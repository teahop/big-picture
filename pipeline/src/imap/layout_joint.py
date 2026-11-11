"""Joint layout of industries and research at every level (v2, replaces the v1 anchored layout).

Industries and research fields are described in one shared language so that they can be placed among each other:

  occupations  an industry's staffing mix (BLS Employment Matrix); a field's or subfield's graduate occupations
               (reviewed field-to-CIP programmes, CIP -> SOC crosswalk; postsecondary teaching excluded). Both are
               TF-IDF weighted, so occupations found in almost every node (cashiers, clerks) count for little.
  text         embedding similarity of node descriptions (the same local model as the bridge).

Each signal is standardised within its block (industry-industry, field-field, industry-field) so that a field's
nearest industry is as near as its nearest field, then the two are blended and turned into rank distances.
The layout is stress majorisation on a balanced neighbour graph: every node keeps its nearest nodes of its own type
and of the other type at full weight, all other pairs at a small weight (global shape).

Level 0 (sectors and fields) is laid out first. Level 1 (industries and subfields) is laid out jointly with a soft
pull toward each node's Level 0 parent, so zooming in keeps the neighbourhood but nodes may leave their parent's
area. Level 2 children (topics of the deep-zone subfields, deep: industries) are placed around their new Level 1
parent as in v1. No randomness: reruns are byte-identical.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir, report_dir
from .layout import canonical, pct_rank, spread
from .layout_anchored import K_SUB, R_SUB_MIN, parent_radius, pct_distance, place_children, prior_offsets

DECIMALS = 6
SOFTMAX_T = 0.03      # temperature for re-weighting a field's programmes per subfield (as graph_l1)
DF_MIN_SHARE = 0.002  # an occupation "appears" in a node when it holds at least this share of it (for IDF)


# ------------------------------------------------------------------ occupation vectors
def tfidf(mat: pd.DataFrame) -> pd.DataFrame:
    """Row shares times log inverse node frequency, rows scaled to unit length."""
    m = mat.div(mat.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)
    df = (m > DF_MIN_SHARE).sum(axis=0)
    idf = np.log(len(m) / df.clip(lower=1))
    w = m * idf
    return w.div(np.linalg.norm(w.to_numpy(), axis=1).clip(min=1e-12), axis=0)


def programme_occupations(cip_soc: pd.DataFrame) -> dict[str, pd.Series]:
    """CIP 4-digit programme -> its occupations (SOC), each 6-digit CIP splitting its weight over its SOCs."""
    cs = cip_soc.drop_duplicates(["cip", "soc"]).copy()
    cs = cs[~cs["soc"].str.startswith("25-1")]
    cs["cip4"] = cs["cip"].str[:5]
    cs["w"] = 1.0 / cs.groupby("cip")["soc"].transform("count")
    return {c4: (g.groupby("soc")["w"].sum() / g["w"].sum()) for c4, g in cs.groupby("cip4")}


def blend(parts: list[tuple[pd.Series, float]]) -> pd.Series:
    vec = pd.Series(dtype=float)
    for s, w in parts:
        vec = vec.add(s * w, fill_value=0.0)
    return vec / vec.sum() if vec.sum() > 0 else vec


def softmax(x: np.ndarray, t: float) -> np.ndarray:
    e = np.exp((x - x.max()) / t)
    return e / e.sum()


# ------------------------------------------------------------------ similarity and layout
def block_standardise(sim: np.ndarray, kind: np.ndarray) -> np.ndarray:
    """z-score the off-diagonal entries of each block (same-type pairs per type, cross-type pairs) separately."""
    out = np.zeros_like(sim, dtype=float)
    a, b = np.meshgrid(kind, kind, indexing="ij")
    off = ~np.eye(len(sim), dtype=bool)
    for mask in ((a == 0) & (b == 0), (a == 1) & (b == 1), a != b):
        m = mask & off
        if m.sum() < 2:
            continue
        v = sim[m]
        out[m] = (v - v.mean()) / (v.std() or 1.0)
    return out


def joint_distance(occ: np.ndarray, sem: np.ndarray, kind: np.ndarray, w_occ: float, w_sem: float) -> tuple[np.ndarray, np.ndarray]:
    """Blended similarity (block-standardised) and its rank distance in [0, 1]."""
    s = (w_occ * block_standardise(occ, kind) + w_sem * block_standardise(sem, kind)) / (w_occ + w_sem)
    np.fill_diagonal(s, s.max() + 1)
    d = 1.0 - pct_rank(s)
    d = (d + d.T) / 2
    np.fill_diagonal(d, 0.0)
    return s, d


def neighbour_weights(s: np.ndarray, kind: np.ndarray, k_same: int, k_cross: int, far: float) -> np.ndarray:
    """1 for each node's k_same most similar same-type nodes and k_cross most similar other-type nodes (symmetric),
    `far` for every other pair."""
    n = len(s)
    w = np.full((n, n), far)
    for i in range(n):
        for same, k in ((True, k_same), (False, k_cross)):
            cand = np.where((kind == kind[i]) == same)[0]
            cand = cand[cand != i]
            if len(cand) == 0 or k == 0:
                continue
            top = cand[np.argsort(-s[i, cand], kind="stable")[:k]]
            w[i, top] = 1.0; w[top, i] = 1.0
    np.fill_diagonal(w, 0.0)
    return w


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
        diff = x[:, None, :] - x[None, :, :]
        dist = np.linalg.norm(diff, axis=2)
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


def spiral(n: int, r: float) -> np.ndarray:
    """Deterministic small offsets (golden-angle spiral) used to start children next to their parent."""
    k = np.arange(n)
    ang = k * np.pi * (3 - np.sqrt(5))
    rad = r * np.sqrt((k + 0.5) / max(n, 1))
    return np.stack([rad * np.cos(ang), rad * np.sin(ang)], axis=1)


def cosine(a: np.ndarray) -> np.ndarray:
    u = a / np.linalg.norm(a, axis=1, keepdims=True).clip(min=1e-12)
    return np.clip(u @ u.T, -1, 1)


# ------------------------------------------------------------------ data
def load_inputs() -> dict:
    from .bridge import field_texts, load_reviewed, sector_texts
    from .graph import share_matrix as sector_share
    from .graph_l1 import industry_texts, share_matrix as l1_share, subfield_texts
    from .sectors import SECTOR_CODES
    from .embed import embed
    it, lv, oa = interim_dir(), interim_dir() / "levels", interim_dir() / "openalex"
    inds = pd.read_csv(it / "bls" / "industries.csv", dtype={"ind_code": str})
    cells = pd.read_csv(it / "bls" / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    onet = pd.read_csv(it / "onet" / "occupations.csv", dtype={"soc": str})
    cip_soc = pd.read_csv(it / "cip" / "cip_soc.csv", dtype=str)
    fields = pd.read_csv(oa / "fields.csv", dtype={"id": str})
    subs_all = pd.read_csv(oa / "subfields.csv", dtype={"id": str, "field_id": str})
    topics_all = pd.read_csv(oa / "topics.csv", dtype={"id": str, "subfield_id": str})
    ind1 = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    occ1 = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str})
    subs = pd.read_csv(lv / "subfields_l1.csv", dtype={"id": str, "field_id": str})
    reviewed = load_reviewed()
    progs = programme_occupations(cip_soc)

    # occupations: industries
    sec_occ = sector_share(cells, SECTOR_CODES)
    sec_occ.index = [f"ind:{c}" for c in sec_occ.index]
    i1 = l1_share(occ1).reindex(list(ind1["ind_code"])).fillna(0.0)
    i1.index = list(ind1["node_id"])
    # occupations: fields (accepted programmes, reviewed weights) and subfields (parent programmes re-weighted by text)
    fld_occ = {f"fld:{fid}": blend([(progs[r.cip4], float(r.weight)) for r in g.itertuples() if r.cip4 in progs])
               for fid, g in reviewed.groupby("field_id")}
    cs4 = cip_soc.drop_duplicates("cip").copy(); cs4["cip4"] = cs4["cip"].str[:5]
    docs = cs4.groupby("cip4")["cip_title"].apply(lambda s: "; ".join(s.head(25))).reset_index()
    doc_idx = {c: i for i, c in enumerate(docs["cip4"])}
    sub_txt = subfield_texts(subs, topics_all)
    sv, cv = embed(sub_txt), embed(list(docs["cip_title"]))
    sub_occ = {}
    for i, r in enumerate(subs.itertuples()):
        p = [c for c in reviewed[reviewed.field_id == r.field_id]["cip4"] if c in progs and c in doc_idx]
        w = softmax(np.array([sv[i] @ cv[doc_idx[c]] for c in p]), SOFTMAX_T)
        sub_occ[r.node_id] = blend([(progs[c], wi) for c, wi in zip(p, w)])
    # text
    sec_txt = sector_texts(inds, cells, onet)
    fld_txt = field_texts(fields, subs_all)
    ind1_nodes = ind1.rename(columns={"title": "title"})
    i1_txt = industry_texts(ind1_nodes, occ1, onet)
    return {
        "l0": {"ids": list(sec_occ.index) + [f"fld:{f}" for f in fields["id"]],
               "occ": pd.concat([sec_occ, pd.DataFrame(fld_occ).T.reindex([f"fld:{f}" for f in fields["id"]])]).fillna(0.0),
               "text": embed(sec_txt + fld_txt)},
        "l1": {"ids": list(i1.index) + list(subs["node_id"]),
               "occ": pd.concat([i1, pd.DataFrame(sub_occ).T.reindex(list(subs["node_id"]))]).fillna(0.0),
               "text": embed(i1_txt + sub_txt)},
        "parent": {**dict(zip(ind1["node_id"], ind1["parent_id"])), **dict(zip(subs["node_id"], subs["parent_id"]))},
        "ind1": ind1, "subs": subs, "fields": fields,
    }


def level_similarity(level: dict, cfg: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ids = level["ids"]
    kind = np.array([0 if i.startswith("ind:") else 1 for i in ids])
    occ = cosine(tfidf(level["occ"].reindex(ids)).to_numpy())
    sem = cosine(np.asarray(level["text"], float))
    s, d = joint_distance(occ, sem, kind, float(cfg["weight_occupational"]), float(cfg["weight_semantic"]))
    return s, d, kind


# ------------------------------------------------------------------ run
def run() -> int:
    from .common import load_deep_zones  # noqa: F401  (deep zones are read through the level tables)
    from .embed import embed
    from .layout import MIN_SEP
    cfg = load_config()["layout"]
    seed = int(load_config()["seed"])
    data = load_inputs()

    # ---- Level 0
    s0, d0, k0 = level_similarity(data["l0"], cfg)
    c0, c1 = cfg["level0"], cfg["level1"]
    w0 = neighbour_weights(s0, k0, int(c0["k_same"]), int(c0["k_cross"]), float(c0["far_weight"]))
    x0 = stress_layout(d0, w0, classical_init(d0), iters=int(cfg["iters"]))
    x0 = np.round(spread(canonical(x0), MIN_SEP), DECIMALS)
    ids0 = data["l0"]["ids"]
    l0 = {i: [float(a), float(b)] for i, (a, b) in zip(ids0, x0)}

    # ---- Level 1: joint, softly pulled toward the Level 0 parent
    s1, d1, k1 = level_similarity(data["l1"], cfg)
    ids1 = data["l1"]["ids"]
    anchor = np.array([l0[data["parent"][i]] for i in ids1])
    # scale rank distances so the Level 1 cloud spans about what Level 0 does
    iu0, iu1 = np.triu_indices(len(x0), 1), np.triu_indices(len(ids1), 1)
    pair0 = np.linalg.norm(x0[:, None] - x0[None], axis=2)[iu0].mean()
    d1s = d1 * (pair0 / d1[iu1].mean())
    w1 = neighbour_weights(s1, k1, int(c1["k_same"]), int(c1["k_cross"]), float(c1["far_weight"]))
    groups = pd.Series(range(len(ids1))).groupby([data["parent"][i] for i in ids1])
    init = anchor.copy()
    for _, idx in groups:
        init[idx.to_numpy()] += spiral(len(idx), 0.03)
    lam = float(cfg["anchor"]) * w1.sum(axis=1).mean()
    x1 = stress_layout(d1s, w1, init, anchor=anchor, lam=lam, iters=int(cfg["iters"]))
    x1 = spread(x1, float(cfg["min_sep_level1"]), pull=0.05)
    pos = {i: [round(float(a), DECIMALS), round(float(b), DECIMALS)] for i, (a, b) in zip(ids1, x1)}

    # ---- Level 2: topics of deep-zone subfields and deep: industries around their new Level 1 parent (as v1)
    radius = place_level2(pos, data, embed)

    lay0 = {"stage": "joint-level0", "seed": seed, "method": __doc__.strip().splitlines()[0], "nodes": l0}
    (public_dir() / "layout.json").write_text(json.dumps(lay0, indent=1, sort_keys=True) + "\n")
    lay1 = {"stage": "joint-level1-2", "nodes": pos, "radius": {k: round(v, 6) for k, v in radius.items()}}
    (public_dir() / "layout_children.json").write_text(json.dumps(lay1, indent=1, sort_keys=True) + "\n")
    report(l0, pos, s0, ids0, s1, ids1, data)
    print(f"layout joint: Level 0 {len(l0)} nodes, Level 1 {len(ids1)} nodes, Level 2 {len(pos) - len(ids1)} nodes")
    return 0


def place_level2(pos: dict, data: dict, embed) -> dict[str, float]:
    lv, oa = interim_dir() / "levels", interim_dir() / "openalex"
    ind1, subs, fields = data["ind1"], data["subs"], data["fields"]
    topics = pd.read_csv(lv / "topics_l2.csv", dtype={"id": str, "subfield_id": str})
    sector_totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str}).set_index("ind_code")["emp_2025"]
    radius: dict[str, float] = {}
    fmax, fw = float(fields["works_us"].max()), fields.set_index("id")["works_us"]
    field_of_sub, sw = subs.set_index("id")["field_id"], subs.set_index("id")["works_us"]
    sub_text = pd.read_csv(oa / "subfields.csv", dtype={"id": str})
    sub_vec = embed([f"{r.name}. {r.description}" for r in sub_text.itertuples()])
    for sid, kids in topics.groupby("subfield_id"):
        parent = np.array(pos[f"fld:{sid}"]); fid = field_of_sub[sid]
        rf = parent_radius(float(fw[fid]), fmax)
        sibs = subs[subs.field_id == fid]["works_us"].max()
        R = max(R_SUB_MIN, K_SUB * rf * float(np.sqrt(sw[sid] / sibs))); radius[f"fld:{sid}"] = R
        tv = embed([f"{r.name}. {r.description} {r.keywords}" for r in kids.itertuples()])
        others = [s for s in sub_text["id"] if s != sid and f"fld:{s}" in pos]
        ov = sub_vec[[list(sub_text["id"]).index(s) for s in others]]
        pri = prior_offsets(parent, np.array([pos[f"fld:{s}"] for s in others]), tv @ ov.T)
        for c, p in zip(kids["id"], place_children(parent, R, pct_distance(tv @ tv.T), pri)):
            pos[f"fld:{c}"] = [round(float(p[0]), DECIMALS), round(float(p[1]), DECIMALS)]
    deep_path = lv / "deep_industry.csv"
    if deep_path.exists():
        deep = pd.read_csv(deep_path)
        sector_of, emp1 = dict(zip(ind1["ind_code"], ind1["sector_code"])), ind1.set_index("node_id")["emp_2025"]
        smax = float(sector_totals.max())
        for pid, kids in deep.groupby("parent_id"):
            sector = sector_of[pid.split(":", 1)[1]]
            rs = parent_radius(float(sector_totals[sector]), smax)
            sibs = ind1[ind1["sector_code"] == sector]["emp_2025"].max()
            R = max(R_SUB_MIN, K_SUB * rs * float(np.sqrt(emp1[pid] / sibs))); radius[pid] = R
            vec = embed([f"{r.label}. {r.zone}. Examples: {r.members}" for r in kids.itertuples()])
            for c, p in zip(kids["node_id"], place_children(np.array(pos[pid]), R, pct_distance(vec @ vec.T), np.zeros((len(kids), 2)))):
                pos[c] = [round(float(p[0]), DECIMALS), round(float(p[1]), DECIMALS)]
    return radius


# ------------------------------------------------------------------ checks
def mixing(xy: np.ndarray, kind: np.ndarray, k: int = 5) -> float:
    """Mean share of each node's k nearest map neighbours that are of the other type."""
    d = np.linalg.norm(xy[:, None] - xy[None], axis=2); np.fill_diagonal(d, np.inf)
    nn = np.argsort(d, axis=1)[:, :k]
    return float((kind[nn] != kind[:, None]).mean())


def cross_hits(xy: np.ndarray, s: np.ndarray, kind: np.ndarray, top: int = 3) -> float:
    """Share of research nodes whose nearest industry on the map is among their `top` most similar industries."""
    ind, res = np.where(kind == 0)[0], np.where(kind == 1)[0]
    hits = 0
    for r in res:
        best = ind[np.argsort(-s[r, ind], kind="stable")[:top]]
        near = ind[np.argmin(np.linalg.norm(xy[ind] - xy[r], axis=1))]
        hits += near in best
    return hits / len(res)


def preservation(xy: np.ndarray, s: np.ndarray, k: int = 5, within: int = 15) -> float:
    """Share of each node's k most similar nodes that sit among its `within` nearest on the map."""
    d = np.linalg.norm(xy[:, None] - xy[None], axis=2); np.fill_diagonal(d, np.inf)
    ss = s.copy(); np.fill_diagonal(ss, -np.inf)
    near, sim = np.argsort(d, axis=1)[:, :within], np.argsort(-ss, axis=1)[:, :k]
    return float(np.mean([len(set(sim[i]) & set(near[i])) / k for i in range(len(xy))]))


def quality(xy: dict, s: np.ndarray, ids: list[str]) -> dict:
    a = np.array([xy[i] for i in ids]); kind = np.array([0 if i.startswith("ind:") else 1 for i in ids])
    return {"mixing": round(mixing(a, kind), 3), "cross_hits": round(cross_hits(a, s, kind), 3), "preservation": round(preservation(a, s), 3)}


def report(l0: dict, pos: dict, s0, ids0, s1, ids1, data) -> None:
    q0, q1 = quality(l0, s0, ids0), quality(pos, s1, ids1)
    par = data["parent"]
    move = np.array([np.hypot(pos[i][0] - l0[par[i]][0], pos[i][1] - l0[par[i]][1]) for i in ids1])
    lines = ["# joint layout report", "",
             "| Level | Mixing (share of 5 nearest that are the other type) | Research nodes whose nearest industry is in their top 3 | Top-5 similar within 15 nearest |",
             "|---|---|---|---|",
             f"| 0 | {q0['mixing']} | {q0['cross_hits']} | {q0['preservation']} |",
             f"| 1 | {q1['mixing']} | {q1['cross_hits']} | {q1['preservation']} |", "",
             f"- Level 1 distance from the Level 0 parent: median {np.median(move):.3f}, 90th percentile {np.percentile(move, 90):.3f} (layout units, map spans about 2)"]
    (report_dir() / "layout_joint.md").write_text("\n".join(lines) + "\n")
