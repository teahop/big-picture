# Industry Map — Plan

Each phase has a kickoff prompt in `handoffs/`. Start a Claude Code session in
this folder and paste or reference that file. Finish a phase, meet its checks,
update this table, commit, then stop.

## Status

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Setup and guards | done (2026-11-09), awaiting owner OK | Hook proven; scaffolds run; SOURCES.md has spec differences to review (O*NET 31.0, OpenAlex key rule, BEA bulk file, Reliance on Science is non-commercial) |
| 1 | Coarse industry terrain and viewer skeleton | done (2026-11-09), awaiting owner OK | Reconciles exactly (sectors + self-employed = published total). Health care to Educational services fails the similarity-space sanity pair (passes in the layout). BEA value added deferred to Phase 3, so no size switch yet. Self-employed left off the map |
| 2 | Coarse research layer, bridge, shared layout | done (2026-11-09), awaiting owner OK | Counts match OpenAlex exactly. CIP mapping owner-reviewed; all 5 bridge sanity pairs pass. In the joint layout Finance and Professional services sit farther apart than the median sector pair, and Economics ranks Finance 6th by layout distance. HERD mapping owner-reviewed; Energy R&D is an estimate (about $1.07B from general engineering lines); Veterinary has no HERD source |
| 3 | Deepen: Level 1 everywhere, Level 2 in deep zones | done (2026-11-09), awaiting owner OK | Level 1 (304 industries, 250 subfields), Level 2 research topics (501) and 43 estimated `deep:` industry nodes (owner-reviewed categories). Level 0 unchanged; children inside radius; deep nodes reconcile with their BLS parents to 1e-13; rebuild is byte-identical; Level 2 frame time 1.6 ms (all 1,107 nodes loaded). Open for the owner: deep-to-topic links, the headcount table, and 3 weak proxies (see notes below) |
| 4 | Personal overlay | built (2026-11-09), awaiting owner review | `imap personal roles/connections/skills/education/presence` write only to `private/`; viewer footprint (all, tenure, connections, skills), centroid marker with caveat, local-only route for the private bundle. Public bundle byte-identical with and without personal inputs. Owner reviewed the role mappings (no changes) and every company with more than one contact (3 corrections, rest accepted). Contact coverage stays at 52% by count (target 90%): owner accepts that single-contact companies too small to show may stay unmapped. Education degrees and presence weights still to confirm |
| 5 | Where-next scoring and toggles | not started | |
| 6 | Polish and publish | not started | |

## Before Phase 0 (owner)

- Install and sign in to the GitHub CLI (`gh auth login`) as `teahop`.
- Install `uv` and Node 20+.
- Create an OpenAlex API key (needed from Phase 2) and put it in `.env`.
- Review `Personal Data/PROFILE_NOTES.md`, especially the proposed deep zones.

## Owner review to-do (deferred, not blocking)

- ~~`data/mappings/field_to_cip.csv`~~: reviewed by the owner 2026-11-09 (180 of 208 proposed rows accepted).
- ~~`data/mappings/herd_to_openalex.csv`~~: reviewed by the owner 2026-11-09 (Veterinary moved out of Health sciences, Communication mapped to Computer Science). Three Energy rows are an estimate (split of Electrical, Mechanical, Engineering nec) and stay `reviewed=no`. Veterinary now has no HERD source ($0); decide whether Agricultural sciences should also feed it.
- Phase 1: Health care and Educational services fail the occupation-similarity sanity pair; owner considers them related (care sectors), so left as is.

- ~~`data/mappings/deep_categories.yaml`~~: categories and proxies reviewed by the owner 2026-11-09, no changes. The machine-readable `calc:` and `parent:` keys added at build time are not yet reviewed.
- `data/mappings/deep_headcounts.csv`: organisation headcounts behind the headcount-share proxies (about 20 organisations have none; many are third-party estimates; Accenture, IBM and Deloitte figures are global or unconfirmed and dominate the consulting split). Owner may correct any row; rerun `uv run imap deep`, then layout, terrain and export.
- Phase 4 (all in `private/`, details in the Phase 4 report): `role_corrections.csv` (role dates and node shares), `company_corrections.csv` (company to node), the umbrella-overlap rule, the education degrees and CIP proposals and the presence parameters in `profile.local.yaml`.
- `data/interim/reports/deep_topic_links.md`: top embedding links from each `deep:` node to Level 2 research topics (local report; the viewer marks them unreviewed).
- `config/deep_zones.yaml`: which subfields and industries are deepened. Public file: it shows which zones were chosen.

## Phases

### Phase 0 — Setup and guards
Goal: a public repo that cannot leak personal data, and an inventory of inputs.
Checks:
- `git status` shows nothing under `Personal Data/` or `private/`.
- Pre-commit hook rejects a test commit that stages a file under `private/`.
- `uv run imap --help` and `npm run dev` both work on empty scaffolds.
- `data/SOURCES.md` exists with one row per source in SPEC section 4.
- Private data inventory report written to `private/`.

### Phase 1 — Coarse industry terrain and viewer skeleton
Goal: about 20 sectors as peaks in the browser, end to end.
Checks:
- Sector employment totals reconcile with the source total within 1%.
- Similar sectors sit closer than dissimilar ones (named pairs in the handoff).
- Viewer renders the mesh, labels, hover details; size switch works if value
  added is loaded.
- Layout file is tracked and a second run reproduces it exactly.

### Phase 2 — Coarse research layer, bridge, shared layout
Goal: 26 fields as valleys in the same space, linked to sectors.
Checks:
- Field work counts match OpenAlex totals for the same filter.
- Field-to-CIP mapping table exists, reviewed, tracked.
- Bridge sanity pairs rank in the top 3 for their field.
- Viewer shows the four layer modes; neither mesh affects the other's height.

### Phase 3 — Deepen
Goal: Level 1 everywhere; Level 2 in the owner's deep zones.
Checks:
- Level 0 positions unchanged to within tolerance after deepening.
- Children stay within their parent's radius.
- Estimated `deep:` nodes are visibly marked and list their size proxy.
- Frame rate acceptable with all nodes loaded (target 30 fps on a laptop).

### Phase 4 — Personal overlay
Goal: footprint from tenure, connections and skills, private only.
Checks:
- Every role and at least 90% of connections (by count) map to a node; the rest
  are listed in a private review table.
- No month is counted twice under the umbrella rule (unit test with synthetic
  data, plus a private reconciliation of total months against career length).
- Owner has reviewed role mappings and the 50 highest-count companies.
- Public export is byte-identical with and without personal data present.

### Phase 5 — Where-next scoring and toggles
Goal: ranked candidates with explanations; pay, mission and geography toggles.
Checks:
- Each candidate shows its component breakdown.
- Each toggle changes the ranking in the expected direction on a synthetic
  profile test.
- Owner reads the top 20 and marks which are sensible; weights tuned once.

### Phase 6 — Polish and publish
Goal: a public static site of the base map, published only on confirmation.
Checks:
- Automated scan of `web/dist` finds no string from the private blocklist.
- Site works from a clean clone with no private files.
- Accessibility pass: keyboard navigation of the node list, readable contrast,
  2D fallback.
- Owner confirms, then GitHub Pages is enabled.

## Risks

| Risk | Response |
|---|---|
| Personal data reaches a public repo | Ignore rules, pre-commit hook, blocklist scan, public export built without reading private inputs |
| Research-to-industry bridge is weak or noisy | Three independent signals, sanity pairs, per-link explanation, hand-reviewed mapping at coarse level |
| Deepening a zone reshuffles the map | Anchored hierarchical layout with frozen parents |
| Official taxonomies are too coarse in the owner's zones | Custom `deep:` nodes, marked as estimated |
| Company-to-industry classification errors | Cache with confidence, hand review of the highest-count companies, corrections never overwritten |
| A data source changes format | Loaders verify against documentation first and stop on mismatch |
