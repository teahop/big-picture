# Phase 4 kickoff — Personal overlay

Read `CLAUDE.md` (privacy rules), `SPEC.md` sections 7 and 9, `PLAN.md`, and
`Personal Data/PROFILE_NOTES.md`. Everything this phase produces from personal
inputs goes to `private/`. Tracked code and tests use synthetic fixtures only.

1. `imap personal roles`: load the role history table. Parse dates and
   durations to months; send anything ambiguous to
   `private/review_roles.csv`. Apply the umbrella rule. Propose industry and
   occupation mappings with shares; write them to the review file and wait for
   my corrections.
2. `imap personal connections`: start from the owner's normalised connections
   table and company index (reuse tie strength; do not recompute from
   messages). Classify each distinct company to a node, cache with confidence in
   `private/company_nodes.csv`, and give me the 50 highest-count companies plus
   all low-confidence ones to review.
3. `imap personal skills` and `education`: map by embeddings and CIP.
4. Presence per SPEC 7.3, with diffusion. Write footprint grids to `private/`.
5. Viewer: load a private bundle only if present; footprint drape; tenure,
   connections and skills sub-footprints; centroid marker with its caveat.
6. Tests with synthetic people: umbrella rule, recency decay, connection
   weighting. Prove the public export is identical with and without
   `Personal Data/` present.

Stop at the Phase 4 checks. Show me the footprint and the unmapped list.
