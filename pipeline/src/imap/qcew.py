"""BLS QCEW 2025 annual averages by area. The national file (US000) gives the payroll that splits BEA value added
across the map's industries (`imap value`).
"""
from __future__ import annotations

import re
import urllib.request

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
