# Phase 1 kickoff — Coarse industry terrain and viewer skeleton

Read `CLAUDE.md`, `SPEC.md` sections 3 to 6 and 10, and `PLAN.md`. Do only this
phase. No personal data is needed or allowed here.

1. `imap ingest bls-matrix`: download the BLS National Employment Matrix
   recorded in `data/SOURCES.md`. Check the file layout against BLS
   documentation before parsing. Produce tidy tables: industries (with NAICS
   code, level, parent), occupations, and industry-by-occupation employment for
   the base and projected years.
2. Aggregate to NAICS sectors (Level 0). Reconcile totals with the published
   total; report the difference.
3. If BEA value added by industry is straightforward to load at sector level,
   add it as a second size measure. If not, note why and defer to Phase 3.
4. `imap graph`: sector-to-sector similarity as cosine of occupation-share
   vectors.
5. `imap layout`: seeded metric MDS or force layout for sectors only. This is a
   provisional layout; Phase 2 replaces it with the joint layout. Write
   positions to a tracked file.
6. `imap terrain`: height grid per SPEC 6.4, industry layer only.
7. `imap export --target public`: write `data/public/` JSON (nodes, edges,
   grids, metadata with source releases).
8. Viewer: render the industry mesh with orbit controls, node labels, hover
   details (label, employment, projected growth) and a search box. Include the
   2D top-down fallback.

Sanity pairs (closer than the median pair distance): Health care with
Educational services; Finance with Professional and technical services;
Manufacturing with Wholesale trade. Tell me if any fails and why.

Stop at the Phase 1 checks. Send me a screenshot and the reconciliation report.
