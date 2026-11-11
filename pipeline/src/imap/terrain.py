"""Industry terrain: one height grid per level and size setting.

Every industry raises the ground with a Gaussian kernel (v1 SPEC 6.4) whose width shrinks with the node's level. Its
amplitude comes from its own size, compared with the other industries drawn at the same level:
(size / largest) ** height_exponent. With `combine: max` each point takes the tallest kernel there, so every peak shows
its own industry's size and a cluster of small industries never outgrows one large one.

Research fields are not drawn (owner decision, 2026-11-10); research and academia show through industries such as
higher education and scientific R&D services.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir

DECIMALS = 4
# Size settings: one switch.
SETTINGS: dict[str, str] = {"activity": "employment", "dollars": "value_added"}


@dataclass
class Layer:
    """Kernel sources at one level: ids, positions, node levels (for the bandwidth), amplitudes."""
    ids: list[str]
    xy: np.ndarray
    levels: np.ndarray
    amp: np.ndarray


def size_amplitude(sizes: np.ndarray, exponent: float) -> np.ndarray:
    """Kernel amplitude from a node's own size: (size / largest size) ** exponent, so the largest node is 1.
    An exponent of 1 is proportional; smaller exponents lift small nodes (0.5 = square root)."""
    s = np.nan_to_num(np.asarray(sizes, float), nan=0.0).clip(min=0)
    top = s.max()
    return (s / top) ** exponent if top > 0 else s


def axes(extent_xy: np.ndarray, n: int, margin: float) -> tuple[np.ndarray, np.ndarray, list[float], list[float]]:
    lo, hi = extent_xy.min(axis=0) - margin, extent_xy.max(axis=0) + margin
    gx, gy = np.meshgrid(np.linspace(lo[0], hi[0], n), np.linspace(lo[1], hi[1], n))
    return gx, gy, [float(lo[0]), float(hi[0])], [float(lo[1]), float(hi[1])]


def kernel_surface(gx: np.ndarray, gy: np.ndarray, layer: Layer, sigma0: float, per_level: float, mode: str = "max") -> np.ndarray:
    """The layer's Gaussian kernels at points (gx, gy): the tallest one ("max") or their sum ("sum")."""
    z = np.zeros_like(np.asarray(gx, float))
    for (px, py), a, lv in zip(layer.xy, layer.amp, layer.levels):
        sigma = sigma0 * (per_level ** int(lv))
        k = a * np.exp(-((gx - px) ** 2 + (gy - py) ** 2) / (2 * sigma ** 2))
        z = np.maximum(z, k) if mode == "max" else z + k
    return z


def height_grid(layer: Layer, extent_xy: np.ndarray, cfg: dict) -> dict:
    gx, gy, x, y = axes(extent_xy, int(cfg["grid_size"]), float(cfg["margin"]))
    z = kernel_surface(gx, gy, layer, float(cfg["bandwidth_level0"]), float(cfg["bandwidth_per_level"]), cfg.get("combine", "max"))
    return {"n": int(cfg["grid_size"]), "x": x, "y": y, "values": np.round(z, DECIMALS).ravel().tolist()}   # row-major, row = y


def build_layers(cfg: dict) -> tuple[dict[str, dict[str, Layer]], np.ndarray]:
    """layers[level][setting] and the shared extent (all Level 0 positions). Every node is sized by its own figure
    (jobs or value added), on one scale per level: the industries drawn at a level are compared with each other."""
    p = float(cfg.get("height_exponent", 0.5))
    layout = json.loads((public_dir() / "layout.json").read_text())["nodes"]
    totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str})
    ind_ids = [f"ind:{c}" for c in totals["ind_code"]]
    extent = np.array([layout[i] for i in ind_ids])
    lv = interim_dir() / "levels"
    child_path = public_dir() / "layout_children.json"
    zeros = lambda k: np.zeros(k, int)
    sizes: dict[str, dict[str, tuple[list[str], np.ndarray, np.ndarray]]] = {
        "0": {"employment": (ind_ids, zeros(len(ind_ids)), totals["emp_2025"].to_numpy(float))}}
    pos = dict(layout)
    if (lv / "industry_l1.csv").exists() and child_path.exists():
        pos.update(json.loads(child_path.read_text())["nodes"])
        ind1 = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
        ids1, one = list(ind1["node_id"]), np.ones(len(ind1), int)
        emp1 = ind1["emp_2025"].to_numpy(float)
        sizes["1"] = {"employment": (ids1, one, emp1)}
        # Level 2: deep: categories replace the Level 1 industries they split
        deep_path, contrib_path = lv / "deep_industry.csv", lv / "deep_industry_contrib.csv"
        if deep_path.exists() and contrib_path.exists():
            deep = pd.read_csv(deep_path)
            gone = ind1["ind_code"].isin(set(pd.read_csv(contrib_path, dtype={"parent_code": str})["parent_code"])).to_numpy()
            ids2 = [i for i, g in zip(ids1, gone) if not g] + list(deep["node_id"])
            lv2 = np.array([1] * int((~gone).sum()) + [2] * len(deep))
            sizes["2"] = {"employment": (ids2, lv2, np.concatenate([emp1[~gone], deep["emp_2025"].to_numpy(float)]))}
        else:
            deep, gone, ids2, lv2 = None, np.zeros(len(ids1), bool), ids1, one
            sizes["2"] = {"employment": (ids1, one, emp1)}
        val_path = lv / "industry_value.csv"
        if val_path.exists():
            va1 = ind1["node_id"].map(pd.read_csv(val_path, dtype={"ind_code": str}).set_index("node_id")["value_added_usd_b"]).to_numpy(float)
            va0 = pd.Series(va1).groupby(ind1["sector_code"].to_numpy()).sum().reindex(totals["ind_code"]).to_numpy(float)
            sizes["0"]["value_added"] = (ind_ids, zeros(len(ind_ids)), va0)
            sizes["1"]["value_added"] = (ids1, one, va1)
            dv_path = lv / "deep_industry_value.csv"
            if deep is not None and dv_path.exists():
                dv = pd.read_csv(dv_path).set_index("node_id")["value_added_usd_b"]
                sizes["2"]["value_added"] = (ids2, lv2, np.concatenate([va1[~gone], deep["node_id"].map(dv).to_numpy(float)]))
            else:
                sizes["2"]["value_added"] = (ids1, one, va1)
    layers: dict[str, dict[str, Layer]] = {}
    for level, by_measure in sizes.items():
        layers[level] = {s: Layer(by_measure[m][0], np.array([pos[i] for i in by_measure[m][0]]), by_measure[m][1], size_amplitude(by_measure[m][2], p))
                         for s, m in SETTINGS.items() if m in by_measure}
    return layers, extent


def run() -> int:
    cfg = load_config()["terrain"]
    layers, extent = build_layers(cfg)
    levels: dict[str, dict] = {}
    for lv_name, by_setting in layers.items():
        grids = {s: height_grid(layer, extent, cfg) for s, layer in by_setting.items()}
        first = next(iter(grids.values()))
        levels[lv_name] = {"n": first["n"], "x": first["x"], "y": first["y"], "settings": {s: {"height": g["values"]} for s, g in grids.items()}}
    largest = {lv: {s: layer.ids[int(np.argmax(layer.amp))] for s, layer in by.items()} for lv, by in layers.items()}
    out = interim_dir() / "terrain"; out.mkdir(parents=True, exist_ok=True)
    payload = {"levels": levels, "params": cfg, "largest": largest, "settings": SETTINGS,
               "reference": "Each industry's kernel amplitude is (size / largest at that level) ** height_exponent, so the largest "
                            "industry of each level peaks at 1. combine: max keeps the tallest kernel at each point, sum adds them."}
    (out / "terrain.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    for lv_name, g in levels.items():
        for s, grids in g["settings"].items():
            print(f"terrain: L{lv_name} {s} {g['n']}x{g['n']}, height 0 to {max(grids['height']):.2f}, largest {largest[lv_name][s]}")
    return 0
