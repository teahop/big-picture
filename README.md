# The Big Picture

*Visualizing a career*

A 3D terrain of American industries, built only from public data, that a
person can place a career on. Research and academia show up as the industries
that do them (colleges and universities, scientific R&D services).

This is version 2, in progress on the `v2` branch. The live site still runs v1
until the v2 release step.

## What exists now

- **One industry terrain:** every industry raises the ground; height is its own
  size (compressed so small sectors still form hills), and each peak shows only
  its own industry.
- **Two size settings:** Activity (jobs, BLS Employment Matrix 2025) and Dollars
  (value added, BEA 2025).
- **Layout by similarity:** industries sit near others with a similar,
  distinctive occupation mix and description; a detailed industry can sit
  outside its sector's area.
- **Three levels of detail:** 20 sectors, 304 detailed industries, then a few
  hand-built deep zones.
- **Career footprint:** a career is drawn as California wildflowers on the
  hills it touched, each hill blooming over its share of the career; step down
  into sectors, industries and deep zones. The owner's own footprint is local
  only and never published.
- **Look:** rolling hills to every edge under a blue sky, or a moonlit night.

Without WebGL the page shows a one-line message and the searchable node lists.

## Planned for v2

1. Add your CV: a visitor gets a footprint from a CV in the browser. Nothing is
   stored or sent.
2. Download one JPG of the map and footprint.

Removed from v1: the "where next" score, the pay, mission and geography toggles,
the 2D contour map, the footprint centroid marker, the four layer modes and the
research fields (OpenAlex, HERD).

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
other than that bundle. The owner's own footprint appears only on a local machine that
has the private files; on the published site a footprint appears only after a visitor adds a CV.

### The CV reader (proxy)

"Add your CV" sends the CV text to a small Cloudflare Worker in `worker/`, which asks
the model (OpenAI) to read it and returns the structured result. It stores and logs
nothing, accepts only the site's origins, and limits size and rate. The key never
reaches the page. Locally, the dev server's `/api/cv` route does the same job and
reads the key from `.env`.

```
cd worker && npm install
npx wrangler secret put OPENAI_API_KEY      # paste the key when asked
# set ALLOWED_ORIGINS in worker/wrangler.jsonc to the published site's origin
npx wrangler deploy
```

Then put the Worker's URL in `config/viewer.yaml` (`cv.proxy_url`) and rebuild. With no
proxy URL, the published page offers the hand-filled form only. Deploying the Worker and
pushing `main` are publishing steps.

### On another website (e.g. Squarespace)

Embed the published page with a Code block:

```html
<iframe src="https://<published site>/" title="The Big Picture" style="width:100%;height:85vh;border:0" loading="lazy"></iframe>
```

The CV reader keeps working inside the iframe because requests still come from the
published site's origin. Add the other site's domain to `ALLOWED_ORIGINS` only if the
page itself is hosted there.
