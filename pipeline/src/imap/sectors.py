"""Level 0 industry sectors as they appear in the BLS National Employment Matrix.

Codes are the matrix's own industry codes (NAICS-based, some are BLS aggregates
such as 31-330 for Manufacturing). `short` is a display label written for this
project; the official BLS title is kept separately in the data.
"""
from __future__ import annotations

# (matrix industry code, short display label)
SECTORS: list[tuple[str, str]] = [
    ("110000", "Agriculture & forestry"),
    ("210000", "Mining & oil/gas"),
    ("220000", "Utilities"),
    ("230000", "Construction"),
    ("31-330", "Manufacturing"),
    ("420000", "Wholesale trade"),
    ("44-450", "Retail trade"),
    ("48-490", "Transportation & warehousing"),
    ("510000", "Information"),
    ("520000", "Finance & insurance"),
    ("530000", "Real estate & leasing"),
    ("540000", "Professional & technical services"),
    ("550000", "Management of companies"),
    ("560000", "Administrative & waste services"),
    ("610000", "Educational services"),
    ("620000", "Health care & social assistance"),
    ("710000", "Arts, entertainment & recreation"),
    ("720000", "Accommodation & food services"),
    ("810000", "Other services"),
    ("900000", "Government (excl. education & hospitals)"),
]

SECTOR_CODES = [c for c, _ in SECTORS]
SHORT_LABEL = dict(SECTORS)

TOTAL_CODE = "TE1000"          # total, all industries
SELF_EMPLOYED_CODE = "TE1100"  # self-employed workers (not an industry)
WAGE_SALARY_CODE = "TE1200"    # total wage and salary employment
ALL_OCC = "00-0000"
