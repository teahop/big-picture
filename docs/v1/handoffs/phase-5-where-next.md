# Phase 5 kickoff — Where-next scoring and toggles

Read `CLAUDE.md`, `SPEC.md` section 8, `PLAN.md`, and the private profile.

1. `imap ingest oews` and `imap ingest qcew` after confirming current releases
   and layouts. Public data only.
2. `imap score`: adjacency (personalised PageRank from presence), growth, size,
   novelty; weighted sum from the private profile.
3. Toggles: pay (floor or multiplier, using wages for the person's nearest
   occupations in each industry), mission (private tags), geography (location
   quotient for the profile's metro; for research, institution share).
4. Viewer: ranked list with per-component bars and a one-line reason; markers on
   the terrain; toggle controls; a way to add or change a mission tag locally
   that writes to the private profile, never to tracked files.
5. Tests on a synthetic profile showing each toggle moves rankings as expected.

Stop at the Phase 5 checks. Give me the top 20 for review.
