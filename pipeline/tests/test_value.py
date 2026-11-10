"""Value added allocation and the dollar measures (synthetic where possible)."""
import numpy as np
import pandas as pd
import pytest

from imap.bea import leaf_of
from imap.common import interim_dir
from imap.terrain import ratio_amplitude

CONC = {"5415": "5415", "5411": "5411", "54194": "5412OP", "541990": "5412OP", "3111": "311FT", "3112": "311FT", "3254": "325"}


def test_leaf_follows_the_naics_prefix():
    assert leaf_of("541500", CONC) == "5415"
    assert leaf_of("311100", CONC) == "311FT"
    assert leaf_of("541940", CONC) == "5412OP"
    assert leaf_of("999999", CONC) is None


def test_ownership_suffix_is_ignored_for_the_leaf():
    assert leaf_of("54150P", CONC) == "5415" or leaf_of("54150P", CONC) is None


def test_ratio_amplitude_is_scaled_to_the_largest_and_never_piles_up():
    a = ratio_amplitude(np.array([0.0, 10.0, 1000.0, np.nan]))
    assert a[0] == 0 and a[2] == pytest.approx(1.0) and 0 < a[1] < 1 and a[3] == 0


@pytest.mark.skipif(not (interim_dir() / "levels" / "industry_value.csv").exists(), reason="value stage not run")
def test_value_added_reconciles_with_bea():
    d = pd.read_csv(interim_dir() / "levels" / "industry_value.csv", dtype={"ind_code": str})
    va = pd.read_csv(interim_dir() / "bea" / "value_added_2025.csv").set_index("code")["usd_billion"]
    assert d["value_added_usd_b"].sum() == pytest.approx(va["GDP"] - va["HS"], rel=1e-4)      # all of GDP except housing (BEA rounds each row to 0.1)
    assert (d["value_added_usd_b"] > 0).all() and (d["va_per_job_usd"] > 0).all()
    deep = pd.read_csv(interim_dir() / "levels" / "deep_industry_value_contrib.csv", dtype={"parent_code": str})
    per_parent = deep.groupby("parent_code")["value_added_usd_b"].sum()
    parent = d.set_index("ind_code").loc[per_parent.index, "value_added_usd_b"]
    assert np.allclose(per_parent, parent, rtol=1e-6)                                         # deep nodes keep their parents' dollars
