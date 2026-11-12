"""Education -> industries (v2). Reads the degrees in the private profile, writes private/education_mapping.csv.

A degree lists its programmes (CIP 4-digit codes). Each programme points to the occupations its graduates enter (NCES
CIP-SOC crosswalk; postsecondary teaching left out unless configured), and each occupation to the industries that
employ it (Employment Matrix shares over the finest industries, deep: nodes included). A degree keeps its `top_n`
industries, rescaled to 1. The same rule serves a visitor's degree in the CV flow, so nothing here is owner-specific.

Owner corrections in words override a degree: private/education_corrections.csv with columns degree (a few words from
its title), industry (the industry's name as shown on the map) and share.
"""
from __future__ import annotations

import pandas as pd

from ..careers import TOP_N, degree_industries, occupation_to_industry, programme_occupations  # noqa: F401
from ..common import interim_dir
from .base import NodeTable, load_profile, private_dir


def apply_corrections(rows: list[dict], corr: pd.DataFrame, nodes: NodeTable) -> list[dict]:
    labels = nodes.finest("ind").assign(key=lambda d: d["label"].str.lower())
    out = []
    for deg in dict.fromkeys(r["degree"] for r in rows):
        mine = corr[corr["degree"].str.lower().apply(lambda k: k in deg.lower())]
        if mine.empty:
            out += [r for r in rows if r["degree"] == deg]; continue
        got = []
        for r in mine.itertuples():
            hit = labels[labels["key"] == r.industry.strip().lower()]
            if hit.empty:
                raise ValueError(f"education correction: no industry named '{r.industry}' on the map")
            got.append({"degree": deg, "node_id": hit.index[0], "label": hit.iloc[0]["label"], "share": float(r.share)})
        tot = sum(g["share"] for g in got)
        out += [{**g, "share": g["share"] / tot} for g in got]
    return out


def run_education() -> int:
    degrees = load_profile().get("education", [])
    if not degrees:
        print("education: no degrees listed in the private profile (education: [{text, cip4}])")
        return 0
    nodes = NodeTable()
    prog = programme_occupations(pd.read_csv(interim_dir() / "cip" / "cip_soc.csv", dtype=str))
    job = occupation_to_industry(set(nodes.finest("ind").index))
    rows = []
    for d in degrees:
        for node, share in degree_industries(d.get("cip4", []), prog, job).items():
            rows.append({"degree": d["text"], "node_id": node, "label": nodes.df.loc[node, "label"], "share": float(share)})
    corr = private_dir() / "education_corrections.csv"
    if corr.exists():
        rows = apply_corrections(rows, pd.read_csv(corr, dtype=str), nodes)
    pd.DataFrame(rows).to_csv(private_dir() / "education_mapping.csv", index=False)
    print(f"education: {len(degrees)} degrees mapped to {len({r['node_id'] for r in rows})} industries")
    return 0
