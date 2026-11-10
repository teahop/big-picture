"""Level 1 and Level 2 node tables (SPEC 5.2 and 5.3).

Industry Level 1 = the Employment Matrix "Line item" industries inside each sector, plus an
explicit "other, not separately listed" remainder node per sector where the line items do not
add up to the sector total, so Level 1 always reconciles with Level 0.
Research Level 1 = OpenAlex subfields; Level 2 = topics under the deep-zone subfields.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .common import interim_dir, load_deep_zones, report_dir
from .sectors import ALL_OCC, SECTOR_CODES, SHORT_LABEL

REMAINDER_MIN_SHARE = 0.01   # remainder nodes smaller than 1% of the sector (and 5k jobs) are dropped
REMAINDER_MIN_K = 5.0
GROWTH_MIN_BASE = 20         # publication growth is undefined below this many works in the base year


def industry_level1(inds: pd.DataFrame, cells: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Returns (nodes, occupation cells per node, reconciliation per sector)."""
    tot = cells[cells["occ_code"] == ALL_OCC].set_index("ind_code")
    lines = inds[(inds["ind_type"] == "Line item") & inds["sector_code"].notna() & (inds["level"].astype(str) == "1")]
    detail = cells[(cells["occ_type"] == "Line item") & (cells["occ_code"] != ALL_OCC)]
    nodes, occ_rows, rec = [], [], []
    for sector in SECTOR_CODES:
        kids = lines[lines["sector_code"] == sector]
        emp25 = float(tot.loc[sector, "emp_2025"]); emp35 = float(tot.loc[sector, "emp_2035"])
        kid_codes = list(kids["ind_code"])
        for r in kids.itertuples():
            e25, e35 = float(tot.loc[r.ind_code, "emp_2025"]), float(tot.loc[r.ind_code, "emp_2035"])
            nodes.append({"node_id": f"ind:{r.ind_code}", "ind_code": r.ind_code, "title": r.ind_title,
                          "label": r.ind_title, "parent_id": f"ind:{sector}", "sector_code": sector,
                          "emp_2025": e25, "emp_2035": e35, "remainder": False})
        part = detail[detail["ind_code"].isin(kid_codes)]
        occ_rows.append(part[["ind_code", "occ_code", "emp_2025"]])
        rem25, rem35 = emp25 - sum(n["emp_2025"] for n in nodes if n["sector_code"] == sector), \
            emp35 - sum(n["emp_2035"] for n in nodes if n["sector_code"] == sector)
        keep = rem25 >= max(REMAINDER_MIN_SHARE * emp25, REMAINDER_MIN_K)
        rec.append({"sector_code": sector, "sector_emp_2025": emp25, "line_items": len(kid_codes),
                    "line_item_sum": emp25 - rem25, "remainder": rem25, "remainder_node": bool(keep)})
        if keep:
            code = f"{sector}-other"
            nodes.append({"node_id": f"ind:{code}", "ind_code": code,
                          "title": f"Other {SHORT_LABEL[sector]} (not separately listed in the matrix)",
                          "label": f"Other: {SHORT_LABEL[sector]}", "parent_id": f"ind:{sector}", "sector_code": sector,
                          "emp_2025": rem25, "emp_2035": rem35, "remainder": True})
            sec_cells = detail[detail["ind_code"] == sector].set_index("occ_code")["emp_2025"]
            used = part.groupby("occ_code")["emp_2025"].sum()
            resid = (sec_cells - used.reindex(sec_cells.index).fillna(0.0)).clip(lower=0.0)
            resid = resid[resid > 0]
            occ_rows.append(pd.DataFrame({"ind_code": code, "occ_code": resid.index, "emp_2025": resid.values}))
    n = pd.DataFrame(nodes)
    n["growth"] = np.where(n["emp_2025"] > 0, (n["emp_2035"] - n["emp_2025"]) / n["emp_2025"] * 100, 0.0)
    return n, pd.concat(occ_rows, ignore_index=True), pd.DataFrame(rec)


def growth_from_counts(yc: pd.DataFrame, level: str, a: int = 2019, b: int = 2024) -> pd.Series:
    """Publication growth in percent from yearly counts (a to b); NaN where the base is too small."""
    sub = yc[yc["level"] == level].pivot_table(index="id", columns="year", values="works_us", aggfunc="sum", fill_value=0)
    base, end = sub.get(a, 0), sub.get(b, 0)
    g = (end / base.where(base >= GROWTH_MIN_BASE) - 1) * 100
    return g.rename("growth")


def research_levels() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Subfield (Level 1) and deep-zone topic (Level 2) nodes with sizes. R&D dollars are not published
    below field level, so they are allocated pro rata by US works (an estimate)."""
    oa = interim_dir() / "openalex"
    fields = pd.read_csv(oa / "fields.csv", dtype={"id": str})
    subs = pd.read_csv(oa / "subfields.csv", dtype={"id": str, "field_id": str})
    topics = pd.read_csv(oa / "topics.csv", dtype={"id": str, "subfield_id": str})
    rd = pd.read_csv(interim_dir() / "herd" / "field_rd.csv", dtype={"id": str}).set_index("id")["rd_thousands"]
    yc = pd.read_csv(oa / "level_year_counts.csv", dtype={"id": str})
    subs = subs[subs["works_global"] > 0].copy()   # subfields with no works at all in the current classifier are not drawn
    subs["field_works"] = subs.groupby("field_id")["works_us"].transform("sum")
    subs["rd"] = subs["field_id"].map(rd) * subs["works_us"] / subs["field_works"].replace(0, np.nan)
    subs["rd"] = subs["rd"].fillna(0.0)
    subs["growth"] = subs["id"].map(growth_from_counts(yc, "subfield"))
    subs["node_id"] = "fld:" + subs["id"]; subs["parent_id"] = "fld:" + subs["field_id"]
    deep = {z["id"] for z in load_deep_zones()["research_subfields"]}
    t = topics[topics["subfield_id"].isin(deep)].copy()
    sub_works = subs.set_index("id")["works_us"]; sub_rd = subs.set_index("id")["rd"]
    t["rd"] = t["subfield_id"].map(sub_rd) * t["works_us"] / t["subfield_id"].map(sub_works).replace(0, np.nan)
    t["rd"] = t["rd"].fillna(0.0)
    t["growth"] = t["id"].map(growth_from_counts(yc, "topic"))
    t["node_id"] = "fld:" + t["id"]; t["parent_id"] = "fld:" + t["subfield_id"]
    return subs, t


def run() -> int:
    bls = interim_dir() / "bls"
    inds = pd.read_csv(bls / "industries.csv", dtype=str)
    cells = pd.read_csv(bls / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    nodes, occ, rec = industry_level1(inds, cells)
    out = interim_dir() / "levels"; out.mkdir(parents=True, exist_ok=True)
    nodes.to_csv(out / "industry_l1.csv", index=False); occ.to_csv(out / "industry_l1_occupations.csv", index=False)
    subs, topics = research_levels()
    subs.to_csv(out / "subfields_l1.csv", index=False); topics.to_csv(out / "topics_l2.csv", index=False)
    sec = nodes.groupby("sector_code")[["emp_2025", "emp_2035"]].sum()
    tot = cells[cells["occ_code"] == ALL_OCC].set_index("ind_code")
    lines = ["# levels validation report",
             f"- industry Level 1 nodes: {len(nodes)} ({int(nodes.remainder.sum())} remainder nodes) under {nodes.sector_code.nunique()} sectors",
             f"- subfield Level 1 nodes: {len(subs)}; deep-zone topic Level 2 nodes: {len(topics)}",
             "", "## Level 1 industries reconcile with Level 0 (2025 employment, thousands)", "",
             "| Sector | Sector total | Sum of Level 1 | Diff |", "|---|---|---|---|"]
    for c in SECTOR_CODES:
        lines.append(f"| {SHORT_LABEL[c]} | {tot.loc[c, 'emp_2025']:,.1f} | {sec.loc[c, 'emp_2025']:,.1f} | {sec.loc[c, 'emp_2025'] - tot.loc[c, 'emp_2025']:+.1f} |")
    f_tot = subs.groupby("field_id")["works_us"].sum()
    fld = pd.read_csv(interim_dir() / "openalex" / "fields.csv", dtype={"id": str}).set_index("id")["works_us"]
    all_subs = pd.read_csv(interim_dir() / "openalex" / "subfields.csv")
    lines += ["", f"- subfields dropped for having zero works globally: {', '.join(all_subs[all_subs.works_global == 0]['name'])}",
              f"- subfield US works sum {int(subs.works_us.sum()):,} vs field sum {int(fld.sum()):,} (max per-field diff {int((f_tot - fld.reindex(f_tot.index)).abs().max())})",
              f"- R&D allocated to subfields {subs.rd.sum():,.0f}k vs fields {pd.read_csv(interim_dir() / 'herd' / 'field_rd.csv').rd_thousands.sum():,.0f}k (pro rata by works)",
              f"- topics with undefined growth (base year under {GROWTH_MIN_BASE} works): {int(topics.growth.isna().sum())}; subfields: {int(subs.growth.isna().sum())}"]
    (report_dir() / "levels.md").write_text("\n".join(lines) + "\n")
    print(f"levels: {len(nodes)} industry L1, {len(subs)} subfield L1, {len(topics)} topic L2")
    return 0
