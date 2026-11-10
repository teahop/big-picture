"""Ingest the OpenAlex taxonomy and US/global work counts (SPEC 4 and 6.1).

Authentication: OPENALEX_API_KEY from .env, sent as a Bearer header (never logged).
Budget (checked 2026-11-09): free key = 10,000 credits/day, 1 credit per list call.
Size filter (US-affiliated works, recent five full years):
    authorships.countries:US, type in article|review|book|book-chapter, publication_year:2021-2025
Global count is the entity's own works_count (all years, all types) and is stored
beside it for reference only.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

from .common import interim_dir, raw_dir, repo_root, report_dir

API = "https://api.openalex.org/"
SIZE_FILTER = "authorships.countries:US,type:article|review|book|book-chapter,publication_year:2021-2025"
YEARS = range(2015, 2026)
USER_AGENT = "industry-map-research (github.com/teahop/industry-map)"


def api_key() -> str:
    env = repo_root() / ".env"
    for line in env.read_text().splitlines():
        if line.startswith("OPENALEX_API_KEY="):
            key = line.split("=", 1)[1].strip()
            if key:
                return key
    raise RuntimeError("OPENALEX_API_KEY missing in .env")


class Client:
    def __init__(self) -> None:
        self.key = api_key()
        self.calls = 0

    def get(self, path: str, **params: str | int) -> dict:
        url = API + path + "?" + urllib.parse.urlencode(params, safe=":|,*")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.key}", "User-Agent": USER_AGENT})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    self.calls += 1
                    time.sleep(0.05)
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503) and attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise
        raise RuntimeError("unreachable")

    def paged(self, path: str, key: str = "results", **params: str | int) -> list[dict]:
        out, cursor = [], "*"
        while cursor:
            d = self.get(path, per_page=200 if key == "group_by" else 100, cursor=cursor, **params)
            out += d[key]
            cursor = d["meta"].get("next_cursor")
        return out


def short(openalex_id: str) -> str:
    return openalex_id.rstrip("/").split("/")[-1]


def entity_table(rows: list[dict], level: str) -> pd.DataFrame:
    recs = []
    for r in rows:
        rec = {"id": short(r["id"]), "name": r["display_name"], "description": r.get("description") or "",
               "alternatives": "; ".join(r.get("display_name_alternatives") or []),
               "works_global": r.get("works_count"), "cited_by_global": r.get("cited_by_count")}
        for parent in ("domain", "field", "subfield"):
            if r.get(parent):
                rec[f"{parent}_id"] = short(r[parent]["id"])
                rec[f"{parent}_name"] = r[parent]["display_name"]
        if level == "topic":
            rec["keywords"] = "; ".join(k["display_name"] if isinstance(k, dict) else k for k in (r.get("keywords") or []))
        recs.append(rec)
    return pd.DataFrame(recs)


def us_counts(client: Client, group_field: str) -> dict[str, int]:
    groups = client.paged("works", key="group_by", filter=SIZE_FILTER, group_by=group_field)
    return {short(g["key"]): g["count"] for g in groups if g["key"] not in (None, "unknown")}


def field_year_counts(client: Client, field_ids: list[str]) -> pd.DataFrame:
    rows = []
    for f in field_ids:
        flt = f"authorships.countries:US,type:article|review|book|book-chapter,primary_topic.field.id:{f},publication_year:{YEARS.start}-{YEARS.stop - 1}"
        d = client.get("works", filter=flt, group_by="publication_year")
        rows += [{"field_id": f, "year": int(g["key"]), "works_us": g["count"]} for g in d["group_by"]]
    return pd.DataFrame(rows)


def coassignment(client: Client, field_ids: list[str]) -> pd.DataFrame:
    """Row F, column G = US works whose primary topic is in field F and that also carry a topic in field G."""
    mat = pd.DataFrame(0, index=field_ids, columns=field_ids, dtype=float)
    for f in field_ids:
        d = client.get("works", filter=f"{SIZE_FILTER},primary_topic.field.id:{f}", group_by="topics.field.id")
        for g in d["group_by"]:
            gid = short(g["key"]) if g["key"] not in (None, "unknown") else None
            if gid in mat.columns:
                mat.loc[f, gid] = g["count"]
    return mat


def verify_counts(client: Client, fields: pd.DataFrame) -> tuple[pd.DataFrame, int, int]:
    """Independent check: re-count each field with a direct filter query (not group_by) under the
    same size filter, and count works with no topic."""
    rows = []
    for f in fields.itertuples():
        d = client.get("works", filter=f"{SIZE_FILTER},primary_topic.field.id:{f.id}", per_page=1)
        rows.append({"field": f.name, "group_by_count": int(f.works_us), "direct_count": int(d["meta"]["count"])})
    total = client.get("works", filter=SIZE_FILTER, per_page=1)["meta"]["count"]
    no_topic = client.get("works", filter=f"{SIZE_FILTER},primary_topic.id:null", per_page=1)["meta"]["count"]
    return pd.DataFrame(rows), int(total), int(no_topic)


def run() -> int:
    client = Client()
    raw = raw_dir() / "openalex"; raw.mkdir(parents=True, exist_ok=True)
    out = interim_dir() / "openalex"; out.mkdir(parents=True, exist_ok=True)

    tables: dict[str, pd.DataFrame] = {}
    for entity, level in (("domains", "domain"), ("fields", "field"), ("subfields", "subfield"), ("topics", "topic")):
        rows = client.paged(entity)
        (raw / f"{entity}.json").write_text(json.dumps(rows))
        tables[level] = entity_table(rows, level)
    for level, group_field in (("field", "primary_topic.field.id"), ("subfield", "primary_topic.subfield.id"), ("topic", "primary_topic.id")):
        counts = us_counts(client, group_field)
        t = tables[level]; t["works_us"] = t["id"].map(counts).fillna(0).astype(int)
    fields = tables["field"]
    yc = field_year_counts(client, list(fields["id"]))
    co = coassignment(client, list(fields["id"]))
    check, total, no_topic = verify_counts(client, fields)
    for level, t in tables.items():
        t.to_csv(out / f"{level}s.csv", index=False)
    yc.to_csv(out / "field_year_counts.csv", index=False)
    co.to_csv(out / "field_coassignment.csv")

    counts = {k: len(v) for k, v in tables.items()}
    lines = ["# ingest openalex-taxonomy validation report", f"- API calls this run: {client.calls}",
             f"- entity counts (expected 4/26/252/4516): {counts}",
             f"- size filter (US-affiliated): `{SIZE_FILTER}`",
             "- global count = entity works_count (all years, all types)",
             f"- fields, US works sum {int(fields.works_us.sum()):,}; global sum {int(fields.works_global.sum()):,}",
             f"- subfield US sum {int(tables['subfield'].works_us.sum()):,}; topic US sum {int(tables['topic'].works_us.sum()):,}",
             "- note: the OpenAlex topic classifier was replaced in October 2026; counts reflect the classifier live on the retrieval date",
             f"- direct-filter recount of all 26 fields: max abs difference vs group_by = {int((check.group_by_count - check.direct_count).abs().max())} works",
             f"- all works under the size filter: {total:,}; with no topic: {no_topic:,} ({no_topic / total * 100:.1f}%); in a field: {int(fields.works_us.sum()):,}",
             "", "## Fields by US works", "", "| Field | US works 2021-25 | Global works |", "|---|---|---|"]
    for r in fields.sort_values("works_us", ascending=False).itertuples():
        lines.append(f"| {r.name} | {r.works_us:,} | {r.works_global:,} |")
    (report_dir() / "ingest_openalex-taxonomy.md").write_text("\n".join(lines) + "\n")
    print(f"ingest openalex-taxonomy: {counts}; {client.calls} API calls")
    return 0


def counts_by_year(client: Client, flt: str) -> dict[int, int]:
    d = client.get("works", filter=f"authorships.countries:US,type:article|review|book|book-chapter,{flt},publication_year:{YEARS.start}-{YEARS.stop - 1}",
                   group_by="publication_year")
    return {int(g["key"]): g["count"] for g in d["group_by"]}


def run_levels() -> int:
    """Level 1 and 2 research data: subfield co-assignment, subfield and deep-topic yearly counts."""
    from .common import load_deep_zones
    client = Client()
    out = interim_dir() / "openalex"
    subs = pd.read_csv(out / "subfields.csv", dtype={"id": str})
    topics = pd.read_csv(out / "topics.csv", dtype={"id": str, "subfield_id": str})
    sub_ids = list(subs["id"])
    co = pd.DataFrame(0.0, index=sub_ids, columns=sub_ids)
    rows = []
    for sid in sub_ids:
        d = client.get("works", filter=f"{SIZE_FILTER},primary_topic.subfield.id:{sid}", group_by="topics.subfield.id")
        for g in d["group_by"]:
            gid = short(g["key"]) if g["key"] not in (None, "unknown") else None
            if gid in co.columns:
                co.loc[sid, gid] = g["count"]
        for y, n in counts_by_year(client, f"primary_topic.subfield.id:{sid}").items():
            rows.append({"level": "subfield", "id": sid, "year": y, "works_us": n})
    deep = {z["id"] for z in load_deep_zones()["research_subfields"]}
    for tid in topics.loc[topics.subfield_id.isin(deep), "id"]:
        for y, n in counts_by_year(client, f"primary_topic.id:{tid}").items():
            rows.append({"level": "topic", "id": tid, "year": y, "works_us": n})
    co.to_csv(out / "subfield_coassignment.csv")
    yc = pd.DataFrame(rows); yc.to_csv(out / "level_year_counts.csv", index=False)
    (report_dir() / "ingest_openalex-levels.md").write_text(
        "# ingest openalex-levels validation report\n"
        f"- API calls: {client.calls}\n- subfield co-assignment matrix {co.shape}; row sums vs subfield US works: "
        f"max relative gap {float(((co.sum(axis=1) - subs.set_index('id').works_us.reindex(co.index)).abs() / subs.set_index('id').works_us.reindex(co.index).clip(lower=1)).max()):.2f} "
        "(works carry up to 3 topics so row sums exceed works)\n"
        f"- yearly counts: {len(yc):,} rows ({(yc.level == 'subfield').sum():,} subfield, {(yc.level == 'topic').sum():,} topic)\n")
    print(f"ingest openalex-levels: {client.calls} API calls")
    return 0
