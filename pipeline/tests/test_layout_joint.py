"""Joint layout of industries and research (synthetic data, plus checks on the built layout when present)."""
import json
import subprocess

import numpy as np
import pandas as pd
import pytest

from imap import layout_joint as lj
from imap.common import interim_dir, load_config, public_dir, repo_root


def test_tfidf_discounts_occupations_found_everywhere():
    m = pd.DataFrame({"cashier": [0.5, 0.5, 0.5], "nurse": [0.5, 0.0, 0.0], "coder": [0.0, 0.5, 0.5]}, index=["a", "b", "c"])
    t = lj.tfidf(m)
    assert t.loc["a", "cashier"] == 0 and t.loc["a", "nurse"] > 0
    assert np.allclose(np.linalg.norm(t.to_numpy(), axis=1), 1.0)


def test_block_standardise_gives_each_block_the_same_scale():
    kind = np.array([0, 0, 0, 1, 1, 1])
    sim = np.full((6, 6), 0.9)
    sim[:3, 3:] = sim[3:, :3] = 0.1          # cross-type pairs uniformly lower before standardising
    sim[0, 3] = sim[3, 0] = 0.2              # one cross pair stands out within its block
    z = lj.block_standardise(sim, kind)
    assert z[0, 3] > 0 and z[0, 1] == 0      # the standout cross pair is above average for its block


def test_neighbour_weights_keep_neighbours_of_both_types():
    kind = np.array([0, 0, 0, 1, 1, 1])
    rng = np.random.default_rng(0)
    s = rng.random((6, 6)); s = (s + s.T) / 2
    w = lj.neighbour_weights(s, kind, k_same=1, k_cross=1, far=0.01)
    assert np.allclose(w, w.T) and np.all(np.diag(w) == 0)
    for i in range(6):
        assert (w[i, kind == kind[i]] == 1).any() and (w[i, kind != kind[i]] == 1).any()


def test_stress_layout_recovers_a_line_and_is_deterministic():
    pts = np.array([[0.0], [1.0], [2.0], [3.0]])
    d = np.abs(pts - pts.T)
    w = np.ones_like(d) - np.eye(4)
    a = lj.stress_layout(d, w, lj.classical_init(d) + 0.01, iters=200)
    b = lj.stress_layout(d, w, lj.classical_init(d) + 0.01, iters=200)
    assert np.array_equal(a, b)
    got = np.linalg.norm(a[:, None] - a[None], axis=2)
    assert np.allclose(got, d, atol=1e-3)


def test_anchor_pulls_nodes_toward_their_targets():
    d = np.array([[0.0, 1.0], [1.0, 0.0]]); w = np.array([[0.0, 1.0], [1.0, 0.0]])
    anchor = np.array([[5.0, 5.0], [5.0, 6.0]])
    x = lj.stress_layout(d, w, np.zeros((2, 2)) + [[0, 0], [0, 1]], anchor=anchor, lam=10.0, iters=200)
    assert np.linalg.norm(x - anchor, axis=1).max() < 0.2


built = pytest.mark.skipif(not (interim_dir() / "levels" / "industry_l1.csv").exists()
                           or not (public_dir() / "layout_children.json").exists(), reason="pipeline not run")


def _v1(path: str):
    try:
        return json.loads(subprocess.run(["git", "show", f"v1.0:{path}"], cwd=repo_root(), capture_output=True, check=True).stdout)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


@built
def test_joint_layout_places_research_next_to_its_industries_better_than_v1():
    cfg = load_config()["layout"]
    data = lj.load_inputs()
    for level, name in (("l0", "layout.json"), ("l1", "layout_children.json")):
        s, _, _ = lj.level_similarity(data[level], cfg)
        ids = data[level]["ids"]
        new = lj.quality(json.loads((public_dir() / name).read_text())["nodes"], s, ids)
        old = _v1(f"data/public/{name}")
        if old is not None:
            v1 = lj.quality(old["nodes"], s, ids)
            assert new["cross_hits"] > v1["cross_hits"], (level, new, v1)
            assert new["mixing"] > 0.1 and new["preservation"] > 0.4, (level, new)
