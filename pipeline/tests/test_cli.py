from imap.cli import STAGES, main


def test_stage_list_matches_spec():
    assert list(STAGES) == ["ingest", "levels", "deep", "value", "graph", "layout", "terrain", "export", "lookup", "personal"]
