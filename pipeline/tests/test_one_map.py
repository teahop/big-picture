"""v2 Phase 1: one terrain for industry and research. Synthetic layers, plus checks on the built bundle when present."""
import json
import subprocess

import numpy as np
import pytest

from imap import terrain
from imap.common import interim_dir, load_config, public_dir, repo_root

CFG = {"grid_size": 41, "margin": 0.5, "bandwidth_level0": 0.12, "bandwidth_per_level": 0.5}


def layer(points, amps, level=0):
    xy = np.array(points, float)
    return terrain.Layer([f"n{i}" for i in range(len(xy))], xy, np.full(len(xy), level), np.array(amps, float))


def test_scaled_types_reach_the_same_peak_even_when_one_is_crowded():
    ind = layer([[0.0, 0.0], [1.0, 1.0]], [1.0, 0.5])
    res = layer([[-1.0, 0.0], [-1.05, 0.05], [-0.95, -0.05]], [1.0, 0.9, 0.9])   # crowded: neighbours add height
    ki, top_i = terrain.type_scale(ind, 0.12, 0.5)
    kr, top_r = terrain.type_scale(res, 0.12, 0.5)
    at = lambda lay, k, i: k * terrain.kernel_sum(np.array([lay.xy[i, 0]]), np.array([lay.xy[i, 1]]), lay, 0.12, 0.5)[0]
    assert top_i == "n0" and top_r == "n0"
    assert at(ind, ki, 0) == pytest.approx(1.0) and at(res, kr, 0) == pytest.approx(1.0)
    assert kr < ki      # the crowded type is scaled down more
    kr2, _ = terrain.type_scale(res, 0.12, 0.5, target=0.8)
    assert at(res, kr2, 0) == pytest.approx(0.8)


def test_share_is_one_over_a_lone_industry_zero_over_a_lone_field_and_bounded():
    extent = np.array([[-1.0, -1.0], [1.0, 1.0]])
    ind, res = layer([[-0.6, 0.0]], [1.0]), layer([[0.6, 0.0]], [1.0])
    empty = terrain.Layer([], np.zeros((0, 2)), np.zeros(0, int), np.zeros(0))
    only_ind = np.array(terrain.combine(ind, empty, 1.0, 1.0, extent, CFG)["share"]).reshape(41, 41)
    only_res = np.array(terrain.combine(empty, res, 1.0, 1.0, extent, CFG)["share"]).reshape(41, 41)
    both = terrain.combine(ind, res, 1.0, 1.0, extent, CFG)
    h, sh = np.array(both["height"]).reshape(41, 41), np.array(both["share"]).reshape(41, 41)
    col = lambda x: int(round((x + 1.5) / 3.0 * 40))     # grid spans extent +/- margin
    row = col(0.0)
    assert only_ind[row, col(-0.6)] == 1.0 and only_res[row, col(0.6)] == 0.0
    assert sh.min() >= 0 and sh.max() <= 1 and h.min() >= 0
    assert sh[row, col(-0.6)] > 0.99 and sh[row, col(0.6)] < 0.01 and sh[row, col(0.0)] == pytest.approx(0.5, abs=0.01)
    assert h[0, 0] < terrain.FLAT and sh[0, 0] == 0.5     # flat ground far from every node is neutral


def test_combine_is_deterministic():
    extent = np.array([[-1.0, -1.0], [1.0, 1.0]])
    ind, res = layer([[-0.3, 0.2], [0.1, 0.1]], [1.0, 0.4]), layer([[0.5, -0.2]], [0.7])
    a = json.dumps(terrain.combine(ind, res, 0.9, 0.6, extent, CFG))
    b = json.dumps(terrain.combine(ind, res, 0.9, 0.6, extent, CFG))
    assert a == b


built = pytest.mark.skipif(not (interim_dir() / "terrain" / "terrain.json").exists(), reason="terrain stage not run")


@built
def test_largest_level0_industry_and_field_have_equal_peak_height():
    cfg = load_config()["terrain"]
    layers, _ = terrain.build_layers(cfg)
    scale = json.loads((interim_dir() / "terrain" / "terrain.json").read_text())["scale"]
    s0, pl = cfg["bandwidth_level0"], cfg["bandwidth_per_level"]
    rel = float(cfg.get("research_relative_height", 1.0))
    for s, t in layers["0"].items():
        peaks = []
        for typ, key in (("industry", "largest_industry"), ("research", "largest_field")):
            lay = t[typ]; i = lay.ids.index(scale[s][key])
            peaks.append(scale[s][typ] * terrain.kernel_sum(lay.xy[i, :1], lay.xy[i, 1:], lay, s0, pl)[0])
        assert peaks[0] == pytest.approx(1.0, rel=1e-5) and peaks[1] == pytest.approx(rel, rel=1e-5), s


@built
def test_public_grids_hold_one_height_and_one_share_grid_per_setting():
    meta = json.loads((public_dir() / "meta.json").read_text())
    assert set(meta["terrain_scale"]) == {"activity", "dollars"}
    for name in ("grids.json", "grids_l1.json", "grids_l2.json"):
        g = json.loads((public_dir() / name).read_text())
        assert set(g) == {"n", "x", "y", "settings"} and set(g["settings"]) == {"activity", "dollars"}
        for grids in g["settings"].values():
            h, sh = np.array(grids["height"]), np.array(grids["share"])
            assert len(h) == len(sh) == g["n"] ** 2
            assert h.min() >= 0 and 0 <= sh.min() and sh.max() <= 1


def _v1(path: str) -> bytes | None:
    try:
        return subprocess.run(["git", "show", f"v1.0:{path}"], cwd=repo_root(), capture_output=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


@pytest.mark.parametrize("name", ["edges.json", "edges_l1.json", "edges_l2.json"])
def test_edges_are_unchanged_from_v1(name):
    old = _v1(f"data/public/{name}")
    if old is None:
        pytest.skip("v1.0 tag not available")
    assert (public_dir() / name).read_bytes() == old


@pytest.mark.parametrize("name", ["nodes.json", "nodes_l1.json", "nodes_l2.json"])
def test_nodes_are_unchanged_from_v1_apart_from_position(name):
    old = _v1(f"data/public/{name}")
    if old is None:
        pytest.skip("v1.0 tag not available")
    strip = lambda ns: [{k: v for k, v in n.items() if k != "xy"} for n in ns]
    assert strip(json.loads((public_dir() / name).read_text())) == strip(json.loads(old))
