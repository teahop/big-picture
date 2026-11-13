# The Big Picture — Specification (v3)

*Visualizing a career.*

Version 3.0 draft, 2026-11-13. Owner: github.com/teahop.
The v2 specification, plan and handoffs are archived in `docs/v2/` (v1 in
`docs/v1/`). Anything this document does not change (data sources, node IDs,
levels of detail, deep zones, the footprint format and weights, Add your CV,
privacy) still works as v2 describes; this document refers to it as "v2 §n".

## 1. Purpose

Unchanged from v2 §1: show American industry as one landscape and draw a career
on it. v3 makes the landscape's position mean something, and gives each level
of detail the view that reads best for it.

## 2. What changes from v2

| # | Change | Section |
|---|---|---|
| 1 | **Meaningful axes.** Left to right is projected growth (faster growth to the right). Front to back is size (small near the viewer, large at the back). Industries are nudged toward their sector | 3 |
| 2 | **Industries in 2D.** The Industries level is a top-down topographic map (contours, elevation tints, hill shading) with cartographic labels. A career is drawn as rainbow contour bands | 4 |
| 3 | **Deep zones as an ocean.** The Deep zones level stays 2D with a sea-chart look. A career is drawn as schools of fish | 5 |
| 4 | Axis labels on every view, and text that no longer says "similar industries sit near each other" | 3.4 |

Unchanged: Sectors stay the 3D California hills with wildflowers; the data
pipeline's sources; the footprint format, weights and roll-up (v2 §6.1, §6.2);
Add your CV (v2 §7, with the v2 release's "straight to the map" flow and Make
adjustments); privacy and publishing (v2 §9).

## 3. Meaningful axes

### 3.1 Decision (owner, 2026-11-13)
- **x, left to right: projected growth.** BLS Employment Matrix projected
  employment change 2025–2035, in percent. Shrinking industries on the left,
  fastest growing on the right.
- **y, front to back: size.** The active size setting (Jobs: employment 2025;
  Value added: BEA 2025). Smallest industries nearest the viewer, largest at
  the back. In the 2D views "back" is the top of the map.
- **Real values, compressed.** Size on a log scale. Growth on a linear scale
  clipped at the 5th and 95th percentile of each level; an industry beyond the
  clip sits at the edge and its label or details say so (for example
  "+153%, beyond the scale").
- **Nudged by sector.** Every level is placed on the axes, but each Level 1
  industry is pulled part of the way toward its sector's position, and each
  deep: node toward its Level 1 parent:
  `position = (1 - pull) * own + pull * parent` with `pull` in config
  (start at 0.3). This keeps some neighbourhood without hiding the axes.
- Height still shows size (v2 §5.2), so tall hills sit at the back and do not
  hide the small ones in front.

### 3.2 Crowding
Industries with nearly the same growth and size would stack. After placing, a
separation pass pushes overlapping hills apart to a minimum distance per level
(config), moving each as little as possible, deterministically. The layout
report lists the largest moves in axis units (percentage points of growth,
factor of size) so the owner can see how far the picture strays from the data.

### 3.3 Size setting
Because y follows the active size measure, positions are computed per size
setting (as the height grids already are). Switching Jobs / Value added moves
the hills; the viewer animates the move rather than jumping.

### 3.4 Reading the axes
- 3D Sectors: lettering laid into the ground along the front edge
  ("SHRINKING ← → GROWING", with two or three growth ticks) and along one side
  ("SMALLER" at the front, "LARGER" toward the back), in the same stone-white
  lettering as the hill names.
- 2D views: proper axes in the map margins, with ticks in percent growth and in
  jobs (or dollars) on the log scale, drawn in the panel's colours.
- The About text and the panel hint describe the axes; "similar industries sit
  near each other" is removed. Similarity is no longer what position means; the
  "Most similar industries" list in the details panel stays.

### 3.5 Pipeline
A new layout stage (`imap layout`, replacing `layout_joint` as the default; the
old one stays callable for comparison until release) writes positions per level
and size setting. Terrain and export follow. `meta.json` records the axis
scales, clip values and `pull`, so the viewer draws ticks from the data, not
from constants. Deep: node growth comes from the source its size comes from; if
it is estimated, it is marked ≈ like other estimates.

## 4. Industries: a 2D topographic map

### 4.1 Why
Sectors are 20 hills and read well in 3D. Industries are about 300, and in 3D
most names collide or hide behind hills. A top-down map has no occlusion, room
for every label at some zoom, and a long tradition of showing height clearly.

### 4.2 View
- Same height grid as 3D, seen straight down (orthographic), rendered in the
  same canvas so switching levels is a camera move, not a page change.
- Classic topographic look: elevation tints (hypsometric, low green to high
  buff and pale brown), contour lines at a fixed interval with every fifth
  heavier (index contours), soft hill shading from the north-west, a paper
  background, and a neat border with the axes in the margin (3.4).
- Pan and zoom like a map (drag, wheel, pinch); no orbit. Zooming out past the
  Industries range returns to the 3D Sectors view.
- Day and Night both exist: Night uses a dark paper and lighter contours.

### 4.3 Labels
- Names placed like a map: centred on each hill's summit, uppercase small
  capitals for large industries and mixed case for small ones, a light halo for
  legibility, and no boxes.
- A greedy placer runs largest first (career industries before all others):
  a label is shown only where it does not overlap one already placed; a label
  that does not fit is tried at a few nearby offsets, then hidden. Zooming in
  reveals more. Long names wrap to two lines and may be shortened (with the full
  name on hover and in the panel).
- Hovering a hill shows its name in the same style and lights its contours
  (the 2D form of the v2 hill glow).

### 4.4 Career: rainbow contour bands
- Each touched industry's hill is drawn with its elevation bands in rainbow
  colours (violet at the foot through to red at the summit), over its own
  ground only (the same ownership rule as the v2 flowers). Untouched hills keep
  the plain map tints.
- The whole touched hill is coloured, down to a fifth of its own height (owner,
  2026-11-13; colouring only the career's share from the summit down was built
  and was nearly invisible at full view).
- The panel keeps the career list and bars; at this level the bars use the same
  rainbow so the panel reads as a legend.

## 5. Deep zones: an ocean

### 5.1 View
- 2D like Industries, with a sea-chart look: deep blue water, depth tints,
  isobaths (depth contours) in pale blue, a light chart grid, and labels in an
  italic chart style.
- Size is drawn as depth: the largest categories are the deepest water. This
  inverts the land picture on purpose ("deep zones"); the owner confirms it in
  Phase 3. Industries outside a deep zone appear as shallower water with their
  Level 1 names, as today they appear as Level 1 hills.
- Axes and labels as 4.3, in the ocean palette.

### 5.2 Career: schools of fish
- Over each touched area, small fish drawn as sprites swim in loose schools
  that stay over that area's water. The number of fish follows the area's share
  of the career (as flower coverage did).
- Motion is gentle and cheap (a simple flocking rule bounded to the area), and
  stops when the visitor prefers reduced motion; the fish then rest in place.

## 6. Moving between views
- Sectors (3D) → Industries (2D): the camera tilts down to straight overhead and
  the hills flatten into the map as the topographic style fades in; Deep zones
  cross-fades land into water. The reverse on the way back.
- The header's Sectors / Industries / Deep zones control and zoom both drive
  it, as now. The career step-down (choosing a touched sector) lands in the 2D
  Industries map framed on that sector's industries.
- Without WebGL: unchanged (v2 §4, the lists still work).

## 7. Performance
- Frame time at each level is no worse than the v2 Level 2 figure.
- Contours and tints are computed in a shader from the height grid (no
  per-frame CPU work); labels are placed on zoom and pan end, not every frame.

## 8. Privacy and publishing
v2 §9 stands. v3 is built on the `v3` branch; `main` (the live site) is not
touched until the owner says to release.

## 9. Open questions for the owner

1. **Axes** (3): accept after seeing the Phase 1 prototype, including the
   clip, `pull` and how far the separation pass moves things.
2. **Size setting moves the map** (3.3): keep, or fix y to Jobs in both
   settings.
3. **Rainbow coverage** (4.4): whole hill (decided 2026-11-13).
4. **Size as depth** (5.1): confirm the inverted ocean, or draw large
   categories as shallows and islands instead.

## 10. Out of scope for v3
As v2 §11, plus: a 2D view for Sectors; changing the footprint format; more
deep zones.
