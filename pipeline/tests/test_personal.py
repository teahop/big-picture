"""Personal overlay tests. Synthetic people and organisations only: no real data and nothing read from Personal Data/."""
import subprocess
import sys
from datetime import date

import numpy as np
import pandas as pd
import pytest

from imap.personal.connections import norm_name, tie_normalised
from imap.personal.presence import expand, halo, tenure
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


def test_recency_decay_halves_every_half_life():
    roles = pd.DataFrame([
        {"nodes": "deep:a:1.0", "person_months": 12.0, "end_years_before_as_of": 0.0},
        {"nodes": "deep:b:1.0", "person_months": 12.0, "end_years_before_as_of": 8.0},
        {"nodes": "deep:c:0.5;deep:d:0.5", "person_months": 24.0, "end_years_before_as_of": 16.0}])
    got = tenure(roles, half_life=8.0)
    assert got["deep:a"] == pytest.approx(1.0) and got["deep:b"] == pytest.approx(0.5)
    assert got["deep:c"] == pytest.approx(0.25) and got["deep:d"] == pytest.approx(0.25)


def test_tie_strength_is_log_scaled_into_unit_interval():
    t = tie_normalised(pd.Series([0.0, 2.0, 35.0]))
    assert t.iloc[0] == 0 and t.iloc[-1] == pytest.approx(1.0) and 0 < t.iloc[1] < 1
    assert tie_normalised(pd.Series([3.0]), max_tie=3.0).iloc[0] == pytest.approx(1.0)


def test_connection_specs_split_equally_or_by_employment():
    members = {"ind:S": pd.Series({"ind:x": 300.0, "ind:y": 100.0})}
    assert expand("deep:a;deep:b", None, None, members) == {"deep:a": 0.5, "deep:b": 0.5}
    got = expand("sector:S", None, None, {"ind:S": members["ind:S"]})
    assert got == {"ind:x": 0.75, "ind:y": 0.25}


def test_halo_passes_a_damped_share_to_neighbours_in_proportion_to_weight():
    edges = [{"source": "a", "target": "b", "weight": 3.0}, {"source": "a", "target": "c", "weight": 1.0}]
    out = halo({"a": 10.0}, edges, damping=0.3)
    assert out["b"] == pytest.approx(2.25) and out["c"] == pytest.approx(0.75)
    assert halo({"z": 5.0}, edges, 0.3) == {}                 # no neighbours, no halo


def test_company_name_normalisation_ignores_suffixes_and_case():
    assert norm_name("Example Corp.") == norm_name("example") == "example"


def test_public_export_does_not_import_the_personal_package():
    code = "import sys, imap.export, imap.terrain, imap.layout_anchored; print(any(m.startswith('imap.personal') for m in sys.modules))"
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout.strip()
    assert out == "False"
