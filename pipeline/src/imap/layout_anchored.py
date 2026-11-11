"""Placing children inside a parent's neighbourhood (v1 anchored layout). v2 uses these helpers for Level 2
(topics of deep-zone subfields, deep: industries) around their Level 1 parent; see layout_joint.py.

For every parent: (1) classical MDS of the children's sibling distances gives their internal
shape; (2) an orthogonal Procrustes fit turns that shape toward the children's "prior" - the
direction of the Level 0 nodes each child is most similar to; (3) the cloud is scaled to fit
inside a radius proportional to the parent's size. No randomness is involved, so reruns are exact.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

K0 = 0.10         # Level 0 radius scale (layout units) for the largest parent
R_MIN = 0.028      # smallest Level 0 radius
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
