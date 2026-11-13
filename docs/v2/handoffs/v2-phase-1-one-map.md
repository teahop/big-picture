# v2 Phase 1 kickoff — One map

Read `CLAUDE.md`, `SPEC.md` section 5 and `PLAN.md`. Work on branch `v2`.
Layout positions may change (owner, 2026-11-10): the joint layout is being reworked so industry and research mix.

1. Terrain (`pipeline/src/imap/terrain.py`, `config/pipeline.yaml`): for each
   level and each size setting (Activity: employment with publications;
   Dollars: value added with university R&D), write one combined height grid
   and one industry-share grid. Scale each type on its own so the largest
   Level 0 industry and the largest Level 0 field peak at the same height; keep
   the v1 volume-preserving split for deeper levels. Put the scaling constants
   in the terrain output.
2. Export (`export.py`): replace the per-layer grids with the combined ones;
   record the scaling constants and the two size settings in `meta.json`.
   `nodes*.json`, `edges*.json` and `layout*.json` must stay byte-identical.
   Update the expected-file list in `.github/workflows/pages.yml` if file names
   change.
3. Viewer (`scene3d.ts`, `state.ts`, `data.ts`, `ui.ts`, `index.html`,
   `design/tokens.css`): one mesh, positive heights only. Tint by industry
   share on a two-hue ramp through a neutral middle, with tokens for light and
   dark. Remove the four layer modes and the stacked gap. Add the emphasis
   control (Both, Industry, Research) and the single size switch. Replace the
   up and down triangle marks with a square for industry and a circle for
   research everywhere they appear. Keep value added per job and R&D per paper
   as figures in the details panel only.
4. The private footprint drape will look wrong on the new surface. Hide the
   footprint control for now; Phase 2 rebuilds it.
5. Tests: equal peak height for the two largest Level 0 nodes; share grid is
   within 0..1 and is 1 over a lone industry, 0 over a lone field; rebuild is
   byte-identical.
6. Measure frame time at Level 2 with all nodes loaded and compare with the v1
   figure in `docs/v1/PLAN.md`.

Things I expect to want to adjust once I see it, so make them config or tokens
rather than constants: the two hues, how strongly a blend reads as neutral, the
relative height of the two types, and peak height overall.

Stop at the Phase 1 checks. Show me the map at each level in both size
settings, light and dark, and point out any place where the single surface
reads worse than v1 did. Wait for my decision on the design.
