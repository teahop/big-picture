# The Big Picture

*Visualizing a career*

A 3D terrain of American industries and research fields, built only from public
data, that a person can place a career on.

This is version 2, in progress on the `v2` branch. The live site still runs v1
until the v2 release step.

## What exists now

- **One terrain:** US industries and research fields raise one surface; height is
  size. Each type is scaled so the largest sector and the largest field peak at the
  same height, and colour shows how much of each place is industry or research.
- **Two size settings:** Activity (jobs from the BLS Employment Matrix 2025, US
  publications from OpenAlex) and Dollars (BEA value added 2025, NSF HERD FY 2024
  university R&D). An emphasis control fades one type without changing heights.
- **Shared layout:** nearby things are similar.
- **Three levels of detail:** sectors and fields, detailed industries and
  subfields, then research topics and a few hand-built deep zones.
- **Private footprint (local only):** its control is hidden while it is rebuilt
  for the one terrain (next step). It is never published.

Without WebGL the page shows a one-line message and the searchable node lists.

## Planned for v2

1. A clearer footprint: touched areas highlighted, with steps down into finer levels.
2. Add your CV: a visitor gets a footprint from a CV in the browser. Nothing is
   stored or sent.
3. Download one JPG of the map and footprint.

Removed from v1: the "where next" score, the pay, mission and geography toggles,
the 2D contour map, the footprint centroid marker and the four layer modes.

Personal data never enters this repository. See `SPEC.md` and `CLAUDE.md`.

Status and build order: `PLAN.md`. Design: `SPEC.md`. The v1 documents are in
`docs/v1/`.

## Setup

```
scripts/setup.sh          # install the pre-commit hook (once per clone)
cd pipeline && uv run imap --help
cd web && npm install && npm run dev
```

## Publishing

The site is a static build of `web/` from the tracked public bundle in `data/public/`
(`cd web && npm run build`). `.github/workflows/pages.yml` builds and deploys it to
GitHub Pages on a push to `main`, and refuses to deploy a build that holds anything
other than that bundle. The footprint control appears only on a local machine that
has the private files; the published site shows the base map only.
