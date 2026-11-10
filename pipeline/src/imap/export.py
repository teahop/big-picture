"""Write the public bundle: nodes, edges, height grids, metadata. No personal data."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir, sha256
from .bls import MATRIX_PATH
from .sectors import SECTOR_CODES, SHORT_LABEL
from .bridge import mapping_reviewed
from .ingest_files import herd_mapping_reviewed
from .openalex import SIZE_FILTER

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


def field_nodes(layout: dict) -> list[dict]:
    oa = interim_dir() / "openalex"
    fields = pd.read_csv(oa / "fields.csv", dtype={"id": str})
    subs = pd.read_csv(oa / "subfields.csv", dtype={"id": str, "field_id": str})
    yc = pd.read_csv(oa / "field_year_counts.csv", dtype={"field_id": str})
    rd = pd.read_csv(interim_dir() / "herd" / "field_rd.csv", dtype={"id": str}).set_index("id")["rd_thousands"]
    nodes = []
    for f in fields.itertuples():
        y = yc[yc.field_id == f.id].set_index("year")["works_us"]
        growth = (y[2024] / y[2019] - 1) * 100  # 2024 vs 2019: both full, indexed years
        top = subs[subs.field_id == f.id].sort_values("works_us", ascending=False).head(5)
        nodes.append({
            "id": f"fld:{f.id}", "label": f.name, "title": f.name, "type": "fld", "level": 0, "parent": None,
            "domain": f.domain_name, "provenance": "official", "description": f.description,
            "size": {"works": int(f.works_us), "works_global": int(f.works_global), "rd": round(float(rd[f.id]), 0)},
            "growth": round(float(growth), 2), "xy": layout[f"fld:{f.id}"],
            "top_subfields": [{"name": r.name, "works_us": int(r.works_us)} for r in top.itertuples()]})
    return nodes


def bridge_edges(k: int = 6) -> pd.DataFrame:
    g = interim_dir() / "graph"
    occ = pd.read_csv(g / "bridge_occupational.csv", index_col=0); sem = pd.read_csv(g / "bridge_semantic.csv", index_col=0)
    comb = pd.read_csv(g / "bridge_combined.csv", index_col=0)
    for df in (occ, sem, comb):
        df.index = df.index.astype(str); df.columns = [str(c) for c in df.columns]
    keep: set[tuple[str, str]] = set()
    for fid in comb.index:
        keep.update((fid, c) for c in comb.loc[fid].sort_values(ascending=False).head(k).index)
    for c in comb.columns:
        keep.update((fid, c) for fid in comb[c].sort_values(ascending=False).head(k).index)
    rows = [{"source": f"fld:{fid}", "target": f"ind:{c}", "type": "fld-ind", "weight": round(float(comb.loc[fid, c]), 4),
             "signals": {"occupational": round(float(occ.loc[fid, c]), 4), "semantic": round(float(sem.loc[fid, c]), 4)}}
            for fid, c in sorted(keep)]
    return pd.DataFrame(rows)


def field_edges(k: int = 4) -> pd.DataFrame:
    sim = pd.read_csv(interim_dir() / "graph" / "field_similarity.csv", index_col=0)
    sim.index, sim.columns = sim.index.astype(str), sim.columns.astype(str)
    keep: set[tuple[str, str]] = set()
    for a in sim.index:
        for b in sim.loc[a].drop(a).sort_values(ascending=False).head(k).index:
            keep.add(tuple(sorted((a, b))))
    return pd.DataFrame([{"source": f"fld:{a}", "target": f"fld:{b}", "type": "fld-fld", "weight": round(float(sim.loc[a, b]), 4)}
                         for a, b in sorted(keep)])


def _ok(x: float) -> float | None:
    return None if x != x else round(float(x), 2)


def level1_nodes(ch: dict) -> list[dict]:
    lv, oa = interim_dir() / "levels", interim_dir() / "openalex"
    ind = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    occ = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    onet = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype={"soc": str}).set_index("soc")["title"]
    occ = occ.astype({"emp_2025": float})
    nodes = []
    for r in ind.itertuples():
        sub = occ[occ.ind_code == r.ind_code]
        tot = sub["emp_2025"].sum() or 1.0
        top = sub.sort_values(["emp_2025", "occ_code"], ascending=[False, True]).head(5)
        nodes.append({"id": r.node_id, "label": r.label, "title": r.title, "type": "ind", "level": 1, "parent": r.parent_id,
                      "naics_code": r.ind_code, "provenance": "official", "remainder": bool(r.remainder),
                      "size": {"employment": round(float(r.emp_2025), 1), "employment_2035": round(float(r.emp_2035), 1)},
                      "growth": round(float(r.growth), 2), "xy": ch[r.node_id],
                      "top_occupations": [{"soc": o.occ_code, "title": onet.get(o.occ_code, o.occ_code), "share_pct": round(float(o.emp_2025 / tot * 100), 1)} for o in top.itertuples()]})
    subs = pd.read_csv(lv / "subfields_l1.csv", dtype={"id": str, "field_id": str})
    topics = pd.read_csv(oa / "topics.csv", dtype={"id": str, "subfield_id": str})
    fields = pd.read_csv(oa / "fields.csv", dtype={"id": str}).set_index("id")["domain_name"]
    for r in subs.itertuples():
        top = topics[topics.subfield_id == r.id].sort_values("works_us", ascending=False).head(5)
        nodes.append({"id": r.node_id, "label": r.name, "title": f"{r.name} ({r.field_name})", "type": "fld", "level": 1, "parent": r.parent_id,
                      "domain": fields[r.field_id], "provenance": "official", "description": r.description if isinstance(r.description, str) else "",
                      "size": {"works": int(r.works_us), "works_global": int(r.works_global), "rd": round(float(r.rd), 0)},
                      "growth": _ok(r.growth), "xy": ch[r.node_id], "top_subfields": [{"name": t.name, "works_us": int(t.works_us)} for t in top.itertuples()]})
    return nodes


def level2_nodes(ch: dict) -> list[dict]:
    lv = interim_dir() / "levels"
    topics = pd.read_csv(lv / "topics_l2.csv", dtype={"id": str, "subfield_id": str})
    return [{"id": r.node_id, "label": r.name, "title": f"{r.name} ({r.subfield_name})", "type": "fld", "level": 2, "parent": r.parent_id,
             "domain": r.field_name, "provenance": "official", "description": r.description if isinstance(r.description, str) else "",
             "keywords": (r.keywords if isinstance(r.keywords, str) else "").split("; ")[:8],
             "size": {"works": int(r.works_us), "works_global": int(r.works_global), "rd": round(float(r.rd), 0)},
             "growth": _ok(r.growth), "xy": ch[r.node_id]} for r in topics.itertuples()]


def _topk_pairs(sim: pd.DataFrame, k: int) -> set[tuple[str, str]]:
    keep: set[tuple[str, str]] = set()
    arr = sim.to_numpy(); cols = list(sim.columns)
    for i, a in enumerate(sim.index):
        for j in [j for j in np.argsort(-arr[i], kind="stable") if cols[j] != a][:k]:
            keep.add(tuple(sorted((a, cols[j]))))
    return keep


def level1_edges(k: int = 5) -> list[dict]:
    g = interim_dir() / "graph_l1"
    rd = lambda f: pd.read_csv(g / f, index_col=0).rename(index=str, columns=str)
    isim, ssim, comb, occ, sem = rd("industry_similarity.csv"), rd("subfield_similarity.csv"), rd("bridge_combined.csv"), rd("bridge_occupational.csv"), rd("bridge_semantic.csv")
    recs = [{"source": f"ind:{a}", "target": f"ind:{b}", "type": "ind-ind", "weight": round(float(isim.loc[a, b]), 4)} for a, b in sorted(_topk_pairs(isim, k))]
    recs += [{"source": f"fld:{a}", "target": f"fld:{b}", "type": "fld-fld", "weight": round(float(ssim.loc[a, b]), 4)} for a, b in sorted(_topk_pairs(ssim, k))]
    keep: set[tuple[str, str]] = set()
    for sid in comb.index:
        keep.update((sid, c) for c in comb.loc[sid].sort_values(ascending=False).head(k).index)
    for c in comb.columns:
        keep.update((sid, c) for sid in comb[c].sort_values(ascending=False).head(k).index)
    recs += [{"source": f"fld:{sid}", "target": f"ind:{c}", "type": "fld-ind", "weight": round(float(comb.loc[sid, c]), 4),
              "signals": {"occupational": round(float(occ.loc[sid, c]), 4), "semantic": round(float(sem.loc[sid, c]), 4)}} for sid, c in sorted(keep)]
    return recs


def run(target: str) -> int:
    if target != "public":
        print("imap export: only --target public exists in Phase 1 (private target arrives in Phase 4).")
        return 2
    out = public_dir()
    out.mkdir(parents=True, exist_ok=True)
    nodes = build_nodes()
    layout = json.loads((out / "layout.json").read_text())
    nodes += field_nodes(layout["nodes"])
    ind_edges = pd.read_csv(interim_dir() / "graph" / "sector_edges.csv")
    ind_edges["weight"] = ind_edges["weight"].round(4)
    records = ind_edges.to_dict("records") + field_edges().to_dict("records") + bridge_edges().to_dict("records")
    edges = pd.DataFrame(records)
    terrain = json.loads((interim_dir() / "terrain" / "terrain.json").read_text())
    meta = {"schema": 2, "size_measures": {"industry": ["employment"], "research": ["works", "rd"]},
            "measure_labels": {"employment": "Employment (jobs, 2025)", "works": "US publications 2021-25", "rd": "University R&D spending (FY 2024, estimated by field)"},
            "deferred_measures": {"industry": {"value_added": "BEA has no bulk file; deferred to Phase 3"}},
            "bridge": {"method": "occupational (field to CIP to SOC to sector) combined with semantic (embedding) similarity; weights in config/pipeline.yaml",
                       "field_to_cip_reviewed": mapping_reviewed(), "herd_mapping_reviewed": herd_mapping_reviewed(), "signals_per_edge": ["occupational", "semantic"]},
            "research_sources": [
                {"name": "OpenAlex", "url": "https://api.openalex.org", "retrieved": "2026-11-09", "filter": SIZE_FILTER, "note": "topic classifier replaced October 2026"},
                {"name": "NSF NCSES HERD FY 2024, Table 10", "url": "https://ncses.nsf.gov/pubs/nsf26304/assets/data-tables/tables/nsf26304-tab010.xlsx", "retrieved": "2026-11-09"},
                {"name": "NCES CIP 2020 to SOC 2018 crosswalk", "url": "https://nces.ed.gov/ipeds/cipcode/Files/CIP2020_SOC2018_Crosswalk.xlsx", "retrieved": "2026-11-09"},
                {"name": "O*NET 31.0 (CC BY 4.0)", "url": "https://www.onetcenter.org/dl_files/database/db_31_0_excel.zip", "retrieved": "2026-11-09"}],
            "levels": [0], "sources": [{**SOURCE, "sha256": sha256(MATRIX_PATH)}],
            "layout": {"stage": layout["stage"], "seed": layout["seed"]}, "terrain": terrain["params"],
            "display_name_source": "config/site.yaml"}
    (out / "nodes.json").write_text(json.dumps(nodes, indent=1) + "\n")
    (out / "edges.json").write_text(json.dumps(records, indent=1) + "\n")
    levels = terrain["levels"]
    (out / "grids.json").write_text(json.dumps(levels["0"], separators=(",", ":")) + "\n")
    have_l1 = (interim_dir() / "levels" / "industry_l1.csv").exists() and (out / "layout_children.json").exists()
    if have_l1:
        ch = json.loads((out / "layout_children.json").read_text())
        n1, n2 = level1_nodes(ch["nodes"]), level2_nodes(ch["nodes"])
        (out / "nodes_l1.json").write_text(json.dumps(n1, separators=(",", ":")) + "\n")
        (out / "nodes_l2.json").write_text(json.dumps(n2, separators=(",", ":")) + "\n")
        e1 = level1_edges()
        (out / "edges_l1.json").write_text(json.dumps(e1, separators=(",", ":")) + "\n")
        (out / "grids_l1.json").write_text(json.dumps(levels["1"], separators=(",", ":")) + "\n")
        (out / "grids_l2.json").write_text(json.dumps(levels["2"], separators=(",", ":")) + "\n")
        meta["levels"] = [0, 1, 2]
        meta["level_notes"] = {"1": "industries: BLS Line items plus remainder nodes; research: OpenAlex subfields",
                               "2": "research: topics replace their deep-zone subfield; industry: unchanged until deep: categories are approved",
                               "rd_below_field": "R&D dollars are not published below field level; subfield and topic values are allocated pro rata by US works (estimate)"}
        print(f"export levels: {len(n1)} Level 1 nodes, {len(n2)} Level 2 nodes, {len(e1)} Level 1 edges")
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(f"export public: {len(nodes)} nodes, {len(records)} edges -> {out}")
    return 0
