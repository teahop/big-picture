# The Big Picture — Plan (v3)

v1 is archived in `docs/v1/`, v2 in `docs/v2/` (released 2026-11-13). This plan
covers v3 as specified in `SPEC.md`.

Each phase has a kickoff prompt in `handoffs/`. Start a Claude Code session in
this folder and reference that file. Finish the phase, meet its checks, update
the table below, commit, then stop and wait for the owner.

**Branch:** all v3 work happens on the `v3` branch. Pushing `main` redeploys the
live site, so `main` stays at the v2 release until Phase 4.

## Status

| Phase | Name | Status | Notes |
|---|---|---|---|
| Prep | v3 spec, plan and handoffs | drafted 2026-11-13, awaiting owner review | v2 documents moved to `docs/v2/`. Owner chose: faster growth to the right; axes at every level, nudged by sector; real values, compressed; rainbow contour bands |
| 1 | Meaningful axes | not started | |
| 2 | Industries as a topographic map | not started | |
| 3 | Deep zones as an ocean | not started | |
| 4 | Release | not started | |

## Owner decisions (from SPEC section 9)

| Decision | Asked in | Default if no answer |
|---|---|---|
| Axes accepted (clip, pull, separation) | Phase 1 | Do not proceed to Phase 2 |
| Size setting moves the map | Phase 1 | Keep (y follows the active setting) |
| Rainbow coverage: whole hill or by share | Phase 2 | By share, matching the flowers |
| Size as depth in the ocean | Phase 3 | Depth (largest is deepest) |

## Phases

### Phase 1 — Meaningful axes
Goal: position means growth (x) and size (y) at every level, in the existing 3D
view, so the owner can judge the idea before the 2D work.
Checks:
- New layout stage writes positions per level and size setting; `meta.json`
  carries axis scales, clip values and `pull`; reruns are byte-identical.
- Unit tests: an industry with higher growth sits further right than one with
  lower growth (before separation, same parent, `pull` = 0); a larger one sits
  further back; clipped values sit at the edge.
- Layout report: largest separation moves in axis units, and how many nodes sit
  beyond the clip, per level.
- 3D Sectors shows axis lettering on the ground; Industries and Deep zones
  (still 3D in this phase) are placed on the axes.
- Switching Jobs / Value added animates the move.
- About text and panel hint describe the axes.
- `uv run pytest`, `npm test` and `npm run build` pass.
- Owner has looked at it at all three levels and accepted, or asked for changes.

### Phase 2 — Industries as a topographic map
Goal: about 300 industries readable at once, with a career shown in rainbow.
Checks:
- Industries level is top-down 2D: elevation tints, contours with index lines,
  hill shading, paper background, axes in the margin; Day and Night.
- Pan and zoom like a map; zooming out returns to 3D Sectors with a smooth
  camera move.
- Label placer: no two visible labels overlap (test on the real bundle at three
  zoom levels); career labels are never dropped for others; the count shown at
  each zoom is reported.
- Rainbow contour bands on touched hills, own ground only; at least two
  coverage variants shown to the owner, one kept.
- Hover lights a hill's contours and shows its name in the map style.
- Career step-down from Sectors lands in 2D framed on the sector's industries.
- Frame time no worse than the v2 Level 2 figure.

### Phase 3 — Deep zones as an ocean
Goal: the deepest level reads as a sea chart, with a career as schools of fish.
Checks:
- Deep zones level: water tints, isobaths, chart grid, italic chart labels,
  axes in the margin; Day and Night.
- Fish schools over touched areas only, count following share; reduced motion
  stops them.
- Land-to-water transition from Industries and back.
- Owner confirms size-as-depth or picks the shallows variant.
- Frame time no worse than the v2 Level 2 figure with fish swimming.

### Phase 4 — Release
Goal: v3 replaces v2 in public.
Checks:
- Phone layout works at all three levels (pan and zoom by touch).
- Blocklist scan of `web/dist`, tracked files and history: no hits; the Pages
  workflow's expected-file list matches the v3 bundle.
- The site works from a clean clone with no private files.
- Owner confirms; then `v3` is merged to `main` and the live site is checked.

## Risks

| Risk | Response |
|---|---|
| Axes crowd industries into a few spots | Log size, clipped growth, separation pass with its moves reported; `pull` is config |
| Losing similarity makes the map less interesting | Sector nudge keeps some grouping; "Most similar industries" stays in the panel; owner judges on the Phase 1 prototype |
| Growth outliers distort the scale | Percentile clip with "beyond the scale" shown on the node |
| 2D labels still collide | Greedy placer with zoom reveal, tested for zero overlaps on the real bundle |
| Rainbow is hard to read or garish | Only on touched hills, over plain map tints; coverage variants shown |
| Fish cost frame time | Sprites, simple bounded flocking, capped count, paused for reduced motion |
| v3 work reaches the live site early | `v3` branch; `main` untouched until Phase 4 |
