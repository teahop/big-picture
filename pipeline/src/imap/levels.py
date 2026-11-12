"""Level 1 industry node table (SPEC 5.2).

Industry Level 1 = the Employment Matrix "Line item" industries inside each sector, plus an
explicit "other, not separately listed" remainder node per sector where the line items do not
add up to the sector total, so Level 1 always reconciles with Level 0.
Level 2 is the deep: industry categories (deep_industry.py).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .common import interim_dir, report_dir
from .sectors import ALL_OCC, SECTOR_CODES, SHORT_LABEL

REMAINDER_MIN_SHARE = 0.01   # remainder nodes smaller than 1% of the sector (and 5k jobs) are dropped
REMAINDER_MIN_K = 5.0


def industry_level1(inds: pd.DataFrame, cells: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Returns (nodes, occupation cells per node, reconciliation per sector)."""
    tot = cells[cells["occ_code"] == ALL_OCC].set_index("ind_code")
    official = inds.set_index("ind_code")["ind_title"]
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
                          # the title feeds the layout's text similarity, so it uses the official sector title, not the display label
                          "title": f"Other {official[sector]} (not separately listed in the matrix)",
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


def run() -> int:
    bls = interim_dir() / "bls"
    inds = pd.read_csv(bls / "industries.csv", dtype=str)
    cells = pd.read_csv(bls / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    nodes, occ, rec = industry_level1(inds, cells)
    out = interim_dir() / "levels"; out.mkdir(parents=True, exist_ok=True)
    nodes.to_csv(out / "industry_l1.csv", index=False); occ.to_csv(out / "industry_l1_occupations.csv", index=False)
    sec = nodes.groupby("sector_code")[["emp_2025", "emp_2035"]].sum()
    tot = cells[cells["occ_code"] == ALL_OCC].set_index("ind_code")
    lines = ["# levels validation report",
             f"- industry Level 1 nodes: {len(nodes)} ({int(nodes.remainder.sum())} remainder nodes) under {nodes.sector_code.nunique()} sectors",
             "", "## Level 1 industries reconcile with Level 0 (2025 employment, thousands)", "",
             "| Sector | Sector total | Sum of Level 1 | Diff |", "|---|---|---|---|"]
    for c in SECTOR_CODES:
        lines.append(f"| {SHORT_LABEL[c]} | {tot.loc[c, 'emp_2025']:,.1f} | {sec.loc[c, 'emp_2025']:,.1f} | {sec.loc[c, 'emp_2025'] - tot.loc[c, 'emp_2025']:+.1f} |")
    (report_dir() / "levels.md").write_text("\n".join(lines) + "\n")
    print(f"levels: {len(nodes)} industry L1")
    return 0
