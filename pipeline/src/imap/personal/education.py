"""Education -> industries (v2). Reads the degrees in the private profile, writes private/education_mapping.csv.

A degree lists its programmes (CIP 4-digit codes). Each programme points to the occupations its graduates enter (NCES
CIP-SOC crosswalk; postsecondary teaching left out unless configured), and each occupation to the industries that
employ it (Employment Matrix shares over the finest industries, deep: nodes included). A degree keeps its `top_n`
industries, rescaled to 1. The same rule serves a visitor's degree in the CV flow, so nothing here is owner-specific.

Owner corrections in words override a degree: private/education_corrections.csv with columns degree (a few words from
its title), industry (the industry's name as shown on the map) and share.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..common import interim_dir
from .base import NodeTable, load_profile, private_dir

TOP_N = 8


def occupation_to_industry(nodes: NodeTable) -> pd.DataFrame:
    """Rows = occupations (SOC), columns = finest industries, values = share of the occupation's jobs."""
    fin = set(nodes.finest("ind").index)
    lv = interim_dir() / "levels"
    o1 = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str}).assign(node_id=lambda d: "ind:" + d["ind_code"])
    frames = [o1[["node_id", "occ_code", "emp_2025"]]]
    if (lv / "deep_industry_occupations.csv").exists():
        frames.append(pd.read_csv(lv / "deep_industry_occupations.csv", dtype={"occ_code": str})[["node_id", "occ_code", "emp_2025"]])
    occ = pd.concat(frames)
    occ = occ[occ["node_id"].isin(fin)]
    job = occ.pivot_table(index="occ_code", columns="node_id", values="emp_2025", aggfunc="sum", fill_value=0.0)
    return job.div(job.sum(axis=1).replace(0, np.nan), axis=0).fillna(0.0)


def programme_occupations(cip_soc: pd.DataFrame, include_postsecondary: bool = False) -> pd.DataFrame:
    cs = cip_soc.drop_duplicates(["cip", "soc"]).copy()
    if not include_postsecondary:
        cs = cs[~cs["soc"].str.startswith("25-1")]
    cs["cip4"] = cs["cip"].str[:5]
    cs["w"] = 1.0 / cs.groupby("cip")["soc"].transform("count")
    return cs


def degree_industries(cip4: list[str], prog: pd.DataFrame, job: pd.DataFrame, top_n: int = TOP_N) -> pd.Series:
    """Industry shares (top_n, summing to 1) for a degree's programmes."""
    soc = prog[prog["cip4"].isin(cip4)].groupby("soc")["w"].sum()
    soc = soc[soc.index.isin(job.index)]
    if soc.sum() <= 0:
        return pd.Series(dtype=float)
    ind = job.loc[soc.index].mul(soc / soc.sum(), axis=0).sum(axis=0)
    top = ind[ind > 0].sort_values(ascending=False, kind="stable").head(top_n)
    return top / top.sum()


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
    job = occupation_to_industry(nodes)
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
