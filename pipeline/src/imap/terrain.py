"""One terrain for industry and research (SPEC 5.2).

Every node raises the ground with a Gaussian kernel (v1 SPEC 6.4). Amplitude at Level 0 is log(1 + size) divided by
log(1 + the type's largest size); deeper levels split the parent's amplitude among its children so the terrain volume is
preserved. Jobs and papers have different units, so each type is scaled on its own before the two are added: the
largest Level 0 industry and the largest Level 0 field reach the same peak height (times
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


def amplitudes(sizes: np.ndarray, ref_size: float | None = None) -> np.ndarray:
    ref = float(np.max(sizes)) if ref_size is None else ref_size
    return np.log1p(sizes) / np.log1p(ref)


def axes(extent_xy: np.ndarray, n: int, margin: float) -> tuple[np.ndarray, np.ndarray, list[float], list[float]]:
    lo, hi = extent_xy.min(axis=0) - margin, extent_xy.max(axis=0) + margin
    gx, gy = np.meshgrid(np.linspace(lo[0], hi[0], n), np.linspace(lo[1], hi[1], n))
    return gx, gy, [float(lo[0]), float(hi[0])], [float(lo[1]), float(hi[1])]


def kernel_sum(gx: np.ndarray, gy: np.ndarray, layer: Layer, sigma0: float, per_level: float) -> np.ndarray:
    """Sum of the layer's Gaussian kernels at points (gx, gy), unscaled."""
    z = np.zeros_like(np.asarray(gx, float))
    for (px, py), a, lv in zip(layer.xy, layer.amp, layer.levels):
        sigma = sigma0 * (per_level ** int(lv))
        z += a * np.exp(-((gx - px) ** 2 + (gy - py) ** 2) / (2 * sigma ** 2))
    return z


def height_grid(xy: np.ndarray, amp: np.ndarray, levels: np.ndarray, *, n: int, margin: float,
                sigma0: float, per_level: float) -> dict:
    """One type's kernel sum on a grid that just covers its own nodes (used by tests and for checks)."""
    gx, gy, x, y = axes(xy, n, margin)
    z = kernel_sum(gx, gy, Layer([], xy, levels, amp), sigma0, per_level)
    return {"n": n, "x": x, "y": y, "values": np.round(z, DECIMALS).ravel().tolist()}  # row-major, row = y


def split_amplitude(parent_amp: np.ndarray, parent_idx: np.ndarray, sizes: np.ndarray, ratio_sq: float) -> np.ndarray:
    """Child amplitudes that preserve the parent's terrain volume. The kernel narrows by `sigma_ratio`
    from parent to child, so the siblings together get amp_parent * ratio_sq, shared in proportion to
    log(1 + size). Without this, dozens of overlapping children would pile up far above their parent."""
    w = np.log1p(np.asarray(sizes, float))
    tot = pd.Series(w).groupby(parent_idx).transform("sum").to_numpy()
    share = np.divide(w, tot, out=np.zeros_like(w), where=tot > 0)
    return parent_amp[parent_idx] * ratio_sq * share


def type_scale(level0: Layer, sigma0: float, per_level: float, target: float = 1.0) -> tuple[float, str]:
    """Factor that brings the type's own surface to `target` at its largest Level 0 node, and that node's id.
    The surface there includes the type's neighbouring kernels, so equal amplitudes alone would not give equal peaks."""
    i = int(np.argmax(level0.amp))
    px, py = level0.xy[i]
    h = float(kernel_sum(np.array([px]), np.array([py]), level0, sigma0, per_level)[0])
    return target / h, level0.ids[i]


def combine(ind: Layer, res: Layer, k_ind: float, k_res: float, extent_xy: np.ndarray, cfg: dict) -> dict:
    """One height grid and one industry-share grid on the shared extent."""
    gx, gy, _, _ = axes(extent_xy, int(cfg["grid_size"]), float(cfg["margin"]))
    s0, pl = float(cfg["bandwidth_level0"]), float(cfg["bandwidth_per_level"])
    zi, zr = k_ind * kernel_sum(gx, gy, ind, s0, pl), k_res * kernel_sum(gx, gy, res, s0, pl)
    h = zi + zr
    share = np.where(h > FLAT, np.divide(zi, h, out=np.full_like(h, 0.5), where=h > 0), 0.5)
    return {"height": np.round(h, DECIMALS).ravel().tolist(), "share": np.round(share, SHARE_DECIMALS).ravel().tolist()}


def grid_frame(extent_xy: np.ndarray, cfg: dict) -> dict:
    _, _, x, y = axes(extent_xy, int(cfg["grid_size"]), float(cfg["margin"]))
    return {"n": int(cfg["grid_size"]), "x": x, "y": y}


def deep_replace(ids1: list[str], codes1: pd.Series, a1: np.ndarray, deep_ids: pd.Series, contrib: pd.DataFrame,
                 size_col: str, ratio_sq: float) -> tuple[list[str], np.ndarray, np.ndarray]:
    """Level 2 industries: deep: categories replace the Level 1 industries they split; each replaced parent's amplitude
    is shared among the deep nodes that take part of it (volume-preserving, proportional to log(1 + size))."""
    row = {c: i for i, c in enumerate(codes1)}
    a_deep = pd.Series(0.0, index=deep_ids)
    for pcode, g in contrib.groupby("parent_code"):
        w = np.log1p(g[size_col].to_numpy(float)); w = w / w.sum()
        a_deep.loc[g["node_id"].to_numpy()] += a1[row[pcode]] * ratio_sq * w
    gone = codes1.isin(set(contrib["parent_code"])).to_numpy()
    ids = [i for i, g in zip(ids1, gone) if not g] + list(deep_ids)
    amp = np.concatenate([a1[~gone], a_deep.reindex(deep_ids).to_numpy()])
    lv = np.array([1] * int((~gone).sum()) + [2] * len(deep_ids))
    return ids, amp, lv


def build_layers(cfg: dict) -> tuple[dict[str, dict[str, dict[str, Layer]]], np.ndarray]:
    """layers[level][setting][type] and the shared extent (all Level 0 positions)."""
    ratio_sq = 1.0 / cfg["bandwidth_per_level"] ** 2     # (sigma_parent / sigma_child)^2 for one level down
    layout = json.loads((public_dir() / "layout.json").read_text())["nodes"]
    totals = pd.read_csv(interim_dir() / "bls" / "sector_totals.csv", dtype={"ind_code": str})
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv", dtype={"id": str})
    rd = pd.read_csv(interim_dir() / "herd" / "field_rd.csv", dtype={"id": str}).set_index("id")["rd_thousands"]
    ind_ids = [f"ind:{c}" for c in totals["ind_code"]]
    fld_ids = [f"fld:{i}" for i in fields["id"]]
    extent = np.array([layout[i] for i in ind_ids + fld_ids])  # one shared extent for every level and setting
    xy = lambda ids, src: np.array([src[i] for i in ids])
    zeros = lambda k: np.zeros(k, int)
    lv = interim_dir() / "levels"
    val_path = lv / "industry_value.csv"
    has_value = val_path.exists()

    a = {"employment": amplitudes(totals["emp_2025"].to_numpy(float)),
         "works": amplitudes(fields["works_us"].to_numpy(float)),
         "rd": amplitudes(fields["id"].map(rd).to_numpy(float))}
    child_path = public_dir() / "layout_children.json"
    have_l1 = (lv / "industry_l1.csv").exists() and child_path.exists()
    if have_l1:
        ind1 = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str})
    if has_value and have_l1:
        va1 = ind1["node_id"].map(pd.read_csv(val_path, dtype={"ind_code": str}).set_index("node_id")["value_added_usd_b"]).to_numpy(float)
        va0 = pd.Series(va1).groupby(ind1["sector_code"].to_numpy()).sum().reindex(totals["ind_code"]).to_numpy(float)
        a["value_added"] = amplitudes(va0)

    def l0(m: str) -> Layer:
        ids = ind_ids if m in ("employment", "value_added") else fld_ids
        return Layer(ids, xy(ids, layout), zeros(len(ids)), a[m])

    settings = {s: t for s, t in SETTINGS.items() if all(m in a for m in t.values())}
    layers = {"0": {s: {"industry": l0(t["industry"]), "research": l0(t["research"])} for s, t in settings.items()}}
    if not have_l1:
        return layers, extent

    from .common import load_deep_zones
    ch = json.loads(child_path.read_text())["nodes"]
    subs = pd.read_csv(lv / "subfields_l1.csv", dtype={"id": str, "field_id": str})
    topics = pd.read_csv(lv / "topics_l2.csv", dtype={"id": str, "subfield_id": str})
    deep = {z["id"] for z in load_deep_zones()["research_subfields"]}
    sec_pos = {c: i for i, c in enumerate(totals["ind_code"])}; fld_pos = {f: i for i, f in enumerate(fields["id"])}
    ind_par = ind1["sector_code"].map(sec_pos).to_numpy()
    sub_par = subs["field_id"].map(fld_pos).to_numpy()
    ids1, sub_ids = list(ind1["node_id"]), list(subs["node_id"])
    # Level 1
    a1 = {"employment": split_amplitude(a["employment"], ind_par, ind1["emp_2025"].to_numpy(), ratio_sq),
          "works": split_amplitude(a["works"], sub_par, subs["works_us"].to_numpy(), ratio_sq),
          "rd": split_amplitude(a["rd"], sub_par, subs["rd"].to_numpy(), ratio_sq)}
    if "value_added" in a:
        a1["value_added"] = split_amplitude(a["value_added"], ind_par, va1, ratio_sq)
    # Level 2 research: deep-zone subfields are replaced by their topics (which split the subfield's amplitude)
    is_deep = subs["id"].isin(deep).to_numpy()
    t_par = topics["subfield_id"].map({sid: i for i, sid in enumerate(subs["id"])}).to_numpy()
    r_ids = list(subs["node_id"][~is_deep]) + list(topics["node_id"])
    r_lv = np.array([1] * int((~is_deep).sum()) + [2] * len(topics))
    a2_res = {m: np.concatenate([a1[m][~is_deep], split_amplitude(a1[m], t_par, topics[col].to_numpy(), ratio_sq)])
              for m, col in (("works", "works_us"), ("rd", "rd"))}
    # Level 2 industry
    l2_ind: dict[str, tuple[list[str], np.ndarray, np.ndarray]] = {m: (ids1, a1[m], np.ones(len(ind1), int)) for m in ("employment", "value_added") if m in a1}
    dpath = lv / "deep_industry.csv"
    if dpath.exists():
        deep_n = pd.read_csv(dpath)
        for m, cfile, col in (("employment", "deep_industry_contrib.csv", "emp_2025"), ("value_added", "deep_industry_value_contrib.csv", "value_added_usd_b")):
            if m in a1 and (lv / cfile).exists():
                l2_ind[m] = deep_replace(ids1, ind1["ind_code"], a1[m], deep_n["node_id"], pd.read_csv(lv / cfile, dtype={"parent_code": str}), col, ratio_sq)
    layers["1"], layers["2"] = {}, {}
    for s, t in settings.items():
        mi, mr = t["industry"], t["research"]
        layers["1"][s] = {"industry": Layer(ids1, xy(ids1, ch), np.ones(len(ids1), int), a1[mi]),
                          "research": Layer(sub_ids, xy(sub_ids, ch), np.ones(len(sub_ids), int), a1[mr])}
        i_ids, i_amp, i_lv = l2_ind[mi]
        layers["2"][s] = {"industry": Layer(i_ids, xy(i_ids, ch), i_lv, i_amp),
                          "research": Layer(r_ids, xy(r_ids, ch), r_lv, a2_res[mr])}
    return layers, extent


def scales(layers: dict, cfg: dict) -> dict[str, dict]:
    """Per size setting: the factor for each type so both peak at the same height at Level 0."""
    s0, pl = float(cfg["bandwidth_level0"]), float(cfg["bandwidth_per_level"])
    rel = float(cfg.get("research_relative_height", 1.0))
    out = {}
    for s, t in layers["0"].items():
        ki, top_i = type_scale(t["industry"], s0, pl)
        kr, top_r = type_scale(t["research"], s0, pl, target=rel)
        out[s] = {"industry": round(ki, 6), "research": round(kr, 6), "largest_industry": top_i, "largest_field": top_r,
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
            levels[lv_name]["settings"][s] = combine(t["industry"], t["research"], k[s]["industry"], k[s]["research"], extent, cfg)
    out = interim_dir() / "terrain"; out.mkdir(parents=True, exist_ok=True)
    payload = {"levels": levels, "params": cfg, "scale": k,
               "reference": "Level 0: log(1+size) over log(1+largest size), per type; each type is then multiplied by its scale "
                            "so its largest Level 0 node peaks at industry_peak or research_peak. Deeper levels split the parent's "
                            "amplitude among its children (volume-preserving, proportional to log(1+size)). share = industry part "
                            "of the height (0.5 where the ground is flat)."}
    (out / "terrain.json").write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    for s, v in k.items():
        print(f"terrain: {s}: scale industry {v['industry']:.4f} ({v['largest_industry']}), research {v['research']:.4f} ({v['largest_field']})")
    for lv_name, g in levels.items():
        for s, grids in g["settings"].items():
            h = np.array(grids["height"]); sh = np.array(grids["share"])
            print(f"terrain: L{lv_name} {s} {g['n']}x{g['n']}, height 0 to {h.max():.2f}, share {sh.min():.2f} to {sh.max():.2f}")
    return 0
