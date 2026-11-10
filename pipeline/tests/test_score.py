"""Where-next scoring tests on a synthetic profile (no real data)."""
import numpy as np
import pandas as pd
import pytest

from imap.geo import qcew_codes
from imap.score import apply_toggles, multiplier, percentile, personalised_pagerank

ON = {"geography": {"enabled": True}, "pay": {"enabled": True}, "mission": {"enabled": True}}
OFF = {"geography": {"enabled": False}, "pay": {"enabled": False}, "mission": {"enabled": False}}


def test_percentile_is_zero_to_one_and_missing_is_neutral():
    p = percentile(pd.Series([10.0, 20.0, 30.0, np.nan]))
    assert p.iloc[0] == 0 and p.iloc[2] == 1 and p.iloc[3] == 0.5


def test_pagerank_favours_neighbours_of_the_seed_and_sums_to_one():
    ids = ["a", "b", "c", "d", "e"]
    edges = [("a", "b", 1.0), ("b", "c", 1.0), ("c", "d", 1.0), ("d", "e", 1.0)]
    r = personalised_pagerank(ids, edges, {"a": 1.0})
    assert r.sum() == pytest.approx(1.0)
    assert r["b"] > r["c"] > r["d"] > r["e"]            # proximity to the seed decides the order
    assert r["a"] > r["c"]                                 # the seed itself stays above distant nodes


def test_pagerank_without_seeds_is_uniform_start():
    r = personalised_pagerank(["a", "b"], [("a", "b", 1.0)], {})
    assert r["a"] == pytest.approx(r["b"])


def test_multiplier_range():
    assert multiplier(0) == 0.5 and multiplier(1) == 1.5 and multiplier(0.5) == 1.0


def test_geography_toggle_raises_concentrated_places_and_lowers_sparse_ones():
    t = {**OFF, "geography": {"enabled": True}}
    hi, lo = {"geo_pct": 0.95}, {"geo_pct": 0.05}
    assert apply_toggles(1.0, hi, t) > 1.0 > apply_toggles(1.0, lo, t)
    assert apply_toggles(1.0, hi, OFF) == 1.0                   # off means no effect


def test_pay_toggle_scales_by_wage_percentile_and_is_skipped_without_wages():
    t = {**OFF, "pay": {"enabled": True}}
    assert apply_toggles(1.0, {"pay_pct": 1.0}, t) > apply_toggles(1.0, {"pay_pct": 0.0}, t)
    assert apply_toggles(1.0, {"pay_pct": None}, t) == 1.0


def test_mission_tags_move_scores_in_the_expected_direction():
    t = {**OFF, "mission": {"enabled": True}}
    assert apply_toggles(1.0, {"tag": 2}, t) == pytest.approx(1.5)
    assert apply_toggles(1.0, {"tag": -2}, t) == pytest.approx(0.5)
    assert apply_toggles(1.0, {"tag": 0}, t) == pytest.approx(1.0)


def test_toggles_reorder_a_ranking():
    base = {"a": 1.00, "b": 0.95, "c": 0.90}
    comps = {"a": {"geo_pct": 0.1, "tag": -2}, "b": {"geo_pct": 0.5, "tag": 0}, "c": {"geo_pct": 0.9, "tag": 2}}
    order = lambda tg: sorted(base, key=lambda k: -apply_toggles(base[k], comps[k], tg))
    assert order(OFF) == ["a", "b", "c"]
    assert order({**OFF, "geography": {"enabled": True}}) == ["c", "b", "a"]
    assert order({**OFF, "mission": {"enabled": True}}) == ["c", "b", "a"]


def test_qcew_code_mapping():
    assert qcew_codes("541500") == [("5415", [5])]
    assert qcew_codes("61130S") == [("6113", [2])] and qcew_codes("61130P") == [("6113", [5])]
    assert qcew_codes("1131-2") == [("1131", [5]), ("1132", [5])]
    assert qcew_codes("999300") == [("92", [3])]
    assert qcew_codes("3250A1") == [] and qcew_codes("510000-other") == []
    assert qcew_codes("221111") == [("221111", [5])]
