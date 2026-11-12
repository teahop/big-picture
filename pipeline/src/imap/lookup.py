"""Lookup files for the CV flow (SPEC 7.3): the deterministic rules that cross-check the model's guesses and stand in for
it when the proxy is unavailable. Public data only; loaded by the page only when the CV flow opens.

  lookup_titles.json   job titles (O*NET 31.0 titles and reported titles) -> occupation (SOC) -> the finest industries
                       employing it (Employment Matrix shares, top N)
  lookup_degrees.json  degree programme titles (CIP 2020, from the CIP-SOC crosswalk) -> industries (graduates'
                       occupations, postsecondary teaching left out, top N), the same rule as the owner's degrees
"""
from __future__ import annotations

import gzip
import json
import re

import pandas as pd

from .careers import degree_industries, finest_industries, occupation_to_industry, programme_occupations
from .common import interim_dir, public_dir, report_dir

TOP_N = 6
BUDGET_GZ = 1.5e6     # bytes after gzip, for both files together (Phase 3 handoff)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(text).lower())).strip()


def industries_of(series: pd.Series, top_n: int = TOP_N) -> list[list]:
    top = series[series > 0].sort_values(ascending=False, kind="stable").head(top_n)
    top = top / top.sum()
    return [[i, round(float(v), 3)] for i, v in top.items()]


def run() -> int:
    fin = finest_industries()
    job = occupation_to_industry(fin)
    onet = pd.read_csv(interim_dir() / "onet" / "occupations.csv", dtype=str)
    socs = [s for s in onet["soc"] if s in job.index]
    soc_idx = {s: i for i, s in enumerate(socs)}
    titles: dict[str, set[int]] = {}
    for r in onet.itertuples():
        if r.soc not in soc_idx:
            continue
        for t in [r.title] + (r.alt_titles.split("; ") if isinstance(r.alt_titles, str) else []):
            key = norm(t)
            if key:
                titles.setdefault(key, set()).add(soc_idx[r.soc])
    title_doc = {"source": "O*NET 31.0 job titles and reported titles; BLS Employment Matrix 2025 shares",
                 "socs": socs, "soc_titles": [onet.set_index("soc").loc[s, "title"] for s in socs],
                 "industries": [industries_of(job.loc[s]) for s in socs],
                 "titles": [[t, sorted(v)] for t, v in sorted(titles.items())]}

    cs = pd.read_csv(interim_dir() / "cip" / "cip_soc.csv", dtype=str)
    prog = programme_occupations(cs)
    progs = cs.drop_duplicates("cip")[["cip", "cip_title"]]
    degrees = []
    for r in progs.itertuples():
        ind = degree_industries([r.cip[:5]], prog, job, TOP_N)
        if len(ind):
            degrees.append([norm(r.cip_title), r.cip, [[i, round(float(v), 3)] for i, v in ind.items()]])
    degree_doc = {"source": "NCES CIP 2020 titles (CIP-SOC crosswalk); graduates' occupations to industries (Employment Matrix 2025)",
                  "programmes": sorted(degrees)}

    out = public_dir()
    sizes = {}
    for name, doc in (("lookup_titles.json", title_doc), ("lookup_degrees.json", degree_doc)):
        text = json.dumps(doc, separators=(",", ":")) + "\n"
        (out / name).write_text(text)
        sizes[name] = (len(text.encode()), len(gzip.compress(text.encode(), mtime=0)))
    total_gz = sum(g for _, g in sizes.values())
    (report_dir() / "lookup.md").write_text("\n".join([
        "# lookup report", "",
        f"- titles: {len(title_doc['titles'])} normalised titles over {len(socs)} occupations",
        f"- degree programmes: {len(degrees)}",
        *[f"- {n}: {raw / 1e6:.2f} MB raw, {gz / 1e6:.2f} MB gzip" for n, (raw, gz) in sizes.items()],
        f"- total after gzip: {total_gz / 1e6:.2f} MB (budget {BUDGET_GZ / 1e6:.1f} MB)"]) + "\n")
    print(f"lookup: {len(title_doc['titles'])} titles, {len(degrees)} programmes, {total_gz / 1e6:.2f} MB gzip")
    if total_gz > BUDGET_GZ:
        print("lookup: OVER BUDGET - see data/interim/reports/lookup.md")
        return 1
    return 0
