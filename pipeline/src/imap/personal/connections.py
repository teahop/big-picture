"""Connections -> company -> industry node (SPEC 7.2).

Reads only company_norm, tie_strength (and the company index's people and max_tie) from the owner's derived tables.
Each distinct company is classified once and cached in private/company_nodes.csv with a confidence value:
  1. alias    : the company is a listed member of a deep: category (public organisations from the reviewed categories)
  2. model    : private/company_proposals_model.csv (model-assisted, unreviewed)
  3. embedding: name similarity to node texts (low confidence by nature)
Owner corrections in private/company_corrections.csv (company_norm,node_id) always win and are never overwritten.
Each contact contributes 1 + tie_normalised; tie is log-scaled: log1p(tie) / log1p(max tie).
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd
import yaml

from ..common import repo_root
from ..embed import embed
from .base import NodeTable, personal_root, private_dir

SUFFIX = re.compile(r"\b(inc|llc|ltd|limited|corp|corporation|co|company|group|plc|gmbh|the|holdings)\b\.?", re.I)
LOW_CONFIDENCE = 0.7
NODE_SPLIT = ";"


def norm_name(s: str) -> str:
    s = re.sub(r"\(.*?\)", " ", str(s).lower())
    s = SUFFIX.sub(" ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def tie_normalised(tie: pd.Series, max_tie: float | None = None) -> pd.Series:
    """Log scale into [0, 1]; a contact with no recorded tie counts 1, the strongest tie counts 2."""
    m = float(tie.max() if max_tie is None else max_tie)
    return np.log1p(tie.clip(lower=0)) / np.log1p(m) if m > 0 else tie * 0.0


def alias_table(nodes: NodeTable) -> dict[str, str]:
    """normalised public organisation name -> deep: node id, from the reviewed category member lists."""
    spec = yaml.safe_load((repo_root() / "data" / "mappings" / "deep_categories.yaml").read_text())
    out: dict[str, str] = {}
    for z in spec["zones"]:
        for c in z["categories"]:
            for m in c.get("members", []):
                out.setdefault(norm_name(m), f"deep:{c['slug']}")
    hc = pd.read_csv(repo_root() / "data" / "mappings" / "deep_headcounts.csv")
    for r in hc.itertuples():
        out.setdefault(norm_name(r.organisation), f"deep:{r.category_slug}")
    ids = set(nodes.df.index)
    return {k: v for k, v in out.items() if v in ids and k}


def label_of(nodes: NodeTable, spec: str) -> str:
    if spec.startswith("sector:"):
        return "sector " + nodes.df.loc["ind:" + spec.split(":", 1)[1], "label"] + " (spread by employment)"
    return nodes.df.loc[spec, "label"]


def classify(companies: pd.DataFrame, nodes: NodeTable, model: dict[str, str], corrections: dict[str, str], accepted: set[str] | None = None) -> pd.DataFrame:
    accepted = accepted or set()
    ind = nodes.finest("ind")
    nv = embed([nodes.text(r) for r in ind.itertuples()])
    aliases = alias_table(nodes)
    names = list(companies["company_norm"])
    cv = embed([f"{n} (company)" for n in names])
    sim = cv @ nv.T
    rows = []
    for i, name in enumerate(names):
        order = np.argsort(-sim[i], kind="stable")[:2]
        top1, top2 = float(sim[i, order[0]]), float(sim[i, order[1]])
        conf = 0.5 * np.clip((top1 - 0.45) / 0.25, 0, 1) + 0.5 * np.clip((top1 - top2) / 0.05, 0, 1)
        node, method = ind.index[order[0]], "embedding"
        if norm_name(name) in aliases:
            node, conf, method = aliases[norm_name(name)], 0.95, "alias (public member of a category)"
        if name in model:
            node, conf, method = model[name], 0.8, "model proposal (unreviewed)"
        if name in corrections:
            node, conf, method = corrections[name], 1.0, "owner correction"
        suggested = node
        if name in accepted and method != "embedding" or (name in accepted and conf >= LOW_CONFIDENCE):
            method, conf = "owner reviewed (accepted as proposed)", 1.0
        if method == "embedding" and conf < LOW_CONFIDENCE:
            node, method = "", "unmapped (embedding only, low confidence)"     # a name-only guess would add noise to the footprint
        rows.append({"company_norm": name, "people": int(companies["people"].iloc[i]), "max_tie": float(companies["max_tie"].iloc[i]),
                     "node_id": node, "confidence": round(float(conf), 3), "method": method, "suggested_node": suggested,
                     "node_label": " + ".join(label_of(nodes, n) for n in node.split(NODE_SPLIT)) if node else ""})
    return pd.DataFrame(rows)


def _read_map(path) -> dict[str, str]:
    return dict(pd.read_csv(path, dtype=str)[["company_norm", "node_id"]].itertuples(index=False)) if path.exists() else {}


def run() -> int:
    d = personal_root() / "LinkedIn_Network"
    ci = pd.read_csv(d / "company_index.csv", usecols=["company_norm", "people", "max_tie"])
    nodes = NodeTable()
    model = _read_map(private_dir() / "company_proposals_model.csv")
    corr = _read_map(private_dir() / "company_corrections.csv")
    acc_path = private_dir() / "company_accepted.txt"       # companies the owner reviewed and accepted as proposed
    accepted = set(acc_path.read_text().splitlines()) if acc_path.exists() else set()
    table = classify(ci, nodes, model, corr, accepted)
    table.to_csv(private_dir() / "company_nodes.csv", index=False)
    top = table.sort_values(["people", "company_norm"], ascending=[False, True]).head(50)
    low = table[(table["confidence"] < LOW_CONFIDENCE) & ~table["company_norm"].isin(top["company_norm"])]
    review = pd.concat([top.assign(why="top 50 by people"), low.assign(why="unmapped or low confidence")])
    review.to_csv(private_dir() / "review_companies.csv", index=False)
    n_people = int(ci["people"].sum())
    mapped = table[table["node_id"] != ""]
    by_method = table.groupby("method")["people"].sum()
    (private_dir() / "report_connections.md").write_text("\n".join([
        "# connections report (private)", "",
        f"- {len(table)} distinct companies covering {n_people} contacts with a company; contacts without a company are not mapped (see below)",
        f"- people by classification method: " + "; ".join(f"{k}: {v}" for k, v in by_method.items()),
        f"- mapped to a node: {len(mapped)} companies covering {int(mapped['people'].sum())} contacts ({mapped['people'].sum() / n_people:.0%} of contacts with a company); the rest are unmapped and listed in review_companies.csv",
        "- review file: review_companies.csv (top 50 by people, then every low-confidence company); corrections go in company_corrections.csv (company_norm,node_id)"]) + "\n")
    print(f"connections: {len(table)} companies classified; review file has {len(review)} rows")
    return 0
