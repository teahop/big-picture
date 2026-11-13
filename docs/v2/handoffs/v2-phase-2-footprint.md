# v2 Phase 2 kickoff — Clear footprint

Read `CLAUDE.md` (privacy rules), `SPEC.md` section 6, `PLAN.md` and
`Personal Data/PROFILE_NOTES.md`. Work on branch `v2`. Everything produced from
personal inputs goes to `private/`. Tracked code, tests and screenshots use a
synthetic person only.

The point of this phase is that I can look at my own footprint and understand
it. Build working variants and let me choose; do not settle the look on paper.

1. Footprint format: change `imap personal presence` to write the entry list of
   SPEC 6.1 (roles and degrees with years and node shares) to
   `private/footprint.json`, from the existing reviewed role, education and
   skills mappings. Remove diffusion. Compute node weights and the touched set
   per SPEC 6.2, with the threshold and the years-per-degree value in config.
   Before I rely on it, show me the education mapping and the weights for
   confirmation (left open at the end of v1).
2. Add a tracked synthetic footprint in the same format (a made-up career) for
   tests, development and screenshots.
3. Viewer, in a new module that takes a footprint object and knows nothing
   about where it came from (Phase 3 feeds it from the browser):
   - weights and roll-up computed in the page from the entries;
   - untouched terrain recedes; touched Level 0 areas outlined and labelled
     with their share;
   - a footprint list in the side panel, largest first, with bars;
   - step-down from the map or the list: camera moves to the area, Level 1
     children appear with the touched ones highlighted, then Level 2 where the
     zone has one; a breadcrumb steps back;
   - selecting a touched node lists the entries behind it.
4. Variants: build at least two treatments of "touched" behind a temporary
   switch (for example ground outline against raised glow, and two strengths of
   fading for the rest). Show them to me on my own footprint locally.
5. Connections: keep as a separate private-only layer, off by default, unless I
   say to remove it when asked in this phase.
6. Replace the old overlay route with one that serves `private/footprint.json`
   on the dev and preview servers only. `vite build` must never include it.
7. Tests with the synthetic person: roll-up sums, threshold behaviour, recency
   decay, umbrella rule still holds. Prove again that the public bundle is
   byte-identical with and without `Personal Data/` present.

Stop at the Phase 2 checks. Walk me through my footprint at Level 0, then one
step-down to Level 1 and one to Level 2, in each variant. After I choose, delete
the variant switch and the losing treatment.
