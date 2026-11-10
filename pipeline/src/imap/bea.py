"""Industry value added in dollars (SPEC 4: BEA GDP by Industry), allocated to the map's industry nodes.

BEA publishes value added for about 70 summary industries, not for the Employment Matrix industries on the map. So:
  * official: BEA value added by summary industry, 2025 annual (table 1, billions of current dollars)
  * estimated: each Level 1 industry gets a share of its BEA summary industry in proportion to its payroll (QCEW 2025
    wages), because value added tracks payroll closely inside one summary industry
  * government-owned industries (ownership suffix S or L, and the government sector) share BEA's state and local, and federal,
    general-government value added (what government adds is mostly compensation of its employees)
Every sector is reconciled: its nodes add up to the sector's BEA total (private sectors) or to the government value added
that belongs to it. Deep nodes take the employment-weighted share of the industries they split. All of it is marked estimated.
"""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

from .common import interim_dir, raw_dir, repo_root, report_dir
from .geo import USER_AGENT, load_area, qcew_codes

BEA_YEAR = 2025
CONCORDANCE_URL = "https://www.bea.gov/sites/default/files/2023-10/BEA-Industry-and-Commodity-Codes-and-NAICS-Concordance.xlsx"
# Employment Matrix sector -> BEA sector code
SECTOR_BEA = {"110000": "11", "210000": "21", "220000": "22", "230000": "23", "31-330": "31G", "420000": "42", "44-450": "44RT",
              "48-490": "48TW", "510000": "51", "520000": "52", "530000": "53", "540000": "54", "550000": "55", "560000": "56",
              "610000": "61", "620000": "62", "710000": "71", "720000": "72", "810000": "81", "900000": "G"}


def api_key() -> str:
    for line in (repo_root() / ".env").read_text().splitlines():
        if line.startswith("BEA_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"')
            if key:
                return key
    raise RuntimeError("BEA_API_KEY missing in .env")


def fetch() -> int:
    """Value added by industry (table 1, annual) and the NAICS concordance; raw files go to data/raw/bea/."""
    d = raw_dir() / "bea"; d.mkdir(parents=True, exist_ok=True)
    q = {"UserID": api_key(), "method": "GetData", "datasetname": "GDPbyIndustry", "TableID": 1, "Frequency": "A", "Year": BEA_YEAR, "Industry": "ALL", "ResultFormat": "JSON"}
    req = urllib.request.Request("https://apps.bea.gov/api/data?" + urllib.parse.urlencode(q), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r:
        payload = json.load(r)
    res = payload["BEAAPI"]["Results"]; res = res[0] if isinstance(res, list) else res
    (d / f"va_{BEA_YEAR}.json").write_text(json.dumps(payload) + "\n")
    out = pd.DataFrame([{"code": x["Industry"], "title": x["IndustrYDescription"], "usd_billion": float(x["DataValue"])} for x in res["Data"]])
    p = interim_dir() / "bea"; p.mkdir(parents=True, exist_ok=True)
    out.to_csv(p / f"value_added_{BEA_YEAR}.csv", index=False)
    conc = d / "concordance.xlsx"
    if not conc.exists():
        req = urllib.request.Request(CONCORDANCE_URL, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=120) as r:
            conc.write_bytes(r.read())
    print(f"bea: {len(out)} industries, GDP {out[out.code == 'GDP'].usd_billion.iloc[0]:,.0f} billion dollars ({BEA_YEAR})")
    return 0


def value_added() -> pd.Series:
    """BEA value added by code, billions of dollars. Housing (the imputed rent of owner-occupied homes, which has no jobs
    behind it) is taken out of Real estate so that dollars per job are not distorted."""
    va = pd.read_csv(interim_dir() / "bea" / f"value_added_{BEA_YEAR}.csv").set_index("code")["usd_billion"].copy()
    va["53"] = va["53"] - va["HS"]
    va["531"] = va["ORE"]
    return va


def concordance() -> dict[str, str]:
    """NAICS (2017) code -> BEA summary code, from BEA's own concordance."""
    df = pd.read_excel(raw_dir() / "bea" / "concordance.xlsx", header=4, dtype=str)
    df = df[["Summary", "Related 2017 NAICS Codes"]].dropna()
    df.columns = ["summary", "naics"]
    return dict(zip(df["naics"].str.strip(), df["summary"].str.strip()))


def leaf_of(ind_code: str, conc: dict[str, str]) -> str | None:
    """BEA summary code for an Employment Matrix industry: the commonest summary among the NAICS codes under its prefix."""
    base = ind_code[:-1] if ind_code[-1:] in "PSL" and ind_code[:-1].isdigit() else ind_code
    m = re.fullmatch(r"(\d{4})-(\d)", base)
    prefixes = [base[:3] + m.group(1)[3], base[:3] + m.group(2)] if m else ([base.rstrip("0") or base] if base.isdigit() else [])
    votes: dict[str, int] = {}
    for p in prefixes:
        hits = [s for n, s in conc.items() if n.startswith(p)] or [s for n, s in conc.items() if p.startswith(n)]
        for s in hits:
            votes[s] = votes.get(s, 0) + 1
    return max(votes, key=votes.get) if votes else None


def payroll(ind_code: str, us: pd.DataFrame) -> float | None:
    """QCEW 2025 total annual wages for an industry (summed over its codes and ownerships), or None."""
    codes = qcew_codes(ind_code)
    if not codes:
        return None
    total, found = 0.0, False
    for code, own in codes:
        rows = us[(us["industry_code"] == code) & (us["own_code"].isin(own))]
        if not rows.empty:
            found = True; total += float(rows["total_annual_wages"].sum())
    return total if found and total > 0 else None


def allocate() -> pd.DataFrame:
    ind = pd.read_csv(interim_dir() / "levels" / "industry_l1.csv", dtype={"ind_code": str, "sector_code": str})
    va = value_added()
    conc = concordance()
    us = _us_with_wages()
    rows = []
    for r in ind.itertuples():
        pay = payroll(r.ind_code, us)
        gov = r.ind_code[-1:] in "SL" and r.ind_code[:-1].isdigit() or r.sector_code == "900000"
        if r.ind_code in ("999100",):
            leaf = "GFG"
        elif r.ind_code == "491000":
            leaf = "GFE"                                   # the Postal Service is a federal government enterprise
        elif gov:
            leaf = "GSLG"
        elif r.remainder:
            leaf = None
        else:
            leaf = leaf_of(r.ind_code, conc)
        rows.append({"node_id": r.node_id, "ind_code": r.ind_code, "sector_code": r.sector_code, "emp_2025": r.emp_2025, "payroll_usd": pay, "leaf": leaf if leaf in va.index else None, "gov": gov})
    d = pd.DataFrame(rows)
    # payroll fallback: employment times the average pay of the node's sector (only where QCEW has no clean match)
    avg = d.dropna(subset=["payroll_usd"]).groupby("sector_code").apply(lambda g: g["payroll_usd"].sum() / g["emp_2025"].sum(), include_groups=False)
    d["payroll_basis"] = np.where(d["payroll_usd"].notna(), "QCEW wages", "employment x sector average pay")
    d["payroll_usd"] = d["payroll_usd"].fillna(d["emp_2025"] * d["sector_code"].map(avg).fillna(avg.mean()))
    d["value_added_usd_b"] = 0.0
    # private industries: sector by sector, weighted by payroll times the value added per payroll dollar of the node's summary industry
    for sector, g in d[~d["gov"]].groupby("sector_code"):
        total = float(va[SECTOR_BEA[sector]]) if sector != "900000" else 0.0
        leaf_ratio = {}
        for leaf, gl in g.dropna(subset=["leaf"]).groupby("leaf"):
            leaf_ratio[leaf] = float(va[leaf]) / (gl["payroll_usd"].sum() / 1e9)
        sector_ratio = total / (g["payroll_usd"].sum() / 1e9)
        w = np.array([(leaf_ratio.get(l, sector_ratio) if isinstance(l, str) else sector_ratio) * p for l, p in zip(g["leaf"], g["payroll_usd"])])
        d.loc[g.index, "value_added_usd_b"] = total * w / w.sum()
    # government-owned industries: state and local general government plus enterprises, shared by payroll over every state or
    # local industry; federal general government goes to the federal government industry, federal enterprises to the Postal Service
    g = d[d["gov"] & (d["leaf"] == "GSLG")]
    d.loc[g.index, "value_added_usd_b"] = (float(va["GSLG"]) + float(va["GSLE"])) * g["payroll_usd"] / g["payroll_usd"].sum()
    d.loc[d["ind_code"] == "999100", "value_added_usd_b"] = float(va["GFG"])
    d.loc[d["ind_code"] == "491000", "value_added_usd_b"] = float(va["GFE"])
    d["jobs_k"] = d["emp_2025"]
    d["va_per_job_usd"] = d["value_added_usd_b"] * 1e9 / (d["emp_2025"] * 1e3)
    return d


def _us_with_wages() -> pd.DataFrame:
    import zipfile
    from .geo import zip_path
    with zipfile.ZipFile(zip_path()) as z:
        name = next(n for n in z.namelist() if "annual US000 " in n)
        with z.open(name) as f:
            return pd.read_csv(f, dtype={"industry_code": str, "own_code": int}, usecols=["industry_code", "own_code", "total_annual_wages"])


def run() -> int:
    d = allocate()
    out = interim_dir() / "levels"
    d.to_csv(out / "industry_value.csv", index=False)
    contrib_path = out / "deep_industry_contrib.csv"
    if contrib_path.exists():                       # deep: nodes take the employment-weighted share of the industries they split
        c = pd.read_csv(contrib_path, dtype={"parent_code": str})
        pv = d.set_index("ind_code")
        c["value_added_usd_b"] = [r.share * float(pv.loc[r.parent_code, "value_added_usd_b"]) for r in c.itertuples()]
        c.to_csv(out / "deep_industry_value_contrib.csv", index=False)
        dv = c.groupby("node_id", as_index=False)["value_added_usd_b"].sum()
        emp = pd.read_csv(out / "deep_industry.csv").set_index("node_id")["emp_2025"]
        dv["va_per_job_usd"] = dv["value_added_usd_b"] * 1e9 / (dv["node_id"].map(emp) * 1e3)
        dv.to_csv(out / "deep_industry_value.csv", index=False)
    va = value_added()
    lines = ["# value added report", "", f"- BEA {BEA_YEAR} value added; map industries total {d['value_added_usd_b'].sum():,.0f} billion dollars against {float(va['GDP'] - 3028.0):,.0f} (GDP minus housing)",
             f"- nodes using the sector-average payroll fallback: {int((d['payroll_basis'] != 'QCEW wages').sum())} of {len(d)}",
             f"- nodes with no BEA summary match (they use the sector's average value added per payroll dollar): {int(d['leaf'].isna().sum())}", ""]
    for sector, g in d.groupby("sector_code"):
        lines.append(f"- {sector}: {g['value_added_usd_b'].sum():,.0f} billion dollars over {len(g)} industries")
    (report_dir() / "value_added.md").write_text("\n".join(lines) + "\n")
    print(f"value: {len(d)} industries, {d['value_added_usd_b'].sum():,.0f} billion dollars of value added allocated")
    return 0
