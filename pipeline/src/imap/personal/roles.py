"""Role history -> tenure (SPEC 7.2, 7.3).

Month allocation ("children first"): every month is worth at most 1 person-month. Roles active in a month
share it in proportion to their weight (a self-directed build weighs 0.5, so alone it fills half a month);
the umbrella entity (the owner's own consultancy) receives only what is left over. Hence no month is counted
twice, a full-time role pauses the umbrella automatically, and concurrent roles split the month.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime

import numpy as np
import pandas as pd

from ..embed import embed
from .base import NodeTable, load_profile, personal_root, private_dir, top_shares

MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DASH = r"\s*[–—\-]\s*|\s+to\s+"
PRESENT = re.compile(r"present|current|now", re.I)


@dataclass
class Role:
    no: int
    start: int | None            # month index (year * 12 + month - 1), inclusive
    end: int | None              # exclusive
    weight: float = 1.0
    umbrella: bool = False
    included: bool = True
    flags: list[str] = field(default_factory=list)


def mi(year: int, month: int) -> int:
    return year * 12 + month - 1


def parse_dates(raw, as_of: date) -> tuple[int | None, int | None, list[str]]:
    """Month indices [start, end) and flags. Only month-resolved ranges are `clean`; the rest carry flags."""
    now = mi(as_of.year, as_of.month) + 1
    if isinstance(raw, (datetime, date)):
        return mi(raw.year, raw.month), now, ["single date: assumed to run to the present"]
    text = str(raw or "").strip()
    flags: list[str] = []
    if re.search(r"confirm|~|approx|early|late|mid", text, re.I):
        flags.append("approximate date")
    parts = re.split(DASH, re.sub(r"\(.*?\)", "", text).strip(" ~"), maxsplit=1)
    if len(parts) == 1:
        y = re.fullmatch(r"~?\s*(\d{4})", parts[0].strip())
        if y:
            return mi(int(y.group(1)), 1), mi(int(y.group(1)), 1) + 12, flags + ["year only"]
        return None, None, flags + ["dates not parseable"]

    def point(s: str, is_end: bool) -> tuple[int | None, bool]:
        s = s.strip().lstrip("~ ")
        if PRESENT.search(s):
            return now, True
        m = re.fullmatch(r"([A-Za-z]{3,9})\.?\s+(\d{4})", s)
        if m and m.group(1)[:3].lower() in MONTHS:
            idx = mi(int(m.group(2)), MONTHS[m.group(1)[:3].lower()])
            return (idx + 1 if is_end else idx), True
        e = re.fullmatch(r"(?:early|mid|late)?\s*(\d{4})", s, re.I)
        if e:
            return mi(int(e.group(1)), 7), False        # year only: mid-year
        return None, False

    s0, ok0 = point(parts[0], False)
    s1, ok1 = point(parts[1], True)
    if s0 is None or s1 is None:
        return None, None, flags + ["dates not parseable"]
    if not (ok0 and ok1):
        flags.append("year-only endpoint")
    if s1 <= s0:
        flags.append("end not after start")
    return s0, s1, flags


def parse_duration(raw) -> float | None:
    """Months from strings like '2 yrs 5 mos', '~1.5 yrs', '13+ yrs', '~9 mos'. None when not clean."""
    t = str(raw or "")
    y = re.search(r"(\d+(?:\.\d+)?)\+?\s*yr", t)
    m = re.search(r"(\d+)\s*mo", t)
    if not (y or m):
        return None
    return (float(y.group(1)) * 12 if y else 0.0) + (float(m.group(1)) if m else 0.0)


def allocate_months(roles: list[Role], as_of: date, capacity: float = 1.0) -> dict[int, float]:
    """Person-months per role number (see module docstring). Pure and deterministic.
    `capacity` is the most one calendar month can hold: 1.0 is one full-time month; the owner works 60-80 hours a week,
    so the profile sets about 1.75. Roles beyond the capacity share it by weight; the umbrella still tops a month up to 1.0 only."""
    now = mi(as_of.year, as_of.month) + 1
    active = [r for r in roles if r.included and r.start is not None and r.end is not None and r.end > r.start]
    others, umb = [r for r in active if not r.umbrella], [r for r in active if r.umbrella]
    out = {r.no: 0.0 for r in active}
    lo = min((r.start for r in active), default=now); hi = max((min(r.end, now) for r in active), default=now)
    for m in range(lo, hi):
        live = [r for r in others if r.start <= m < r.end]
        wsum = sum(r.weight for r in live)
        used = min(capacity, wsum)
        for r in live:
            out[r.no] += r.weight / wsum * used
        for u in umb:
            if u.start <= m < u.end:
                out[u.no] += max(0.0, 1.0 - used)
    return out


def load_workbook() -> pd.DataFrame:
    path = personal_root() / "TJH_Database.xlsx"
    df = pd.read_excel(path, sheet_name="Experience Database")
    extra = private_dir() / "extra_roles.csv"       # roles the owner adds without editing their workbook (columns as the workbook)
    if extra.exists():
        add = pd.read_csv(extra)
        df = pd.concat([df, add.reindex(columns=df.columns)], ignore_index=True)
    return df


def _rules(profile: dict) -> dict:
    r = profile.get("role_rules", {}) or {}
    return {"umbrella": r.get("umbrella_row"), "builds": set(r.get("self_directed_rows", [])), "excluded": set(r.get("excluded_rows", []))}


def build_roles(df: pd.DataFrame, profile: dict, as_of: date) -> list[Role]:
    rules = _rules(profile)
    wb = float(profile.get("presence", {}).get("self_directed_builds_weight", 0.5))
    roles = []
    for r in df.itertuples(index=False):
        no = int(r[0])
        s, e, flags = parse_dates(r[df.columns.get_loc("Dates")], as_of)
        role = Role(no, s, e, weight=wb if no in rules["builds"] else 1.0, umbrella=(no == rules["umbrella"]),
                    included=no not in rules["excluded"], flags=flags)
        if not role.included:
            role.flags.append("excluded by role_rules (did not proceed or aggregate)")
        dur = parse_duration(r[df.columns.get_loc("Duration")])
        if dur and s is not None and e is not None and not PRESENT.search(str(r[df.columns.get_loc("Dates")])):
            cal = e - s
            if abs(cal - dur) > max(3.0, 0.25 * dur):
                role.flags.append(f"duration text says {dur:.0f} months, dates give {cal}")
        if s is None and role.included:
            role.flags.append("no usable dates: carries no tenure until corrected")
        roles.append(role)
    return roles


def apply_corrections(roles: list[Role], path) -> dict[int, str]:
    """Owner corrections: `no,field,value` rows; fields start|end (YYYY-MM), status (included|excluded), weight, nodes."""
    nodes: dict[int, str] = {}
    if not path.exists():
        return nodes
    for c in pd.read_csv(path, dtype=str).itertuples(index=False):
        role = next((r for r in roles if r.no == int(c.no)), None)
        if role is None:
            continue
        if c.field in ("start", "end"):
            y, m = map(int, c.value.split("-"))
            setattr(role, c.field, mi(y, m) + (1 if c.field == "end" else 0))
            role.flags = [f for f in role.flags if "date" not in f and "year" not in f and "endpoint" not in f and "usable" not in f]
        elif c.field == "status":
            role.included = c.value == "included"
        elif c.field == "weight":
            role.weight = float(c.value)
        elif c.field == "nodes":
            nodes[role.no] = c.value
    return nodes


def propose(df: pd.DataFrame, nodes: NodeTable):
    ind = nodes.finest("ind")
    iv = embed([nodes.text(r) for r in ind.itertuples()])
    occ = pd.read_csv(__import__("imap.common", fromlist=["interim_dir"]).interim_dir() / "onet" / "occupations.csv", dtype={"soc": str})
    ov = embed([f"{r.title}. {r.description}"[:300] for r in occ.itertuples()])
    col = {c: i for i, c in enumerate(df.columns)}
    texts = [" | ".join(str(x) for x in (r[col["Organization"]], r[col["Role / Title"]], r[col["Sector"]], str(r[col["Summary"]])[:300]) if str(x) != "nan")
             for r in df.itertuples(index=False)]
    rv = embed(texts)
    out = []
    for i in range(len(df)):
        ni = [(ind.index[j], s) for j, s in top_shares(iv @ rv[i])]
        title = str(df.iloc[i]["Role / Title"])
        ti = embed([title if title != "nan" else texts[i]])[0]
        oc = [(occ["soc"][j], s) for j, s in top_shares(ov @ ti)]
        out.append((ni, oc))
    return out


def parse_nodes(value: str) -> list[tuple[str, float]]:
    """'ind:513200:0.6;deep:x:0.4' -> [(node_id, share)]; ids may contain one colon."""
    out = []
    for part in value.split(";"):
        nid, share = part.rsplit(":", 1)
        out.append((nid, float(share)))
    return out


def load_model_proposals(path, nodes: NodeTable) -> dict[int, str]:
    """Model-assisted proposals (private file), validated against the published nodes. Never replaces owner corrections."""
    if not path.exists():
        return {}
    finest = set(nodes.finest("ind")["id"]); out = {}
    for r in pd.read_csv(path, dtype=str).itertuples(index=False):
        pairs = parse_nodes(r.nodes)
        bad = [n for n, _ in pairs if n not in finest]
        if bad or abs(sum(s for _, s in pairs) - 1) > 1e-6:
            raise ValueError(f"model proposal for role {r.no}: unknown or non-finest nodes {bad} or shares not summing to 1")
        out[int(r.no)] = r.nodes
    return out


def run() -> int:
    profile = load_profile()
    as_of = date.fromisoformat(str(profile.get("as_of", date.today().isoformat())))
    df = load_workbook()
    nodes = NodeTable()
    roles = build_roles(df, profile, as_of)
    corr_path = private_dir() / "role_corrections.csv"
    node_corr = apply_corrections(roles, corr_path)
    capacity = float(profile.get("presence", {}).get("month_capacity", 1.0))
    alloc = allocate_months(roles, as_of, capacity)
    prop = propose(df, nodes)
    model = load_model_proposals(private_dir() / "role_proposals_model.csv", nodes)
    col = {c: i for i, c in enumerate(df.columns)}
    now = mi(as_of.year, as_of.month) + 1
    rows = []
    for i, (r, (ni, oc)) in enumerate(zip(roles, prop)):
        raw = df.iloc[i]
        mapped = node_corr.get(r.no) or model.get(r.no) or ";".join(f"{n}:{s:.2f}" for n, s in ni)
        end_idx = None if r.end is None else min(r.end, now)
        rows.append({"no": r.no, "organisation": raw["Organization"], "title": raw["Role / Title"], "dates_raw": raw["Dates"],
                     "start": None if r.start is None else f"{r.start // 12}-{r.start % 12 + 1:02d}",
                     "end": None if end_idx is None else f"{(end_idx - 1) // 12}-{(end_idx - 1) % 12 + 1:02d}",
                     "end_years_before_as_of": None if end_idx is None else max(0.0, (now - end_idx) / 12),
                     "role_type": "umbrella" if r.umbrella else "self-directed build" if r.weight < 1 else "role",
                     "included": r.included, "weight": r.weight, "person_months": round(alloc.get(r.no, 0.0), 2),
                     "provisional": any(("year" in f or "approx" in f or "single date" in f) for f in r.flags) and r.included,
                     "flags": " | ".join(r.flags), "nodes": mapped,
                     "nodes_source": "owner correction" if r.no in node_corr else "model proposal (unreviewed)" if r.no in model else "embedding proposal",
                     "node_labels": "; ".join(nodes.df.loc[n.split(":", 1)[0] + ":" + n.split(":", 1)[1].rsplit(":", 1)[0], "label"] for n in mapped.split(";") if n),
                     "occupations": ";".join(f"occ:{s_}:{w:.2f}" for s_, w in oc)})
    out = pd.DataFrame(rows)
    out.to_csv(private_dir() / "review_roles.csv", index=False)
    inc = out[out["included"] & (out["person_months"] > 0)]
    inc.to_csv(private_dir() / "roles_resolved.csv", index=False)
    start = min(r.start for r in roles if r.included and r.start is not None)
    active_months = sum(1 for m in range(start, now) if any(r.included and r.start is not None and r.start <= m < r.end for r in roles))
    total = float(out["person_months"].sum())
    umb = float(out[out["role_type"] == "umbrella"]["person_months"].sum())
    prov = float(out[out["provisional"]]["person_months"].sum())
    (private_dir() / "report_roles.md").write_text("\n".join([
        "# roles report (private)", "",
        f"- as of {as_of}; career span {now - start} months; months with at least one role {active_months}",
        f"- allocated person-months {total:.1f} against {active_months} active months (a month holds at most {capacity:g}): within capacity: {total <= capacity * active_months + 1e-6}; umbrella share {umb:.1f}",
        f"- provisional roles (approximate or year-only dates): {int(out['provisional'].sum())} carrying {prov:.1f} person-months ({prov / max(total, 1e-9):.0%})",
        f"- needing review: {int((out['flags'] != '').sum())} roles have flags; see review_roles.csv",
        "- owner corrections live in role_corrections.csv (columns no, field, value) and are never overwritten"]) + "\n")
    print(f"roles: {len(inc)} roles with tenure, {total:.0f} person-months over {active_months} active months; {int(out['provisional'].sum())} provisional")
    return 0
