# v3 Phase 1 kickoff — Meaningful axes

Read `CLAUDE.md`, `SPEC.md` section 3 and `PLAN.md`. Work on branch `v3`.

1. Data check first: confirm that every node at every level has projected
   growth and both size measures in the current public bundle, and where
   deep: node growth comes from. Record anything estimated. If a value is
   missing, stop and report the options.
2. Layout (`pipeline/src/imap/layout_axes.py`, `config/pipeline.yaml`): for each
   level and size setting, x from growth (linear, clipped at the 5th and 95th
   percentile of the level), y from log size (largest at the back, which is the
   smaller layout y if the viewer keeps the camera at +y; check `scene3d.ts`
   `local()` and match it). Then `pull` toward the parent (sector for Level 1,
   Level 1 parent for deep:), then a deterministic separation pass to a minimum
   distance per level. Make the clip percentiles, `pull` and minimum distances
   config. Keep `layout_joint` callable for comparison.
3. Terrain and export: positions per size setting; heights unchanged.
   `meta.json` gets the axis scales, clip values and `pull`. Update the Pages
   workflow's expected-file list if file names change.
4. Report (`data/interim/reports/`): per level, nodes beyond the clip, the ten
   largest separation moves in percentage points and size factor.
5. Viewer: read positions for the active size setting; animate the move when
   it changes. In 3D Sectors, lay axis lettering into the ground along the front
   ("SHRINKING ← → GROWING" with ticks from `meta.json`) and along one side
   ("SMALLER" front, "LARGER" back), reusing `grassLabel.ts`. Industries and
   Deep zones stay 3D in this phase, placed on the axes.
6. Text: update the About dialog and the panel hint to describe the axes;
   remove "similar industries sit near each other". Keep the "Most similar
   industries" list.
7. Tests: ordering by growth and by size with `pull` = 0 before separation;
   clipped values at the edge; rerun byte-identical.

Make these easy to change rather than constants: clip percentiles, `pull`,
minimum distances, and the axis lettering's size and placement.

Stop at the Phase 1 checks. Show me all three levels in both size settings,
Day and Night, with the layout report, and point out where the axes make the
map worse than v2. Wait for my decision.
