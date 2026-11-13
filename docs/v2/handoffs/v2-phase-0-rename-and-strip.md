# v2 Phase 0 kickoff — Rename and strip

Read `CLAUDE.md`, `SPEC.md` sections 2 to 4 and `PLAN.md`. This phase removes
and renames only. Do not start the one-map work.

1. Tag the last v1 commit `v1.0` (local tag; ask before pushing it). Create and
   switch to branch `v2`. Do not push `main`: it deploys the live site.
2. Name: set `display_name: "The Big Picture"` and add
   `subtitle: "Visualizing a career"` in `config/site.yaml`. Make the viewer
   header, `<title>`, meta description and README read both from there
   (`web/vite.config.ts`, `scripts/sync_title.py`). Change the `imap` CLI
   description text. Leave identifiers, the repo name and the URL alone.
3. Remove where-next: `imap score`, `score.py`, `test_score.py`,
   `web/src/score.ts`, `web/src/whereNext.ts`, the `#where-next` element, the
   `ranked` state and its map markers, the `/_private/score.json` route.
4. Remove pay, mission and geography: `geo.py`, the `oews`, `qcew` county and
   `openalex-geo` ingest paths that only they used, the mission-tag save route
   in `vite.config.ts`, and the `where_next` and `mission_tags` blocks of
   `config/profile.example.yaml`. Before deleting any ingest, check what else
   reads its output: the deep-zone build and the value-added split use QCEW and
   must keep working.
5. Remove the 2D map: `web/src/map2d.ts`, `#view-2d`, the view switch. Without
   WebGL, show a one-line message and keep the node lists usable.
6. Remove the centroid marker and its caveat. Leave the footprint drape and the
   layer modes as they are; Phases 1 and 2 replace them.
7. `data/SOURCES.md`: mark the sources no longer used as "retired in v2" rather
   than deleting their rows. Update `README.md` to describe v2 honestly (what
   exists now, what is planned).
8. Private files under `private/` for the removed features (score, pay,
   geography) are the owner's: list them and ask before deleting any.

Stop at the Phase 0 checks in `PLAN.md`. Show me the renamed viewer running
locally and the list of what was removed.
