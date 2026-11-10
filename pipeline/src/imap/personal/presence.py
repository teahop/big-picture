"""Presence (SPEC 7.3) and the footprint grids (SPEC 7.4). Writes private/overlay.json only.

presence(n) = sum_r share(r,n) * months(r)/12 * 0.5^(years_since_end(r)/half_life)      (tenure)
            + k * log(1 + sum_c (1 + tie(c)) over contacts at n)                        (connections)
            + skill_weight * skill_match(n) + education_weight * degree share(n)         (skills and education)
`months(r)` is the person-months left after the umbrella rule. Presence then diffuses one step along the Level 1
graph (weight-proportional, damped); it is drawn as Gaussian kernels on the shared layout plane, per level of detail.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ..common import interim_dir, load_config, public_dir
from .base import NodeTable, load_profile, personal_root, private_dir
from .connections import NODE_SPLIT, tie_normalised
from .roles import parse_nodes
from .skills import degree_shares, skill_match

COMPONENTS = ["tenure", "education", "skills", "connections"]


def root_sector(nodes: NodeTable, node_id: str) -> str:
    cur = node_id
    while True:
        p = nodes.df.loc[cur, "parent"]
        if not isinstance(p, str):
            return cur
        cur = p


def expand(spec: str, nodes: NodeTable, finest_ind: pd.DataFrame, sector_members: dict[str, pd.Series]) -> dict[str, float]:
    """Node spec -> {finest node: share}. `a;b` splits equally; `sector:code` spreads by employment over the sector's finest nodes."""
    parts = [p for p in spec.split(NODE_SPLIT) if p]
    out: dict[str, float] = {}
    for p in parts:
        if p.startswith("sector:"):
            w = sector_members[f"ind:{p.split(':', 1)[1]}"]
            for n, s in (w / w.sum()).items():
                out[n] = out.get(n, 0.0) + s / len(parts)
        else:
            out[p] = out.get(p, 0.0) + 1.0 / len(parts)
    return out


def tenure(roles: pd.DataFrame, half_life: float) -> dict[str, float]:
    out: dict[str, float] = {}
    for r in roles.itertuples():
        decay = 0.5 ** (float(r.end_years_before_as_of) / half_life)
        for node, share in parse_nodes(r.nodes):
            out[node] = out.get(node, 0.0) + share * float(r.person_months) / 12.0 * decay
    return out


def connection_weights(company_nodes: pd.DataFrame, contacts: pd.DataFrame, nodes: NodeTable, finest: pd.DataFrame, members) -> dict[str, float]:
    tie = tie_normalised(contacts["tie_strength"].astype(float))
    contacts = contacts.assign(w=1.0 + tie)
    per_company = contacts.groupby("company_norm")["w"].sum()
    out: dict[str, float] = {}
    spec = company_nodes.set_index("company_norm")["node_id"].fillna("")
    for company, w in per_company.items():
        s = spec.get(company, "")
        if not s:
            continue
        for node, share in expand(s, nodes, finest, members).items():
            out[node] = out.get(node, 0.0) + share * float(w)
    return out


def roll_up(values: dict[str, float], nodes: NodeTable, contrib: pd.DataFrame) -> dict[str, float]:
    """Move each finest node's value one level up: deep: nodes across the industries they replace, others to their parent."""
    out: dict[str, float] = {}
    for node, v in values.items():
        for parent, share in nodes.parent_shares(node, contrib).items():
            out[parent] = out.get(parent, 0.0) + v * share
    return out


def level1_values(own_finest: dict[str, float], nodes: NodeTable, contrib: pd.DataFrame) -> dict[str, float]:
    """Own presence aggregated to Level 1 nodes (a node already at Level 1 stays; deeper nodes roll up to Level 1)."""
    out: dict[str, float] = {}
    for node, v in own_finest.items():
        lvl = int(nodes.df.loc[node, "level"])
        cur = {node: v}
        while lvl > 1:
            cur = roll_up(cur, nodes, contrib)
            lvl -= 1
        for k, x in cur.items():
            out[k] = out.get(k, 0.0) + x
    return out


def halo(agg1: dict[str, float], edges: list[dict], damping: float) -> dict[str, float]:
    """One diffusion step: each node passes `damping` of its presence to its graph neighbours in proportion to edge weight."""
    nbrs: dict[str, list[tuple[str, float]]] = {}
    for e in edges:
        nbrs.setdefault(e["source"], []).append((e["target"], e["weight"]))
        nbrs.setdefault(e["target"], []).append((e["source"], e["weight"]))
    out: dict[str, float] = {}
    for n, v in agg1.items():
        links = nbrs.get(n, [])
        tot = sum(w for _, w in links)
        for m, w in links:
            out[m] = out.get(m, 0.0) + damping * v * w / tot
    return out


def kernel_grid(items: list[tuple[tuple[float, float], float, int]], extent: dict, sigma0: float, per_level: float, n: int) -> np.ndarray:
    gx, gy = np.meshgrid(np.linspace(extent["x"][0], extent["x"][1], n), np.linspace(extent["y"][0], extent["y"][1], n))
    z = np.zeros_like(gx)
    for (px, py), v, lv in items:
        s = sigma0 * per_level ** lv
        z += v * np.exp(-((gx - px) ** 2 + (gy - py) ** 2) / (2 * s * s))
    return z


def centroid(items: list[tuple[tuple[float, float], float, int]]) -> dict:
    xy = np.array([i[0] for i in items]); w = np.array([i[1] for i in items])
    c = (xy * w[:, None]).sum(axis=0) / w.sum()
    spread = float(np.sqrt((w * ((xy - c) ** 2).sum(axis=1)).sum() / w.sum()))
    big = xy[w >= 0.05 * w.max()]
    nearest = float(np.min(np.hypot(*(big - c).T)))
    return {"xy": [round(float(c[0]), 4), round(float(c[1]), 4)], "spread": round(spread, 4), "nearest_occupied_node": round(nearest, 4),
            "between_clusters": bool(nearest > 0.5 * spread)}


def run() -> int:
    profile = load_profile(); pr = profile["presence"]
    nodes = NodeTable()
    priv = private_dir()
    finest = nodes.finest("ind")
    contrib = pd.read_csv(interim_dir() / "levels" / "deep_industry_contrib.csv", dtype={"parent_code": str})
    sectors = {}
    for r in finest.itertuples():
        sectors.setdefault(root_sector(nodes, r.id), {})[r.id] = float(r.size.get("employment", 0.0))
    members = {k: pd.Series(v) for k, v in sectors.items()}

    # --- components at the finest nodes
    comp: dict[str, dict[str, float]] = {c: {} for c in COMPONENTS}
    comp["tenure"] = tenure(pd.read_csv(priv / "roles_resolved.csv"), float(pr["tenure_half_life_years"]))
    contacts = pd.read_csv(personal_root() / "LinkedIn_Network" / "connections_normalized.csv", usecols=["company_norm", "tie_strength"]).dropna(subset=["company_norm"])
    raw_conn = connection_weights(pd.read_csv(priv / "company_nodes.csv").fillna(""), contacts, nodes, finest, members)
    comp["connections"] = {n: float(pr["connection_weight_k"]) * float(np.log1p(w)) for n, w in raw_conn.items()}
    skills = skill_match(pd.read_csv(priv / "skills_mapping.csv"))
    comp["skills"] = {n: float(pr["skill_weight"]) * float(v) for n, v in skills.items()}
    edu: dict[str, float] = {}
    ed_path = priv / "education_mapping.csv"
    if ed_path.exists():
        as_of_year = pd.Timestamp(str(profile.get("as_of"))).year
        years = {d["text"]: (float(d["years"]), int(d["end"])) for d in profile.get("education", [])}
        for r in pd.read_csv(ed_path).itertuples():
            yrs, end = years[r.degree]
            decay = 0.5 ** ((as_of_year - end) / float(pr["tenure_half_life_years"])) if pr.get("education_decay") else 1.0
            edu[r.node_id] = edu.get(r.node_id, 0.0) + yrs * decay * float(r.share)
    comp["education"] = edu

    # --- levels: own presence, Level 1 aggregation, halo
    e1 = json.loads((public_dir() / "edges_l1.json").read_text())
    damp = float(pr.get("halo_damping", 0.3))
    cfg = load_config()["terrain"]
    grids0 = json.loads((public_dir() / "grids.json").read_text())["industry"]["measures"]["employment"]
    extent = {"x": grids0["x"], "y": grids0["y"]}
    n = int(cfg["grid_size"])
    level_nodes: dict[str, dict[str, dict[str, float]]] = {"0": {}, "1": {}, "2": {}}
    items: dict[str, dict[str, list]] = {"0": {}, "1": {}, "2": {}}
    # "total" is the person's own footprint (tenure + skills and education). Connections are a separate layer because
    # their coverage is partial; "all" adds them back for anyone who wants the combined picture.
    comps_all = {**comp, "total": {}, "all": {}}
    for target, parts in (("total", ("tenure", "education", "skills")), ("all", COMPONENTS)):
        for c in parts:
            for k, v in comp[c].items():
                comps_all[target][k] = comps_all[target].get(k, 0.0) + v
    for c, own in comps_all.items():
        agg1 = level1_values(own, nodes, contrib)
        h = halo(agg1, e1, damp)
        l1 = {k: agg1.get(k, 0.0) + h.get(k, 0.0) for k in set(agg1) | set(h)}
        l0: dict[str, float] = {}
        for k, v in l1.items():
            for p, s in nodes.parent_shares(k, contrib).items():
                l0[p] = l0.get(p, 0.0) + v * s
        # Level 2 draws the finest nodes' own presence plus the halo at Level 1 positions
        l2 = {**{k: v for k, v in own.items()}}
        level_nodes["0"][c], level_nodes["1"][c], level_nodes["2"][c] = l0, l1, {**l2, **{f"halo:{k}": v for k, v in h.items()}}
        for lv, vals in (("0", l0), ("1", l1), ("2", level_nodes["2"][c])):
            its = []
            for k, v in vals.items():
                base = k.split("halo:", 1)[1] if k.startswith("halo:") else k
                lvl = 1 if k.startswith("halo:") else int(nodes.df.loc[base, "level"])
                if v > 0 and base in nodes.xy:
                    its.append((nodes.xy[base], float(v), lvl))
            items[lv][c] = its

    grids, cents, node_vals = {}, {}, {}
    for lv in ("0", "1", "2"):
        grids[lv], cents[lv] = {}, {}
        for c in comps_all:
            if not items[lv][c]:
                continue
            z = kernel_grid(items[lv][c], extent, float(cfg["bandwidth_level0"]), float(cfg["bandwidth_per_level"]), n)
            m = float(z.max()) or 1.0
            grids[lv][c] = {"max": round(m, 4), "values": np.round(z / m, 3).ravel().tolist()}
        cents[lv] = centroid(items[lv]["total"])
        node_vals[lv] = {k: {c: round(level_nodes[lv][c].get(k, 0.0), 3) for c in comps_all}
                         for k in set().union(*[set(level_nodes[lv][c]) for c in comps_all]) if not k.startswith("halo:")}
    overlay = {"schema": 1, "as_of": str(profile.get("as_of", "")), "extent": {**extent, "n": n}, "components": list(comps_all),
               "params": {"half_life_years": pr["tenure_half_life_years"], "k": pr["connection_weight_k"], "skill_weight": pr["skill_weight"],
                          "education_weight": pr.get("education_weight", 0), "halo_damping": damp},
               "centroid": cents, "nodes": node_vals, "grids": grids,
               "caveat": "The centroid is a summary of a spread-out footprint; with several separate clusters it can sit where there is no presence."}
    (priv / "overlay.json").write_text(json.dumps(overlay, separators=(",", ":")) + "\n")

    top = pd.DataFrame([{"node_id": k, "label": nodes.df.loc[k, "label"], **v} for k, v in node_vals["2"].items() if k in nodes.df.index]).sort_values("total", ascending=False)
    top.head(40).to_csv(priv / "presence_top.csv", index=False)
    tot = {c: sum(comp[c].values()) for c in COMPONENTS}
    (priv / "report_presence.md").write_text("\n".join([
        "# presence report (private)", "",
        "- component totals (finest nodes, before diffusion): " + "; ".join(f"{c} {v:.2f}" for c, v in tot.items()),
        f"- nodes with any presence: {len(node_vals['2'])} at Level 2, {len(node_vals['1'])} at Level 1, {len(node_vals['0'])} at Level 0",
        f"- centroid per level: " + "; ".join(f"L{lv} between_clusters={c['between_clusters']}" for lv, c in cents.items()),
        "- 'total' = tenure + education + skills; connections are a separate layer; 'all' combines them",
        "- top 12 nodes at Level 2 (own footprint, without connections): " + "; ".join(f"{r.label} {r.total:.2f}" for r in top.head(12).itertuples())]) + "\n")
    print(f"presence: tenure {tot['tenure']:.1f}, connections {tot['connections']:.1f}, skills {tot['skills']:.2f}; wrote private/overlay.json")
    return 0
