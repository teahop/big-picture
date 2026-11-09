"""Height grids (SPEC 6.4): a sum of Gaussian kernels centred on the layer's nodes.

Amplitude is log(1 + size) divided by log(1 + reference size), so a shared
reference lets the research layer use the same range in Phase 2. Industry
heights are positive; research heights are negative. Bandwidth shrinks with node level.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir

DECIMALS = 4


def amplitudes(sizes: np.ndarray, ref_size: float | None = None) -> np.ndarray:
    ref = float(np.max(sizes)) if ref_size is None else ref_size
    return np.log1p(sizes) / np.log1p(ref)


def height_grid(xy: np.ndarray, amp: np.ndarray, levels: np.ndarray, *, n: int, margin: float,
                sigma0: float, per_level: float, sign: float = 1.0) -> dict:
    lo, hi = xy.min(axis=0) - margin, xy.max(axis=0) + margin
    gx, gy = np.meshgrid(np.linspace(lo[0], hi[0], n), np.linspace(lo[1], hi[1], n))
    z = np.zeros_like(gx)
    for (px, py), a, lv in zip(xy, amp, levels):
        sigma = sigma0 * (per_level ** int(lv))
        z += a * np.exp(-((gx - px) ** 2 + (gy - py) ** 2) / (2 * sigma ** 2))
    z *= sign
    return {"n": n, "x": [float(lo[0]), float(hi[0])], "y": [float(lo[1]), float(hi[1])],
            "values": np.round(z, DECIMALS).ravel().tolist()}  # row-major, row = y


def height_grid_on(extent_xy: np.ndarray, xy: np.ndarray, amp: np.ndarray, levels: np.ndarray, **kw) -> dict:
    """Like height_grid, but the grid extent comes from `extent_xy` so layers share one grid."""
    n, margin, sigma0, per_level, sign = kw["n"], kw["margin"], kw["sigma0"], kw["per_level"], kw.get("sign", 1.0)
    lo, hi = extent_xy.min(axis=0) - margin, extent_xy.max(axis=0) + margin
    gx, gy = np.meshgrid(np.linspace(lo[0], hi[0], n), np.linspace(lo[1], hi[1], n))
    z = np.zeros_like(gx)
    for (px, py), a, lv in zip(xy, amp, levels):
        sigma = sigma0 * (per_level ** int(lv))
        z += a * np.exp(-((gx - px) ** 2 + (gy - py) ** 2) / (2 * sigma ** 2))
    return {"n": n, "x": [float(lo[0]), float(hi[0])], "y": [float(lo[1]), float(hi[1])],
            "values": np.round(z * sign, DECIMALS).ravel().tolist()}


def run() -> int:
    cfg = load_config()["terrain"]
    layout = json.loads((public_dir() / "layout.json").read_text())["nodes"]
    totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str})
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv", dtype={"id": str})
    rd = pd.read_csv(interim_dir() / "herd" / "field_rd.csv", dtype={"id": str}).set_index("id")["rd_thousands"]
    ind_ids = [f"ind:{c}" for c in totals["ind_code"]]
    fld_ids = [f"fld:{i}" for i in fields["id"]]
    all_xy = np.array([layout[i] for i in ind_ids + fld_ids])  # one shared extent for both layers
    kw = dict(n=cfg["grid_size"], margin=cfg["margin"], sigma0=cfg["bandwidth_level0"], per_level=cfg["bandwidth_per_level"])

    def grid(ids: list[str], sizes: np.ndarray, sign: float) -> dict:
        xy = np.array([layout[i] for i in ids])
        g = height_grid_on(all_xy, xy, amplitudes(sizes), np.zeros(len(ids), dtype=int), sign=sign, **kw)
        return g

    layers = {
        "industry": {"sign": 1, "measures": {"employment": grid(ind_ids, totals["emp_2025"].to_numpy(), 1.0)}},
        "research": {"sign": -1, "measures": {
            "works": grid(fld_ids, fields["works_us"].to_numpy(float), -1.0),
            "rd": grid(fld_ids, fields["id"].map(rd).to_numpy(float), -1.0)}},
    }
    out = interim_dir() / "terrain"; out.mkdir(parents=True, exist_ok=True)
    payload = {"layers": layers, "params": cfg, "reference": "each measure scaled so its largest Level 0 node has amplitude 1 (common range)"}
    (out / "terrain.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    for lname, layer in layers.items():
        for m, g in layer["measures"].items():
            v = np.array(g["values"])
            print(f"terrain: {lname}/{m} {g['n']}x{g['n']}, height range {v.min():.3f} to {v.max():.3f}")
    return 0
