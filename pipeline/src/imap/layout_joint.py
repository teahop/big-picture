"""Industry layout at every level (v2; replaces the v1 anchored layout).

Industries are compared in two ways and the two are blended:

  occupations  each industry's staffing mix (BLS Employment Matrix), TF-IDF weighted so occupations found in almost
               every industry (cashiers, clerks) count for little.
  text         embedding similarity of industry descriptions (title and main occupations; local model).

The blend becomes rank distances, and the layout is stress majorisation on a neighbour graph: each industry keeps its
nearest industries at full weight, every other pair at a small weight (global shape).

Level 0 (sectors) is laid out first. Level 1 (detailed industries) is laid out jointly with a soft pull toward each
industry's sector, so zooming in keeps the neighbourhood but an industry may leave its sector's area (hospitals can sit
next to nursing care, universities next to research labs). Level 2 deep: categories are placed around their new
Level 1 parent. Research and academia appear through industries (higher education, scientific R&D services); research
fields are not drawn (owner decision, 2026-11-10). No randomness: reruns are byte-identical.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir, report_dir
from .layout import canonical, pct_rank, spread
from .layout_anchored import K_SUB, R_SUB_MIN, parent_radius, pct_distance, place_children

DECIMALS = 6
DF_MIN_SHARE = 0.002  # an occupation "appears" in an industry when it holds at least this share of it (for IDF)


# ------------------------------------------------------------------ similarity
def tfidf(mat: pd.DataFrame) -> pd.DataFrame:
    """Row shares times log inverse node frequency, rows scaled to unit length."""
    m = mat.div(mat.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    df = (m > DF_MIN_SHARE).sum(axis=0)
    idf = np.log(len(m) / df.clip(lower=1))
    w = m * idf
    return w.div(np.linalg.norm(w.to_numpy(), axis=1).clip(min=1e-12), axis=0)


def cosine(a: np.ndarray) -> np.ndarray:
    u = a / np.linalg.norm(a, axis=1, keepdims=True).clip(min=1e-12)
    return np.clip(u @ u.T, -1, 1)


def standardise(sim: np.ndarray) -> np.ndarray:
    """z-score of the off-diagonal entries (so two signals with different ranges can be blended)."""
    off = ~np.eye(len(sim), dtype=bool)
    out = np.zeros_like(sim, dtype=float)
    v = sim[off]
    out[off] = (v - v.mean()) / (v.std() or 1.0)
    return out


def blended_distance(occ: np.ndarray, sem: np.ndarray, w_occ: float, w_sem: float) -> tuple[np.ndarray, np.ndarray]:
    """Blended similarity and its rank distance in [0, 1]."""
    s = (w_occ * standardise(occ) + w_sem * standardise(sem)) / (w_occ + w_sem)
    np.fill_diagonal(s, s.max() + 1)
    d = 1.0 - pct_rank(s)
    d = (d + d.T) / 2
    np.fill_diagonal(d, 0.0)
    return s, d


def neighbour_weights(s: np.ndarray, k: int, far: float) -> np.ndarray:
    """1 for each node's k most similar nodes (symmetric), `far` for every other pair."""
    n = len(s)
    w = np.full((n, n), far)
    for i in range(n):
        cand = np.delete(np.arange(n), i)
        top = cand[np.argsort(-s[i, cand], kind="stable")[:k]]
        w[i, top] = 1.0; w[top, i] = 1.0
    np.fill_diagonal(w, 0.0)
    return w


# ------------------------------------------------------------------ layout
def stress_layout(d: np.ndarray, w: np.ndarray, init: np.ndarray, anchor: np.ndarray | None = None,
                  lam: float = 0.0, iters: int = 400) -> np.ndarray:
    """Weighted stress majorisation (SMACOF), optionally with a quadratic pull of each node toward `anchor`."""
    n = len(d)
    v = -w.copy(); np.fill_diagonal(v, w.sum(axis=1))
    if anchor is not None and lam > 0:
        v = v + lam * np.eye(n)
    vinv = np.linalg.pinv(v)
    x = init.astype(float).copy()
    for _ in range(iters):
        dist = np.linalg.norm(x[:, None, :] - x[None, :, :], axis=2)
        ratio = np.divide(w * d, dist, out=np.zeros_like(dist), where=dist > 1e-12)
        b = -ratio; np.fill_diagonal(b, ratio.sum(axis=1))
        rhs = b @ x
        if anchor is not None and lam > 0:
            rhs = rhs + lam * anchor
        x = vinv @ rhs
    return x


def classical_init(d: np.ndarray) -> np.ndarray:
    n = len(d)
    j = np.eye(n) - np.ones((n, n)) / n
    b = -0.5 * j @ (d ** 2) @ j
    vals, vecs = np.linalg.eigh(b)
    idx = np.argsort(vals)[::-1][:2]
    return vecs[:, idx] * np.sqrt(np.maximum(vals[idx], 0))


def fill_box(xy: np.ndarray) -> np.ndarray:
    """Scale each axis on its own to -1..1, so the hills reach every edge of the map rather than a disc."""
    c = (xy.max(axis=0) + xy.min(axis=0)) / 2
    return (xy - c) / ((xy.max(axis=0) - xy.min(axis=0)) / 2)


def grid_points(rows: int, cols: int) -> np.ndarray:
    """A staggered grid (odd rows shifted half a step) scaled to fill -1..1 on both axes."""
    p = np.array([[c + (0.5 if r % 2 else 0.0), r] for r in range(rows) for c in range(cols)], float)
    return (p - p.min(axis=0)) / (p.max(axis=0) - p.min(axis=0)) * 2 - 1


def snap_to_grid(xy: np.ndarray, rows: int, cols: int, jitter: float, seed: int) -> np.ndarray:
    """Give each node the grid spot that keeps the arrangement closest to `xy` overall (assignment problem), then a
    small seeded jitter so the hills do not stand in rows. The axes carry no meaning, so this keeps neighbours roughly
    together while the hills tile the map."""
    from scipy.optimize import linear_sum_assignment
    g = grid_points(rows, cols)
    if len(g) < len(xy):
        raise ValueError(f"level0_grid has {len(g)} spots for {len(xy)} sectors")
    r, c = linear_sum_assignment(((xy[:, None] - g[None]) ** 2).sum(axis=-1))
    out = g[c[np.argsort(r)]]
    return out + np.random.default_rng(seed).uniform(-jitter, jitter, out.shape)


def spiral(n: int, r: float) -> np.ndarray:
    """Deterministic small offsets (golden-angle spiral) used to start children next to their parent."""
    k = np.arange(n)
    ang = k * np.pi * (3 - np.sqrt(5))
    rad = r * np.sqrt((k + 0.5) / max(n, 1))
    return np.stack([rad * np.cos(ang), rad * np.sin(ang)], axis=1)


# ------------------------------------------------------------------ data
def sector_texts(inds: pd.DataFrame, cells: pd.DataFrame, onet: pd.DataFrame, codes: list[str], n_occ: int = 10) -> list[str]:
    desc, titles = onet.set_index("soc")["description"], onet.set_index("soc")["title"]
    out = []
    for code in codes:
        title = inds.loc[inds.ind_code == code, "ind_title"].iloc[0]
        sub = cells[(cells.ind_code == code) & (cells.occ_type == "Line item")].sort_values("pct_ind_2025", ascending=False)
        socs = [s for s in sub["occ_code"] if s in desc.index][:n_occ]
        out.append(f"{title} industry. Main occupations: " + " ".join(f"{titles[s]}: {str(desc[s])[:240]}" for s in socs))
    return out


def load_inputs() -> dict:
    from .embed import embed
    from .graph import share_matrix as sector_share
    from .graph_l1 import industry_texts, share_matrix as l1_share
    from .sectors import SECTOR_CODES
    it, lv = interim_dir(), interim_dir() / "levels"
    inds = pd.read_csv(it / "bls" / "industries.csv", dtype={"ind_code": str})
    cells = pd.read_csv(it / "bls" / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    onet = pd.read_csv(it / "onet" / "occupations.csv", dtype={"soc": str})
    ind1 = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    occ1 = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    sec_occ = sector_share(cells, SECTOR_CODES)
    sec_occ.index = [f"ind:{c}" for c in sec_occ.index]
    i1 = l1_share(occ1).reindex(list(ind1["ind_code"])).fillna(0.0)
    i1.index = list(ind1["node_id"])
    return {
        "l0": {"ids": list(sec_occ.index), "occ": sec_occ, "text": embed(sector_texts(inds, cells, onet, SECTOR_CODES))},
        "l1": {"ids": list(i1.index), "occ": i1, "text": embed(industry_texts(ind1, occ1, onet))},
        "parent": dict(zip(ind1["node_id"], ind1["parent_id"])),
        "ind1": ind1,
    }


def level_similarity(level: dict, cfg: dict) -> tuple[np.ndarray, np.ndarray]:
    occ = cosine(tfidf(level["occ"].reindex(level["ids"]).fillna(0.0)).to_numpy())
    sem = cosine(np.asarray(level["text"], float))
    return blended_distance(occ, sem, float(cfg["weight_occupational"]), float(cfg["weight_semantic"]))


# ------------------------------------------------------------------ run
def run() -> int:
    from .embed import embed
    cfg = load_config()["layout"]
    seed = int(load_config()["seed"])
    data = load_inputs()
    c0, c1 = cfg["level0"], cfg["level1"]

    # ---- Level 0
    s0, d0 = level_similarity(data["l0"], cfg)
    x0 = stress_layout(d0, neighbour_weights(s0, int(c0["k"]), float(c0["far_weight"])), classical_init(d0), iters=int(cfg["iters"]))
    x0 = fill_box(spread(canonical(x0), float(cfg["min_sep_level0"]), iters=1500))
    if cfg.get("level0_grid"):
        gcfg = cfg["level0_grid"]
        x0 = snap_to_grid(x0, int(gcfg["rows"]), int(gcfg["cols"]), float(gcfg["jitter"]), seed)
    x0 = np.round(x0, DECIMALS)
    ids0 = data["l0"]["ids"]
    l0 = {i: [float(a), float(b)] for i, (a, b) in zip(ids0, x0)}

    # ---- Level 1: jointly, softly pulled toward the Level 0 parent
    s1, d1 = level_similarity(data["l1"], cfg)
    ids1 = data["l1"]["ids"]
    anchor = np.array([l0[data["parent"][i]] for i in ids1])
    iu0, iu1 = np.triu_indices(len(x0), 1), np.triu_indices(len(ids1), 1)
    pair0 = np.linalg.norm(x0[:, None] - x0[None], axis=2)[iu0].mean()
    d1s = d1 * (pair0 / d1[iu1].mean())        # the Level 1 cloud spans about what Level 0 does
    w1 = neighbour_weights(s1, int(c1["k"]), float(c1["far_weight"]))
    init = anchor.copy()
    for _, idx in pd.Series(range(len(ids1))).groupby([data["parent"][i] for i in ids1]):
        init[idx.to_numpy()] += spiral(len(idx), 0.03)
    x1 = stress_layout(d1s, w1, init, anchor=anchor, lam=float(cfg["anchor"]) * w1.sum(axis=1).mean(), iters=int(cfg["iters"]))
    x1 = fill_box(spread(x1, float(cfg["min_sep_level1"]), iters=1500, pull=0.05))
    pos = {i: [round(float(a), DECIMALS), round(float(b), DECIMALS)] for i, (a, b) in zip(ids1, x1)}

    # ---- Level 2: deep: categories around their new Level 1 parent
    radius = place_deep(pos, data["ind1"], embed)

    lay0 = {"stage": "joint-level0", "seed": seed, "method": __doc__.strip().splitlines()[0], "nodes": l0}
    (public_dir() / "layout.json").write_text(json.dumps(lay0, indent=1, sort_keys=True) + "\n")
    lay1 = {"stage": "joint-level1-2", "nodes": pos, "radius": {k: round(v, 6) for k, v in radius.items()}}
    (public_dir() / "layout_children.json").write_text(json.dumps(lay1, indent=1, sort_keys=True) + "\n")
    report(l0, pos, s0, ids0, s1, ids1, data["parent"])
    print(f"layout: Level 0 {len(l0)} sectors, Level 1 {len(ids1)} industries, Level 2 {len(pos) - len(ids1)} deep nodes")
    return 0


def place_deep(pos: dict, ind1: pd.DataFrame, embed) -> dict[str, float]:
    lv = interim_dir() / "levels"
    radius: dict[str, float] = {}
    deep_path = lv / "deep_industry.csv"
    if not deep_path.exists():
        return radius
    deep = pd.read_csv(deep_path)
    totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str}).set_index("ind_code")["emp_2025"]
    sector_of, emp1, smax = dict(zip(ind1["ind_code"], ind1["sector_code"])), ind1.set_index("node_id")["emp_2025"], float(totals.max())
    for pid, kids in deep.groupby("parent_id"):
        sector = sector_of[pid.split(":", 1)[1]]
        sibs = ind1[ind1["sector_code"] == sector]["emp_2025"].max()
        R = max(R_SUB_MIN, K_SUB * parent_radius(float(totals[sector]), smax) * float(np.sqrt(emp1[pid] / sibs))); radius[pid] = R
        vec = embed([f"{r.label}. {r.zone}. Examples: {r.members}" for r in kids.itertuples()])
        for c, p in zip(kids["node_id"], place_children(np.array(pos[pid]), R, pct_distance(vec @ vec.T), np.zeros((len(kids), 2)))):
            pos[c] = [round(float(p[0]), DECIMALS), round(float(p[1]), DECIMALS)]
    return radius


# ------------------------------------------------------------------ checks
def preservation(xy: np.ndarray, s: np.ndarray, k: int = 5, within: int = 15) -> float:
    """Share of each node's k most similar nodes that sit among its `within` nearest on the map."""
    d = np.linalg.norm(xy[:, None] - xy[None], axis=2); np.fill_diagonal(d, np.inf)
    ss = s.copy(); np.fill_diagonal(ss, -np.inf)
    near, sim = np.argsort(d, axis=1)[:, :within], np.argsort(-ss, axis=1)[:, :k]
    return float(np.mean([len(set(sim[i]) & set(near[i])) / k for i in range(len(xy))]))


def report(l0: dict, pos: dict, s0, ids0, s1, ids1, parent: dict) -> None:
    p0 = preservation(np.array([l0[i] for i in ids0]), s0, k=3, within=6)
    p1 = preservation(np.array([pos[i] for i in ids1]), s1)
    move = np.array([np.hypot(pos[i][0] - l0[parent[i]][0], pos[i][1] - l0[parent[i]][1]) for i in ids1])
    (report_dir() / "layout_joint.md").write_text("\n".join([
        "# industry layout report", "",
        f"- Level 0: share of each sector's 3 most similar sectors among its 6 nearest on the map: {p0:.3f}",
        f"- Level 1: share of each industry's 5 most similar industries among its 15 nearest on the map: {p1:.3f}",
        f"- Level 1 distance from the sector's position: median {np.median(move):.3f}, 90th percentile {np.percentile(move, 90):.3f} (map spans about 2)"]) + "\n")
