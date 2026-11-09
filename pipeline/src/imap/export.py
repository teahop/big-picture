"""Write the public bundle: nodes, edges, height grids, metadata. No personal data."""
from __future__ import annotations

import json

import pandas as pd

from .common import interim_dir, load_config, public_dir, sha256
from .bls import MATRIX_PATH
from .sectors import SECTOR_CODES, SHORT_LABEL

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


def run(target: str) -> int:
    if target != "public":
        print("imap export: only --target public exists in Phase 1 (private target arrives in Phase 4).")
        return 2
    out = public_dir()
    out.mkdir(parents=True, exist_ok=True)
    nodes = build_nodes()
    edges = pd.read_csv(interim_dir() / "graph" / "sector_edges.csv")
    edges["weight"] = edges["weight"].round(4)
    terrain = json.loads((interim_dir() / "terrain" / "terrain.json").read_text())
    layout = json.loads((out / "layout.json").read_text())
    meta = {"schema": 1, "size_measures": {"industry": ["employment"]},
            "deferred_measures": {"industry": {"value_added": "BEA has no bulk file; deferred to Phase 3"}},
            "levels": [0], "sources": [{**SOURCE, "sha256": sha256(MATRIX_PATH)}],
            "layout": {"stage": layout["stage"], "seed": layout["seed"]}, "terrain": terrain["params"],
            "display_name_source": "config/site.yaml"}
    (out / "nodes.json").write_text(json.dumps(nodes, indent=1) + "\n")
    (out / "edges.json").write_text(json.dumps(edges.to_dict("records"), indent=1) + "\n")
    (out / "grids.json").write_text(json.dumps(terrain["layers"], separators=(",", ":")) + "\n")
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"export public: {len(nodes)} nodes, {len(edges)} edges -> {out}")
    return 0
