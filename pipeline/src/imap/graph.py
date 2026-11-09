"""Sector-to-sector similarity: cosine of occupation-share vectors (SPEC 6.1)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .common import interim_dir, report_dir
from .sectors import SECTOR_CODES, SHORT_LABEL

TOP_K = 4  # nearest neighbours kept per node as edges

# Sanity pairs from the Phase 1 handoff: each must be closer than the median pair.
SANITY_PAIRS = [("620000", "610000"), ("520000", "540000"), ("31-330", "420000")]


def share_matrix(cells: pd.DataFrame, codes: list[str] = SECTOR_CODES) -> pd.DataFrame:
    """Rows = industries, columns = detailed occupations, values = share of the
    industry's detailed-occupation employment (rows sum to 1)."""
    sub = cells[(cells["ind_code"].isin(codes)) & (cells["occ_type"] == "Line item")]
    mat = sub.astype({"emp_2025": float}).pivot_table(index="ind_code", columns="occ_code", values="emp_2025", aggfunc="sum", fill_value=0.0)
    mat = mat.reindex(codes)
    return mat.div(mat.sum(axis=1), axis=0)


def cosine_matrix(mat: pd.DataFrame) -> pd.DataFrame:
    v = mat.to_numpy(dtype=float)
    norm = np.linalg.norm(v, axis=1, keepdims=True)
    if (norm == 0).any():
        raise ValueError("A node has an all-zero occupation vector")
    u = v / norm
    sim = np.clip(u @ u.T, -1.0, 1.0)
    return pd.DataFrame(sim, index=mat.index, columns=mat.index)


def distance_from_cosine(sim: pd.DataFrame) -> np.ndarray:
    """Euclidean distance between unit vectors: sqrt(2(1-cos))."""
    return np.sqrt(np.maximum(2.0 * (1.0 - sim.to_numpy()), 0.0))


def top_k_edges(sim: pd.DataFrame, k: int = TOP_K) -> pd.DataFrame:
    codes = list(sim.index)
    keep: set[tuple[str, str]] = set()
    for i, a in enumerate(codes):
        order = [j for j in np.argsort(-sim.to_numpy()[i], kind="stable") if j != i][:k]
        keep.update(tuple(sorted((a, codes[j]))) for j in order)
    rows = [{"source": f"ind:{a}", "target": f"ind:{b}", "type": "ind-ind", "weight": float(sim.loc[a, b])}
            for a, b in sorted(keep)]
    return pd.DataFrame(rows)


def pair_check(dist: np.ndarray, codes: list[str]) -> list[dict]:
    iu = np.triu_indices(len(codes), 1)
    median = float(np.median(dist[iu]))
    idx = {c: i for i, c in enumerate(codes)}
    return [{"a": a, "b": b, "distance": float(dist[idx[a], idx[b]]), "median": median,
             "ok": bool(dist[idx[a], idx[b]] < median)} for a, b in SANITY_PAIRS]


def run() -> int:
    cells = pd.read_csv(interim_dir() / "bls" / "industry_occupation.csv", dtype={"ind_code": str, "occ_code": str})
    mat = share_matrix(cells)
    sim = cosine_matrix(mat)
    out = interim_dir() / "graph"
    out.mkdir(parents=True, exist_ok=True)
    sim.to_csv(out / "sector_similarity.csv")
    edges = top_k_edges(sim)
    edges.to_csv(out / "sector_edges.csv", index=False)
    checks = pair_check(distance_from_cosine(sim), list(sim.index))
    lines = ["# graph validation report", f"- sectors: {len(sim)}; occupations in vectors: {mat.shape[1]}",
             f"- edges kept (top {TOP_K} per node, symmetric union): {len(edges)}",
             f"- cosine range off-diagonal: {sim.to_numpy()[np.triu_indices(len(sim), 1)].min():.3f} "
             f"to {sim.to_numpy()[np.triu_indices(len(sim), 1)].max():.3f}",
             "", "## Sanity pairs in similarity space (distance must be below the median pair distance)", "",
             "| Pair | Distance | Median | OK |", "|---|---|---|---|"]
    for c in checks:
        lines.append(f"| {SHORT_LABEL[c['a']]} - {SHORT_LABEL[c['b']]} | {c['distance']:.3f} | {c['median']:.3f} | {'yes' if c['ok'] else 'NO'} |")
    (report_dir() / "graph.md").write_text("\n".join(lines) + "\n")
    print(f"graph: {len(sim)} sectors, {len(edges)} edges; sanity pairs ok: {[c['ok'] for c in checks]}")
    return 0
