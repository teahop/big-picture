"""Footprint weights (SPEC 6.2), generic: entries in, weights per level and the touched set out.

An entry is one role or one degree with node shares summing to 1. weight(node) = sum over entries of
share * years * recency for roles (recency = 0.5 ** ((as_of - end_year) / half_life)) and share * degree_years for
degrees. No diffusion. Weights roll up the hierarchy of the public bundle: a Level 1 industry passes its weight to its
sector; a deep: node passes it to the Level 1 industries it replaces, in their `replaces_share` proportions. So each
level holds the same total and a parent's weight is the sum of its children's.

The page computes the same thing in web/src/footprint.ts; this copy is for the private report and the tests.
Settings come from config/viewer.yaml (footprint block).
"""
from __future__ import annotations

import json
from collections.abc import Iterable

import yaml

from .common import public_dir, repo_root


def settings() -> dict:
    return yaml.safe_load((repo_root() / "config" / "viewer.yaml").read_text())["footprint"]


def recency(end_year: float | None, as_of: float, half_life: float) -> float:
    if end_year is None:
        return 1.0
    return 0.5 ** (max(0.0, as_of - float(end_year)) / half_life)


def entry_weight(entry: dict, as_of: float, cfg: dict) -> float:
    if entry["kind"] == "degree":
        return float(cfg["degree_years"])
    return float(entry["years"]) * recency(entry.get("end_year"), as_of, float(cfg["half_life_years"]))


def finest_weights(entries: Iterable[dict], as_of: float, cfg: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for e in entries:
        w = entry_weight(e, as_of, cfg)
        for node, share in e["nodes"].items():
            out[node] = out.get(node, 0.0) + w * float(share)
    return out


def load_hierarchy() -> dict[str, dict]:
    """node id -> {level, parent, up: {node one level up: share}} from the public bundle."""
    nodes = []
    for f in ("nodes.json", "nodes_l1.json", "nodes_l2.json"):
        p = public_dir() / f
        if p.exists():
            nodes += json.loads(p.read_text())
    return {n["id"]: {"level": n["level"], "up": n.get("replaces_share") or ({n["parent"]: 1.0} if n.get("parent") else {})} for n in nodes}


def roll_up(finest: dict[str, float], hier: dict[str, dict]) -> dict[int, dict[str, float]]:
    """Weights at each level of detail. Level 2 is the finest weights; Level 1 moves deep: nodes up; Level 0 moves
    everything to sectors. Unknown node ids raise, so a stale footprint never draws silently wrong."""
    unknown = sorted(set(finest) - set(hier))
    if unknown:
        raise KeyError(f"footprint names nodes not in the bundle: {unknown[:5]}")
    levels: dict[int, dict[str, float]] = {2: dict(finest)}
    for target in (1, 0):
        cur: dict[str, float] = {}
        for node, w in levels[target + 1].items():
            stack = [(node, w)]
            while stack:
                n, v = stack.pop()
                if hier[n]["level"] <= target or not hier[n]["up"]:
                    cur[n] = cur.get(n, 0.0) + v
                else:
                    stack += [(p, v * s) for p, s in hier[n]["up"].items()]
        levels[target] = cur
    return levels


def touched(weights: dict[str, float], threshold: float) -> dict[str, float]:
    """Touched nodes and their share of the total, largest first."""
    total = sum(weights.values())
    if total <= 0:
        return {}
    shares = {n: w / total for n, w in weights.items() if w / total >= threshold}
    return dict(sorted(shares.items(), key=lambda kv: -kv[1]))
