"""Phase 2 tests on small synthetic tables (no real or personal data)."""
import numpy as np
import pandas as pd
import pytest

from imap import bridge, ingest_files, layout


def test_field_similarity_is_symmetric_with_unit_diagonal():
    co = pd.DataFrame([[8, 2, 0], [1, 9, 3], [0, 2, 8]], index=list("abc"), columns=list("abc"), dtype=float)
    sim = bridge.field_similarity(co)
    assert np.allclose(sim, sim.T) and np.allclose(np.diag(sim), 1.0)
    assert sim.loc["a", "b"] > sim.loc["a", "c"]


def test_pct_rank_spans_zero_to_one_and_orders():
    r = layout.pct_rank(np.array([0.1, 0.9, 0.5]))
    assert r.min() == 0 and r.max() == 1 and r[1] > r[2] > r[0]


def test_minmax_rows_and_combine_weights():
    sem = pd.DataFrame([[1.0, 3.0]], index=["f"], columns=["x", "y"])
    occ = pd.DataFrame([[10.0, 0.0]], index=["f"], columns=["x", "y"])
    out = bridge.combine(occ, sem, 0.6, 0.4)
    assert out.loc["f", "x"] == pytest.approx(0.6) and out.loc["f", "y"] == pytest.approx(0.4)
    assert bridge.combine(None, sem, 0.6, 0.4).loc["f", "y"] == 1.0


def herd_table(tmp_path, title="Table 10", fy="FY 2024"):
    rows = [[title, None], [f"x: {fy}", None], ["(Dollars in thousands)", None], ["Field", "All R&D expenditures"],
            [None, "Federal government"], ["All R&D fields", 300], ["Science", 200], ["Computer and information sciences", 100],
            ["Life sciences", 100], ["Agricultural sciences", 60], ["Health sciences", 40], ["Non-S&E", 100], ["Law", 100]]
    path = tmp_path / "t.xlsx"
    pd.DataFrame(rows).to_excel(path, header=False, index=False)
    return path


def test_parse_herd_leaves_sum_to_total(tmp_path):
    h = ingest_files.parse_herd(herd_table(tmp_path))
    assert h.loc[~h.is_parent, "rd_thousands"].sum() == 300


def test_parse_herd_rejects_wrong_table(tmp_path):
    with pytest.raises(ingest_files.LayoutMismatch):
        ingest_files.parse_herd(herd_table(tmp_path, title="Table 3"))


def test_allocate_herd_splits_by_works_and_conserves_dollars(tmp_path):
    h = ingest_files.parse_herd(herd_table(tmp_path))
    mapping = pd.DataFrame({"herd_field": ["Health sciences", "Health sciences", "Law"],
                            "openalex_field": ["Medicine", "Nursing", "Social Sciences"]})
    works = pd.Series({"Medicine": 90, "Nursing": 10, "Social Sciences": 5})
    alloc, unalloc = ingest_files.allocate_herd(h, mapping, works)
    by = alloc.groupby("openalex_field")["rd_thousands"].sum()
    assert by["Medicine"] == pytest.approx(36) and by["Nursing"] == pytest.approx(4)
    assert set(unalloc["herd_field"]) == {"Computer and information sciences", "Agricultural sciences"}


def test_allocate_herd_rejects_unknown_field(tmp_path):
    h = ingest_files.parse_herd(herd_table(tmp_path))
    with pytest.raises(ingest_files.LayoutMismatch):
        ingest_files.allocate_herd(h, pd.DataFrame({"herd_field": ["Nope"], "openalex_field": ["Medicine"]}), pd.Series({"Medicine": 1}))


def test_load_reviewed_requires_an_accepted_row_per_field(tmp_path, monkeypatch):
    f = tmp_path / "m.csv"
    pd.DataFrame({"field_id": ["1", "1", "2"], "cip4": ["01.01", "01.02", "02.01"],
                  "similarity": [.7, .6, .5], "accept": ["yes", "no", "no"]}).to_csv(f, index=False)
    monkeypatch.setattr(bridge, "REVIEWED", f)
    with pytest.raises(ValueError, match="no accepted program"):
        bridge.load_reviewed()


def test_mapping_reviewed_flag(tmp_path, monkeypatch):
    f = tmp_path / "m.csv"
    pd.DataFrame({"field_id": ["1"], "accept": ["yes"], "reviewed": ["yes"]}).to_csv(f, index=False)
    monkeypatch.setattr(bridge, "REVIEWED", f)
    assert bridge.mapping_reviewed()
    pd.DataFrame({"field_id": ["1"], "accept": ["yes"], "reviewed": ["no"]}).to_csv(f, index=False)
    assert not bridge.mapping_reviewed()
