"""Phase 3 tests on small synthetic tables (no real or personal data)."""

import numpy as np
import pandas as pd
import pytest

from imap import layout_anchored as la
from imap import levels



def test_place_children_stay_inside_radius_and_are_deterministic():
    rng = np.random.default_rng(3)
    pts = rng.normal(size=(12, 5))
    dist = np.linalg.norm(pts[:, None] - pts[None], axis=2)
    parent = np.array([0.3, -0.2])
    prior = rng.normal(size=(12, 2))
    a = la.place_children(parent, 0.1, dist, prior)
    b = la.place_children(parent, 0.1, dist, prior)
    assert np.array_equal(a, b)
    assert np.linalg.norm(a - parent, axis=1).max() <= 0.1 + 1e-12


@pytest.mark.parametrize("n", [1, 2, 3])
def test_place_children_handles_small_families(n):
    d = la.pct_distance(np.ones((n, n)))
    xy = la.place_children(np.zeros(2), 0.05, d, np.zeros((n, 2)))
    assert xy.shape == (n, 2) and np.linalg.norm(xy, axis=1).max() <= 0.05 + 1e-12


def test_procrustes_turns_the_cloud_toward_the_prior():
    x = np.array([[1.0, 0.0], [-1.0, 0.0], [0.0, 0.2], [0.0, -0.2]])
    prior = np.array([[0.0, 1.0], [0.0, -1.0], [0.2, 0.0], [-0.2, 0.0]])   # same shape rotated 90 degrees
    out = la.procrustes_rotate(x, prior)
    assert np.allclose(np.abs(out), np.abs(prior), atol=1e-9)


def test_parent_radius_scales_with_sqrt_size_and_has_a_floor():
    assert la.parent_radius(100, 100) == pytest.approx(la.K0)
    assert la.parent_radius(25, 100) == pytest.approx(la.K0 / 2)
    assert la.parent_radius(0.001, 100) == la.R_MIN


def test_industry_level1_adds_a_remainder_node_that_reconciles():
    inds = pd.DataFrame({"ind_code": ["110000", "111000"], "ind_title": ["Agri", "Crops"], "ind_type": ["Summary", "Line item"],
                         "sector_code": ["110000", "110000"], "level": [0, 1]})
    rows = []
    for ind, e25, e35 in (("110000", 100.0, 110.0), ("111000", 60.0, 66.0)):
        rows.append({"ind_code": ind, "occ_code": "00-0000", "occ_type": "Summary", "emp_2025": e25, "emp_2035": e35})
    for ind, occ, e in (("110000", "45-1011", 70.0), ("110000", "45-2091", 30.0), ("111000", "45-1011", 50.0), ("111000", "45-2091", 10.0)):
        rows.append({"ind_code": ind, "occ_code": occ, "occ_type": "Line item", "emp_2025": e, "emp_2035": e})
    sectors = ["110000"]
    import imap.levels as lv
    old = lv.SECTOR_CODES
    lv.SECTOR_CODES = sectors
    try:
        nodes, occ, rec = lv.industry_level1(inds, pd.DataFrame(rows))
    finally:
        lv.SECTOR_CODES = old
    assert nodes["emp_2025"].sum() == pytest.approx(100.0) and nodes["remainder"].sum() == 1
    rem = occ[occ.ind_code == "110000-other"].set_index("occ_code")["emp_2025"]
    assert rem["45-1011"] == pytest.approx(20.0) and rem["45-2091"] == pytest.approx(20.0)


def test_growth_needs_a_minimum_base():
    yc = pd.DataFrame({"level": "subfield", "id": ["a", "a", "b", "b"], "year": [2019, 2024, 2019, 2024], "works_us": [100, 150, 5, 50]})
    g = levels.growth_from_counts(yc, "subfield")
    assert g["a"] == pytest.approx(50.0) and np.isnan(g["b"])
