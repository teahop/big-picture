"""Anchored hierarchical layout (SPEC 6.2, steps 2-3): Level 0 positions are frozen; each child is
placed inside its parent's neighbourhood.

For every parent: (1) classical MDS of the children's sibling distances gives their internal
shape; (2) an orthogonal Procrustes fit turns that shape toward the children's "prior" - the
direction of the Level 0 nodes each child is most similar to; (3) the cloud is scaled to fit
inside a radius proportional to the parent's size. No randomness is involved, so reruns are exact.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

K0 = 0.15          # Level 0 radius scale (layout units) for the largest parent
R_MIN = 0.04       # smallest Level 0 radius
K_SUB = 0.35       # a subfield's radius relative to its parent field's radius (scaled by size)
R_SUB_MIN = 0.012
FILL = 0.9         # children are scaled so the farthest sits at FILL * radius


def parent_radius(size: float, size_max: float, k: float = K0, r_min: float = R_MIN) -> float:
    return max(r_min, k * float(np.sqrt(size / size_max)))


def classical_mds(dist: np.ndarray) -> np.ndarray:
    """2D classical MDS; deterministic (eigenvector signs fixed by the largest coordinate)."""
    n = len(dist)
    if n == 1:
        return np.zeros((1, 2))
    if n == 2:
        return np.array([[-0.5, 0.0], [0.5, 0.0]]) * max(float(dist[0, 1]), 1e-6)
    j = np.eye(n) - np.ones((n, n)) / n
    b = -0.5 * j @ (dist ** 2) @ j
    w, v = np.linalg.eigh(b)
    idx = np.argsort(w)[::-1][:2]
    x = v[:, idx] * np.sqrt(np.maximum(w[idx], 0))
    for k in range(2):
        if x[np.argmax(np.abs(x[:, k])), k] < 0:
            x[:, k] = -x[:, k]
    return x


def procrustes_rotate(x: np.ndarray, prior: np.ndarray) -> np.ndarray:
    """Rotate/reflect x to best match the (centred) prior offsets; unchanged when the prior is degenerate."""
    if len(x) < 3:
        # two children: put the pair along the prior direction when there is one
        if len(x) == 2 and np.linalg.norm(prior[0] - prior[1]) > 1e-9:
            d = prior[0] - prior[1]; d = d / np.linalg.norm(d)
            half = np.linalg.norm(x[0] - x[1]) / 2
            return np.array([d * half, -d * half])
        return x
    p = prior - prior.mean(axis=0)
    if np.linalg.norm(p) < 1e-9:
        return x
    u, _, vt = np.linalg.svd((x - x.mean(axis=0)).T @ p)
    return (x - x.mean(axis=0)) @ (u @ vt)


def place_children(parent_xy: np.ndarray, radius: float, sibling_dist: np.ndarray, prior: np.ndarray) -> np.ndarray:
    """Positions for the children of one parent, all within `radius` of the parent."""
    x = classical_mds(sibling_dist)
    x = procrustes_rotate(x, prior)
    far = float(np.max(np.linalg.norm(x, axis=1)))
    if far > 0:
        x = x * (FILL * radius / far)
    return parent_xy + x


def prior_offsets(parent_xy: np.ndarray, attractor_xy: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """One 2D offset per child. weights is children x attractors; each child's weights are
    centred, so the child leans toward attractors it is MORE similar to than average."""
    d = attractor_xy - parent_xy
    unit = d / np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    w = weights - weights.mean(axis=1, keepdims=True)
    sd = w.std(axis=1, keepdims=True)
    w = w / np.where(sd > 0, sd, 1.0)
    return w @ unit / max(len(attractor_xy), 1)


def pct_distance(sim: np.ndarray) -> np.ndarray:
    """Distances from a similarity block by percentile rank of its off-diagonal entries."""
    n = len(sim)
    if n < 3:
        return np.where(np.eye(n) == 1, 0.0, 0.5)
    iu = np.triu_indices(n, 1)
    ranks = pd.Series(sim[iu]).rank(method="average").to_numpy()
    pr = (ranks - 1) / max(len(ranks) - 1, 1)
    d = np.zeros((n, n)); d[iu] = 1 - pr
    return d + d.T


def write(path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n")


# ------------------------------------------------------------------ orchestration
def _rolled(weights: pd.DataFrame, groups: pd.Series, mass: pd.Series) -> pd.DataFrame:
    """Collapse columns of `weights` into groups (mass-weighted mean); returns rows x groups."""
    out = {}
    for g, cols in groups.groupby(groups):
        c = list(cols.index)
        m = mass.reindex(c).fillna(0.0).to_numpy()
        m = m / m.sum() if m.sum() > 0 else np.full(len(c), 1 / len(c))
        out[g] = weights[c].to_numpy() @ m
    return pd.DataFrame(out, index=weights.index)


def run() -> int:
    from .common import interim_dir, public_dir, report_dir, sha256
    from .embed import embed
    from .graph_l1 import cosine, share_matrix

    l0_path = public_dir() / "layout.json"
    l0 = json.loads(l0_path.read_text())["nodes"]
    lv, g1, oa = interim_dir() / "levels", interim_dir() / "graph_l1", interim_dir() / "openalex"
    ind = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    occ = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    subs = pd.read_csv(lv / "subfields_l1.csv", dtype={"id": str, "field_id": str})
    topics = pd.read_csv(lv / "topics_l2.csv", dtype={"id": str, "subfield_id": str})
    isim = pd.read_csv(g1 / "industry_similarity.csv", index_col=0); isim.index = isim.index.astype(str); isim.columns = isim.columns.astype(str)
    ssim = pd.read_csv(g1 / "subfield_similarity.csv", index_col=0); ssim.index = ssim.index.astype(str); ssim.columns = ssim.columns.astype(str)
    comb = pd.read_csv(g1 / "bridge_combined.csv", index_col=0); comb.index = comb.index.astype(str); comb.columns = comb.columns.astype(str)
    fields = pd.read_csv(oa / "fields.csv", dtype={"id": str})
    sector_totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str}).set_index("ind_code")["emp_2025"]
    pos: dict[str, list[float]] = {}
    radius: dict[str, float] = {}

    # ---- industries: Level 1 under each sector
    sector_of = dict(zip(ind["ind_code"], ind["sector_code"]))
    shares = share_matrix(occ).reindex(list(ind["ind_code"])).fillna(0.0)
    sec_vec = shares.mul(ind.set_index("ind_code")["emp_2025"], axis=0).groupby(pd.Series(sector_of)).sum()
    sec_vec = sec_vec.div(sec_vec.sum(axis=1), axis=0)
    cos_cs = pd.DataFrame(cosine(pd.concat([shares, sec_vec])).loc[shares.index, sec_vec.index].to_numpy(), index=shares.index, columns=sec_vec.index)
    field_of_sub = subs.set_index("id")["field_id"]
    br_rolled = _rolled(comb, pd.Series(sector_of).reindex(comb.columns), ind.set_index("ind_code")["emp_2025"])  # subfields x sectors
    ind_to_field = _rolled(comb.T, field_of_sub.reindex(comb.index), subs.set_index("id")["works_us"])         # industries x fields
    smax = float(sector_totals.max())
    for sector, kids in ind.groupby("sector_code"):
        parent = np.array(l0[f"ind:{sector}"]); R = parent_radius(float(sector_totals[sector]), smax); radius[f"ind:{sector}"] = R
        codes = list(kids["ind_code"])
        dist = pct_distance(isim.loc[codes, codes].to_numpy())
        other = [s for s in sec_vec.index if s != sector]
        pri = prior_offsets(parent, np.array([l0[f"ind:{s}"] for s in other]), cos_cs.loc[codes, other].to_numpy())
        flds = [f"{f}" for f in fields["id"]]
        pri += 0.5 * prior_offsets(parent, np.array([l0[f"fld:{f}"] for f in flds]), ind_to_field.reindex(index=codes, columns=flds).fillna(0).to_numpy())
        xy = place_children(parent, R, dist, pri)
        for c, p in zip(codes, xy):
            pos[f"ind:{c}"] = [round(float(p[0]), 6), round(float(p[1]), 6)]

    # ---- research: subfields under each field
    fmax = float(fields["works_us"].max()); fw = fields.set_index("id")["works_us"]
    sec_codes = list(sec_vec.index)
    for fid, kids in subs.groupby("field_id"):
        parent = np.array(l0[f"fld:{fid}"]); R = parent_radius(float(fw[fid]), fmax); radius[f"fld:{fid}"] = R
        ids = [i for i in kids["id"] if i in ssim.index]
        if not ids:
            continue
        dist = pct_distance(ssim.loc[ids, ids].to_numpy())
        other = [f for f in fields["id"] if f != fid]
        roll = _rolled(ssim.reindex(index=ids).fillna(0.0), field_of_sub.reindex(ssim.columns), subs.set_index("id")["works_us"])
        pri = prior_offsets(parent, np.array([l0[f"fld:{f}"] for f in other]), roll.reindex(columns=other).fillna(0).to_numpy())
        pri += 0.5 * prior_offsets(parent, np.array([l0[f"ind:{s}"] for s in sec_codes]), br_rolled.reindex(index=ids, columns=sec_codes).fillna(0).to_numpy())
        xy = place_children(parent, R, dist, pri)
        for c, p in zip(ids, xy):
            pos[f"fld:{c}"] = [round(float(p[0]), 6), round(float(p[1]), 6)]

    # ---- research: topics under each deep-zone subfield (Level 2)
    sub_text = pd.read_csv(oa / "subfields.csv", dtype={"id": str})
    sub_vec = embed([f"{r.name}. {r.description}" for r in sub_text.itertuples()])
    sw = subs.set_index("id")["works_us"]
    for sid, kids in topics.groupby("subfield_id"):
        parent = np.array(pos[f"fld:{sid}"]); fid = field_of_sub[sid]
        sibs = subs[subs.field_id == fid]["works_us"].max()
        R = max(R_SUB_MIN, K_SUB * radius[f"fld:{fid}"] * float(np.sqrt(sw[sid] / sibs))); radius[f"fld:{sid}"] = R
        tv = embed([f"{r.name}. {r.description} {r.keywords}" for r in kids.itertuples()])
        dist = pct_distance(tv @ tv.T)
        others = [s for s in sub_text["id"] if s != sid and f"fld:{s}" in pos]
        ov = sub_vec[[list(sub_text["id"]).index(s) for s in others]]
        pri = prior_offsets(parent, np.array([pos[f"fld:{s}"] for s in others]), tv @ ov.T)
        xy = place_children(parent, R, dist, pri)
        for c, p in zip(kids["id"], xy):
            pos[f"fld:{c}"] = [round(float(p[0]), 6), round(float(p[1]), 6)]

    # ---- industries: deep: categories under their primary Level 1 industry (Level 2)
    deep_path = lv / "deep_industry.csv"
    deep = pd.read_csv(deep_path) if deep_path.exists() else pd.DataFrame(columns=["node_id", "parent_id"])
    if len(deep):
        emp1 = ind.set_index("node_id")["emp_2025"]
        for pid, kids in deep.groupby("parent_id"):
            code = pid.split(":", 1)[1]
            sector = sector_of[code]
            sibs = ind[ind["sector_code"] == sector]["emp_2025"].max()
            R = max(R_SUB_MIN, K_SUB * radius[f"ind:{sector}"] * float(np.sqrt(emp1[pid] / sibs))); radius[pid] = R
            vec = embed([f"{r.label}. {r.zone}. Examples: {r.members}" for r in kids.itertuples()])
            xy = place_children(np.array(pos[pid]), R, pct_distance(vec @ vec.T), np.zeros((len(kids), 2)))
            for c, p_ in zip(kids["node_id"], xy):
                pos[c] = [round(float(p_[0]), 6), round(float(p_[1]), 6)]

    payload = {"stage": "anchored-level1-2", "frozen_level0_sha256": sha256(l0_path), "nodes": pos, "radius": {k: round(v, 6) for k, v in radius.items()}}
    write(public_dir() / "layout_children.json", payload)

    # ---- checks
    worst = 0.0; outside = 0
    parent_of = {**dict(zip(ind["node_id"], ind["parent_id"])), **dict(zip(subs["node_id"], subs["parent_id"])), **dict(zip(topics["node_id"], topics["parent_id"])), **dict(zip(deep["node_id"], deep["parent_id"]))}
    for n, par in parent_of.items():
        if n not in pos:
            continue
        pxy = l0.get(par) or pos.get(par)
        d = float(np.hypot(pos[n][0] - pxy[0], pos[n][1] - pxy[1])); R = radius[par]
        worst = max(worst, d / R)
        outside += d > R + 1e-9
    (report_dir() / "layout_children.md").write_text("\n".join([
        "# anchored layout validation report",
        f"- placed: {sum(k.startswith('ind:') for k in pos)} industry nodes, {sum(k.startswith('deep:') for k in pos)} deep: industry nodes, {sum(k.startswith('fld:') for k in pos)} research nodes",
        f"- Level 0 file sha256 (frozen, not rewritten by this stage): `{payload['frozen_level0_sha256']}`",
        f"- children outside their parent's radius: {outside}; farthest child as a fraction of radius: {worst:.3f}",
    ]) + "\n")
    print(f"layout children: {len(pos)} nodes placed; outside radius: {outside}")
    return 0
