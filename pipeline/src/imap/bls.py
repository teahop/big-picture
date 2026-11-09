"""Ingest the BLS National Employment Matrix from a locally saved XLSX.

BLS blocks automated downloads (403 Access Denied), so the owner saves the file
by hand to data/raw/bls/matrix.xlsx. This stage verifies the layout against the
sheet's own field descriptions before parsing and stops on any mismatch.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import pandas as pd

from .common import interim_dir, raw_dir, report_dir, sha256
from .sectors import (ALL_OCC, SECTOR_CODES, SELF_EMPLOYED_CODE,
                      SHORT_LABEL, TOTAL_CODE, WAGE_SALARY_CODE)

MATRIX_PATH = raw_dir() / "bls" / "matrix.xlsx"

EXPECTED_COLUMNS = [
    "Occupation type", "Industry type", "Occupation code", "Occupation title",
    "Industry code", "Industry title",
    "2025 Employment", "2025 Percent of Industry", "2025 Percent of Occupation",
    "2035 Employment", "2035 Percent of Industry", "2035 Percent of Occupation",
    "Numeric change, 2025-35", "Percent change, 2025-35",
]
RENAME = {
    "Occupation type": "occ_type", "Industry type": "ind_type",
    "Occupation code": "occ_code", "Occupation title": "occ_title",
    "Industry code": "ind_code", "Industry title": "ind_title",
    "2025 Employment": "emp_2025", "2025 Percent of Industry": "pct_ind_2025",
    "2025 Percent of Occupation": "pct_occ_2025", "2035 Employment": "emp_2035",
    "2035 Percent of Industry": "pct_ind_2035", "2035 Percent of Occupation": "pct_occ_2035",
    "Numeric change, 2025-35": "chg", "Percent change, 2025-35": "pct_chg",
}


class LayoutMismatch(RuntimeError):
    pass


def read_matrix(path: Path) -> pd.DataFrame:
    """Read and layout-check the matrix. Raises LayoutMismatch if it differs from the docs."""
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. BLS blocks scripted downloads: save "
            "https://www.bls.gov/emp/ind-occ-matrix/matrix.xlsx there by hand."
        )
    names = pd.ExcelFile(path).sheet_names
    if "Matrix" not in names or "Field Descriptions" not in names:
        raise LayoutMismatch(f"Expected sheets Matrix and Field Descriptions, got {names}")
    desc = pd.read_excel(path, sheet_name="Field Descriptions", header=None)
    head = str(desc.iloc[0, 0])
    if "2025-35" not in head:
        raise LayoutMismatch(f"Not the 2025-35 matrix (title says: {head!r})")
    df = pd.read_excel(path, sheet_name="Matrix", dtype={"Industry code": str, "Occupation code": str})
    if list(df.columns) != EXPECTED_COLUMNS:
        raise LayoutMismatch(f"Columns changed: {list(df.columns)}")
    return df.rename(columns=RENAME)


def assign_sectors(industries: pd.DataFrame) -> pd.DataFrame:
    """Add sector_code. The matrix lists each sector followed by its detailed
    industries, so a sector is the last sector row seen in file order. TE rows
    (totals, self-employed) belong to no sector. Raises if a sector is missing."""
    inds = industries.reset_index(drop=True).copy()
    missing = [c for c in SECTOR_CODES if c not in set(inds["ind_code"])]
    if missing:
        raise LayoutMismatch(f"Sector rows missing from matrix: {missing}")
    current: str | None = None
    out: list[str | None] = []
    for code in inds["ind_code"]:
        if code.startswith("TE"):
            current = None
        elif code in SECTOR_CODES:
            current = code
        out.append(current)
    inds["sector_code"] = out
    return inds


def build_tables(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    inds = df[["ind_code", "ind_title", "ind_type"]].drop_duplicates("ind_code")
    inds = assign_sectors(inds)
    is_sector = inds["ind_code"].isin(SECTOR_CODES)
    inds["level"] = is_sector.map({True: 0, False: 1})
    inds["node_id"] = "ind:" + inds["ind_code"]
    inds["parent_id"] = ("ind:" + inds["sector_code"]).where(~is_sector & inds["sector_code"].notna())
    inds["label"] = inds.apply(lambda r: SHORT_LABEL.get(r["ind_code"], r["ind_title"]), axis=1)
    occs = df[["occ_code", "occ_title", "occ_type"]].drop_duplicates("occ_code")
    cells = df[["ind_code", "occ_code", "occ_type", "emp_2025", "emp_2035",
                "pct_ind_2025", "pct_ind_2035", "pct_occ_2025", "pct_occ_2035"]]
    return {"industries": inds.reset_index(drop=True), "occupations": occs.reset_index(drop=True),
            "industry_occupation": cells.reset_index(drop=True)}


def sector_totals(df: pd.DataFrame) -> pd.DataFrame:
    """One row per sector with total employment (all occupations)."""
    tot = df[df["occ_code"] == ALL_OCC].set_index("ind_code")
    rows = tot.loc[SECTOR_CODES, ["ind_title", "emp_2025", "emp_2035"]].reset_index()
    rows["pct_chg"] = (rows["emp_2035"] - rows["emp_2025"]) / rows["emp_2025"] * 100
    return rows


def reconcile(df: pd.DataFrame, tables: dict[str, pd.DataFrame]) -> dict:
    tot = df[df["occ_code"] == ALL_OCC].set_index("ind_code")
    sectors = sector_totals(df)
    out: dict = {}
    for year in ("2025", "2035"):
        col = f"emp_{year}"
        published = float(tot.loc[TOTAL_CODE, col])
        sector_sum = float(sectors[col].sum())
        self_emp = float(tot.loc[SELF_EMPLOYED_CODE, col])
        out[year] = {
            "published_total": published, "sector_sum": sector_sum, "self_employed": self_emp,
            "wage_salary_published": float(tot.loc[WAGE_SALARY_CODE, col]),
            "diff_sector_vs_published": sector_sum - published,
            "diff_pct_sector_vs_published": (sector_sum - published) / published * 100,
            "diff_pct_with_self_employed": (sector_sum + self_emp - published) / published * 100,
            "diff_pct_vs_wage_salary": (sector_sum - float(tot.loc[WAGE_SALARY_CODE, col]))
            / float(tot.loc[WAGE_SALARY_CODE, col]) * 100,
        }
    inds = tables["industries"]
    detail = inds[inds["level"] == 1].dropna(subset=["sector_code"])
    line = tot.reindex(detail["ind_code"])
    line = line[line["ind_type"] == "Line item"].copy()
    line["sector_code"] = detail.set_index("ind_code").loc[line.index, "sector_code"]
    out["detail_vs_sector"] = (
        line.groupby("sector_code")["emp_2025"].sum()
        .rename("line_item_sum").to_frame()
        .join(sectors.set_index("ind_code")["emp_2025"].rename("sector_total"))
        .assign(coverage_pct=lambda t: t["line_item_sum"] / t["sector_total"] * 100)
    )
    return out


def write_report(df: pd.DataFrame, tables: dict, rec: dict, path: Path, matrix: Path) -> None:
    y25 = rec["2025"]
    lines = [
        "# ingest bls-matrix validation report",
        f"Generated {dt.date.today().isoformat()}. File: `{matrix.name}`, sha256 `{sha256(matrix)}`.",
        "", "## Row counts",
        f"- matrix rows: {len(df):,}",
        f"- industries: {len(tables['industries'])} "
        f"({int((tables['industries'].level == 0).sum())} sectors at Level 0)",
        f"- occupations: {len(tables['occupations'])}",
        "", "## Reconciliation (employment, thousands of jobs)",
        "Sectors are the 20 Level 0 rows. Self-employed workers are a separate total row, not an industry.", "",
        "| Year | Published total | Sum of sectors | Diff | Diff % | Self-employed | Diff % if self-employed added | Diff % vs wage and salary total |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for y in ("2025", "2035"):
        r = rec[y]
        lines.append(
            f"| {y} | {r['published_total']:,.1f} | {r['sector_sum']:,.1f} | {r['diff_sector_vs_published']:,.1f} "
            f"| {r['diff_pct_sector_vs_published']:.2f}% | {r['self_employed']:,.1f} "
            f"| {r['diff_pct_with_self_employed']:.2f}% | {r['diff_pct_vs_wage_salary']:.2f}% |")
    lines += ["", "## Detailed industries vs sector (2025, line items only)",
              "Coverage below 100% reflects suppressed cells, rounding and BLS summary-only rows.", "",
              "| Sector | Sector total | Sum of detailed line items | Coverage |", "|---|---|---|---|"]
    for code, r in rec["detail_vs_sector"].iterrows():
        lines.append(f"| {SHORT_LABEL[code]} | {r['sector_total']:,.1f} | {r['line_item_sum']:,.1f} | {r['coverage_pct']:.1f}% |")
    path.write_text("\n".join(lines) + "\n")


def run(matrix: Path = MATRIX_PATH) -> int:
    df = read_matrix(matrix)
    tables = build_tables(df)
    rec = reconcile(df, tables)
    out = interim_dir() / "bls"
    out.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        table.to_csv(out / f"{name}.csv", index=False)
    sector_totals(df).to_csv(out / "sector_totals.csv", index=False)
    report = report_dir() / "ingest_bls-matrix.md"
    write_report(df, tables, rec, report, matrix)
    y = rec["2025"]
    print(f"ingest bls-matrix: {len(df):,} rows; sectors sum {y['sector_sum']:,.1f} vs published "
          f"{y['published_total']:,.1f} ({y['diff_pct_sector_vs_published']:+.2f}%); report: {report}")
    return 0
