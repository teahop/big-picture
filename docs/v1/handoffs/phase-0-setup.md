# Phase 0 kickoff — Setup and guards

Read `CLAUDE.md`, `SPEC.md` and `PLAN.md` first. Then do only this phase.

1. Confirm tools: `git`, `gh` (signed in as `teahop`), `uv`, Node 20+. If any is
   missing, stop and tell me what to install.
2. `git init` in this folder (branch `main`). Before the first commit, show me
   `git status --short` and confirm nothing under `Personal Data/` or `private/`
   appears.
3. Add a pre-commit hook (tracked in `scripts/hooks/`, installed by a setup
   script) that:
   - rejects any staged path under `Personal Data/` or `private/`;
   - rejects staged content containing any line from
     `private/blocklist.txt` when that file exists.
   Generate `private/blocklist.txt` locally from the full names in the
   connections export. Prove the hook works with a throwaway staged file, then
   unstage it.
4. Scaffold `pipeline/` as a `uv` project exposing an `imap` CLI with stub
   subcommands: `ingest`, `graph`, `layout`, `terrain`, `export`, `personal`,
   `score`. Add `pytest`.
5. Create `config/site.yaml` with `display_name: "Industry Map"`; nothing else
   may hard-code the project name.
6. Scaffold `web/` with Vite, TypeScript and three.js showing an empty scene.
7. Create `data/SOURCES.md` with one row per source in SPEC section 4. For each,
   find the current official download or API page and record URL, release and
   today's date. Do not download bulk data yet. Flag anything that differs from
   the spec.
8. Write `private/data_inventory.md`: for each file in `Personal Data/` that the
   spec uses, its columns, row count and any parsing quirk. Start from
   `Personal Data/PROFILE_NOTES.md`. Do not read message contents.
9. Create `private/profile.local.yaml` from `config/profile.example.yaml`, filled
   from `PROFILE_NOTES.md`.
10. Create the GitHub repo `teahop/industry-map` as **public** with `gh repo
   create`, push, and show me the file list on GitHub so I can confirm it is
   clean.

Stop when the Phase 0 checks in `PLAN.md` pass. Report and update the status
table.
