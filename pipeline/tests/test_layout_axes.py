"""v3 axes layout (SPEC 3): growth left to right, size front (small) to back (large), clipped scales, pull, separation."""
import numpy as np

from imap import layout_axes as la

GROWTH = np.array([-5.0, 0.0, 2.0, 8.0, 40.0])
SIZE = np.array([2.0, 50.0, 900.0, 10.0, 300.0])


def scale() -> la.Scale:
    return la.fit_scale(GROWTH, SIZE, (5, 95), 5)


def test_higher_growth_sits_further_right():
    xy = la.axis_positions(GROWTH, SIZE, scale())
    assert list(np.argsort(xy[:, 0], kind="stable")) == list(np.argsort(GROWTH, kind="stable"))


def test_larger_sits_further_back():
    xy = la.axis_positions(GROWTH, SIZE, scale())
    # back is the smaller layout y (the camera sits at +y)
    assert list(np.argsort(-xy[:, 1], kind="stable")) == list(np.argsort(SIZE, kind="stable"))
    assert xy[np.argmax(SIZE), 1] == -1.0


def test_values_beyond_the_clip_sit_at_the_edge():
    sc = scale()
    assert sc.g_hi < 40 and sc.g_lo > -5                   # the outliers are beyond the 5th-95th percentile scale
    xy = la.axis_positions(GROWTH, SIZE, sc)
    assert xy[4, 0] == 1.0 and xy[0, 0] == -1.0
    assert xy[0, 1] == 1.0                                  # smallest, below the size clip: at the front edge
    assert np.all(np.abs(xy) <= 1.0)


def test_pull_moves_part_way_toward_the_parent():
    out = la.nudge(np.array([[1.0, 1.0]]), np.array([[0.0, 0.0]]), 0.3)
    assert np.allclose(out, [[0.7, 0.7]])
    assert np.allclose(la.nudge(np.array([[0.4, -0.2]]), np.array([[0.0, 0.0]]), 0.0), [[0.4, -0.2]])


def test_separation_keeps_points_apart_moves_little_and_respects_fixed():
    target = np.array([[0.0, 0.0], [0.01, 0.0], [0.5, 0.5], [0.0, 0.01]])
    fixed = np.array([True, False, False, False])
    out = la.separate(target, 0.1, fixed=fixed)
    d = np.linalg.norm(out[:, None] - out[None], axis=2) + np.eye(4)
    assert d.min() > 0.08                                   # the pull back toward the target leaves pairs just under min_sep
    assert np.allclose(out[0], target[0])                   # fixed point untouched
    assert np.allclose(out[2], target[2], atol=1e-3)        # a point with room barely moves
    assert np.array_equal(out, la.separate(target, 0.1, fixed=fixed))   # deterministic
