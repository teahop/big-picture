"""Where-next scoring (SPEC 8). Reads the private overlay and profile; writes private/score.json and a report.

Components (each a percentile rank across the candidates of one layer, 0..1):
  adjacency  personalised PageRank from the own footprint (tenure, education, skills) over the similarity graph
  growth     projected employment growth (industry) or publication growth (research)
  size       log of employment (industry) or US works (research)
  novelty    1 - own presence (scaled so the 95th percentile of occupied nodes is 1)
score = sum(weight * component). Toggles are multipliers in 0.5..1.5 applied by the viewer and by `apply_toggles`:
  geography  0.5 + percentile of the metro location quotient (industry: QCEW; research: metro share of works)
  pay        0.5 + percentile of the wage level for the person's occupations (needs the OEWS file; skipped without it)
  mission    1 + 0.25 * tag, tag in -2..2 (owner tags win over the weak field-map seed)
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
import yaml

from .common import interim_dir, public_dir
from .geo import industry_lq, qcew_codes, employment, load_area
from .personal.base import NodeTable, load_profile, private_dir

ALPHA = 0.85           # PageRank continuation probability
HIERARCHY_WEIGHT = 0.5
MULT_LO, MULT_HI = 0.5, 1.5


def percentile(values: pd.Series) -> pd.Series:
    """Average-rank percentile in 0..1; missing values get the neutral 0.5."""
    out = values.rank(method="average", pct=True)
    n = values.notna().sum()
    if n > 1:
        out = (values.rank(method="average") - 1) / (n - 1)
    return out.fillna(0.5)


def personalised_pagerank(ids: list[str], edges: list[tuple[str, str, float]], seeds: dict[str, float], alpha: float = ALPHA, iters: int = 200) -> pd.Series:
    """Personalised PageRank on an undirected weighted graph; returns a score per node id."""
    idx = {n: i for i, n in enumerate(ids)}
    w = np.zeros((len(ids), len(ids)))
    for a, b, x in edges:
        if a in idx and b in idx and a != b:
            w[idx[a], idx[b]] += x; w[idx[b], idx[a]] += x
    col = w.sum(axis=0); col[col == 0] = 1.0
    p = w / col
    s = np.array([seeds.get(n, 0.0) for n in ids], float)
    s = s / s.sum() if s.sum() > 0 else np.full(len(ids), 1 / len(ids))
    x = s.copy()
    for _ in range(iters):
        nx = alpha * p @ x + (1 - alpha) * s
        if np.abs(nx - x).sum() < 1e-12:
            x = nx; break
        x = nx
    return pd.Series(x, index=ids)


def multiplier(p: float) -> float:
    return MULT_LO + (MULT_HI - MULT_LO) * float(p)


def apply_toggles(base: float, comps: dict, toggles: dict) -> float:
    """Base score times the enabled toggle multipliers. `comps` carries geo_pct, pay_pct and tag."""
    s = base
    if toggles.get("geography", {}).get("enabled"):
        s *= multiplier(comps.get("geo_pct", 0.5))
    if toggles.get("pay", {}).get("enabled") and comps.get("pay_pct") is not None:
        s *= multiplier(comps["pay_pct"])
    if toggles.get("mission", {}).get("enabled"):
        s *= 1 + 0.25 * float(comps.get("tag", 0))
    return s


def mission_tags(nodes: NodeTable, profile: dict) -> tuple[dict[str, float], dict[str, float]]:
    """(owner tags, weak seed tags) by node id. Owner tags may use a node id or a deep: slug."""
    owner: dict[str, float] = {}
    for src in (profile.get("mission_tags") or {}, yaml.safe_load((private_dir() / "mission_tags.local.yaml").read_text() or "{}") if (private_dir() / "mission_tags.local.yaml").exists() else {}):
        for k, v in (src or {}).items():
            owner[k if ":" in k else f"deep:{k}"] = float(v)
    seed: dict[str, float] = {}
    from .personal.base import personal_root
    fm = personal_root() / "LinkedIn_Network" / "field_map_2026-09-02.csv"
    if fm.exists():
        from .personal.connections import classify
        f = pd.read_csv(fm)
        table = classify(pd.DataFrame({"company_norm": f["company"].astype(str), "people": 1, "max_tie": 0.0}), nodes, {}, {})
        val = {"target": 2.0, "aligned": 1.0}
        for fit, row in zip(f["fit"], table.itertuples()):
            if row.node_id and row.confidence >= 0.7 and ";" not in row.node_id and not row.node_id.startswith("sector:"):
                seed[row.node_id] = max(seed.get(row.node_id, 0.0), val.get(fit, 0.0))
    return owner, seed


def deep_lq(nodes: NodeTable, lq_by_code: dict[str, float], contrib: pd.DataFrame) -> dict[str, tuple[float | None, str]]:
    """Deep nodes inherit the employment-weighted LQ of the industries they split (no finer public data), except where
    the category has its own QCEW definition."""
    spec = yaml.safe_load((interim_dir().parent.parent / "data" / "mappings" / "deep_categories.yaml").read_text())
    own = {c["slug"]: c["calc"]["codes"] for z in spec["zones"] for c in z["categories"] if c.get("calc", {}).get("kind") == "qcew"}
    out: dict[str, tuple[float | None, str]] = {}
    for node_id, g in contrib.groupby("node_id"):
        slug = node_id.split(":", 1)[1]
        if slug in own:
            out[node_id] = (None, "own QCEW codes")
            continue
        known = [(r.emp_2025, lq_by_code.get(r.parent_code)) for r in g.itertuples() if lq_by_code.get(r.parent_code) is not None]
        w = sum(e for e, _ in known)
        out[node_id] = ((sum(e * l for e, l in known) / w) if w else None, "inherited from parent industries")
    return out


def run() -> int:
    profile = load_profile()
    wn = profile["where_next"]
    nodes = NodeTable()
    priv = private_dir()
    overlay = json.loads((priv / "overlay.json").read_text())
    presence = {k: v["total"] for k, v in overlay["nodes"]["2"].items()}

    # ---- graph: similarity edges, hierarchy and deep-to-topic links
    pub = public_dir()
    edges: list[tuple[str, str, float]] = []
    for f in ("edges_l1.json", "edges_l2.json"):
        edges += [(e["source"], e["target"], float(e["weight"])) for e in json.loads((pub / f).read_text())]
    for r in nodes.df.itertuples():
        for p in [r.parent, *r.replaces]:
            if isinstance(p, str):
                edges.append((r.id, p, HIERARCHY_WEIGHT))
    ids = list(nodes.df.index)
    ppr = personalised_pagerank(ids, edges, presence)
    nbrs: dict[str, list[tuple[str, float]]] = {}
    for a, b, w in edges:
        nbrs.setdefault(a, []).append((b, w)); nbrs.setdefault(b, []).append((a, w))

    # ---- geography
    geo = profile.get("geography", {})
    ind_all = nodes.df[(nodes.df["type"] == "ind") & (nodes.df["level"] == 1)]
    lq_tab = industry_lq(geo["county_fips"], [str(c) for c in ind_all["naics_code"]]) if geo.get("county_fips") else pd.DataFrame()
    lq_by_code = {r.ind_code: r.lq for r in lq_tab.itertuples() if r.lq is not None and r.lq == r.lq}
    contrib = pd.read_csv(interim_dir() / "levels" / "deep_industry_contrib.csv", dtype={"parent_code": str})
    dlq = deep_lq(nodes, lq_by_code, contrib)
    metro = pd.concat([load_area(f) for f in geo["county_fips"]]) if geo.get("county_fips") else None
    if metro is not None:
        metro = metro.groupby(["industry_code", "own_code"], as_index=False).agg(annual_avg_emplvl=("annual_avg_emplvl", "sum"), disclosure_code=("disclosure_code", "first"))
        us = load_area("US000")
        tm = float(metro[(metro.industry_code == "10") & (metro.own_code == 0)]["annual_avg_emplvl"].sum())
        tu = float(us[(us.industry_code == "10") & (us.own_code == 0)]["annual_avg_emplvl"].sum())
        spec = yaml.safe_load((interim_dir().parent.parent / "data" / "mappings" / "deep_categories.yaml").read_text())
        for z in spec["zones"]:
            for c in z["categories"]:
                if c.get("calc", {}).get("kind") == "qcew":
                    codes = [(x, [5]) for x in c["calc"]["codes"]]
                    m, _ = employment(metro, codes); u, _ = employment(us, codes)
                    if u > 0 and m > 0:
                        dlq[f"deep:{c['slug']}"] = ((m / tm) / (u / tu), "own QCEW codes")
    gr = priv / "geo_research.csv"
    rlq = {r.id: r.lq for r in pd.read_csv(gr, dtype={"id": str}).itertuples()} if gr.exists() else {}

    owner_tags, seed_tags = mission_tags(nodes, profile)
    scale = np.percentile([v for v in presence.values() if v > 0], 95) if any(v > 0 for v in presence.values()) else 1.0

    # ---- candidates
    rows = []
    for type_ in ("ind", "fld"):
        fin = nodes.finest(type_)
        fin = fin[~fin["remainder"].fillna(False).astype(bool)] if "remainder" in fin else fin
        sub = pd.DataFrame({"id": fin.index})
        sub["type"] = type_
        sub["label"] = fin["label"].to_numpy(); sub["level"] = fin["level"].to_numpy()
        sub["growth"] = fin["growth"].astype(float).to_numpy()
        key = "employment" if type_ == "ind" else "works"
        sub["size_raw"] = [float(s.get(key, 0.0)) for s in fin["size"]]
        sub["presence"] = [presence.get(i, 0.0) for i in sub["id"]]
        sub["ppr"] = [float(ppr[i]) for i in sub["id"]]
        sub["adjacency"] = percentile(sub["ppr"]).to_numpy()
        sub["growth_c"] = percentile(sub["growth"]).to_numpy()
        sub["size_c"] = percentile(np.log1p(sub["size_raw"])).to_numpy()
        sub["novelty"] = (1 - np.clip(sub["presence"] / scale, 0, 1)).to_numpy()
        lqs, how = [], []
        for i in sub["id"]:
            if type_ == "ind":
                if i.startswith("deep:"):
                    v, h = dlq.get(i, (None, "no data"))
                else:
                    code = str(nodes.df.loc[i, "naics_code"]); v, h = lq_by_code.get(code), "QCEW county sum" if code in lq_by_code else "no clean QCEW equivalent"
            else:
                p = i if i.split(":", 1)[1] in rlq else nodes.df.loc[i, "parent"]
                key2 = p.split(":", 1)[1] if isinstance(p, str) else ""
                v, h = rlq.get(key2), "metro share of US works" + ("" if p == i else " (inherited from subfield)")
            lqs.append(v if v is not None and v == v else None); how.append(h)
        sub["lq"] = pd.Series(lqs, dtype=object).where(pd.Series(lqs, dtype=object).notna(), None).tolist(); sub["lq_how"] = how
        sub["geo_pct"] = percentile(pd.Series([np.log(v) if v and v > 0 else np.nan for v in lqs])).to_numpy()
        sub["tag"] = [owner_tags.get(i, owner_tags.get(i.split(":", 1)[1], seed_tags.get(i, 0.0))) for i in sub["id"]]
        sub["tag_source"] = ["owner" if (i in owner_tags) else "field-map seed" if i in seed_tags else "" for i in sub["id"]]
        near = []
        for i in sub["id"]:
            cand = [(presence.get(n, 0.0) * w, n) for n, w in nbrs.get(i, []) if presence.get(n, 0.0) > 0 and n != i]
            near.append(nodes.df.loc[max(cand)[1], "label"] if cand else "")
        sub["near"] = near
        rows.append(sub)
    cand = pd.concat(rows, ignore_index=True)
    w = wn["weights"]
    cand["base"] = (w["adjacency"] * cand["adjacency"] + w["growth"] * cand["growth_c"] + w["size"] * cand["size_c"] + w["novelty"] * cand["novelty"])
    cand["pay_pct"] = None                       # filled when the OEWS file has been loaded (hand download needed)

    out = {"weights": w, "toggles": wn["toggles"], "multiplier_range": [MULT_LO, MULT_HI], "pay_available": False,
           "nodes": [{"id": r.id, "type": r.type, "label": r.label, "level": int(r.level),
                      "components": {"adjacency": round(r.adjacency, 4), "growth": round(r.growth_c, 4), "size": round(r.size_c, 4), "novelty": round(r.novelty, 4)},
                      "growth_pct": None if r.growth != r.growth else round(r.growth, 1), "presence": round(r.presence, 3),
                      "lq": None if r.lq is None or r.lq != r.lq else round(r.lq, 2), "lq_how": r.lq_how, "geo_pct": round(r.geo_pct, 4),
                      "tag": r.tag, "tag_source": r.tag_source, "near": r.near, "base": round(r.base, 4)} for r in cand.itertuples()]}
    (priv / "score.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False) + "\n")   # strict JSON: the viewer parses it

    def board(df: pd.DataFrame, toggles: dict) -> pd.DataFrame:
        d = df.copy()
        d["score"] = [apply_toggles(r.base, {"geo_pct": r.geo_pct, "pay_pct": None, "tag": r.tag}, toggles) for r in d.itertuples()]
        return d.sort_values("score", ascending=False)
    lines = ["# where-next scores (private)", "",
             f"- weights: {w}; {len(cand)} candidates ({int((cand.type == 'ind').sum())} industries, {int((cand.type == 'fld').sum())} research nodes)",
             "- own footprint seeds the adjacency (tenure, education, skills); connections are not used",
             f"- pay toggle: not available (needs the OEWS file, see `imap ingest oews`)",
             f"- geography: {int(cand['lq'].notna().sum())} of {len(cand)} candidates have a location quotient; the rest are neutral",
             f"- mission tags: {int((cand['tag_source'] == 'owner').sum())} owner, {int((cand['tag_source'] == 'field-map seed').sum())} weak seed", ""]
    off = {k: {"enabled": False} for k in ("pay", "mission", "geography")}
    for type_, name in (("ind", "industries"), ("fld", "research")):
        top = board(cand[cand.type == type_], off).head(20)
        lines += [f"## Top 20 {name} (toggles off)", "", "| # | node | adjacency | growth | size | novelty | near your footprint | LQ |", "|---|---|---|---|---|---|---|---|"]
        for n, r in enumerate(top.itertuples(), 1):
            lines.append(f"| {n} | {r.label} | {r.adjacency:.2f} | {r.growth_c:.2f} | {r.size_c:.2f} | {r.novelty:.2f} | {r.near} | {'' if r.lq is None else f'{r.lq:.1f}'} |")
        lines.append("")
    (priv / "report_score.md").write_text("\n".join(lines) + "\n")
    print(f"score: {len(cand)} candidates; wrote private/score.json and report_score.md")
    return 0
