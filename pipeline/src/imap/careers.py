"""Public career rules (no personal data): occupations to industries, degree programmes to occupations to industries.
Used by the owner's private footprint (personal/education.py) and by the viewer's lookup files (lookup.py)."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .common import interim_dir, public_dir

TOP_N = 8


def finest_industries() -> set[str]:
    """Industry ids drawn at the finest level (the Level 1 industries)."""
    return {n["id"] for n in json.loads((public_dir() / "nodes_l1.json").read_text())}


def occupation_to_industry(fin: set[str] | None = None) -> pd.DataFrame:
    """Rows = occupations (SOC), columns = finest industries, values = share of the occupation's jobs."""
    fin = fin if fin is not None else finest_industries()
    lv = interim_dir() / "levels"
    o1 = pd.read_csv(lv / "industry_l1_occupations.csv", dtype={"ind_code": str, "occ_code": str}).assign(node_id=lambda d: "ind:" + d["ind_code"])
    frames = [o1[["node_id", "occ_code", "emp_2025"]]]
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


