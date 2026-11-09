# Industry Map

A terrain map of American industry and research fields that a person can place
themselves on.

- **Industry layer:** peaks, sized by employment (value added as an alternative).
- **Research layer:** valleys, sized by publication volume (R&D dollars as an alternative).
- **Shared layout:** both layers use one coordinate space, so a location means the
  same thing in each. View either alone, stacked, or overlaid.
- **Personal overlay:** a footprint computed from tenure, skills and connections,
  plus a "where next" score with pay, mission and geography toggles.

Personal data never enters this repository. See `SPEC.md` section 9.

Status and build order: `PLAN.md`. Full design: `SPEC.md`.

## Setup

```
scripts/setup.sh          # install the pre-commit hook (once per clone)
cd pipeline && uv run imap --help
cd web && npm install && npm run dev
```
