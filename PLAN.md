# Industry Map — Plan

Each phase has a kickoff prompt in `handoffs/`. Start a Claude Code session in
this folder and paste or reference that file. Finish a phase, meet its checks,
update this table, commit, then stop.

## Status

| Phase | Name | Status | Notes |
|---|---|---|---|
| 0 | Setup and guards | done (2026-11-09), awaiting owner OK | Hook proven; scaffolds run; SOURCES.md has spec differences to review (O*NET 31.0, OpenAlex key rule, BEA bulk file, Reliance on Science is non-commercial) |
| 1 | Coarse industry terrain and viewer skeleton | not started | |
| 2 | Coarse research layer, bridge, shared layout | not started | |
| 3 | Deepen: Level 1 everywhere, Level 2 in deep zones | not started | |
| 4 | Personal overlay | not started | |
| 5 | Where-next scoring and toggles | not started | |
| 6 | Polish and publish | not started | |

## Before Phase 0 (owner)

- Install and sign in to the GitHub CLI (`gh auth login`) as `teahop`.
- Install `uv` and Node 20+.
- Create an OpenAlex API key (needed from Phase 2) and put it in `.env`.
- Review `Personal Data/PROFILE_NOTES.md`, especially the proposed deep zones.

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
