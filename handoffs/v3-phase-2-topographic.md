# v3 Phase 2 kickoff — Industries as a topographic map

Read `CLAUDE.md`, `SPEC.md` sections 4 and 6 and `PLAN.md`. Work on branch `v3`.
Phase 1 must be accepted first.

1. View switch (`scene3d.ts`, or a new `map2d.ts` sharing the renderer and
   height grids): at the Industries level the camera moves to straight overhead
   and switches to an orthographic camera; controls become pan and zoom (drag,
   wheel, pinch), no orbit. Zooming out past the Industries range returns to 3D
   Sectors. Animate both ways.
2. Topographic shader on the same mesh: hypsometric tints, contour lines at a
   fixed interval with heavier index contours every fifth, hill shading from
   the north-west, paper background, neat border. Day and Night palettes as
   tokens in `style.css`. Hide the 3D-only extras (sky, clouds, sun, moon,
   wildflowers, ground lettering) in 2D.
3. Axes in the map margins with ticks from `meta.json` (percent growth; jobs or
   dollars on the log scale).
4. Label placer (`web/src/labels2d.ts`, pure and unit-tested): largest first,
   career industries first of all; place at the summit, try a few offsets,
   otherwise hide; wrap long names to two lines and shorten if needed. Run on
   zoom and pan end. Style: map lettering with a halo, no boxes. Hover shows
   the name and lights the hill's contours.
5. Career: rainbow contour bands on touched hills over their own ground (reuse
   the ownership rule in `footprintLayer.ts`). Build two coverage variants
   (whole hill; summit down in proportion to share) behind a dev switch. Panel
   bars use the rainbow at this level.
6. Career step-down from Sectors lands in 2D framed on the sector's touched
   industries.
7. Tests: no overlapping labels on the real bundle at three zoom levels; career
   labels always placed when on screen. Measure frame time.

Stop at the Phase 2 checks. Show me the map in Day and Night with the sample
career, both rainbow variants, and label counts per zoom. Wait for my choice.
