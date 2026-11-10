"""Level 2 industry `deep:` nodes (SPEC 5.3), built from the owner-reviewed categories.

Every deep node is `estimated`. A node splits the official BLS employment of the Level 1 industries it
sits under, so a zone's deep nodes always add up to the BLS total of the industries they replace.
Within a parent industry the split follows each category's size proxy, converted to one comparable
quantity (jobs):
  * official share  - QCEW 2025 employment for a NAICS slice, or IPEDS 2023 staff by institution type
  * headcount share - published headcounts of the member organisations listed in the category
Shares are normalised inside each parent, so the proxy only decides how a parent is divided.
A category that is the only one under a parent takes the whole parent.
"""
from __future__ import annotations

import csv
import fnmatch
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import yaml

from .common import interim_dir, raw_dir, repo_root, report_dir

MIN_COVERAGE = 0.5      # headcount proxies covering fewer than half of the listed members are flagged weak
FLOOR_SHARE = 0.05      # `minus` calculations never take more than 95% of the quantity they subtract from
CARNEGIE = {"research": {15, 16, 17, 25, 27}, "regional": {18, 19, 20}}
ONLINE_NAMES = {"Western Governors University", "Southern New Hampshire University"}


@dataclass
class Category:
    slug: str
    label: str
    zone: str
    parents: list[str]
    members: list[str]
    proxy: str
    calc: dict | None = None
    headcounts: list[tuple[str, float]] = field(default_factory=list)


def load_categories(zones_in_yaml: dict, ind_codes: set[str]) -> list[Category]:
    out = []
    for z in zones_in_yaml["zones"]:
        zone_parents = [p for p in z["parents"] if p in ind_codes]
        for c in z["categories"]:
            pats = [c["parent"]] if c.get("parent") else z["parents"]
            parents = [p for p in zone_parents if any(fnmatch.fnmatchcase(p, pat) for pat in pats)]
            if not parents:
                raise ValueError(f"category {c['slug']}: no parent industry matches {pats}")
            out.append(Category(c["slug"], c["label"], z["zone"], parents, list(c.get("members", [])), c["proxy"], c.get("calc")))
    return out


def read_headcounts(path) -> dict[str, list[tuple[str, float]]]:
    got: dict[str, list[tuple[str, float]]] = {}
    for r in csv.DictReader(open(path)):
        got.setdefault(r["category_slug"], [])
        if r["headcount"].strip():
            got[r["category_slug"]].append((r["organisation"], float(r["headcount"])))
    return got


# ------------------------------------------------------------------ official slices
def qcew_total(codes: list[str], year: int = 2025) -> float:
    total = 0.0
    for code in codes:
        df = pd.read_csv(raw_dir() / "qcew" / f"{year}_{code}.csv", dtype={"area_fips": str, "industry_code": str})
        total += float(df[df["area_fips"] == "US000"]["annual_avg_emplvl"].sum())
    return total


def qcew_size(industry: str, size_code: int) -> float:
    df = pd.read_csv(raw_dir() / "qcew" / f"size{size_code}.csv", dtype={"area_fips": str, "industry_code": str})
    row = df[(df["area_fips"] == "US000") & (df["industry_code"] == industry) & (df["own_code"] == 5)]
    return float(row[["month1_emplvl", "month2_emplvl", "month3_emplvl"]].mean(axis=1).sum())


def ipeds_groups() -> pd.DataFrame:
    """Total staff (headcount) of four-year institutions by group and control, IPEDS 2023."""
    d = raw_dir() / "ipeds"
    hd = pd.read_csv(d / "hd2023" / "HD2023.csv", encoding="latin1", low_memory=False)
    hd.columns = [c.lstrip("﻿ï»¿") for c in hd.columns]
    eap = pd.read_csv(d / "eap2023" / "eap2023.csv", encoding="latin1", low_memory=False)
    eap.columns = [c.lstrip("﻿ï»¿") for c in eap.columns]
    staff = eap[eap["EAPCAT"] == 10000][["UNITID", "EAPTOT"]]
    df = hd[["UNITID", "INSTNM", "CONTROL", "ICLEVEL", "C21BASIC"]].merge(staff, on="UNITID")
    df = df[df["ICLEVEL"] == 1].copy()
    cb = df["C21BASIC"]
    df["group"] = np.select(
        [(df["CONTROL"] == 3) | df["INSTNM"].isin(ONLINE_NAMES), cb.isin(CARNEGIE["research"]), cb.isin(CARNEGIE["regional"])],
        ["online", "research", "regional"], default="liberal")
    df["public"] = df["CONTROL"] == 1
    return df


def ipeds_staff(df: pd.DataFrame, group: str, parent_code: str) -> float:
    public = parent_code[-1] in ("S", "L")
    return float(df[(df["group"] == group) & (df["public"] == public)]["EAPTOT"].sum())


# ------------------------------------------------------------------ build
def build() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict]:
    ind = pd.read_csv(interim_dir() / "levels" / "industry_l1.csv", dtype={"ind_code": str})
    occ = pd.read_csv(interim_dir() / "levels" / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    onet = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype={"soc": str}).set_index("soc")["title"]
    spec = yaml.safe_load((repo_root() / "data" / "mappings" / "deep_categories.yaml").read_text())
    cats = load_categories(spec, set(ind["ind_code"]))
    hc = read_headcounts(repo_root() / "data" / "mappings" / "deep_headcounts.csv")
    for c in cats:
        c.headcounts = hc.get(c.slug, [])
    by_slug = {c.slug: c for c in cats}
    emp = ind.set_index("ind_code")[["emp_2025", "emp_2035"]]
    ip = None

    raw_cache: dict[tuple[str, str], float] = {}

    def raw(c: Category, parent: str) -> float:
        key = (c.slug, parent if (c.calc or {}).get("kind") == "ipeds" else "")
        if key in raw_cache:
            return raw_cache[key]
        k = (c.calc or {}).get("kind", "headcount")
        if k == "qcew":
            v = qcew_total(c.calc["codes"])
            minus = sum(raw(by_slug[s], parent) for s in c.calc.get("minus", []))
            v = max(v - minus, FLOOR_SHARE * v)
        elif k == "qcew_size":
            v = qcew_size(c.calc["industry"], c.calc["size_code"])
        elif k == "ipeds":
            nonlocal ip
            ip = ipeds_groups() if ip is None else ip
            v = ipeds_staff(ip, c.calc["group"], parent)
        else:
            v = sum(h for _, h in c.headcounts)
        raw_cache[key] = v
        return v

    contrib_rows = []
    for parent in sorted({p for c in cats for p in c.parents}):
        here = [c for c in cats if parent in c.parents]
        vals = np.array([1.0] if len(here) == 1 else [raw(c, parent) for c in here], float)   # a sole category takes the whole parent
        if vals.sum() <= 0:
            raise ValueError(f"parent {parent}: no size information for any of {[c.slug for c in here]}")
        share = vals / vals.sum()
        for c, s, v in zip(here, share, vals):
            if s <= 0:
                continue                      # e.g. no for-profit institutions under a local-government parent
            contrib_rows.append({"slug": c.slug, "parent_code": parent, "share": float(s), "raw": float(v), "sole": len(here) == 1,
                                 "emp_2025": float(emp.loc[parent, "emp_2025"] * s), "emp_2035": float(emp.loc[parent, "emp_2035"] * s)})
    contrib = pd.DataFrame(contrib_rows)

    nodes, occ_rows = [], []
    for c in cats:
        part = contrib[contrib["slug"] == c.slug].sort_values(["emp_2025", "parent_code"], ascending=[False, True])
        e25, e35 = float(part["emp_2025"].sum()), float(part["emp_2035"].sum())
        kind = (c.calc or {}).get("kind", "headcount")
        sole = bool(part["sole"].all())
        n_data = len(c.headcounts)
        coverage = n_data / len(c.members) if c.members else 1.0
        if sole:
            basis, weak = "only category under its parent industry, so it takes the whole BLS total", False
        elif kind == "headcount":
            weak = coverage < MIN_COVERAGE or n_data < 2
            basis = f"headcount share: published headcounts for {n_data} of {len(c.members)} listed organisations, scaled to the BLS total of its parent industry"
        elif kind == "ipeds":
            weak, basis = False, "official share: IPEDS 2023 total staff of four-year institutions of this type, scaled to the BLS total of each parent industry"
        else:
            weak, basis = False, "official share: BLS QCEW 2025 employment" + (" minus listed organisations counted elsewhere" if c.calc.get("minus") else "") + ", scaled to the BLS total of its parent industry"
        proxy = basis + (" (weak: few headcounts found)" if weak else "")
        nodes.append({"node_id": f"deep:{c.slug}", "slug": c.slug, "label": c.label, "title": c.label, "zone": c.zone,
                      "parent_id": f"ind:{part.iloc[0]['parent_code']}", "replaces": ";".join(f"ind:{p}" for p in part["parent_code"]),
                      "emp_2025": e25, "emp_2035": e35, "growth": (e35 - e25) / e25 * 100 if e25 else 0.0,
                      "proxy_kind": "whole parent" if sole else kind, "size_proxy": proxy, "weak": weak,
                      "members": "; ".join(c.members), "members_with_data": n_data, "members_listed": len(c.members)})
        for r in part.itertuples():
            o = occ[occ["ind_code"] == r.parent_code]
            tot = float(o["emp_2025"].sum())
            if tot > 0:
                occ_rows.append(pd.DataFrame({"node_id": f"deep:{c.slug}", "occ_code": o["occ_code"], "emp_2025": o["emp_2025"] / tot * r.emp_2025}))
    node_df = pd.DataFrame(nodes)
    occ_df = pd.concat(occ_rows).groupby(["node_id", "occ_code"], as_index=False)["emp_2025"].sum()
    contrib["node_id"] = "deep:" + contrib["slug"]
    contrib["parent_id"] = "ind:" + contrib["parent_code"]
    return node_df, contrib, occ_df, {"ipeds": ip, "onet": onet}


def topic_links() -> pd.DataFrame:
    """Cosine similarity of every deep: node to every Level 2 research topic (all pairs, long form)."""
    from .embed import embed
    deep = pd.read_csv(interim_dir() / "levels" / "deep_industry.csv")
    topics = pd.read_csv(interim_dir() / "levels" / "topics_l2.csv", dtype={"id": str})
    dv = embed([f"{r.label}. {r.zone}. Examples: {r.members if isinstance(r.members, str) else ''}" for r in deep.itertuples()])
    tv = embed([f"{r.name}. {r.description if isinstance(r.description, str) else ''} {r.keywords if isinstance(r.keywords, str) else ''}" for r in topics.itertuples()])
    sim = dv @ tv.T
    rows = [{"deep_id": d, "topic_node": tn, "topic": tname, "subfield": sf, "cosine": float(sim[i, j])}
            for i, d in enumerate(deep["node_id"]) for j, (tn, tname, sf) in enumerate(zip(topics["node_id"], topics["name"], topics["subfield_name"]))]
    return pd.DataFrame(rows)


def run() -> int:
    node_df, contrib, occ_df, extra = build()
    out = interim_dir() / "levels"
    node_df.to_csv(out / "deep_industry.csv", index=False)
    contrib.to_csv(out / "deep_industry_contrib.csv", index=False)
    occ_df.to_csv(out / "deep_industry_occupations.csv", index=False)

    ind = pd.read_csv(out / "industry_l1.csv", dtype={"ind_code": str}).set_index("ind_code")
    rec = contrib.groupby("parent_code")["emp_2025"].sum()
    worst = float((rec - ind.loc[rec.index, "emp_2025"]).abs().max())
    lines = ["# deep: industry nodes validation report", "",
             f"- deep nodes: {len(node_df)}; parent industries replaced: {contrib['parent_code'].nunique()}",
             f"- reconciliation: largest gap between the deep nodes and the BLS total of a parent industry = {worst:.6f} thousand jobs",
             f"- weak size proxies: {int(node_df['weak'].sum())} ({', '.join(node_df[node_df['weak']]['slug']) or 'none'})", ""]
    for zone, g in node_df.groupby("zone", sort=False):
        lines += [f"## {zone}", "", "| Node | Jobs 2025 (k) | Share of zone | Proxy | Members with data |", "|---|---|---|---|---|"]
        tot = g["emp_2025"].sum()
        for r in g.sort_values("emp_2025", ascending=False).itertuples():
            lines.append(f"| {r.label} | {r.emp_2025:,.1f} | {r.emp_2025 / tot:.0%} | {r.proxy_kind}{' (weak)' if r.weak else ''} | {r.members_with_data} of {r.members_listed} |")
        lines.append("")
    if extra["ipeds"] is not None:
        ip = extra["ipeds"]
        t = ip.groupby(["group", "public"])["EAPTOT"].sum().unstack()
        lines += ["## IPEDS 2023 four-year staff by group (headcount)", "", "| Group | Private | Public |", "|---|---|---|"]
        lines += [f"| {g} | {t.loc[g, False]:,.0f} | {t.loc[g, True]:,.0f} |" for g in t.index] + [""]
    links = topic_links()
    links.sort_values(["deep_id", "cosine"], ascending=[True, False]).groupby("deep_id").head(10).to_csv(out / "deep_topic_links.csv", index=False)
    rep = ["# deep: industry to research-topic links (embedding similarity) - for owner review", "",
           "Top 5 Level 2 research topics per deep: node, by cosine similarity of the node's text (label, zone, example organisations) to the topic's text.", ""]
    labels = dict(zip(node_df["node_id"], node_df["label"]))
    for d, g in links.groupby("deep_id", sort=False):
        rep += [f"### {labels[d]}", ""] + [f"- {r.cosine:.2f}  {r.topic} ({r.subfield})" for r in g.sort_values("cosine", ascending=False).head(5).itertuples()] + [""]
    (report_dir() / "deep_topic_links.md").write_text("\n".join(rep) + "\n")
    (report_dir() / "deep_industry.md").write_text("\n".join(lines) + "\n")
    print(f"deep: {len(node_df)} nodes, reconciliation gap {worst:.2e}, weak proxies: {int(node_df['weak'].sum())}")
    return 0
