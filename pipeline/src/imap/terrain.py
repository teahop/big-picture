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


def split_amplitude(parent_amp: np.ndarray, parent_idx: np.ndarray, sizes: np.ndarray, ratio_sq: float) -> np.ndarray:
    """Child amplitudes that preserve the parent's terrain volume. The kernel narrows by `sigma_ratio`
    from parent to child, so the siblings together get amp_parent * ratio_sq, shared in proportion to
    log(1 + size). Without this, dozens of overlapping children would pile up far above their parent."""
    w = np.log1p(np.asarray(sizes, float))
    tot = pd.Series(w).groupby(parent_idx).transform("sum").to_numpy()
    share = np.divide(w, tot, out=np.zeros_like(w), where=tot > 0)
    return parent_amp[parent_idx] * ratio_sq * share


def level_layers(cfg: dict, extent: np.ndarray, ind: tuple, res: tuple) -> dict:
    """One terrain per layer and measure for a level of detail. `ind` and `res` are
    (xy, levels, {measure: amplitudes})."""
    kw = dict(n=cfg["grid_size"], margin=cfg["margin"], sigma0=cfg["bandwidth_level0"], per_level=cfg["bandwidth_per_level"])
    layers = {"industry": {"sign": 1, "measures": {}}, "research": {"sign": -1, "measures": {}}}
    for (xy, levels, amps), sign, layer in ((ind, 1.0, "industry"), (res, -1.0, "research")):
        for measure, a in amps.items():
            layers[layer]["measures"][measure] = height_grid_on(extent, xy, np.asarray(a, float), levels, sign=sign, **kw)
    return layers


def run() -> int:
    cfg = load_config()["terrain"]
    ratio_sq = 1.0 / cfg["bandwidth_per_level"] ** 2     # (sigma_parent / sigma_child)^2 for one level down
    layout = json.loads((public_dir() / "layout.json").read_text())["nodes"]
    totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str})
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv", dtype={"id": str})
    rd = pd.read_csv(interim_dir() / "herd" / "field_rd.csv", dtype={"id": str}).set_index("id")["rd_thousands"]
    ind_ids = [f"ind:{c}" for c in totals["ind_code"]]
    fld_ids = [f"fld:{i}" for i in fields["id"]]
    extent = np.array([layout[i] for i in ind_ids + fld_ids])  # one shared extent for every level and layer
    xy = lambda ids, src: np.array([src[i] for i in ids])
    a_emp0 = amplitudes(totals["emp_2025"].to_numpy(float))
    a_works0 = amplitudes(fields["works_us"].to_numpy(float))
    a_rd0 = amplitudes(fields["id"].map(rd).to_numpy(float))
    levels = {"0": level_layers(cfg, extent,
        (xy(ind_ids, layout), np.zeros(len(ind_ids), int), {"employment": a_emp0}),
        (xy(fld_ids, layout), np.zeros(len(fld_ids), int), {"works": a_works0, "rd": a_rd0}))}

    lv = interim_dir() / "levels"; child_path = public_dir() / "layout_children.json"
    if (lv / "industry_l1.csv").exists() and child_path.exists():
        from .common import load_deep_zones
        ch = json.loads(child_path.read_text())["nodes"]
        ind1 = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
        subs = pd.read_csv(lv / "subfields_l1.csv", dtype={"id": str, "field_id": str})
        topics = pd.read_csv(lv / "topics_l2.csv", dtype={"id": str, "subfield_id": str})
        deep = {z["id"] for z in load_deep_zones()["research_subfields"]}
        sec_pos = {c: i for i, c in enumerate(totals["ind_code"])}; fld_pos = {f: i for i, f in enumerate(fields["id"])}
        # Level 1
        ind_par = ind1["sector_code"].map(sec_pos).to_numpy()
        a_ind1 = split_amplitude(a_emp0, ind_par, ind1["emp_2025"].to_numpy(), ratio_sq)
        sub_par = subs["field_id"].map(fld_pos).to_numpy()
        a_works1 = split_amplitude(a_works0, sub_par, subs["works_us"].to_numpy(), ratio_sq)
        a_rd1 = split_amplitude(a_rd0, sub_par, subs["rd"].to_numpy(), ratio_sq)
        ind_xy = xy(list(ind1["node_id"]), ch)
        levels["1"] = level_layers(cfg, extent, (ind_xy, np.ones(len(ind1), int), {"employment": a_ind1}),
            (xy(list(subs["node_id"]), ch), np.ones(len(subs), int), {"works": a_works1, "rd": a_rd1}))
        # Level 2: deep-zone subfields are replaced by their topics (which split the subfield's amplitude)
        is_deep = subs["id"].isin(deep).to_numpy()
        sub_idx = {sid: i for i, sid in enumerate(subs["id"])}
        t_par = topics["subfield_id"].map(sub_idx).to_numpy()
        a_w2 = np.concatenate([a_works1[~is_deep], split_amplitude(a_works1, t_par, topics["works_us"].to_numpy(), ratio_sq)])
        a_r2 = np.concatenate([a_rd1[~is_deep], split_amplitude(a_rd1, t_par, topics["rd"].to_numpy(), ratio_sq)])
        keep = subs[~is_deep]
        r_ids = list(keep["node_id"]) + list(topics["node_id"])
        r_lv = np.array([1] * len(keep) + [2] * len(topics))
        levels["2"] = level_layers(cfg, extent, (ind_xy, np.ones(len(ind1), int), {"employment": a_ind1}),
            (xy(r_ids, ch), r_lv, {"works": a_w2, "rd": a_r2}))
    out = interim_dir() / "terrain"; out.mkdir(parents=True, exist_ok=True)
    payload = {"levels": levels, "params": cfg,
               "reference": "Level 0: log(1+size) scaled so the largest node is 1. Deeper levels split the parent's amplitude among its children (volume-preserving, proportional to log(1+size))"}
    (out / "terrain.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    for lv_name, layers in levels.items():
        for lname, layer in layers.items():
            for m, g in layer["measures"].items():
                v = np.array(g["values"]); print(f"terrain: L{lv_name} {lname}/{m} {g['n']}x{g['n']}, height {v.min():.2f} to {v.max():.2f}")
    return 0
