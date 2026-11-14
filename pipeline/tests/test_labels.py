"""Display names on the map (owner, 2026-11-13): no "Other:" prefix, no NAICS code lists, and no two the same."""
import collections
import json
import re

from imap.common import public_dir
from imap.export import display_label


def test_display_label_rules():
    assert display_label("ind:x", "Chemical manufacturing (3251,2,3,9)", False, "310000", {}) == "Chemical manufacturing"
    assert display_label("ind:x", "Miscellaneous store retailers (4594 and 4595 only)", False, "440000", {}) == "Miscellaneous store retailers"
    assert display_label("ind:x", "Nonferrous metal (except aluminum) production", False, "310000", {}) == "Nonferrous metal (except aluminum) production"
    assert display_label("ind:a", "anything (1,2)", False, "310000", {"ind:a": "Reviewed name"}) == "Reviewed name"


def test_exported_names_are_clean_and_unique():
    for name in ("nodes_l1.json", "nodes_l2.json"):
        labels = [n["label"] for n in json.loads((public_dir() / name).read_text())]
        assert not [l for l in labels if l.startswith("Other:") or re.search(r"\(\s*\d", l)]
        assert not [l for l, c in collections.Counter(labels).items() if c > 1]
