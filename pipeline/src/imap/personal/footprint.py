"""The owner's footprint (SPEC 6.1): an entry list written to private/footprint.json, plus a private report.

Roles come from private/roles_resolved.csv (reviewed nodes; person-months after the umbrella rule and role weights),
degrees from private/education_mapping.csv. Connections are a separate private-only layer, off by default in the
viewer. Skills are not part of the v2 footprint (entries are roles and degrees only). No diffusion.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .. import footprint as fp
from .base import NodeTable, load_profile, personal_root, private_dir
from .connections import NODE_SPLIT, tie_normalised
from .roles import parse_nodes


def year_of(ym: str | float | None) -> float | None:
    """'YYYY-MM' (end of that month) -> fractional year."""
    if not isinstance(ym, str) or not ym:
        return None
    y, m = ym.split("-")[:2]
    return int(y) + int(m) / 12.0


def expand(spec: str, members: dict[str, pd.Series]) -> dict[str, float]:
    """Node spec -> {finest node: share}. `a;b` splits equally; `sector:code` spreads by employment over the sector's finest nodes."""
    parts = [p for p in spec.split(NODE_SPLIT) if p]
    out: dict[str, float] = {}
    for p in parts:
        if p.startswith("sector:"):
            w = members[f"ind:{p.split(':', 1)[1]}"]
            for n, s in (w / w.sum()).items():
                out[n] = out.get(n, 0.0) + s / len(parts)
        else:
            out[p] = out.get(p, 0.0) + 1.0 / len(parts)
    return out


def role_entries(roles: pd.DataFrame) -> list[dict]:
    out = []
    for r in roles.itertuples():
        if not r.included or not float(r.person_months) > 0 or not isinstance(r.nodes, str):
            continue
        out.append({"kind": "role", "label": f"{r.title}, {r.organisation}", "years": round(float(r.person_months) / 12.0, 3),
                    "end_year": year_of(r.end), "nodes": {n: round(s, 4) for n, s in parse_nodes(r.nodes)}})
    return out


def degree_entries(mapping: pd.DataFrame) -> list[dict]:
    return [{"kind": "degree", "label": deg.split(":")[0], "nodes": {r.node_id: round(float(r.share), 4) for r in g.itertuples()}}
            for deg, g in mapping.groupby("degree", sort=False)]


def connections_layer(nodes: NodeTable, k: float) -> dict[str, float]:
    priv = private_dir()
    path = personal_root() / "LinkedIn_Network" / "connections_normalized.csv"
    if not path.exists() or not (priv / "company_nodes.csv").exists():
        return {}
    contacts = pd.read_csv(path, usecols=["company_norm", "tie_strength"]).dropna(subset=["company_norm"])
    contacts = contacts.assign(w=1.0 + tie_normalised(contacts["tie_strength"].astype(float)))
    per_company = contacts.groupby("company_norm")["w"].sum()
    finest = nodes.finest("ind")
    members: dict[str, pd.Series] = {}
    for r in finest.itertuples():
        sector = r.id
        while isinstance(nodes.df.loc[sector, "parent"], str):
            sector = nodes.df.loc[sector, "parent"]
        members.setdefault(sector, {})[r.id] = float(r.size.get("employment", 0.0))
    members = {s: pd.Series(v) for s, v in members.items()}
    spec = pd.read_csv(priv / "company_nodes.csv").fillna("").set_index("company_norm")["node_id"]
    raw: dict[str, float] = {}
    for company, w in per_company.items():
        if spec.get(company, ""):
            for node, share in expand(spec[company], members).items():
                raw[node] = raw.get(node, 0.0) + share * float(w)
    return {n: round(k * float(np.log1p(w)), 4) for n, w in sorted(raw.items())}


def run() -> int:
    profile = load_profile(); priv = private_dir()
    nodes = NodeTable()
    d = pd.Timestamp(str(profile.get("as_of")))
    as_of = d.year + d.month / 12.0
    entries = role_entries(pd.read_csv(priv / "roles_resolved.csv"))
    ed = priv / "education_mapping.csv"
    if ed.exists():
        entries += degree_entries(pd.read_csv(ed))
    finest = set(nodes.finest("ind").index)
    bad = sorted({n for e in entries for n in e["nodes"] if n not in finest})
    if bad:
        raise ValueError(f"footprint: entries name nodes that are not drawn at the finest level: {bad}")
    k = float(profile.get("presence", {}).get("connection_weight_k", 0.6))
    out = {"schema": 1, "as_of": round(as_of, 4), "entries": entries, "layers": {"connections": connections_layer(nodes, k)}}
    (priv / "footprint.json").write_text(json.dumps(out, indent=1) + "\n")
    report(out, nodes)
    print(f"footprint: {sum(e['kind'] == 'role' for e in entries)} roles, {sum(e['kind'] == 'degree' for e in entries)} degrees; wrote private/footprint.json")
    return 0


def report(fpt: dict, nodes: NodeTable) -> None:
    cfg = fp.settings()
    levels = fp.roll_up(fp.finest_weights(fpt["entries"], fpt["as_of"], cfg), fp.load_hierarchy())
    label = lambda n: nodes.df.loc[n, "label"] if n in nodes.df.index else n
    lines = ["# footprint report (private)", "",
             f"Settings (config/viewer.yaml): half-life {cfg['half_life_years']} years, a degree counts {cfg['degree_years']} years, touched at {cfg['touched_threshold']:.0%} of the total.", ""]
    for lv in (0, 1, 2):
        t = fp.touched(levels[lv], float(cfg["touched_threshold"]))
        lines += [f"## Level {lv}: {len(t)} touched of {len(levels[lv])} with any weight (total {sum(levels[lv].values()):.2f} weighted years)", ""]
        lines += [f"- {label(n)}: {s:.0%}" for n, s in t.items()] + [""]
    lines += ["## Entries", ""]
    for e in fpt["entries"]:
        w = fp.entry_weight(e, fpt["as_of"], cfg)
        top = sorted(e["nodes"].items(), key=lambda kv: -kv[1])[:4]
        lines.append(f"- {e['kind']}: {e['label']} - weight {w:.2f}" + (f" ({e['years']:.1f} years, ended {e['end_year']:.1f})" if e["kind"] == "role" and e.get("end_year") else "")
                     + " -> " + "; ".join(f"{label(n)} {s:.0%}" for n, s in top))
    (private_dir() / "report_footprint.md").write_text("\n".join(lines) + "\n")
