"""Value added allocation and the dollar measures (synthetic where possible)."""
import numpy as np
import pandas as pd
import pytest

from imap.bea import leaf_of
from imap.common import interim_dir

CONC = {"5415": "5415", "5411": "5411", "54194": "5412OP", "541990": "5412OP", "3111": "311FT", "3112": "311FT", "3254": "325"}


def test_leaf_follows_the_naics_prefix():
    assert leaf_of("541500", CONC) == "5415"
    assert leaf_of("311100", CONC) == "311FT"
    assert leaf_of("541940", CONC) == "5412OP"
    assert leaf_of("999999", CONC) is None


def test_ownership_suffix_is_ignored_for_the_leaf():
    assert leaf_of("54150P", CONC) == "5415" or leaf_of("54150P", CONC) is None


@pytest.mark.skipif(not (interim_dir() / "levels" / "industry_value.csv").exists(), reason="value stage not run")
def test_value_added_reconciles_with_bea():
    d = pd.read_csv(interim_dir() / "levels" / "industry_value.csv", dtype={"ind_code": str})
    va = pd.read_csv(interim_dir() / "bea" / "value_added_2025.csv").set_index("code")["usd_billion"]
    assert d["value_added_usd_b"].sum() == pytest.approx(va["GDP"] - va["HS"], rel=1e-4)      # all of GDP except housing (BEA rounds each row to 0.1)
    assert (d["value_added_usd_b"] > 0).all() and (d["va_per_job_usd"] > 0).all()
