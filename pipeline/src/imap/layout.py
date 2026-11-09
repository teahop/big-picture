"""Provisional Level 0 layout: seeded metric MDS on sector similarity (SPEC 6.2).

Phase 2 replaces this with the joint industry+research layout. Positions are
written to a tracked file; re-running is an explicit command and reproduces the
file exactly for the same inputs and seed.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.manifold import MDS

from .common import interim_dir, load_config, public_dir, report_dir
from .graph import SANITY_PAIRS, distance_from_cosine
from .sectors import SHORT_LABEL

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


def run() -> int:
    seed = int(load_config()["seed"])
    sim = pd.read_csv(interim_dir() / "graph" / "sector_similarity.csv", index_col=0)
    sim.index = sim.index.astype(str)
    codes = list(sim.index)
    dist = distance_from_cosine(sim)
    xy, stress = mds_layout(dist, seed)
    xy = np.round(xy, DECIMALS)
    payload = {"stage": "provisional-level0", "method": "metric MDS (sklearn), canonical orientation",
               "seed": seed, "stress": round(stress, 6), "nodes": {f"ind:{c}": [float(x), float(y)] for c, (x, y) in zip(codes, xy)}}
    LAYOUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    LAYOUT_PATH.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n")

    ld = layout_distances(xy)
    iu = np.triu_indices(len(codes), 1)
    median = float(np.median(ld[iu]))
    corr = float(np.corrcoef(ld[iu], dist[iu])[0, 1])
    idx = {c: i for i, c in enumerate(codes)}
    lines = ["# layout validation report", f"- seed {seed}; raw stress {stress:.2f}",
             f"- correlation between layout distance and similarity distance: {corr:.3f}",
             "", "## Sanity pairs in the 2D layout (must be closer than the median pair)", "",
             "| Pair | Layout distance | Median | OK |", "|---|---|---|---|"]
    for a, b in SANITY_PAIRS:
        d = float(ld[idx[a], idx[b]])
        lines.append(f"| {SHORT_LABEL[a]} - {SHORT_LABEL[b]} | {d:.3f} | {median:.3f} | {'yes' if d < median else 'NO'} |")
    (report_dir() / "layout.md").write_text("\n".join(lines) + "\n")
    print(f"layout: wrote {LAYOUT_PATH.name} (raw stress {stress:.2f}, corr {corr:.3f})")
    return 0
