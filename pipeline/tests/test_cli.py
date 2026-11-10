import pytest

from imap.cli import STAGES, main


def test_stage_list_matches_spec():
    assert list(STAGES) == ["ingest", "levels", "deep", "graph", "layout", "terrain", "export", "personal", "score"]


@pytest.mark.parametrize("stage", ["score"])
def test_stub_runs(stage):
    assert main([stage]) == 0


def test_requires_stage():
    with pytest.raises(SystemExit):
        main([])
