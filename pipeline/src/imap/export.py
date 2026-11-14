"""Write the public bundle: industry nodes, edges, height grids, metadata. No personal data."""
from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir, repo_root, sha256
from .bls import MATRIX_PATH
from .sectors import SECTOR_CODES, SHORT_LABEL
from .terrain import SETTINGS, hill_shape

SOURCE = {
    "name": "BLS National Employment Matrix",
    "release": "2025-35 projection cycle (base year 2025, projected year 2035)",
    "url": "https://www.bls.gov/emp/ind-occ-matrix/matrix.xlsx",
    "retrieved": "2026-11-09",
    "retrieval_note": "saved by hand: BLS blocks scripted downloads",
    "industry_coding": "NAICS 2022 based; occupations SOC 2018",
}


def top_occupations(cells: pd.DataFrame, occs: pd.DataFrame, code: str, n: int = 5) -> list[dict]:
    sub = cells[(cells["ind_code"] == code) & (cells["occ_type"] == "Line item")]
    sub = sub.sort_values(["pct_ind_2025", "occ_code"], ascending=[False, True]).head(n)
    title = occs.set_index("occ_code")["occ_title"]
    return [{"soc": r.occ_code, "title": title[r.occ_code], "share_pct": float(r.pct_ind_2025)} for r in sub.itertuples()]


def build_nodes() -> list[dict]:
    bls = interim_dir() / "bls"
    totals = pd.read_csv(bls / "sector_totals.csv", dtype={"ind_code": str}).set_index("ind_code")
    cells = pd.read_csv(bls / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    occs = pd.read_csv(bls / "occupations.csv", dtype={"occ_code": str})
    layout = json.loads((public_dir() / "layout.json").read_text())["nodes"]
    nodes = []
    for code in SECTOR_CODES:
        t = totals.loc[code]
        nid = f"ind:{code}"
        nodes.append({
            "id": nid, "label": SHORT_LABEL[code], "title": t["ind_title"], "type": "ind", "level": 0,
            "parent": None, "naics_code": code, "provenance": "official",
            "size": {"employment": round(float(t["emp_2025"]), 1), "employment_2035": round(float(t["emp_2035"]), 1)},
            "growth": round(float(t["pct_chg"]), 2),
            "xy": layout[nid], "top_occupations": top_occupations(cells, occs, code),
        })
    return nodes


def _ok(x: float) -> float | None:
    return None if x != x else round(float(x), 2)


LABELS_PATH = "data/mappings/industry_labels.csv"
CODE_LIST = re.compile(r"\s*\(\s*\d[\d.,\s]*(?:and\s+\d+\s*)?(?:only)?\)\s*$")   # a trailing list of NAICS codes, e.g. " (3251,2,3,9)", " (4594 and 4595 only)"


def display_label(node_id: str, label: str, remainder: bool, sector: str, named: dict[str, str]) -> str:
    """The name shown on the map: a reviewed name for a matrix line item that bundles several NAICS industries (built from
    their NAICS 2022 titles, data/mappings/industry_labels.csv), the sector's own name for the rest of a sector that the
    matrix does not list separately (owner, 2026-11-13: no "Other:" prefix), otherwise the matrix title without any
    trailing NAICS code list. The official title stays in `title` for the details panel."""
    if node_id in named:
        return named[node_id]
    if remainder:
        return SHORT_LABEL[sector]
    return CODE_LIST.sub("", label)


def level1_nodes(ch: dict) -> list[dict]:
    lv = interim_dir() / "levels"
    ind = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    occ = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    onet = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype={"soc": str}).set_index("soc")["title"]
    occ = occ.astype({"emp_2025": float})
    named = dict(pd.read_csv(repo_root() / LABELS_PATH)[["node_id", "label"]].itertuples(index=False, name=None))
    nodes = []
    for r in ind.itertuples():
        sub = occ[occ.ind_code == r.ind_code]
        tot = sub["emp_2025"].sum() or 1.0
        top = sub.sort_values(["emp_2025", "occ_code"], ascending=[False, True]).head(5)
        nodes.append({"id": r.node_id, "label": display_label(r.node_id, r.label, bool(r.remainder), str(r.sector_code), named), "title": r.title, "type": "ind", "level": 1, "parent": r.parent_id,
                      "naics_code": r.ind_code, "provenance": "official", "remainder": bool(r.remainder),
                      "size": {"employment": round(float(r.emp_2025), 1), "employment_2035": round(float(r.emp_2035), 1)},
                      "growth": round(float(r.growth), 2), "xy": ch[r.node_id],
                      "top_occupations": [{"soc": o.occ_code, "title": onet.get(o.occ_code, o.occ_code), "share_pct": round(float(o.emp_2025 / tot * 100), 1)} for o in top.itertuples()]})
    return nodes


def deep_nodes(ch: dict) -> list[dict]:
    lv = interim_dir() / "levels"
    if not (lv / "deep_industry.csv").exists():
        return []
    deep = pd.read_csv(lv / "deep_industry.csv")
    occ = pd.read_csv(lv / "deep_industry_occupations.csv", dtype={"occ_code": str})
    contrib = pd.read_csv(lv / "deep_industry_contrib.csv", dtype={"parent_code": str})
    # how each deep: node's weight divides over the Level 1 industries it replaces (its jobs drawn from each)
    up = {d: {f"ind:{p}": round(float(e / g["emp_2025"].sum()), 4) for p, e in zip(g["parent_code"], g["emp_2025"])} for d, g in contrib.groupby("node_id")}
    onet = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype={"soc": str}).set_index("soc")["title"]
    nodes = []
    for r in deep.itertuples():
        sub = occ[occ.node_id == r.node_id]; tot = sub["emp_2025"].sum() or 1.0
        top = sub.sort_values(["emp_2025", "occ_code"], ascending=[False, True]).head(5)
        nodes.append({"id": r.node_id, "label": r.label, "title": r.title, "type": "ind", "level": 2, "parent": r.parent_id,
                      "replaces": [x for x in r.replaces.split(";") if x != r.parent_id], "replaces_share": up[r.node_id], "provenance": "estimated",
                      "size_proxy": r.size_proxy, "weak_proxy": bool(r.weak), "zone": r.zone,
                      "members": [m for m in (r.members.split("; ") if isinstance(r.members, str) else []) if m],
                      "size": {"employment": round(float(r.emp_2025), 1), "employment_2035": round(float(r.emp_2035), 1)},
                      "growth": round(float(r.growth), 2), "xy": ch[r.node_id],
                      "top_occupations": [{"soc": o.occ_code, "title": onet.get(o.occ_code, o.occ_code), "share_pct": round(float(o.emp_2025 / tot * 100), 1)} for o in top.itertuples()]})
    return nodes


def add_dollar_measures(nodes: list[dict]) -> None:
    """Value added ($ billions, BEA 2025, split to the map's industries by payroll: estimated below the sector) and value
    added per job ($ thousands)."""
    lv = interim_dir() / "levels"
    va: dict[str, float] = {}
    if (lv / "industry_value.csv").exists():
        v = pd.read_csv(lv / "industry_value.csv", dtype={"ind_code": str, "sector_code": str})
        va.update(dict(zip(v["node_id"], v["value_added_usd_b"])))
        va.update({f"ind:{s}": float(x) for s, x in v.groupby("sector_code")["value_added_usd_b"].sum().items()})
        if (lv / "deep_industry_value.csv").exists():
            d = pd.read_csv(lv / "deep_industry_value.csv")
            va.update(dict(zip(d["node_id"], d["value_added_usd_b"])))
    for n in nodes:
        s = n["size"]
        if n["type"] == "ind" and n["id"] in va and s.get("employment"):
            s["value_added"] = round(va[n["id"]], 2)
            s["va_per_job"] = round(va[n["id"]] * 1000.0 / s["employment"], 1)
            n["value_added_basis"] = ("BEA value added by sector (government value added shared by payroll)" if n["level"] == 0 else
                                      "estimated from the industry's parent industries" if n["id"].startswith("deep:") else
                                      "estimated: BEA summary industry split by payroll")


def _topk_pairs(sim: pd.DataFrame, k: int) -> set[tuple[str, str]]:
    keep: set[tuple[str, str]] = set()
    arr = sim.to_numpy(); cols = list(sim.columns)
    for i, a in enumerate(sim.index):
        for j in [j for j in np.argsort(-arr[i], kind="stable") if cols[j] != a][:k]:
            keep.add(tuple(sorted((a, cols[j]))))
    return keep


def level1_edges(k: int = 5) -> list[dict]:
    isim = pd.read_csv(interim_dir() / "graph_l1" / "industry_similarity.csv", index_col=0).rename(index=str, columns=str)
    return [{"source": f"ind:{a}", "target": f"ind:{b}", "type": "ind-ind", "weight": round(float(isim.loc[a, b]), 4)} for a, b in sorted(_topk_pairs(isim, k))]


def add_positions(nodes: list[dict], by_setting: dict[str, dict]) -> None:
    """v3: each node's position per size setting (y follows the active size measure); `xy` stays the Jobs position."""
    for n in nodes:
        if by_setting and all(n["id"] in by_setting[s] for s in by_setting):
            n["xy_by"] = {s: by_setting[s][n["id"]] for s in sorted(by_setting)}


def run(target: str) -> int:
    if target != "public":
        print("imap export: only --target public exists (no private target).")
        return 2
    out = public_dir()
    out.mkdir(parents=True, exist_ok=True)
    nodes = build_nodes()
    layout = json.loads((out / "layout.json").read_text())
    ind_edges = pd.read_csv(interim_dir() / "graph" / "sector_edges.csv")
    ind_edges["weight"] = ind_edges["weight"].round(4)
    records = ind_edges.to_dict("records")
    terrain = json.loads((interim_dir() / "terrain" / "terrain.json").read_text())
    meta = {"schema": 4,
            "size_settings": {"activity": {"label": "Activity", "measure": SETTINGS["activity"]}, "dollars": {"label": "Dollars", "measure": SETTINGS["dollars"]}},
            "largest": terrain["largest"],
            "measure_labels": {"employment": "Employment (jobs, 2025)", "value_added": "Value added (2025, billions of dollars)",
                               "va_per_job": "Value added per job (thousands of dollars)"},
            "levels": [0], "sources": [{**SOURCE, "sha256": sha256(MATRIX_PATH)}],
            "other_sources": [
                {"name": "BEA GDP by Industry 2025, Table 1 (value added)", "url": "https://apps.bea.gov/api/data", "retrieved": "2026-11-09"},
                {"name": "BLS QCEW 2025 annual (payroll for the value-added split)", "url": "https://data.bls.gov/cew/data/files/2025/csv/2025_annual_by_area.zip", "retrieved": "2026-11-09"},
                {"name": "O*NET 31.0 (CC BY 4.0), occupation descriptions for the layout", "url": "https://www.onetcenter.org/dl_files/database/db_31_0_excel.zip", "retrieved": "2026-11-09"}],
            "layout": {"stage": layout["stage"], "seed": layout["seed"]}, "terrain": terrain["params"],
            # v3 axes: per size setting and level, the growth clip (percent) and size clip (log scale) behind x and y
            **({"axes": {"scales": layout["axes"], "params": layout["params"], "measures": layout["measures"],
                         "x": "projected employment growth 2025-2035, percent, linear: g_lo at x = -1, g_hi at x = 1",
                         "y": "size, log scale: s_hi (largest) at y = -1 (back), s_lo at y = 1 (front)"}} if "axes" in layout else {}),
            "display_name_source": "config/site.yaml"}
    add_dollar_measures(nodes)
    stretch = float(load_config()["terrain"].get("hill_stretch_max", 1.0))
    add_hill = lambda ns: [n.update(hill=list(hill_shape(n["id"], stretch))) for n in ns]   # each hill's stretch and angle
    add_hill(nodes)
    add_positions(nodes, layout.get("by_setting", {}))
    (out / "nodes.json").write_text(json.dumps(nodes, indent=1) + "\n")
    (out / "edges.json").write_text(json.dumps(records, indent=1) + "\n")
    levels = terrain["levels"]
    (out / "grids.json").write_text(json.dumps(levels["0"], separators=(",", ":")) + "\n")
    have_l1 = (interim_dir() / "levels" / "industry_l1.csv").exists() and (out / "layout_children.json").exists()
    if have_l1:
        ch = json.loads((out / "layout_children.json").read_text())
        n1, n2 = level1_nodes(ch["nodes"]), deep_nodes(ch["nodes"])
        add_dollar_measures(n1); add_dollar_measures(n2); add_hill(n1); add_hill(n2)
        add_positions(n1, ch.get("by_setting", {})); add_positions(n2, ch.get("by_setting", {}))
        (out / "nodes_l1.json").write_text(json.dumps(n1, separators=(",", ":")) + "\n")
        (out / "nodes_l2.json").write_text(json.dumps(n2, separators=(",", ":")) + "\n")
        e1 = level1_edges()
        (out / "edges_l1.json").write_text(json.dumps(e1, separators=(",", ":")) + "\n")
        (out / "grids_l1.json").write_text(json.dumps(levels["1"], separators=(",", ":")) + "\n")
        (out / "grids_l2.json").write_text(json.dumps(levels["2"], separators=(",", ":")) + "\n")
        meta["levels"] = [0, 1, 2]
        meta["level_notes"] = {"1": "BLS Line items plus remainder nodes",
                               "2": "owner-reviewed deep: categories (estimated) replace the Level 1 industries they split",
                               "deep_size": "deep: node employment splits the official BLS total of its parent industries by a size proxy (QCEW, IPEDS or published headcounts); see each node"}
        meta["other_sources"] += [
            {"name": "BLS QCEW 2025 annual, NAICS 5171xx and 5414xx; Q1 2025 establishment-size slice for NAICS 5416", "url": "https://data.bls.gov/cew/data/api/", "retrieved": "2026-11-09"},
            {"name": "NCES IPEDS 2023: Institutional Characteristics (HD2023) and Employees by Assigned Position (EAP2023)", "url": "https://nces.ed.gov/ipeds/datacenter/", "retrieved": "2026-11-09"},
            {"name": "Published organisation headcounts (see data/mappings/deep_headcounts.csv for each source)", "url": "", "retrieved": "2026-11-09"}]
        print(f"export levels: {len(n1)} Level 1 nodes, {len(n2)} Level 2 nodes, {len(e1)} Level 1 edges")
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"export public: {len(nodes)} nodes, {len(records)} edges -> {out}")
    return 0
