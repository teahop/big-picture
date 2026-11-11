"""Layout helper tests (the v1 research bridge and HERD tests were removed with research fields in v2)."""
import numpy as np

from imap import layout


def test_pct_rank_spans_zero_to_one_and_orders():
    r = layout.pct_rank(np.array([0.1, 0.9, 0.5]))
    assert r.min() == 0 and r.max() == 1 and r[1] > r[2] > r[0]
