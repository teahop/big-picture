"""Footprint weights (SPEC 6.2) with a synthetic person only."""
import json

import pytest

from imap import footprint as fp
from imap.common import public_dir, repo_root

CFG = {"half_life_years": 8, "degree_years": 2, "touched_threshold": 0.03}
SYNTH = repo_root() / "web" / "src" / "fixtures" / "synthetic_footprint.json"

# A tiny hierarchy: sectors S, T; industries s1, s2 (in S), t1 (in T); a deep node d replacing s2 and t1.
HIER = {"ind:S": {"level": 0, "up": {}}, "ind:T": {"level": 0, "up": {}},
        "ind:s1": {"level": 1, "up": {"ind:S": 1.0}}, "ind:s2": {"level": 1, "up": {"ind:S": 1.0}}, "ind:t1": {"level": 1, "up": {"ind:T": 1.0}},
        "deep:d": {"level": 2, "up": {"ind:s2": 0.25, "ind:t1": 0.75}}}


def test_recency_halves_every_half_life_and_degrees_do_not_decay():
    role = lambda end: {"kind": "role", "years": 2.0, "end_year": end, "nodes": {"ind:s1": 1.0}}
    assert fp.entry_weight(role(2026.0), 2026.0, CFG) == pytest.approx(2.0)
    assert fp.entry_weight(role(2018.0), 2026.0, CFG) == pytest.approx(1.0)
    assert fp.entry_weight(role(2010.0), 2026.0, CFG) == pytest.approx(0.5)
    assert fp.entry_weight({"kind": "degree", "nodes": {"ind:s1": 1.0}}, 2026.0, CFG) == 2


def test_weights_roll_up_and_every_level_holds_the_same_total():
    entries = [{"kind": "role", "years": 4.0, "end_year": 2026.0, "nodes": {"ind:s1": 0.5, "deep:d": 0.5}}]
    lv = fp.roll_up(fp.finest_weights(entries, 2026.0, CFG), HIER)
    assert lv[2] == {"ind:s1": 2.0, "deep:d": 2.0}
    assert lv[1] == pytest.approx({"ind:s1": 2.0, "ind:s2": 0.5, "ind:t1": 1.5})
    assert lv[0] == pytest.approx({"ind:S": 2.5, "ind:T": 1.5})
    assert sum(lv[0].values()) == sum(lv[1].values()) == pytest.approx(sum(lv[2].values()))


def test_threshold_drops_stray_shares():
    w = {"a": 9.0, "b": 0.9, "c": 0.1}
    assert list(fp.touched(w, 0.03)) == ["a", "b"]
    assert fp.touched(w, 0.0) == pytest.approx({"a": 0.9, "b": 0.09, "c": 0.01})
    assert fp.touched({}, 0.03) == {}


def test_unknown_nodes_are_refused():
    with pytest.raises(KeyError):
        fp.roll_up({"ind:nope": 1.0}, HIER)


def test_synthetic_footprint_is_well_formed():
    f = json.loads(SYNTH.read_text())
    for e in f["entries"]:
        assert sum(e["nodes"].values()) == pytest.approx(1.0) and e["kind"] in ("role", "degree")
        assert ("years" in e) == (e["kind"] == "role")


@pytest.mark.skipif(not (public_dir() / "nodes_l2.json").exists(), reason="bundle not built")
def test_synthetic_footprint_on_the_real_bundle_rolls_up_parent_equals_children():
    f = json.loads(SYNTH.read_text())
    hier = fp.load_hierarchy()
    lv = fp.roll_up(fp.finest_weights(f["entries"], f["as_of"], CFG), hier)
    for parent, w in lv[0].items():                      # every touched sector equals the sum of its Level 1 children
        kids = sum(v for n, v in lv[1].items() if parent in hier[n]["up"])
        assert w == pytest.approx(kids, rel=1e-3)
    assert sum(lv[0].values()) == pytest.approx(sum(lv[2].values()), rel=1e-3)   # replaces_share is rounded to 4 places
    finest = {n for n, h in hier.items() if h["level"] == 2} | {n for n, h in hier.items() if h["level"] == 1 and not any(n in hh["up"] for hh in hier.values() if hh["level"] == 2)}
    assert all(n in finest for e in f["entries"] for n in e["nodes"])
