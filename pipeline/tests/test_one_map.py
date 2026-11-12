"""Industry terrain (v2): heights from each industry's own size, no pile-up, research fields gone."""
import json
import subprocess

import numpy as np
import pytest

from imap import terrain
from imap.common import interim_dir, load_config, public_dir, repo_root

CFG = {"grid_size": 41, "margin": 0.5, "bandwidth_level0": 0.12, "bandwidth_per_level": 0.5, "combine": "max"}


def layer(points, amps, level=0):
    xy = np.array(points, float)
    return terrain.Layer([f"n{i}" for i in range(len(xy))], xy, np.full(len(xy), level), np.array(amps, float))


def test_max_surface_never_exceeds_the_tallest_node_but_sum_does():
    crowd = layer([[0.0, 0.0], [0.02, 0.0], [0.0, 0.02], [0.02, 0.02]], [0.6, 0.6, 0.6, 0.6])
    ext = np.array([[-1.0, -1.0], [1.0, 1.0]])
    z_max = np.array(terrain.height_grid(crowd, ext, CFG)["values"])
    z_sum = np.array(terrain.height_grid(crowd, ext, {**CFG, "combine": "sum"})["values"])
    assert z_max.max() <= 0.6 + 1e-9 and z_sum.max() > 1.0


def test_height_grid_is_deterministic():
    lay, ext = layer([[-0.3, 0.2], [0.1, 0.1]], [1.0, 0.4]), np.array([[-1.0, -1.0], [1.0, 1.0]])
    assert json.dumps(terrain.height_grid(lay, ext, CFG)) == json.dumps(terrain.height_grid(lay, ext, CFG))


built = pytest.mark.skipif(not (interim_dir() / "terrain" / "terrain.json").exists(), reason="terrain stage not run")


@built
def test_heights_follow_size_not_sibling_count():
    """Regression: a sector's only child must not tower over larger industries that have many siblings."""
    layers, _ = terrain.build_layers(load_config()["terrain"])
    lay = layers["1"]["activity"]
    amp = dict(zip(lay.ids, lay.amp))
    assert amp["ind:722511"] > amp["ind:551000"]          # restaurants (5.4M jobs) over management of companies (2.6M)
    assert lay.ids[int(np.argmax(lay.amp))] == max(lay.ids, key=lambda i: amp[i])


@built
def test_public_grids_hold_one_height_grid_per_setting():
    meta = json.loads((public_dir() / "meta.json").read_text())
    assert set(meta["size_settings"]) == {"activity", "dollars"}
    for name in ("grids.json", "grids_l1.json", "grids_l2.json"):
        g = json.loads((public_dir() / name).read_text())
        assert set(g) == {"n", "x", "y", "settings"} and set(g["settings"]) == {"activity", "dollars"}
        for grids in g["settings"].values():
            h = np.array(grids["height"])
            # the power mean lifts a peak a hair when a neighbour's slope reaches it, so allow 2%
            assert set(grids) == {"height"} and len(h) == g["n"] ** 2 and h.min() >= 0 and h.max() <= 1.02


@built
def test_no_research_nodes_or_edges_in_the_bundle():
    for name in ("nodes.json", "nodes_l1.json", "nodes_l2.json"):
        assert all(n["type"] == "ind" for n in json.loads((public_dir() / name).read_text())), name
    for name in ("edges.json", "edges_l1.json"):
        assert all(e["type"] == "ind-ind" for e in json.loads((public_dir() / name).read_text())), name
    assert not (public_dir() / "edges_l2.json").exists()


def _v1(path: str):
    try:
        return json.loads(subprocess.run(["git", "show", f"v1.0:{path}"], cwd=repo_root(), capture_output=True, check=True).stdout)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


@pytest.mark.parametrize("name", ["edges.json", "edges_l1.json"])
def test_industry_edges_are_unchanged_from_v1(name):
    old = _v1(f"data/public/{name}")
    if old is None:
        pytest.skip("v1.0 tag not available")
    assert json.loads((public_dir() / name).read_text()) == [e for e in old if e["type"] == "ind-ind"]


@pytest.mark.parametrize("name", ["nodes.json", "nodes_l1.json", "nodes_l2.json"])
def test_industry_nodes_are_unchanged_from_v1_apart_from_position_labels_and_deep_shares(name):
    old = _v1(f"data/public/{name}")
    if old is None:
        pytest.skip("v1.0 tag not available")
    # display labels were shortened and remainder ("Other: ...") titles now use the official sector title
    skip = lambda n, k: k in ("xy", "replaces_share", "label") or (k == "title" and n["id"].endswith("-other"))
    strip = lambda ns: [{k: v for k, v in n.items() if not skip(n, k)} for n in ns if n["type"] == "ind"]
    assert strip(json.loads((public_dir() / name).read_text())) == strip(old)
