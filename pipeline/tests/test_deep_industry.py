"""Tests for the deep: industry nodes (synthetic inputs; one integration check on the built tables when present)."""
import numpy as np
import pandas as pd
import pytest

from imap.common import interim_dir
from imap.deep_industry import FLOOR_SHARE, load_categories, read_headcounts

SPEC = {"zones": [{"zone": "Z", "parents": ["611A", "611B", "999"], "categories": [
    {"slug": "a", "label": "A", "members": ["x", "y"], "proxy": "headcount share", "parent": "611*"},
    {"slug": "b", "label": "B", "members": [], "proxy": "official share"},
]}]}


def test_parent_patterns_match_only_listed_parents():
    cats = load_categories(SPEC, {"611A", "611B", "999"})
    assert cats[0].parents == ["611A", "611B"]          # pattern 611* matches two of the zone's parents
    assert cats[1].parents == ["611A", "611B", "999"]   # no `parent` key: every parent of the zone


def test_unknown_parent_is_an_error():
    with pytest.raises(ValueError):
        load_categories(SPEC, {"123"})


def test_headcounts_skip_blank_rows(tmp_path):
    p = tmp_path / "h.csv"
    p.write_text("category_slug,organisation,headcount,scope,as_of,source,quality,note\n"
                 "a,X,100,global,,s,q,\na,Y,,,,,,Excluded\nb,Z,5,US,,s,q,\n")
    got = read_headcounts(p)
    assert got == {"a": [("X", 100.0)], "b": [("Z", 5.0)]}


def test_floor_share_keeps_minus_positive():
    assert 0 < FLOOR_SHARE < 1


@pytest.mark.skipif(not (interim_dir() / "levels" / "deep_industry_contrib.csv").exists(), reason="deep stage not run")
def test_deep_nodes_reconcile_with_their_parents():
    lv = interim_dir() / "levels"
    contrib = pd.read_csv(lv / "deep_industry_contrib.csv", dtype={"parent_code": str})
    ind = pd.read_csv(lv / "industry_l1.csv", dtype={"ind_code": str}).set_index("ind_code")
    got = contrib.groupby("parent_code")["emp_2025"].sum()
    assert np.allclose(got, ind.loc[got.index, "emp_2025"], atol=1e-6)
    shares = contrib.groupby("parent_code")["share"].sum()
    assert np.allclose(shares, 1.0)
    nodes = pd.read_csv(lv / "deep_industry.csv")
    assert nodes["node_id"].is_unique and (nodes["node_id"].str.startswith("deep:")).all()
    assert (nodes["emp_2025"] > 0).all()
