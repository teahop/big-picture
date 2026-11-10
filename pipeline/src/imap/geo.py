"""Geography for the "where next" toggle (SPEC 8): QCEW location quotients for industries, and the metro's share of
US publications for research. The metro itself (counties, cities) is chosen in the private profile; the downloads are generic.

LQ(industry) = (metro employment in the industry / metro total employment) / (US employment in it / US total).
The metro's QCEW detail exists only at county level, so the metro is a list of counties summed here.
"""
from __future__ import annotations

import re
import urllib.request
import zipfile

import pandas as pd

from .common import raw_dir

QCEW_YEAR = 2025
QCEW_ZIP_URL = f"https://data.bls.gov/cew/data/files/{QCEW_YEAR}/csv/{QCEW_YEAR}_annual_by_area.zip"
USER_AGENT = "industry-map-research/0.1 (open data pipeline)"
OWN = {"P": [5], "S": [2], "L": [3]}          # Employment Matrix ownership suffix -> QCEW ownership code


def zip_path():
    return raw_dir() / "qcew" / "area_zip" / "by_area.zip"


def download_qcew() -> int:
    path = zip_path()
    if path.exists():
        print(f"qcew: {path.name} already present ({path.stat().st_size / 1e6:.0f} MB)")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(QCEW_ZIP_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
        f.write(r.read())
    print(f"qcew: downloaded {QCEW_ZIP_URL} ({path.stat().st_size / 1e6:.0f} MB)")
    return 0


def qcew_codes(ind_code: str) -> list[tuple[str, list[int]]]:
    """Employment Matrix industry code -> [(QCEW industry code, ownership codes)]; [] when there is no clean equivalent."""
    c = str(ind_code)
    if c.endswith("-other") or re.search(r"[A-Z]\d$", c) or "-" in c and not re.fullmatch(r"\d{4}-\d", c):
        return []
    if c in ("999100", "999200", "999300"):
        return [("92", [{"1": 1, "2": 2, "3": 3}[c[3]]])]          # public administration, federal / state / local
    m = re.fullmatch(r"(\d{4})-(\d)", c)
    if m:
        return [(m.group(1)[:3] + d, [5]) for d in (m.group(1)[3], m.group(2))]
    own = [5]
    if c[-1] in OWN:
        own, c = OWN[c[-1]], c[:-1]
    if not c.isdigit():
        return []
    return [(c.rstrip("0") or c, own)]


def load_area(fips: str) -> pd.DataFrame:
    with zipfile.ZipFile(zip_path()) as z:
        name = next(n for n in z.namelist() if f"annual {fips} " in n)
        with z.open(name) as f:
            df = pd.read_csv(f, dtype={"industry_code": str, "own_code": int, "disclosure_code": str},
                             usecols=["industry_code", "own_code", "annual_avg_emplvl", "disclosure_code"])
    return df


def employment(df: pd.DataFrame, codes: list[tuple[str, list[int]]]) -> tuple[float, bool]:
    """Summed employment and whether every cell was published (QCEW suppresses small cells)."""
    total, ok = 0.0, True
    for code, own in codes:
        rows = df[(df["industry_code"] == code) & (df["own_code"].isin(own))]
        if rows.empty:
            ok = False
            continue
        total += float(rows["annual_avg_emplvl"].sum())
        ok &= bool(rows["disclosure_code"].isna().all())
    return total, ok


def industry_lq(counties: list[str], ind_codes: list[str]) -> pd.DataFrame:
    """One row per matrix industry code: metro employment, US employment, location quotient, whether it could be matched."""
    metro = pd.concat([load_area(f) for f in counties])
    metro = metro.groupby(["industry_code", "own_code"], as_index=False).agg(
        annual_avg_emplvl=("annual_avg_emplvl", "sum"), disclosure_code=("disclosure_code", lambda s: s.dropna().iloc[0] if s.notna().any() else None))
    us = load_area("US000")
    tm = float(metro[(metro["industry_code"] == "10") & (metro["own_code"] == 0)]["annual_avg_emplvl"].sum())
    tu = float(us[(us["industry_code"] == "10") & (us["own_code"] == 0)]["annual_avg_emplvl"].sum())
    rows = []
    for code in ind_codes:
        codes = qcew_codes(code)
        if not codes:
            rows.append({"ind_code": code, "metro_emp": None, "us_emp": None, "lq": None, "status": "no clean QCEW equivalent"})
            continue
        m, ok_m = employment(metro, codes)
        u, ok_u = employment(us, codes)
        if u <= 0:
            rows.append({"ind_code": code, "metro_emp": None, "us_emp": None, "lq": None, "status": "not in QCEW"})
        elif not ok_m and m == 0:
            rows.append({"ind_code": code, "metro_emp": None, "us_emp": u, "lq": None, "status": "metro cell suppressed"})
        else:
            rows.append({"ind_code": code, "metro_emp": m, "us_emp": u, "lq": (m / tm) / (u / tu), "status": "ok" if ok_m else "partly suppressed"})
    return pd.DataFrame(rows)


def run_openalex_geo() -> int:
    """Metro share of US publications per subfield (cities from the private profile). Output stays in private/."""
    from .openalex import SIZE_FILTER, Client, short
    from .personal.base import load_profile, private_dir
    cities = load_profile().get("geography", {}).get("cities", [])
    if not cities:
        print("openalex-geo: no geography.cities in the private profile")
        return 1
    client = Client()
    flt = SIZE_FILTER + ",authorships.institutions.geo.city:" + "|".join(cities)
    groups = client.paged("works", key="group_by", filter=flt, group_by="primary_topic.subfield.id")
    metro = {short(g["key"]): g["count"] for g in groups if g["key"] not in (None, "unknown")}
    from .common import interim_dir
    subs = pd.read_csv(interim_dir() / "levels" / "subfields_l1.csv", dtype={"id": str})
    us_total = float(subs["works_us"].sum()); metro_total = float(sum(metro.values()))
    rows = [{"id": r.id, "metro_works": metro.get(r.id, 0), "us_works": int(r.works_us),
             "lq": (metro.get(r.id, 0) / metro_total) / (r.works_us / us_total) if r.works_us > 0 else None} for r in subs.itertuples()]
    pd.DataFrame(rows).to_csv(private_dir() / "geo_research.csv", index=False)
    print(f"openalex-geo: {int(metro_total)} metro works over {len(metro)} subfields ({client.calls} API calls)")
    return 0


def check_oews() -> int:
    """OEWS needs a hand download: bls.gov refuses scripted requests (403), as it did for the Employment Matrix."""
    d = raw_dir() / "oews"
    found = sorted(d.glob("oesm*in4*")) if d.exists() else []
    if not found:
        print("oews: no file found. Download the May 2025 industry-specific 4-digit NAICS file (oesm25in4.zip) from "
              "https://www.bls.gov/oes/tables.htm and save it in data/raw/oews/")
        return 1
    print(f"oews: found {found[0].name}; the loader is written once the file layout has been checked")
    return 0
