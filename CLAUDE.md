# CLAUDE.md — The Big Picture (repo: big-picture)

Read `SPEC.md` (what and why) and `PLAN.md` (order and status) before any work.
Work one phase at a time using the matching file in `handoffs/`.
These describe v3. The finished v2 documents are in `docs/v2/` and v1 in `docs/v1/`;
`SPEC.md` refers to them for everything v3 does not change.

## Hard rules

1. **This repo is public. Personal data is local only.**
   - `Personal Data/` and `private/` are git-ignored and must stay that way.
   - Never copy names, employers of contacts, messages, emails, compensation
     details or anything from `Personal Data/` into a tracked file, a commit
     message, a test fixture, a log that is committed, or `web/`.
   - Before every commit run `git status --short` and confirm no path under
     `Personal Data/` or `private/` is staged. The pre-commit hook from Phase 0
     enforces this; do not bypass it with `--no-verify`.
   - Examples and fixtures use synthetic people only.
2. **Verify data sources, do not assume them.** Agency file names, API
   parameters and release versions change. Before writing a loader, fetch the
   current documentation or file listing and record the exact URL, release and
   retrieval date in `data/SOURCES.md`. If a source in the spec is unavailable
   or changed, stop and report the options rather than substituting silently.
3. **Do not hand-edit generated outputs.** Change the code and re-run.
4. **Stop at each phase's acceptance checks.** Report results, update the status
   table in `PLAN.md`, and wait for the owner before starting the next phase.
5. **Ask before any step that publishes.** Enabling GitHub Pages, changing
   repo visibility, renaming the repo, or pushing `main` (which redeploys the
   live site) needs an explicit yes in that session. v3 work stays on the `v3`
   branch until the release step.
6. **A visitor's CV is read by a model through the site's own proxy, and nothing
   is kept.** The CV text goes only to the proxy, which forwards it to the model
   provider (OpenAI) and stores nothing; the page writes nothing to browser
   storage or the URL; the API key lives only in `.env` and the proxy's secrets,
   never in the browser bundle. Fixtures for the CV flow are synthetic; the
   owner's CV is never one. (Changed by the owner on 2026-11-11 from "never
   leaves the browser".)

## Layout

```
SPEC.md  PLAN.md  CLAUDE.md  README.md
handoffs/            one kickoff prompt per v3 phase
docs/v1/, docs/v2/   archived v1 and v2 spec, plan and handoffs
config/              profile.example.yaml (public schema, synthetic values)
pipeline/            Python package: ingest -> graph -> layout -> terrain -> export
data/raw/            downloaded public data (ignored)
data/interim/        intermediate tables (ignored)
data/public/         small exported JSON the viewer loads (tracked, no personal data)
data/SOURCES.md      source, release, URL, retrieval date for every dataset
web/                 static viewer (Vite + TypeScript + three.js)
Personal Data/       owner's raw inputs (ignored)
private/             derived personal outputs and profile.local.yaml (ignored)
```

## Conventions

- Python 3.11+, managed with `uv`. DuckDB and pandas for tables, networkx for
  graphs. Type hints and small pure functions; every pipeline stage is a CLI
  subcommand (`uv run imap <stage>`) that reads and writes files, so stages can
  be re-run alone.
- Every random process takes a fixed seed from `config/`.
- Each stage writes a short validation report (row counts, coverage, unmatched
  items) to `data/interim/reports/`.
- Node IDs are stable strings: `ind:<code>`, `fld:<openalex id>`, `occ:<soc>`,
  `deep:<slug>` for custom deep-zone nodes.
- Tests: `uv run pytest`. Viewer: `npm run dev` and `npm run build` in `web/`.
- Commit at the end of each phase with a message naming the phase.

## Naming

The display name is "The Big Picture", subtitle "Visualizing a career" (v2; v1
was "Industry Map"). Both live in one place, `config/site.yaml` (`display_name`,
`subtitle`), and the viewer, README title, page metadata and exported image read
from it. Code identifiers (`imap`, package and file names) stay
neutral and do not change on a rename.

## Private context

Owner-specific details (which zones to deepen, data quirks) are in `Personal Data/PROFILE_NOTES.md`. Read it; never quote it into a
tracked file.
