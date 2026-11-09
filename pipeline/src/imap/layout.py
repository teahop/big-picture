"""Joint Level 0 layout of sectors and research fields: seeded metric MDS (SPEC 6.2).

Three similarity blocks (sector-sector, field-field, bridge) are each converted to
percentile ranks so their scales are comparable, then to distances. Positions are
written to a tracked file and frozen; re-running is an explicit command and
reproduces the file exactly for the same inputs and seed.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.manifold import MDS

from .common import interim_dir, load_config, public_dir, report_dir
from .bridge import SANITY
from .graph import SANITY_PAIRS
from .sectors import SECTOR_CODES, SHORT_LABEL

LAYOUT_PATH = public_dir() / "layout.json"
DECIMALS = 6


def canonical(xy: np.ndarray) -> np.ndarray:
    """Centre, rotate to principal axes, fix axis signs and scale to max |coord| = 1."""
    xy = xy - xy.mean(axis=0)
    _, _, vt = np.linalg.svd(xy, full_matrices=False)
    xy = xy @ vt.T
    for k in range(xy.shape[1]):
        if xy[np.argmax(np.abs(xy[:, k])), k] < 0:
            xy[:, k] = -xy[:, k]
    return xy / np.abs(xy).max()


def mds_layout(dist: np.ndarray, seed: int) -> tuple[np.ndarray, float]:
    mds = MDS(n_components=2, metric="precomputed", metric_mds=True, n_init=8, max_iter=2000,
              random_state=seed, init="random", normalized_stress=False)
    xy = mds.fit_transform(dist)
    return canonical(xy), float(mds.stress_)


def layout_distances(xy: np.ndarray) -> np.ndarray:
    return np.linalg.norm(xy[:, None, :] - xy[None, :, :], axis=2)


def pct_rank(values: np.ndarray) -> np.ndarray:
    """Percentile rank in [0, 1] of every entry (ties share the average rank)."""
    ranks = pd.Series(values.ravel()).rank(method="average").to_numpy()
    return ((ranks - 1) / max(len(ranks) - 1, 1)).reshape(values.shape)


def joint_distance(ss: np.ndarray, ff: np.ndarray, sf: np.ndarray) -> np.ndarray:
    """Distance matrix for [sectors..., fields...]. Each block is rank-normalised on its own
    off-diagonal entries (sf in full), distance = 1 - percentile of similarity."""
    ns, nf = len(ss), len(ff)
    d = np.zeros((ns + nf, ns + nf))
    for block, off in ((ss, 0), (ff, ns)):
        n = len(block)
        iu = np.triu_indices(n, 1)
        pr = pct_rank(block[iu])
        sub = np.zeros((n, n)); sub[iu] = 1 - pr; sub = sub + sub.T
        d[off:off + n, off:off + n] = sub
    cross = 1 - pct_rank(sf)
    d[:ns, ns:] = cross; d[ns:, :ns] = cross.T
    return d


def run() -> int:
    seed = int(load_config()["seed"])
    g = interim_dir() / "graph"
    sim = pd.read_csv(g / "sector_similarity.csv", index_col=0); sim.index = sim.index.astype(str)
    fsim = pd.read_csv(g / "field_similarity.csv", index_col=0)
    comb = pd.read_csv(g / "bridge_combined.csv", index_col=0)
    codes = list(sim.index); fids = [str(i) for i in fsim.index]
    comb.index = comb.index.astype(str); comb.columns = [str(c) for c in comb.columns]
    ss, ff = sim.to_numpy(), fsim.to_numpy()
    sf = comb.loc[fids, codes].to_numpy().T  # sectors x fields
    dist = joint_distance(ss, ff, sf)
    xy, stress = mds_layout(dist, seed)
    xy = np.round(xy, DECIMALS)
    ids = [f"ind:{c}" for c in codes] + [f"fld:{f}" for f in fids]
    payload = {"stage": "joint-level0", "method": "metric MDS (sklearn) on percentile-ranked similarity blocks, canonical orientation",
               "seed": seed, "stress": round(stress, 6), "nodes": {i: [float(x), float(y)] for i, (x, y) in zip(ids, xy)}}
    LAYOUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    LAYOUT_PATH.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n")

    ld = layout_distances(xy); ns = len(codes)
    iu = np.triu_indices(len(ids), 1)
    corr = float(np.corrcoef(ld[iu], dist[iu])[0, 1])
    blocks = {"sector-sector": (ld[:ns, :ns], dist[:ns, :ns]), "field-field": (ld[ns:, ns:], dist[ns:, ns:]),
              "bridge (field-sector)": (ld[:ns, ns:], dist[:ns, ns:])}
    lines = ["# layout validation report (joint Level 0)", f"- seed {seed}; raw stress {stress:.2f}; overall corr(layout, target distance) {corr:.3f}",
             "", "| Block | corr(layout, target distance) |", "|---|---|"]
    for name, (a, b) in blocks.items():
        m = np.triu_indices(a.shape[0], 1) if a.shape[0] == a.shape[1] else (slice(None), slice(None))
        lines.append(f"| {name} | {float(np.corrcoef(np.ravel(a[m]), np.ravel(b[m]))[0, 1]):.3f} |")
    idx = {c: i for i, c in enumerate(codes)}
    median = float(np.median(ld[:ns, :ns][np.triu_indices(ns, 1)]))
    lines += ["", "## Sector sanity pairs in the layout (closer than the median sector pair)", "", "| Pair | Layout distance | Median | OK |", "|---|---|---|---|"]
    for a, b in SANITY_PAIRS:
        dd = float(ld[idx[a], idx[b]])
        lines.append(f"| {SHORT_LABEL[a]} - {SHORT_LABEL[b]} | {dd:.3f} | {median:.3f} | {'yes' if dd < median else 'NO'} |")
    names = pd.read_csv(interim_dir() / "openalex" / "fields.csv", dtype={"id": str}).set_index("name")["id"]
    lines += ["", "## Bridge pairs in the layout (rank of the sector among the 20 sectors by layout distance from the field)", "", "| Field | Sector | Rank |", "|---|---|---|"]
    for fname, ok in SANITY:
        j = ns + fids.index(names[fname])
        order = list(np.argsort(ld[j, :ns]))
        best = min(order.index(idx[c]) + 1 for c in ok)
        lines.append(f"| {fname} | {' or '.join(SHORT_LABEL[c] for c in ok)} | {best} |")
    (report_dir() / "layout.md").write_text("\n".join(lines) + "\n")
    print(f"layout: joint layout of {len(ids)} nodes (raw stress {stress:.2f}, corr {corr:.3f})")
    return 0
