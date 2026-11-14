"""Industry layout on meaningful axes (v3 SPEC 3).

  x, left to right   projected employment growth 2025-2035 (percent), linear, clipped at percentiles of the level
  y, back to front   size on a log scale (largest at the back = smallest layout y; the viewer's camera sits at +y),
                     clipped at a low percentile so a few tiny industries do not stretch the scale

Both axes fill -1..1 at each level. Each Level 1 industry is then pulled part of the way toward its sector's position
(`pull`), so some neighbourhood survives. A deterministic
separation pass pushes overlapping hills apart, moving each as little as possible; its moves are reported in axis units.

Positions are computed per size setting (Jobs: employment; Value added: value added), because y follows the active
size measure. Growth is employment growth in both settings. No randomness: reruns are byte-identical.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .common import interim_dir, load_config, public_dir, report_dir

DECIMALS = 6
SETTINGS: dict[str, str] = {"activity": "employment", "dollars": "value_added"}


# ------------------------------------------------------------------ pure parts
@dataclass
class Scale:
    """One level's axis scale: growth clipped to [g_lo, g_hi] percent; size clipped to [s_lo, s_hi], logged."""
    g_lo: float
    g_hi: float
    s_lo: float
    s_hi: float

    def x(self, growth: np.ndarray) -> np.ndarray:
        g = np.clip(np.asarray(growth, float), self.g_lo, self.g_hi)
        return -1 + 2 * (g - self.g_lo) / ((self.g_hi - self.g_lo) or 1.0)

    def y(self, size: np.ndarray) -> np.ndarray:
        s = np.log(np.clip(np.asarray(size, float), self.s_lo, self.s_hi))
        lo, hi = np.log(self.s_lo), np.log(self.s_hi)
        return 1 - 2 * (s - lo) / ((hi - lo) or 1.0)          # largest at the back (y = -1)

    def as_dict(self) -> dict:
        return {k: round(float(v), 4) for k, v in vars(self).items()}


def fit_scale(growth: np.ndarray, size: np.ndarray, g_pct: tuple[float, float], s_pct_low: float) -> Scale:
    g = np.asarray(growth, float); s = np.asarray(size, float)
    pos = s[s > 0]
    return Scale(float(np.percentile(g, g_pct[0])), float(np.percentile(g, g_pct[1])),
                 float(np.percentile(pos, s_pct_low)), float(pos.max()))


def axis_positions(growth: np.ndarray, size: np.ndarray, scale: Scale) -> np.ndarray:
    return np.stack([scale.x(growth), scale.y(size)], axis=1)


def nudge(own: np.ndarray, parent: np.ndarray, pull: float) -> np.ndarray:
    """(1 - pull) * own + pull * parent."""
    return (1 - pull) * own + pull * parent


def separate(target: np.ndarray, min_sep: float, fixed: np.ndarray | None = None, iters: int = 600, pull: float = 0.05) -> np.ndarray:
    """Push apart points closer than `min_sep`, with a weak pull back toward `target`; `fixed` points do not move.
    Deterministic (exact duplicates are split along a fixed golden-angle direction). Stays inside -1..1."""
    q = target.astype(float).copy()
    n = len(q)
    free = np.ones(n, bool) if fixed is None else ~fixed
    k = np.arange(n)
    tie = np.stack([np.cos(k * 2.399963), np.sin(k * 2.399963)], axis=1) * 1e-4
    q[free] += tie[free]
    for _ in range(iters):
        v = q[:, None, :] - q[None, :, :]
        d = np.linalg.norm(v, axis=2) + np.eye(n)
        push = np.where((d < min_sep) & (d > 1e-12), (min_sep - d) / d / 2, 0.0)
        step = 0.5 * (v * push[:, :, None]).sum(axis=1) + pull * (target - q)
        q[free] += step[free]
        q = np.clip(q, -1, 1)
    return q


# ------------------------------------------------------------------ data
def load_levels() -> dict:
    """Ids, parents, growth and both sizes for Level 0 and Level 1."""
    it, lv = interim_dir(), interim_dir() / "levels"
    totals = pd.read_csv(it / "bls" / "sector_totals.csv", dtype={"ind_code": str})
    ind1 = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str, "sector_code": str})
    va1 = ind1["node_id"].map(pd.read_csv(lv / "industry_value.csv", dtype={"ind_code": str}).set_index("node_id")["value_added_usd_b"])
    va0 = va1.groupby(ind1["sector_code"].to_numpy()).sum()
    l0 = pd.DataFrame({"id": "ind:" + totals["ind_code"], "growth": totals["pct_chg"].astype(float),
                       "employment": totals["emp_2025"].astype(float), "value_added": totals["ind_code"].map(va0).astype(float)})
    l1 = pd.DataFrame({"id": ind1["node_id"], "parent": ind1["parent_id"], "growth": ind1["growth"].astype(float),
                       "employment": ind1["emp_2025"].astype(float), "value_added": va1.astype(float)})
    return {"l0": l0, "l1": l1}


# ------------------------------------------------------------------ run
def place(data: dict, measure: str, cfg: dict) -> tuple[dict, dict, dict]:
    """Positions {id: [x, y]} for Level 0 and Levels 1-2, scales per level, and the moves for the report."""
    gp = tuple(cfg["growth_clip_pct"]); sp = float(cfg["size_clip_low_pct"]); pull = float(cfg["pull"])
    l0, l1 = data["l0"], data["l1"]
    sc0 = fit_scale(l0["growth"], l0[measure], gp, sp)
    t0 = axis_positions(l0["growth"], l0[measure], sc0)
    x0 = separate(t0, float(cfg["min_sep"]["0"]))
    pos0 = dict(zip(l0["id"], x0))

    sc1 = fit_scale(l1["growth"], l1[measure], gp, sp)
    own1 = axis_positions(l1["growth"], l1[measure], sc1)
    t1 = nudge(own1, np.array([pos0[p] for p in l1["parent"]]), pull)
    x1 = separate(t1, float(cfg["min_sep"]["1"]))
    pos1 = dict(zip(l1["id"], x1))

    moves = {"0": (list(l0["id"]), t0, x0, sc0), "1": (list(l1["id"]), t1, x1, sc1)}
    pos12 = dict(pos1)
    scales = {"0": sc0.as_dict(), "1": sc1.as_dict()}
    return pos0, pos12, {"scales": scales, "moves": moves}


def rounded(pos: dict) -> dict:
    return {i: [round(float(a), DECIMALS), round(float(b), DECIMALS)] for i, (a, b) in sorted(pos.items())}


def run() -> int:
    conf = load_config()
    cfg = conf["layout_axes"]
    data = load_levels()
    by0, by12, axes, reports = {}, {}, {}, {}
    for setting, measure in SETTINGS.items():
        p0, p12, info = place(data, measure, cfg)
        by0[setting], by12[setting] = rounded(p0), rounded(p12)
        axes[setting] = info["scales"]; reports[setting] = info["moves"]
    common = {"axes": axes, "params": {k: cfg[k] for k in ("growth_clip_pct", "size_clip_low_pct", "pull", "min_sep")},
              "measures": SETTINGS}
    lay0 = {"stage": "axes-level0", "seed": int(conf["seed"]), "method": __doc__.strip().splitlines()[0],
            "nodes": by0["activity"], "by_setting": by0, **common}
    (public_dir() / "layout.json").write_text(json.dumps(lay0, indent=1, sort_keys=True) + "\n")
    lay1 = {"stage": "axes-level1-2", "nodes": by12["activity"], "by_setting": by12, **common}
    (public_dir() / "layout_children.json").write_text(json.dumps(lay1, indent=1, sort_keys=True) + "\n")
    report(data, reports)
    print(f"layout (axes): Level 0 {len(by0['activity'])} sectors, Level 1 {len(by12['activity'])} industries, "
          f"settings {', '.join(SETTINGS)}")
    return 0


# ------------------------------------------------------------------ report
def report(data: dict, reports: dict) -> None:
    frames = {"0": data["l0"], "1": data["l1"]}
    lines = ["# axes layout report", "",
             "Moves are from each node's place on the axes (after the pull toward its parent) to where the separation "
             "pass left it. Growth moves are in percentage points; size moves are a factor (1.0 = none).", ""]
    for setting, moves in reports.items():
        measure = SETTINGS[setting]
        lines += [f"## {setting} ({measure})", ""]
        for lv, (ids, target, final, sc) in moves.items():
            f = frames[lv].set_index("id")
            beyond_g = [i for i in ids if not sc.g_lo <= f.loc[i, "growth"] <= sc.g_hi]
            beyond_s = [i for i in ids if f.loc[i, measure] < sc.s_lo]
            dg = (final[:, 0] - target[:, 0]) * (sc.g_hi - sc.g_lo) / 2
            ds = np.exp(np.abs(final[:, 1] - target[:, 1]) * (np.log(sc.s_hi) - np.log(sc.s_lo)) / 2)
            dist = np.hypot(final[:, 0] - target[:, 0], final[:, 1] - target[:, 1])
            lines += [f"### Level {lv}: {len(ids)} nodes", "",
                      f"- growth scale {sc.g_lo:.2f}% to {sc.g_hi:.2f}%; {len(beyond_g)} beyond it: "
                      + ", ".join(f"{i} ({f.loc[i, 'growth']:+.1f}%)" for i in beyond_g[:12]) + (" …" if len(beyond_g) > 12 else ""),
                      f"- size scale {sc.s_lo:,.1f} to {sc.s_hi:,.1f}; {len(beyond_s)} below it",
                      f"- separation move (layout units, map spans 2): median {np.median(dist):.3f}, max {dist.max():.3f}",
                      "- largest moves:"]
            for k in np.argsort(-dist, kind="stable")[:10]:
                lines.append(f"  - {ids[k]}: growth {dg[k]:+.2f} pp, size x{ds[k]:.2f}")
            lines.append("")
    lines += similarity_lines(reports)
    (report_dir() / "layout_axes.md").write_text("\n".join(lines) + "\n")


def similarity_lines(reports: dict) -> list[str]:
    """What the axes cost in neighbourhood: the v2 similarity check (share of each industry's most similar industries
    among its nearest on the map), for the axes layout (Jobs) beside the v2 similarity layout's score."""
    try:
        from . import layout_joint as lj
        cfg, data = load_config()["layout"], lj.load_inputs()
    except Exception as e:                                   # embeddings unavailable: leave the check out
        return ["## similarity", "", f"- not computed ({type(e).__name__})", ""]
    out = ["## similarity (Jobs)", "", "Share of each node's most similar nodes that sit among its nearest on the map "
           "(v2 required at least 0.6; a random layout scores about within / (n - 1)).", ""]
    for lv, key, k, within in (("0", "l0", 3, 6), ("1", "l1", 5, 15)):
        sim, _ = lj.level_similarity(data[key], cfg)
        ids, _, final, _ = reports["activity"][lv]
        where = dict(zip(ids, final))
        score = lj.preservation(np.array([where[i] for i in data[key]["ids"]]), sim, k, within)
        chance = within / (len(ids) - 1)
        out.append(f"- Level {lv}: {score:.3f} (chance about {chance:.3f})")
    return out + [""]
