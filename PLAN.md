# The Big Picture — Plan (v2)

v1 (Phases 0 to 6) is finished and archived in `docs/v1/`. This plan covers v2
as specified in `SPEC.md`.

Each phase has a kickoff prompt in `handoffs/`. Start a Claude Code session in
this folder and reference that file. Finish the phase, meet its checks, update
the table below, commit, then stop and wait for the owner.

**Branch:** all v2 work happens on the `v2` branch. Pushing `main` redeploys the
live site, so `main` is not touched until Phase 4.

## Status

| Phase | Name | Status | Notes |
|---|---|---|---|
| Prep | v2 spec, plan and handoffs | drafted 2026-11-10, awaiting owner review | v1 documents moved to `docs/v1/`. Committed on branch `v2` |
| 0 | Rename and strip | done 2026-11-10, accepted by owner | `v1.0` tag on afe0ef1 (local, not pushed). QCEW helpers moved to `qcew.py` for the value-added split. Presence diffusion (halo) and the layer modes stay until Phases 1 and 2 |
| 1 | One map | done 2026-11-10, accepted by owner (industry-only terrain) | Research fields removed (owner). Heights from each industry's own size (square root, tallest peak wins). Industry layout from distinctive occupations plus text; Level 1 may leave its sector. Footprint control hidden until Phase 2 |
| 2 | Clear footprint | reworked 2026-11-11 after owner review; awaiting owner check | Wildflowers on rolling hills to every edge, blue sky and moonlit night. Career labels placed without overlap (stems to their hills), others on hover. Green panel, Day/Night toggle, Hide panel link, search removed, network removed |
| 3 | Add your CV | not started | |
| 4 | Download and release | not started | Publishing needs an explicit yes |

## Owner decisions (from SPEC section 10)

Each is asked in the phase where it matters; none blocks Phase 0.

| Decision | Asked in | Default if no answer |
|---|---|---|
| One-map design accepted | Phase 1 | Do not proceed to Phase 2 |
| Footprint treatment | Phase 2 | Do not proceed to Phase 3 |
| Connections layer kept (private only) | Phase 2 | Removed by owner 2026-11-11 |
| Sample synthetic footprint on the public site | Phase 3 | Yes |
| Own footprint in public | Phase 4 | No |
| Rename repository and URL | Phase 4 | Leave as `industry-map` |

## Carried over from v1 (not blocking)

- `data/mappings/deep_headcounts.csv`: organisation headcounts behind the deep
  zone size estimates are still open to correction.
- Private: the education mapping and presence weights were left to confirm at
  the end of v1 Phase 4. Phase 2 uses them, so confirm them there.
- The v1 to-dos about where-next, pay and geography are closed by removal.
- Research fields were removed in Phase 1. Phase 2 re-targeted degrees to
  industries (CIP -> SOC -> industry, SPEC 7.3) and dropped skills from the
  footprint (entries are roles and degrees only).

## Phases

### Phase 0 — Rename and strip
Goal: the same v1 map under the new name, with the removed features gone.
Checks:
- `v1.0` tag exists on the last v1 commit; work is on branch `v2`.
- Header, page title, description and README read "The Big Picture" and
  "Visualizing a career" from `config/site.yaml`; no other file hard-codes them.
- No code, control, config key or test remains for where-next, pay, mission,
  geography, the 2D map or the centroid (search the tree for each).
- `uv run pytest` and `npm run build` pass.
- `nodes*.json`, `edges*.json` and `layout*.json` in `data/public/` are
  byte-identical to v1.
- Viewer runs locally with the remaining controls working.

### Phase 1 — One map
Goal: one industry terrain that reads honestly (research shows through industries).
Checks:
- One mesh; one height grid per level and size setting (Activity, Dollars).
- Heights follow each industry's own size; no point is taller than its tallest
  industry (`combine: max`); an only child never towers over larger industries.
- No research nodes, edges or sources in the public bundle.
- Similar industries stay together at least as well as in v1 (layout report).
- Size switch works; frame time at Level 2 is no worse than v1.
- Owner has looked at it and accepted the design, or asked for changes.

### Phase 2 — Clear footprint
Goal: the owner can read their own footprint at a glance and step into it.
Checks:
- The private pipeline writes the entry format of SPEC 6.1; the public bundle
  is byte-identical with and without personal inputs.
- Weights roll up: for every touched parent, weight equals the sum of its
  children's (unit test, synthetic person).
- With the footprint on: untouched terrain recedes, touched Level 0 areas are
  outlined and labelled with shares, and the panel lists them.
- Step-down works from map and list through Level 1 to Level 2, with a
  breadcrumb back.
- Selecting a touched node shows the entries behind it.
- At least two visual variants were shown; the owner picked one and the other
  is removed. (Done: Wildflowers kept, Outline removed.)

### Phase 3 — Add your CV
Goal: a visitor gets a footprint from a CV without any data leaving the page.
Checks:
- Lookup sources verified and recorded in `data/SOURCES.md` before loaders are
  written; lookup files are within the size budget set in the handoff.
- Three synthetic CVs (PDF and pasted text) each reach a drawn footprint; the
  manual form alone also does.
- On the synthetic set, the correct Level 1 industry is among the offered
  guesses for most roles and for most degrees (targets in the
  handoff); misses are reported, not hidden.
- Browser test: after a CV is chosen, no network request leaves the page, and
  `localStorage`, `sessionStorage`, IndexedDB, cookies and the URL are
  unchanged.
- Content-Security-Policy restricts connections to the site's own origin.
- The page states the privacy promise and the limits in SPEC 7.4.

### Phase 4 — Download and release
Goal: one JPG download, then v2 replaces v1 in public.
Checks:
- The download produces one JPG with the map, footprint, name, subtitle,
  touched-area list, legend and site address; correct in light and dark; works
  in current Chrome, Safari and Firefox.
- The image is produced without any network request.
- Phone layout: the CV flow and the download are usable at phone width.
- Blocklist scan of `web/dist`, tracked files and history: no hits. The Pages
  workflow's expected-file list matches the v2 bundle.
- The site works from a clean clone with no private files.
- Owner confirms; then `v2` is merged to `main`, the live site is checked, and
  the repository rename is done only if separately confirmed.

## Risks

| Risk | Response |
|---|---|
| Research is less visible without fields | It shows through industries (higher education, scientific R&D); owner decision 2026-11-10 |
| The footprint is still unclear | Discrete touched set, receding background, list with shares; decided on working variants, not on paper |
| CV parsing is unreliable | The confirm step is the design, not a fallback; a manual form always works |
| Company-to-industry guesses are poor without a server | Organisation list plus job-title ranking, alternatives offered, search over all nodes; report hit rates on synthetic CVs |
| A visitor's CV leaks | No backend, origin-only CSP, no storage, automated no-network test |
| Personal data reaches the public repo | v1 guards unchanged; synthetic fixtures only |
| v2 work reaches the live site early | `v2` branch; `main` untouched until the release step |
| Lookup files make the page slow | Size budget; load them only when the CV flow opens |
