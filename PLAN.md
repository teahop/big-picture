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
| 1 | Meaningful axes | done 2026-11-13, accepted by owner 2026-11-13 | `imap layout` now places by growth (5th-95th percentile clip) and log size (5th percentile low clip), pull 0.3, per size setting; `--method joint` keeps the v2 layout. Separation moves at most 0.65 pp growth and size x1.3 (Level 0). Similarity score falls to 0.38 (Level 0, chance 0.32) and 0.14 (Level 1, chance 0.05); v2 was above 0.6. The seven largest sectors share the back quarter under Jobs; untouched sector names that would overlap now show on hover only. Animated Jobs/Value added slide. Owner review rounds: axes became two hand-lettered card signs (GROWING right; LARGER front middle), hill names curve around each hill (two lines when long, bold with a drop shadow) and show only where fully in sight on their own ground, floating labels only on hover, rounder hills (stretch 1.6), camera at about 40 degrees |
| 2 | Industries as a topographic map | done 2026-11-13, accepted by owner 2026-11-13 | Industries (and, until Phase 3, Deep zones) are a top-down topographic map: hypsometric tints, contours with index lines, hill shading, neat border, axes in the margins (growth %, jobs or dollars on a log scale), Day and Night. Camera tilts down from 3D, then pan and zoom; zooming out returns to Sectors. Label placer: no overlaps and career names always placed (tested on the real bundle at 3 zooms; 64 of 304 names at zoom 1). Hover lights a hill and turns its contours red. Rainbow bands violet (foot) to red (top) on career hills; owner chose whole hill 2026-11-13 (by share was nearly invisible at full view; removed). Career step-down lands framed in 2D. Frame time with labels re-placed every frame (panning): 1.2 ms Level 1, 1.7 ms Level 2 incl. GPU wait (v1 Level 2: 1.6 ms CPU); under 0.1 ms when still |
| 3 | Deep zones as an ocean | removed by owner 2026-11-13 | Built (sea chart, shallows and islands, schools of fish) and reviewed, then the owner removed the deep zones entirely: the deep stage, its config and mappings, Level 2 layout, terrain and export, the Deep zones control, ocean and fish. Former `deep:` footprint entries fold into their industries (`data/mappings/deep_folded.csv`); the private footprint was rebuilt. The CV Worker must be redeployed at release (it still lists deep ids) |
| 4 | Release | checks done 2026-11-14, awaiting owner's yes to deploy | Phone (375 px): both levels fit with no sideways scroll; 2D names keep clear of the axis strip and the growth axis shortens on narrow screens; the CV dialog fits. README and About updated for v3. Blocklist scan (1,668 terms) of the build, tracked files and paths, and full history of all branches: 0 hits. Clean clone (no private dirs) builds; the Pages guard passes (11 expected data files, no key or provider call). Built site contacts only itself (CSP: self and the CV Worker), storage empty. Still to do, each only with the owner's yes: redeploy the CV Worker from v3, then fast-forward v3 into main and push |

## Owner decisions (from SPEC section 9)

| Decision | Asked in | Default if no answer |
|---|---|---|
| Axes accepted (clip, pull, separation) | Phase 1 | Do not proceed to Phase 2 |
| Size setting moves the map | Phase 1 | Keep (y follows the active setting) |
| Rainbow coverage: whole hill or by share | Phase 2 | Whole hill (owner, 2026-11-13) |
| Deep zones | Phase 3 | Removed (owner, 2026-11-13) |

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
- Phone layout works at both levels (pan and zoom by touch).
- The CV Worker is redeployed from v3 (only with the owner's yes), so the model
  no longer offers the removed deep ids.
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
