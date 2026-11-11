# The Big Picture

*Visualizing a career*

A 3D terrain of American industries and research fields, built only from public
data, that a person can place a career on.

This is version 2, in progress on the `v2` branch. The live site still runs v1
until the v2 release step.

## What exists now

- **Industry terrain:** peaks for US industries, sized by employment (value added
  and value added per job as alternatives). BLS Employment Matrix 2025, BEA GDP by
  Industry 2025.
- **Research terrain:** valleys for research fields, sized by US publications
  (university R&D dollars as an alternative). OpenAlex, NSF HERD FY 2024.
- **Shared layout:** both use one coordinate space, so nearby things are similar.
  For now they are shown as separate layers (alone, stacked or overlaid).
- **Three levels of detail:** sectors and fields, detailed industries and
  subfields, then research topics and a few hand-built deep zones.
- **Private footprint (local only):** on the owner's machine, a footprint from
  tenure, education and skills drapes over the terrain. It is never published.

Without WebGL the page shows a one-line message and the searchable node lists.

## Planned for v2

1. One map: industry and research on a single terrain.
2. A clearer footprint: touched areas highlighted, with steps down into finer levels.
3. Add your CV: a visitor gets a footprint from a CV in the browser. Nothing is
   stored or sent.
4. Download one JPG of the map and footprint.

Removed from v1: the "where next" score, the pay, mission and geography toggles,
the 2D contour map and the footprint centroid marker.

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
