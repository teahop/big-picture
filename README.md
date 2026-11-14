# The Big Picture

*Visualizing a career*

A landscape of American industries, built only from public data, that a
person can place a career on. Research and academia show up as the industries
that do them (colleges and universities, scientific R&D services).

This is version 3. The site is at https://teahop.github.io/big-picture/.

## What it does

- **Meaningful axes:** left to right is projected employment growth to 2035
  (faster growth to the right); front to back is size, with the largest
  industries at the back. Height is size too. Each industry leans a little
  toward its sector, and the details panel still lists its most similar
  industries.
- **Two size settings:** Jobs (BLS Employment Matrix 2025) and Value added
  (BEA 2025); switching slides the hills to their new places.
- **Two levels of detail:** 20 sectors as 3D California hills with their names
  laid into the grass, then 304 detailed industries as a 2D topographic map
  (contours, elevation tints, axes in the margins, names that never overlap).
- **Add your CV:** a visitor adds a CV (PDF, pasted text, or rows filled in by
  hand); a language model reads it through the site's proxy and the career is
  drawn straight away, with Make adjustments to change any row. Nothing is
  stored. The career shows as wildflowers on the sector hills and as rainbow
  contour bands on the industry map; choosing a sector steps down into its
  industries. Clear CV removes it.
- **Look:** rolling hills under a blue sky with hand-lettered axis signs, or a
  moonlit night; the industry map has day and night palettes too.

Without WebGL the page shows a one-line message and the node lists.

Personal data never enters this repository. See `SPEC.md` and `CLAUDE.md`.

Status and build order: `PLAN.md`. Design: `SPEC.md` (v3). The v2 documents are
in `docs/v2/` and v1 (the earlier "Industry Map") in `docs/v1/`.

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
