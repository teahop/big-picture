# v3 Phase 3 kickoff — Deep zones as an ocean

Read `CLAUDE.md`, `SPEC.md` section 5 and `PLAN.md`. Work on branch `v3`.
Phase 2 must be accepted first.

1. Ocean style for the Deep zones level, reusing the 2D view: water tints by
   depth, pale isobaths with index lines, a light chart grid, italic chart
   labels through the Phase 2 placer, axes in the margin. Day and Night tokens.
2. Size as depth (largest is deepest). Build the alternative (large categories
   as shallows and islands) behind a dev switch so the owner can compare.
3. Transition: cross-fade land to water from Industries, and back.
4. Fish (`web/src/fish.ts`): small sprites in loose schools over each touched
   area's own water, count proportional to share with a total cap; simple
   bounded flocking; when `prefers-reduced-motion` is set, they rest in place.
5. Measure frame time with the fish swimming at the cap.

Stop at the Phase 3 checks. Show me the ocean in Day and Night with the sample
career, both depth variants, and the frame time. Wait for my choice.
