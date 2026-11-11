"""One terrain for industry and research (SPEC 5.2).

Every node raises the ground with a Gaussian kernel (v1 SPEC 6.4). Its amplitude comes from its own size, compared with
the other nodes of its type drawn at the same level: (size / largest) ** height_exponent. Jobs and papers have different units, so each type is scaled on its own before the two are added: the
largest industry and the largest research node of each level reach the same peak height (times
`terrain.research_relative_height`). The scaling constants go into the output.

Per level and size setting the stage writes one height grid and one industry-share grid (share of the height that
comes from industry: 1 = all industry, 0 = all research, 0.5 where the ground is flat).
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir

DECIMALS = 4          # heights
SHARE_DECIMALS = 3
FLAT = 1e-4           # below this combined height a cell has no meaningful mix; its share is neutral (0.5)
# Size settings (SPEC 5.3): one switch, applied to both types together.
SETTINGS: dict[str, dict[str, str]] = {
    "activity": {"industry": "employment", "research": "works"},
    "dollars": {"industry": "value_added", "research": "rd"},
}


@dataclass
class Layer:
    """Kernel sources of one node type at one level: ids, positions, node levels (for the bandwidth), amplitudes."""
    ids: list[str]
    xy: np.ndarray
    levels: np.ndarray
    amp: np.ndarray


def axes(extent_xy: np.ndarray, n: int, margin: float) -> tuple[np.ndarray, np.ndarray, list[float], list[float]]:
    lo, hi = extent_xy.min(axis=0) - margin, extent_xy.max(axis=0) + margin
    gx, gy = np.meshgrid(np.linspace(lo[0], hi[0], n), np.linspace(lo[1], hi[1], n))
    return gx, gy, [float(lo[0]), float(hi[0])], [float(lo[1]), float(hi[1])]


def kernel_sum(gx: np.ndarray, gy: np.ndarray, layer: Layer, sigma0: float, per_level: float, mode: str = "sum") -> np.ndarray:
    """The layer's Gaussian kernels at points (gx, gy), unscaled: summed, or the tallest one ("max"), so a crowd of
    small nodes never outgrows one large node."""
    z = np.zeros_like(np.asarray(gx, float))
    for (px, py), a, lv in zip(layer.xy, layer.amp, layer.levels):
        sigma = sigma0 * (per_level ** int(lv))
        k = a * np.exp(-((gx - px) ** 2 + (gy - py) ** 2) / (2 * sigma ** 2))
        z = np.maximum(z, k) if mode == "max" else z + k
    return z


def height_grid(xy: np.ndarray, amp: np.ndarray, levels: np.ndarray, *, n: int, margin: float,
                sigma0: float, per_level: float) -> dict:
    """One type's kernel sum on a grid that just covers its own nodes (used by tests and for checks)."""
    gx, gy, x, y = axes(xy, n, margin)
    z = kernel_sum(gx, gy, Layer([], xy, levels, amp), sigma0, per_level)
    return {"n": n, "x": x, "y": y, "values": np.round(z, DECIMALS).ravel().tolist()}  # row-major, row = y


def type_scale(level0: Layer, sigma0: float, per_level: float, target: float = 1.0, mode: str = "sum") -> tuple[float, str]:
    """Factor that brings the type's own surface to `target` at its largest Level 0 node, and that node's id.
    The surface there includes the type's neighbouring kernels, so equal amplitudes alone would not give equal peaks."""
    i = int(np.argmax(level0.amp))
    px, py = level0.xy[i]
    h = float(kernel_sum(np.array([px]), np.array([py]), level0, sigma0, per_level, mode)[0])
    return target / h, level0.ids[i]


def combine(ind: Layer, res: Layer, k_ind: float, k_res: float, extent_xy: np.ndarray, cfg: dict) -> dict:
    """One height grid and one industry-share grid on the shared extent."""
    gx, gy, _, _ = axes(extent_xy, int(cfg["grid_size"]), float(cfg["margin"]))
    s0, pl = float(cfg["bandwidth_level0"]), float(cfg["bandwidth_per_level"])
    mode = cfg.get("combine", "sum")
    zi, zr = k_ind * kernel_sum(gx, gy, ind, s0, pl, mode), k_res * kernel_sum(gx, gy, res, s0, pl, mode)
    h = np.maximum(zi, zr) if mode == "max" else zi + zr
    share = np.where(h > FLAT, np.divide(zi, h, out=np.full_like(h, 0.5), where=h > 0), 0.5)
    return {"height": np.round(h, DECIMALS).ravel().tolist(), "share": np.round(share, SHARE_DECIMALS).ravel().tolist()}


def grid_frame(extent_xy: np.ndarray, cfg: dict) -> dict:
    _, _, x, y = axes(extent_xy, int(cfg["grid_size"]), float(cfg["margin"]))
    return {"n": int(cfg["grid_size"]), "x": x, "y": y}


def size_amplitude(sizes: np.ndarray, exponent: float) -> np.ndarray:
    """Kernel amplitude from a node's own size: (size / largest size) ** exponent, so the largest node is 1.
    An exponent of 1 is proportional; smaller exponents lift small nodes (0.5 = square root)."""
    s = np.nan_to_num(np.asarray(sizes, float), nan=0.0).clip(min=0)
    top = s.max()
    return (s / top) ** exponent if top > 0 else s


def build_layers(cfg: dict) -> tuple[dict[str, dict[str, dict[str, Layer]]], np.ndarray]:
    """layers[level][setting][type] and the shared extent (all Level 0 positions).

    Every node is sized by its own figure (jobs, value added, publications, R&D), on one scale per level and type:
    the nodes drawn at a level are compared with each other, not with their siblings."""
    p = float(cfg.get("height_exponent", 0.5))
    layout = json.loads((public_dir() / "layout.json").read_text())["nodes"]
    totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str})
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv", dtype={"id": str})
    rd = pd.read_csv(interim_dir() / "herd" / "field_rd.csv", dtype={"id": str}).set_index("id")["rd_thousands"]
    ind_ids = [f"ind:{c}" for c in totals["ind_code"]]
    fld_ids = [f"fld:{i}" for i in fields["id"]]
    extent = np.array([layout[i] for i in ind_ids + fld_ids])  # one shared extent for every level and setting
    lv = interim_dir() / "levels"
    child_path = public_dir() / "layout_children.json"
    have_l1 = (lv / "industry_l1.csv").exists() and child_path.exists()

    # sizes[level][measure] = (ids, node levels, sizes); positions come from layout.json / layout_children.json
    sizes: dict[str, dict[str, tuple[list[str], np.ndarray, np.ndarray]]] = {"0": {
        "employment": (ind_ids, np.zeros(len(ind_ids), int), totals["emp_2025"].to_numpy(float)),
        "works": (fld_ids, np.zeros(len(fld_ids), int), fields["works_us"].to_numpy(float)),
        "rd": (fld_ids, np.zeros(len(fld_ids), int), fields["id"].map(rd).to_numpy(float))}}
    pos = dict(layout)
    if have_l1:
        from .common import load_deep_zones
        pos.update(json.loads(child_path.read_text())["nodes"])
        ind1 = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
        subs = pd.read_csv(lv / "subfields_l1.csv", dtype={"id": str, "field_id": str})
        topics = pd.read_csv(lv / "topics_l2.csv", dtype={"id": str, "subfield_id": str})
        deep_subs = {z["id"] for z in load_deep_zones()["research_subfields"]}
        ids1, sub_ids = list(ind1["node_id"]), list(subs["node_id"])
        one = lambda k: np.ones(k, int)
        sizes["1"] = {"employment": (ids1, one(len(ids1)), ind1["emp_2025"].to_numpy(float)),
                      "works": (sub_ids, one(len(sub_ids)), subs["works_us"].to_numpy(float)),
                      "rd": (sub_ids, one(len(sub_ids)), subs["rd"].to_numpy(float))}
        # Level 2: deep-zone subfields are replaced by their topics; deep: industries replace the industries they split
        keep = subs[~subs["id"].isin(deep_subs)]
        r_ids = list(keep["node_id"]) + list(topics["node_id"])
        r_lv = np.array([1] * len(keep) + [2] * len(topics))
        sizes["2"] = {"works": (r_ids, r_lv, np.concatenate([keep["works_us"].to_numpy(float), topics["works_us"].to_numpy(float)])),
                      "rd": (r_ids, r_lv, np.concatenate([keep["rd"].to_numpy(float), topics["rd"].to_numpy(float)]))}
        deep_path, contrib_path = lv / "deep_industry.csv", lv / "deep_industry_contrib.csv"
        if deep_path.exists() and contrib_path.exists():
            deep = pd.read_csv(deep_path)
            gone = ind1["ind_code"].isin(set(pd.read_csv(contrib_path, dtype={"parent_code": str})["parent_code"]))
            i_ids = list(ind1["node_id"][~gone]) + list(deep["node_id"])
            i_lv = np.array([1] * int((~gone).sum()) + [2] * len(deep))
            sizes["2"]["employment"] = (i_ids, i_lv, np.concatenate([ind1["emp_2025"][~gone].to_numpy(float), deep["emp_2025"].to_numpy(float)]))
        else:
            deep, gone, i_ids, i_lv = None, None, ids1, one(len(ids1))
            sizes["2"]["employment"] = (ids1, one(len(ids1)), ind1["emp_2025"].to_numpy(float))
        val_path = lv / "industry_value.csv"
        if val_path.exists():
            va = pd.read_csv(val_path, dtype={"ind_code": str}).set_index("node_id")["value_added_usd_b"]
            va1 = ind1["node_id"].map(va).to_numpy(float)
            va0 = pd.Series(va1).groupby(ind1["sector_code"].to_numpy()).sum().reindex(totals["ind_code"]).to_numpy(float)
            sizes["0"]["value_added"] = (ind_ids, np.zeros(len(ind_ids), int), va0)
            sizes["1"]["value_added"] = (ids1, one(len(ids1)), va1)
            dv_path = lv / "deep_industry_value.csv"
            if deep is not None and dv_path.exists():
                dv = pd.read_csv(dv_path).set_index("node_id")["value_added_usd_b"]
                sizes["2"]["value_added"] = (i_ids, i_lv, np.concatenate([va1[~gone.to_numpy()], deep["node_id"].map(dv).to_numpy(float)]))
            else:
                sizes["2"]["value_added"] = (ids1, one(len(ids1)), va1)

    layers: dict[str, dict[str, dict[str, Layer]]] = {}
    for level, by_measure in sizes.items():
        layers[level] = {}
        for setting, t in SETTINGS.items():
            if not all(m in by_measure for m in t.values()):
                continue
            layers[level][setting] = {}
            for typ, m in t.items():
                ids, lvls, sz = by_measure[m]
                layers[level][setting][typ] = Layer(ids, np.array([pos[i] for i in ids]), lvls, size_amplitude(sz, p))
    return layers, extent


def scales(layers: dict, cfg: dict) -> dict[str, dict[str, dict]]:
    """Per level and size setting: the factor for each type so both peak at the same height (the largest industry
    and the largest research node of that level, times research_relative_height for research)."""
    s0, pl, mode = float(cfg["bandwidth_level0"]), float(cfg["bandwidth_per_level"]), cfg.get("combine", "sum")
    rel = float(cfg.get("research_relative_height", 1.0))
    out: dict[str, dict[str, dict]] = {}
    for level, by_setting in layers.items():
        out[level] = {}
        for s, t in by_setting.items():
            ki, top_i = type_scale(t["industry"], s0, pl, mode=mode)
            kr, top_r = type_scale(t["research"], s0, pl, target=rel, mode=mode)
            out[level][s] = {"industry": round(ki, 6), "research": round(kr, 6), "largest_industry": top_i, "largest_research": top_r,
                             "industry_peak": 1.0, "research_peak": rel, "measures": SETTINGS[s]}
    return out


def run() -> int:
    cfg = load_config()["terrain"]
    layers, extent = build_layers(cfg)
    k = scales(layers, cfg)
    levels: dict[str, dict] = {}
    for lv_name, by_setting in layers.items():
        levels[lv_name] = {**grid_frame(extent, cfg), "settings": {}}
        for s, t in by_setting.items():
            levels[lv_name]["settings"][s] = combine(t["industry"], t["research"], k[lv_name][s]["industry"], k[lv_name][s]["research"], extent, cfg)
    out = interim_dir() / "terrain"; out.mkdir(parents=True, exist_ok=True)
    payload = {"levels": levels, "params": cfg, "scale": k,
               "reference": "Each node's kernel amplitude is (size / largest size of its type at that level) ** height_exponent; "
                            "each type is then multiplied by its scale so the largest industry and the largest research node of the "
                            "level peak at industry_peak and research_peak. share = industry part of the height (0.5 where the ground is flat). combine: sum adds kernels, max keeps the tallest."}
    (out / "terrain.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    for s, v in k["0"].items():
        print(f"terrain: L0 {s}: scale industry {v['industry']:.4f} ({v['largest_industry']}), research {v['research']:.4f} ({v['largest_research']})")
    for lv_name, g in levels.items():
        for s, grids in g["settings"].items():
            h = np.array(grids["height"]); sh = np.array(grids["share"])
            print(f"terrain: L{lv_name} {s} {g['n']}x{g['n']}, height 0 to {h.max():.2f}, share {sh.min():.2f} to {sh.max():.2f}")
    return 0
