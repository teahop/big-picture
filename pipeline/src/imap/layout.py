"""Layout helpers: canonical orientation, metric MDS, minimum-separation spread, percentile ranks.
The v2 layout itself is in layout_joint.py."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.manifold import MDS


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


MIN_SEP = 0.16      # no two Level 0 nodes closer than this (layout units, coordinates run -1..1)


def spread(xy: np.ndarray, min_sep: float = MIN_SEP, iters: int = 800, pull: float = 0.02) -> np.ndarray:
    """Push apart nodes closer than `min_sep`, with a weak pull back toward the MDS position so neighbourhoods are kept.
    Deterministic (no randomness); the result is rescaled to max |coord| = 1."""
    q = xy.copy()
    for _ in range(iters):
        v = q[:, None, :] - q[None, :, :]
        d = np.linalg.norm(v, axis=2) + np.eye(len(q))
        push = np.where((d < min_sep) & (d > 1e-9), (min_sep - d) / d / 2, 0.0)
        q = q + 0.5 * (v * push[:, :, None]).sum(axis=1) + pull * (xy - q)
    return q / np.abs(q).max()


def layout_distances(xy: np.ndarray) -> np.ndarray:
    return np.linalg.norm(xy[:, None, :] - xy[None, :, :], axis=2)


def pct_rank(values: np.ndarray) -> np.ndarray:
    """Percentile rank in [0, 1] of every entry (ties share the average rank)."""
    ranks = pd.Series(values.ravel()).rank(method="average").to_numpy()
    return ((ranks - 1) / max(len(ranks) - 1, 1)).reshape(values.shape)
