"""Height grids (SPEC 6.4): a sum of Gaussian kernels centred on the layer's nodes.

Amplitude is log(1 + size) divided by log(1 + reference size), so a shared
reference lets the research layer use the same range in Phase 2. Industry
heights are positive. Bandwidth shrinks with node level.
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


def run() -> int:
    cfg = load_config()["terrain"]
    layout = json.loads((public_dir() / "layout.json").read_text())["nodes"]
    totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str})
    ids = [f"ind:{c}" for c in totals["ind_code"]]
    xy = np.array([layout[i] for i in ids])
    levels = np.zeros(len(ids), dtype=int)
    amp = amplitudes(totals["emp_2025"].to_numpy())
    grid = height_grid(xy, amp, levels, n=cfg["grid_size"], margin=cfg["margin"],
                       sigma0=cfg["bandwidth_level0"], per_level=cfg["bandwidth_per_level"])
    out = interim_dir() / "terrain"
    out.mkdir(parents=True, exist_ok=True)
    payload = {"layers": {"industry": {"sign": 1, "measures": {"employment": grid}}},
               "params": cfg, "reference": "max Level 0 employment (2025)"}
    (out / "terrain.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"terrain: industry grid {grid['n']}x{grid['n']}, max height {max(grid['values']):.3f}")
    return 0
