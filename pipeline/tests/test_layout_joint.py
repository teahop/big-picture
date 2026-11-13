"""Industry layout (synthetic data, plus checks on the built layout when present)."""
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


def test_neighbour_weights_are_symmetric_and_keep_k_neighbours():
    rng = np.random.default_rng(0)
    s = rng.random((6, 6)); s = (s + s.T) / 2
    w = lj.neighbour_weights(s, k=2, far=0.01)
    assert np.allclose(w, w.T) and np.all(np.diag(w) == 0)
    assert all((w[i] == 1).sum() >= 2 for i in range(6))


def test_stress_layout_recovers_a_line_and_is_deterministic():
    pts = np.array([[0.0], [1.0], [2.0], [3.0]])
    d = np.abs(pts - pts.T)
    w = np.ones_like(d) - np.eye(4)
    a = lj.stress_layout(d, w, lj.classical_init(d) + 0.01, iters=200)
    b = lj.stress_layout(d, w, lj.classical_init(d) + 0.01, iters=200)
    assert np.array_equal(a, b)
    assert np.allclose(np.linalg.norm(a[:, None] - a[None], axis=2), d, atol=1e-3)


def test_anchor_pulls_nodes_toward_their_targets():
    d = np.array([[0.0, 1.0], [1.0, 0.0]]); w = np.array([[0.0, 1.0], [1.0, 0.0]])
    anchor = np.array([[5.0, 5.0], [5.0, 6.0]])
    x = lj.stress_layout(d, w, np.array([[0.0, 0.0], [0.0, 1.0]]), anchor=anchor, lam=10.0, iters=200)
    assert np.linalg.norm(x - anchor, axis=1).max() < 0.2


built = pytest.mark.skipif(not (interim_dir() / "levels" / "industry_l1.csv").exists()
                           or not (public_dir() / "layout_children.json").exists(), reason="pipeline not run")


def _v1(path: str):
    try:
        return json.loads(subprocess.run(["git", "show", f"v1.0:{path}"], cwd=repo_root(), capture_output=True, check=True).stdout)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


@built
def test_layout_keeps_similar_industries_together_at_least_as_well_as_v1():
    stage = json.loads((public_dir() / "layout.json").read_text())["stage"]
    if not stage.startswith("joint"):
        pytest.skip("v3 places industries on growth and size axes (owner, 2026-11-13); similarity is reported, not required")
    cfg, data = load_config()["layout"], lj.load_inputs()
    for level, name, k, within in (("l0", "layout.json", 3, 6), ("l1", "layout_children.json", 5, 15)):
        s, _ = lj.level_similarity(data[level], cfg)
        ids = data[level]["ids"]
        score = lambda pos: lj.preservation(np.array([pos[i] for i in ids]), s, k, within)
        new = score(json.loads((public_dir() / name).read_text())["nodes"])
        assert new > 0.6, (level, new)
        old = _v1(f"data/public/{name}")
        if old is not None:
            # 3 points of slack: the hills were deliberately spread apart (owner, 2026-11-11), which costs a little here
            assert new >= score(old["nodes"]) - 0.03, level
