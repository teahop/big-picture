"""v2 Phase 3: the CV lookup files (public data only)."""
import gzip
import json

import pytest

from imap.common import public_dir
from imap.lookup import BUDGET_GZ, industries_of, norm

import pandas as pd


def test_norm_keeps_letters_and_digits_only():
    assert norm("  Sr. Software-Engineer (II) ") == "sr software engineer ii"


def test_industries_of_takes_top_n_and_renormalises():
    s = pd.Series({"a": 0.5, "b": 0.3, "c": 0.2, "d": 0.0})
    out = industries_of(s, top_n=2)
    assert [i for i, _ in out] == ["a", "b"] and abs(sum(v for _, v in out) - 1) < 1e-3


@pytest.fixture(scope="module")
def files():
    d = public_dir()
    if not (d / "lookup_titles.json").exists():
        pytest.skip("run `imap lookup` first")
    return {n: (d / n).read_text() for n in ("lookup_titles.json", "lookup_degrees.json")}


def test_lookups_fit_budget_and_point_at_map_nodes(files):
    assert sum(len(gzip.compress(t.encode())) for t in files.values()) <= BUDGET_GZ
    ids = {n["id"] for f in ("nodes_l1.json", "nodes_l2.json") for n in json.loads((public_dir() / f).read_text())}
    t, d = json.loads(files["lookup_titles.json"]), json.loads(files["lookup_degrees.json"])
    assert len(t["industries"]) == len(t["socs"]) and t["titles"]
    assert all(i in ids for row in t["industries"] for i, _ in row)
    assert all(i in ids for _, _, row in d["programmes"] for i, _ in row)
    assert all(0 <= s < len(t["socs"]) for _, ss in t["titles"] for s in ss)
    assert "registered nurses" in dict(t["titles"])
