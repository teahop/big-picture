"""Ingest CIP-SOC and O*NET. Files are fetched once into data/raw/ (identifying
User-Agent, no scripted evasion) and layout-checked before parsing."""
from __future__ import annotations

import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from .common import interim_dir, raw_dir, repo_root, report_dir, sha256

USER_AGENT = "industry-map-research (github.com/teahop/industry-map)"
CIP_URL = "https://nces.ed.gov/ipeds/cipcode/Files/CIP2020_SOC2018_Crosswalk.xlsx"
ONET_URL = "https://www.onetcenter.org/dl_files/database/db_31_0_excel.zip"
ONET_DIR = "db_31_0_excel"


class LayoutMismatch(RuntimeError):
    pass


def fetch(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as r:
        dest.write_bytes(r.read())
    return dest


# ---------------------------------------------------------------- CIP-SOC
CIP_COLUMNS = ["CIP2020Code", "CIP2020Title", "SOC2018Code", "SOC2018Title"]


def run_cip() -> int:
    path = fetch(CIP_URL, raw_dir() / "cip" / "CIP2020_SOC2018_Crosswalk.xlsx")
    d = pd.read_excel(path, sheet_name="CIP-SOC", dtype=str)
    if list(d.columns) != CIP_COLUMNS:
        raise LayoutMismatch(f"CIP-SOC columns changed: {list(d.columns)}")
    d.columns = ["cip", "cip_title", "soc", "soc_title"]
    d = d.dropna(subset=["cip", "soc"]).drop_duplicates()
    d["cip_title"] = d["cip_title"].str.rstrip(".")
    odir = interim_dir() / "cip"; odir.mkdir(parents=True, exist_ok=True)
    d.to_csv(odir / "cip_soc.csv", index=False)
    (report_dir() / "ingest_cip-soc.md").write_text(
        f"# ingest cip-soc validation report\n- file CIP2020_SOC2018_Crosswalk.xlsx sha256 `{sha256(path)}`, sheet CIP-SOC\n"
        f"- rows {len(d):,}; distinct CIP codes {d.cip.nunique()}; distinct SOC codes {d.soc.nunique()}\n"
        f"- CIP code length counts: {d.cip.str.len().value_counts().to_dict()}\n"
        "- only 6-digit CIP titles exist in this file; 2- and 4-digit titles are not a direct download\n")
    print(f"ingest cip-soc: {len(d):,} rows")
    return 0


# ---------------------------------------------------------------- O*NET
def run_onet() -> int:
    zpath = fetch(ONET_URL, raw_dir() / "onet" / "db_31_0_excel.zip")
    root = raw_dir() / "onet" / "x"
    if not (root / ONET_DIR).exists():
        with zipfile.ZipFile(zpath) as z:
            z.extractall(root)
    base = root / ONET_DIR
    readme = (base / "Read Me.txt").read_text()
    if "O*NET 31.0" not in readme:
        raise LayoutMismatch("Not O*NET 31.0")
    occ = pd.read_excel(base / "Occupation Data.xlsx", dtype=str)
    jt = pd.read_excel(base / "Job Titles.xlsx", dtype=str)
    rt = pd.read_excel(base / "Sample of Reported Titles.xlsx", dtype=str)
    for name, df, cols in (("Occupation Data", occ, ["O*NET-SOC Code", "Title", "Description"]),
                           ("Job Titles", jt, ["O*NET-SOC Code", "Title", "Job Title", "Short Title", "Source(s)"]),
                           ("Sample of Reported Titles", rt, ["O*NET-SOC Code", "Title", "Reported Job Title", "Shown in My Next Move"])):
        if list(df.columns) != cols:
            raise LayoutMismatch(f"{name} columns changed: {list(df.columns)}")
    for df in (occ, jt, rt):
        df["soc"] = df["O*NET-SOC Code"].str[:7]  # O*NET-SOC 11-1011.00 -> SOC 2018 11-1011
    titles = pd.concat([jt[["soc", "Job Title"]].rename(columns={"Job Title": "t"}),
                        rt[["soc", "Reported Job Title"]].rename(columns={"Reported Job Title": "t"})])
    titles = titles.dropna().drop_duplicates().groupby("soc")["t"].apply(lambda s: "; ".join(s))
    by_soc = occ.groupby("soc").agg(title=("Title", "first"), description=("Description", " ".join)).join(titles.rename("alt_titles"))
    odir = interim_dir() / "onet"; odir.mkdir(parents=True, exist_ok=True)
    by_soc.reset_index().to_csv(odir / "occupations.csv", index=False)
    (report_dir() / "ingest_onet.md").write_text(
        f"# ingest onet validation report\n- release: O*NET 31.0 (August 2026 release per Read Me), licence CC BY 4.0; zip sha256 `{sha256(zpath)}`\n"
        f"- files used: Occupation Data ({len(occ):,} rows), Job Titles ({len(jt):,}), Sample of Reported Titles ({len(rt):,}); headers match the 31.0 data dictionary\n"
        f"- O*NET-SOC codes collapsed to SOC 2018 6-digit: {by_soc.shape[0]} occupations\n")
    print(f"ingest onet: {len(by_soc)} SOC occupations (release 31.0)")
    return 0


def run(source: str) -> int:
    return {"cip-soc": run_cip, "onet": run_onet}[source]()
