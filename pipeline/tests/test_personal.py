"""Personal overlay tests. Synthetic people and organisations only: no real data and nothing read from Personal Data/."""
import subprocess
import sys
from datetime import date

import numpy as np
import pandas as pd
import pytest

from imap.personal.footprint import expand, role_entries, year_of
from imap.personal.roles import Role, allocate_months, mi, parse_dates, parse_duration

AS_OF = date(2026, 11, 9)


def test_clean_dates_have_no_flags_and_year_only_is_flagged():
    s, e, flags = parse_dates("Mar 2020 – Jun 2020", AS_OF)
    assert (s, e, flags) == (mi(2020, 3), mi(2020, 6) + 1, [])
    s, e, flags = parse_dates("2018 – 2020", AS_OF)
    assert e - s == 24 and "year-only endpoint" in flags
    s, e, flags = parse_dates("Mar 2020 – Present", AS_OF)
    assert e == mi(2026, 11) + 1 and not flags
    assert parse_dates("Various", AS_OF)[0] is None
    assert "single date" in parse_dates(date(2026, 5, 1), AS_OF)[2][0]


def test_durations():
    assert parse_duration("2 yrs 5 mos") == 29 and parse_duration("~1.5 yrs") == 18 and parse_duration("Intermittent") is None


def test_umbrella_gets_only_uncovered_months():
    umbrella = Role(1, mi(2020, 1), mi(2021, 12) + 1, umbrella=True)
    child = Role(2, mi(2020, 3), mi(2020, 6) + 1)
    job = Role(3, mi(2020, 7), mi(2020, 9) + 1)           # full-time: pauses the umbrella
    got = allocate_months([umbrella, child, job], AS_OF)
    assert got[2] == 4 and got[3] == 3 and got[1] == 24 - 4 - 3
    assert sum(got.values()) == 24                       # no month counted twice


def test_concurrent_roles_split_a_month_and_builds_weigh_half():
    a, b = Role(1, mi(2020, 1), mi(2020, 2)), Role(2, mi(2020, 1), mi(2020, 2))
    assert allocate_months([a, b], AS_OF) == {1: 0.5, 2: 0.5}
    build = Role(3, mi(2020, 1), mi(2020, 2), weight=0.5)
    umb = Role(4, mi(2020, 1), mi(2020, 2), umbrella=True)
    got = allocate_months([build, umb], AS_OF)
    assert got == {3: 0.5, 4: 0.5}                        # a lone build fills half a month, the umbrella the rest
    one, two = Role(5, mi(2020, 1), mi(2020, 2)), Role(6, mi(2020, 1), mi(2020, 2), weight=0.5)
    got = allocate_months([one, two], AS_OF)
    assert pytest.approx(sum(got.values())) == 1.0 and got[5] > got[6]


def test_month_capacity_lets_concurrent_roles_exceed_one_month():
    a, b, c = (Role(i, mi(2020, 1), mi(2020, 2)) for i in (1, 2, 3))
    got = allocate_months([a, b, c], AS_OF, capacity=1.75)
    assert pytest.approx(sum(got.values())) == 1.75 and pytest.approx(got[1]) == 1.75 / 3
    two = allocate_months([a, b], AS_OF, capacity=1.75)
    assert two == {1: 0.875, 2: 0.875}                  # two roles share the 1.75 capacity
    umb = Role(9, mi(2020, 1), mi(2020, 2), umbrella=True)
    assert allocate_months([a, umb], AS_OF, capacity=1.75) == {1: 1.0, 9: 0.0}   # umbrella tops a month up to 1.0 only


def test_excluded_roles_carry_nothing():
    got = allocate_months([Role(1, mi(2020, 1), mi(2020, 12) + 1, included=False)], AS_OF)
    assert got == {}


def test_role_entries_carry_years_after_the_umbrella_rule_and_skip_excluded_roles():
    roles = pd.DataFrame([
        {"title": "T1", "organisation": "Example A", "included": True, "person_months": 18.0, "end": "2020-06", "nodes": "deep:a:0.5;deep:b:0.5"},
        {"title": "T2", "organisation": "Example B", "included": False, "person_months": 12.0, "end": "2019-01", "nodes": "deep:c:1.0"},
        {"title": "T3", "organisation": "Example C", "included": True, "person_months": 0.0, "end": "2018-01", "nodes": "deep:d:1.0"}])
    got = role_entries(roles)
    assert len(got) == 1 and got[0]["years"] == pytest.approx(1.5) and got[0]["end_year"] == pytest.approx(2020.5)
    assert got[0]["nodes"] == {"deep:a": 0.5, "deep:b": 0.5} and year_of(None) is None


def test_node_specs_split_equally_or_by_employment():
    members = {"ind:S": pd.Series({"ind:x": 300.0, "ind:y": 100.0})}
    assert expand("deep:a;deep:b", members) == {"deep:a": 0.5, "deep:b": 0.5}
    assert expand("sector:S", members) == {"ind:x": 0.75, "ind:y": 0.25}


def test_public_export_does_not_import_the_personal_package():
    code = "import sys, imap.export, imap.terrain, imap.layout_joint, imap.footprint; print(any(m.startswith('imap.personal') for m in sys.modules))"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.strip()
    assert out == "False"
