"""Level 0 industry sectors as they appear in the BLS National Employment Matrix.

Codes are the matrix's own industry codes (NAICS-based, some are BLS aggregates
such as 31-330 for Manufacturing). `short` is a short display label written for this
project (it is lettered onto the hills, so keep it brief); the official BLS title is kept separately in the data.
"""
from __future__ import annotations

# (matrix industry code, short display label)
SECTORS: list[tuple[str, str]] = [
    ("110000", "Agriculture"),
    ("210000", "Mining"),
    ("220000", "Utilities"),
    ("230000", "Construction"),
    ("31-330", "Manufacturing"),
    ("420000", "Wholesale"),
    ("44-450", "Retail"),
    ("48-490", "Transportation"),
    ("510000", "Information"),
    ("520000", "Finance"),
    ("530000", "Real estate"),
    ("540000", "Professional services"),
    ("550000", "Management"),
    ("560000", "Business support"),
    ("610000", "Education"),
    ("620000", "Health care"),
    ("710000", "Arts & entertainment"),
    ("720000", "Hospitality"),
    ("810000", "Other services"),
    ("900000", "Government"),
]

SECTOR_CODES = [c for c, _ in SECTORS]
SHORT_LABEL = dict(SECTORS)

TOTAL_CODE = "TE1000"          # total, all industries
SELF_EMPLOYED_CODE = "TE1100"  # self-employed workers (not an industry)
WAGE_SALARY_CODE = "TE1200"    # total wage and salary employment
ALL_OCC = "00-0000"
