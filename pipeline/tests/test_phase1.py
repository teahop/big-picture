"""Phase 1 tests on small synthetic tables (no real or personal data)."""
import numpy as np
import pandas as pd
import pytest

from imap import bls, graph, layout, terrain
from imap.sectors import SECTOR_CODES


def synthetic_industries() -> pd.DataFrame:
    codes = ["TE1000", "TE1100", "TE1200", "110000", "111000", "210000", "211000", "491000"]
    return pd.DataFrame({"ind_code": codes, "ind_title": codes, "ind_type": ["Summary"] * len(codes)})


def test_assign_sectors_uses_file_order_and_skips_totals():
    inds = synthetic_industries()
    # pad with the remaining real sector codes so the completeness check passes
    extra = [c for c in SECTOR_CODES if c not in set(inds["ind_code"])]
    inds = pd.concat([inds, pd.DataFrame({"ind_code": extra, "ind_title": extra, "ind_type": "Summary"})])
    out = bls.assign_sectors(inds).set_index("ind_code")["sector_code"]
    assert pd.isna(out["TE1000"]) and pd.isna(out["TE1100"])
    assert out["111000"] == "110000" and out["211000"] == "210000"
    assert out["110000"] == "110000"


def test_assign_sectors_raises_when_a_sector_is_missing():
    with pytest.raises(bls.LayoutMismatch):
        bls.assign_sectors(synthetic_industries())


def test_read_matrix_rejects_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        bls.read_matrix(tmp_path / "nope.xlsx")


def cells() -> pd.DataFrame:
    rows = []
    for ind, mix in {"A": {"o1": 8, "o2": 2}, "B": {"o1": 7, "o2": 3}, "C": {"o3": 10}}.items():
        for occ, emp in mix.items():
            rows.append({"ind_code": ind, "occ_code": occ, "occ_type": "Line item", "emp_2025": emp})
    return pd.DataFrame(rows)


def test_share_rows_sum_to_one_and_cosine_orders_pairs():
    mat = graph.share_matrix(cells(), codes=["A", "B", "C"])
    assert np.allclose(mat.sum(axis=1), 1.0)
    sim = graph.cosine_matrix(mat)
    assert np.allclose(np.diag(sim), 1.0)
    assert sim.loc["A", "B"] > 0.95 and sim.loc["A", "C"] == 0.0


def test_top_k_edges_are_unique_and_undirected():
    mat = graph.share_matrix(cells(), codes=["A", "B", "C"])
    edges = graph.top_k_edges(graph.cosine_matrix(mat), k=1)
    pairs = {tuple(sorted((r.source, r.target))) for r in edges.itertuples()}
    assert len(pairs) == len(edges)


def test_layout_is_deterministic_and_keeps_similar_nodes_close():
    mat = graph.share_matrix(cells(), codes=["A", "B", "C"])
    dist = graph.distance_from_cosine(graph.cosine_matrix(mat))
    xy1, _ = layout.mds_layout(dist, seed=7)
    xy2, _ = layout.mds_layout(dist, seed=7)
    assert np.array_equal(xy1, xy2)
    d = layout.layout_distances(xy1)
    assert d[0, 1] < d[0, 2] and d[0, 1] < d[1, 2]
    assert np.abs(xy1).max() == pytest.approx(1.0)


def test_amplitude_comes_from_own_size_with_max_one():
    amp = terrain.size_amplitude(np.array([0.0, 25.0, 100.0, np.nan]), 0.5)
    assert amp[0] == 0 and amp[2] == pytest.approx(1.0) and amp[1] == pytest.approx(0.5) and amp[3] == 0
    assert terrain.size_amplitude(np.array([25.0, 100.0]), 1.0)[0] == pytest.approx(0.25)


def test_height_grid_peaks_at_node_and_deeper_levels_are_narrower():
    cfg = dict(grid_size=41, margin=1.0, bandwidth_level0=0.4, bandwidth_per_level=0.5, combine="max")
    ext = np.array([[0.0, 0.0]])
    g0 = terrain.height_grid(terrain.Layer(["a"], ext, np.array([0]), np.array([1.0])), ext, cfg)
    g1 = terrain.height_grid(terrain.Layer(["a"], ext, np.array([1]), np.array([1.0])), ext, cfg)
    v0, v1 = np.array(g0["values"]), np.array(g1["values"])
    assert v0.max() == pytest.approx(1.0, abs=1e-3) and v0.min() >= 0
    assert (v1 > 0.05).sum() < (v0 > 0.05).sum()
