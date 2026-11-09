"""Ingest HERD, CIP-SOC and O*NET. Files are fetched once into data/raw/ (identifying
User-Agent, no scripted evasion) and layout-checked before parsing."""
from __future__ import annotations

import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

from .common import interim_dir, raw_dir, repo_root, report_dir, sha256
from .openalex import USER_AGENT

HERD_URL = "https://ncses.nsf.gov/pubs/nsf26304/assets/data-tables/tables/nsf26304-tab010.xlsx"
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


# ---------------------------------------------------------------- HERD
HERD_PARENTS = {"All R&D fields", "Science", "Geosciences, atmospheric sciences, and ocean sciences",
                "Life sciences", "Physical sciences", "Social sciences", "Engineering", "Non-S&E"}


def parse_herd(path: Path) -> pd.DataFrame:
    d = pd.read_excel(path, header=None)
    if "Table 10" not in str(d.iloc[0, 0]) or "FY 2024" not in str(d.iloc[1, 0]):
        raise LayoutMismatch(f"Unexpected HERD table: {d.iloc[0, 0]} / {d.iloc[1, 0]}")
    if str(d.iloc[3, 0]).strip() != "Field" or "All R&D" not in str(d.iloc[3, 1]):
        raise LayoutMismatch("HERD Table 10 header row moved")
    body = d.iloc[5:, [0, 1]].dropna()
    body.columns = ["herd_field", "rd_thousands"]
    body["herd_field"] = body["herd_field"].astype(str).str.strip()
    body["rd_thousands"] = body["rd_thousands"].astype(float)
    body["is_parent"] = body["herd_field"].isin(HERD_PARENTS)
    return body.reset_index(drop=True)


def allocate_herd(herd: pd.DataFrame, mapping: pd.DataFrame, works_us: pd.Series) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split each leaf HERD field's dollars across its mapped OpenAlex fields in proportion to
    US works. Returns (dollars per OpenAlex field, HERD fields left unallocated)."""
    leaves = herd[~herd["is_parent"]].set_index("herd_field")["rd_thousands"]
    rows = []
    for hf, grp in mapping.groupby("herd_field"):
        if hf not in leaves.index:
            raise LayoutMismatch(f"Mapping names a HERD field not in the table: {hf!r}")
        w = grp["openalex_field"].map(works_us).astype(float)
        if w.isna().any() or w.sum() == 0:
            raise LayoutMismatch(f"Mapping names an unknown OpenAlex field for {hf!r}")
        for of, share in zip(grp["openalex_field"], w / w.sum()):
            rows.append({"openalex_field": of, "herd_field": hf, "rd_thousands": leaves[hf] * share})
    alloc = pd.DataFrame(rows)
    unalloc = leaves[~leaves.index.isin(mapping["herd_field"])].rename("rd_thousands").reset_index()
    return alloc, unalloc


def run_herd() -> int:
    path = fetch(HERD_URL, raw_dir() / "herd" / "nsf26304-tab010.xlsx")
    herd = parse_herd(path)
    leaves = herd[~herd["is_parent"]]
    total = float(herd.loc[herd.herd_field == "All R&D fields", "rd_thousands"].iloc[0])
    leaf_sum = float(leaves["rd_thousands"].sum())
    fields = pd.read_csv(interim_dir() / "openalex" / "fields.csv")
    mapping = pd.read_csv(repo_root() / "data" / "mappings" / "herd_to_openalex.csv")
    alloc, unalloc = allocate_herd(herd, mapping, fields.set_index("name")["works_us"])
    by_field = alloc.groupby("openalex_field")["rd_thousands"].sum()
    out = fields[["id", "name"]].assign(rd_thousands=fields["name"].map(by_field).fillna(0.0))
    odir = interim_dir() / "herd"; odir.mkdir(parents=True, exist_ok=True)
    herd.to_csv(odir / "herd_fields.csv", index=False)
    alloc.to_csv(odir / "allocation.csv", index=False)
    out.to_csv(odir / "field_rd.csv", index=False)
    lines = ["# ingest herd validation report",
             f"- file: nsf26304-tab010.xlsx (HERD FY 2024, Table 10, standard-form population), sha256 `{sha256(path)}`",
             f"- published all-fields total {total:,.0f}k; sum of leaf fields {leaf_sum:,.0f}k "
             f"(diff {leaf_sum - total:,.0f}k, {((leaf_sum - total) / total) * 100:.3f}%)",
             f"- allocated to OpenAlex fields {by_field.sum():,.0f}k; unallocated {unalloc.rd_thousands.sum():,.0f}k "
             f"({unalloc.rd_thousands.sum() / leaf_sum * 100:.1f}%): " + ", ".join(unalloc.herd_field),
             f"- OpenAlex fields with no HERD source (R&D = 0): " + ", ".join(out.loc[out.rd_thousands == 0, "name"]),
             "- method: leaf HERD dollars split across mapped OpenAlex fields by US works share; mapping unreviewed",
             "", "| OpenAlex field | R&D (thousand USD) |", "|---|---|"]
    for r in out.sort_values("rd_thousands", ascending=False).itertuples():
        lines.append(f"| {r.name} | {r.rd_thousands:,.0f} |")
    (report_dir() / "ingest_herd.md").write_text("\n".join(lines) + "\n")
    print(f"ingest herd: total {total:,.0f}k, leaf sum diff {leaf_sum - total:,.0f}k, unallocated {unalloc.rd_thousands.sum():,.0f}k")
    return 0


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
    return {"herd": run_herd, "cip-soc": run_cip, "onet": run_onet}[source]()
