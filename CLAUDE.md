# CLAUDE.md — Industry Map

Read `SPEC.md` (what and why) and `PLAN.md` (order and status) before any work.
Work one phase at a time using the matching file in `handoffs/`.

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
5. **Ask before any step that publishes.** Enabling GitHub Pages or changing
   repo visibility needs an explicit yes in that session.

## Layout

```
SPEC.md  PLAN.md  CLAUDE.md  README.md
handoffs/            one kickoff prompt per phase
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

"Industry Map" is a working title and will change. The display name lives in one
place, `config/site.yaml` (`display_name`), and the viewer, README title and page
metadata read from it. Code identifiers (`imap`, package and file names) stay
neutral and do not change on a rename.

## Private context

Owner-specific details (which zones to deepen, data quirks, default toggle
values) are in `Personal Data/PROFILE_NOTES.md`. Read it; never quote it into a
tracked file.
