# The Big Picture — Specification (v2)

*Visualizing a career.*

Version 2.0 draft, 2026-11-10. Owner: github.com/teahop.
The v1 specification, plan and handoffs are archived in `docs/v1/`. Anything this
document does not change (data sources, node IDs, similarity, anchored layout,
levels of detail, deep zones) still works as v1 section numbers describe; this
document refers to them as "v1 §n".

## 1. Purpose

Show American industry and research as one landscape, and draw a career on it.

A visitor can do two things:

1. **Look at the map.** See which research fields and industries sit near each
   other, and how large they are.
2. **See a career on it.** Add a CV, confirm a few guesses, see which parts of
   the map that career touches, and download the picture.

v1 also asked "where could I go next?". v2 does not. It is a picture of where a
career has been.

## 2. What changes from v1

| # | Change | Section |
|---|---|---|
| 1 | Renamed **The Big Picture**, subtitle **Visualizing a career** | 3 |
| 2 | Removed: where-next scoring, the 2D map, pay, mission and geography | 4 |
| 3 | Industry and research are drawn on **one** terrain instead of two | 5 |
| 4 | New: a visitor adds a CV in the browser and sees a career footprint; nothing is stored or sent | 7 |
| 5 | The footprint is redrawn so it is clear: touched Level 0 areas are highlighted and the user can step down into Levels 1 and 2 | 6 |
| 6 | New: download one JPG of the map with the footprint | 8 |

Unchanged: the public data pipeline, the node graph, the shared anchored layout,
the three levels of detail, the deep zones, the privacy rules, static hosting.

## 3. Name

- `config/site.yaml` holds `display_name: "The Big Picture"` and a new key
  `subtitle: "Visualizing a career"`. The viewer header, page title, page
  description, README title and the exported image read both from there.
- Code identifiers (`imap`, package and file names) do not change.
- The repository name and the published URL still say `industry-map`. Renaming
  them changes a public address, so it is a separate, confirmed step (section 10).

## 4. Removed

| Feature | What goes |
|---|---|
| Where next | `imap score`, `score.py`, `web/src/score.ts`, `web/src/whereNext.ts`, the ranked panel and markers, the `where_next` block of the profile, the score tests |
| Pay | OEWS ingest and the pay toggle |
| Mission | Mission tags, the tag editor, the dev-server route that saves tags |
| Geography | `geo.py`, the QCEW county and OpenAlex metro ingests used only for location quotients, the geography toggle |
| 2D map | `web/src/map2d.ts` and the view switch. Without WebGL the page shows a plain message and the node lists; there is no contour fallback |
| Layer modes | Industry only, research only, stacked, overlaid. One map replaces them |
| Centroid marker | The weighted-centroid marker and its caveat text. A list of touched areas replaces it |
| Presence diffusion | The one-step spread of presence to neighbours (v1 §7.3). It blurred the footprint |

QCEW stays where the deep-zone industry build and the value-added split use it.
Retired sources stay listed in `data/SOURCES.md`, marked "retired in v2", so the
history of the public data is still explained.

## 5. One map

### 5.1 The problem
v1 drew industry as peaks and research as valleys on two meshes. That needed
four layer modes to read, and a footprint draped over two surfaces was hard to
see. But the two node types already share one layout, so a position means the
same thing for both.

### 5.2 Decision: one surface, height is size, colour is the mix
- **One mesh.** Every node, industry or research, raises the ground. Height at
  a point is the sum of Gaussian kernels of all nodes near it (v1 §6.4 kernel
  and volume-preserving split, unchanged).
- **Comparable heights.** Jobs and papers have different units, so each type is
  scaled on its own before the two are added: the largest Level 0 industry and
  the largest Level 0 field reach the same height. The scaling constants are
  exported so the viewer can state them.
- **Colour shows the mix.** Each grid cell also carries the industry share of
  its height (0 = all research, 1 = all industry). The terrain is tinted along a
  two-hue ramp through a neutral middle, so a mountain that is mostly industry,
  mostly research, or a real blend is visible at a glance.
- **Not colour alone.** Labels carry a shape mark for type (a square for
  industry, a circle for research), and the details panel names the type.
- **One emphasis control** replaces the layer modes: Both, Industry, Research.
  It fades the labels and tint of the other type. It does not change heights.

### 5.3 Size measures
One switch, two settings, applied to both types together:

| Setting | Industry | Research |
|---|---|---|
| Activity (default) | Employment | US publications |
| Dollars | Value added | University R&D |

Value added per job and R&D per paper are no longer terrain measures. They stay
as figures in the details panel.

### 5.4 Considered and not chosen
- *Peaks and valleys on one mesh:* an industry over a related field would cancel
  to flat ground, hiding exactly the places where the two meet.
- *Merging both types into new joint regions at Level 0:* this invents a
  taxonomy nobody recognises and loses the official names and figures.
- *Two interleaved point clouds without terrain:* loses the sense of size.

### 5.5 Exported data
Per level and per size setting: one height grid and one industry-share grid.
The separate industry and research grids of v1 are no longer exported. Nodes,
edges and layout files keep their v1 shape.

## 6. Footprint

### 6.1 One format, two producers
A footprint is a list of **entries**. An entry is one role or one degree:

```
{ "kind": "role" | "degree",
  "label": "...",            # shown only to the person whose footprint it is
  "years": 3.5,              # roles only
  "end_year": 2021,          # roles only, optional
  "nodes": { "ind:...": 0.7, "ind:...": 0.3 } }   # shares sum to 1
```

Two producers write this format, and the viewer draws both the same way:

- **The owner's private pipeline** (`imap personal ...`), from the reviewed
  role, education and skills mappings, written to `private/` and served only on
  a local machine. It can map to `deep:` and Level 2 nodes.
- **The in-browser CV flow** (section 7), held in memory only.

### 6.2 Weight
`weight(node) = sum over entries of share * years * recency`, where `recency`
is the v1 half-life decay for roles and 1 for degrees (a degree counts as a
fixed number of years set in config). No diffusion. Weights roll up: a parent's
weight is the sum of its children's, so the three levels always agree.

A node is **touched** when its weight is at least a small fraction of the
footprint's total (threshold in config), so stray shares do not light up the
whole map.

Connections remain a separate, private-only layer for the owner, off by
default. Visitors do not have it.

### 6.3 How it is drawn
The v1 footprint was a soft heat blended over two terrains. v2 makes it
discrete and makes the map step back:

1. **The rest recedes.** With a footprint on, untouched terrain loses its tint
   and its labels fade.
2. **Touched Level 0 areas stand out.** Each touched sector or field keeps its
   colour, gets an outline on the ground and a full-strength label with its
   share of the footprint.
3. **A footprint list.** The side panel lists the touched Level 0 areas, largest
   first, with a bar for each share. This is the summary; there is no centroid.
4. **Step down.** Choosing a touched area (on the map or in the list) moves the
   camera to it and shows its Level 1 children, with the touched ones
   highlighted the same way. Choosing a touched Level 1 node does the same for
   Level 2 where that zone has one. A breadcrumb (All › Sector › Industry)
   steps back up.
5. **Why.** Selecting a touched node lists the entries that put weight there
   (for example "Role, 4 years, 70%"). These labels come from the person's own
   footprint and never from the public bundle.

The exact treatment (outline or glow, how far the rest fades, how the step-down
moves) is decided by the owner looking at working variants in Phase 2, not on
paper.

## 7. Add your CV

### 7.1 Promise
Nothing a visitor provides leaves their browser, and nothing is kept after the
tab closes. This is enforced, not only stated:

- All parsing and matching runs in the page. There is no backend, no analytics
  on the CV flow, and no third-party request that carries CV content.
- A Content-Security-Policy limits network access to the site's own origin.
- Nothing is written to `localStorage`, `sessionStorage`, IndexedDB, cookies or
  the URL.
- An automated browser test loads a synthetic CV and asserts that no request
  leaves the page after the file is chosen and that storage stays empty.
- The page says this in one sentence beside the upload control.

### 7.2 Flow
1. **Add.** Choose a PDF or paste text. A short manual form (role, organisation,
   years; degree, subject) is always available as the other path.
2. **Read.** The page extracts text and finds likely roles and degrees from date
   ranges and section headings. This will be imperfect; the next step is the
   correction.
3. **Confirm.** One compact list: each role and degree with its best guess and
   two or three alternatives as buttons, plus a search box over all nodes. The
   visitor can fix the years, change a guess, delete a row or add one. A typical
   CV should need under a minute.
4. **See.** The footprint is drawn as in section 6.
5. **Download.** Section 8.

### 7.3 Matching without a server
The pipeline builds small public lookup files for the viewer:

| Guess | From | Built from |
|---|---|---|
| Role → industry (Level 1) | Organisation name, then job title | A public company-to-industry list; job titles to occupation (O*NET titles), occupation to industries (Employment Matrix shares) |
| Degree → research field (Level 0 or 1) | Subject of the degree | CIP titles and the reviewed `field_to_cip.csv` |

Matching is by normalised text and token overlap. The organisation is the
stronger signal for industry; the title only ranks alternatives. Where there is
no confident guess the row asks the visitor to pick.

Under hard rule 2, the company list and any new file are verified against their
current documentation before a loader is written, and recorded in
`data/SOURCES.md`. Candidates to check: SEC EDGAR company names with SIC codes
and a SIC-to-NAICS concordance; O*NET 31.0 job titles (already ingested); the
CIP 2020 code list. If the lookup files cannot be kept small enough to load
quickly, the build stops and reports options.

Considered and not chosen: sending the CV to a language model (it would leave
the browser and need a key or a backend); a sentence-embedding model in the
browser (tens of megabytes for a feature that is "just for fun"; revisit only
if text matching proves too weak in Phase 3).

### 7.4 Limits to state on the page
- Level 2 exists only in a few deep zones, so most visitors' footprints stop at
  Level 1.
- The map is of the United States.
- The match is a guess the visitor corrected, not an assessment.

## 8. Download

One button renders a single JPG, built in the page and saved by the browser:

- The map from the current camera with the footprint on, at a fixed size
  (target 2400 × 1600).
- The name and subtitle, the list of touched Level 0 areas with shares, the
  type legend and the site address.
- An optional caption the visitor types (for example their name). It is not
  required and is not stored.

The image is drawn on a canvas (the WebGL frame plus labels and text) and
exported with `canvas.toBlob("image/jpeg")`. No upload, no share link.

## 9. Privacy and publishing

v1 §9 stands. Additions:

- Test fixtures for the CV flow are synthetic CVs only. The owner's CV is never
  used in a tracked test or example.
- The lookup files of section 7.3 are public data only and go through the same
  blocklist scan as the rest of the bundle.
- The Pages workflow's list of expected data files is updated for the new
  bundle, and still refuses anything else.
- `main` deploys to the live site on push. v2 is built on a `v2` branch so the
  published v1 site stays as it is until the owner says to release.

## 10. Open questions for the owner

1. **One map** (5.2): confirm after seeing the Phase 1 prototype.
2. **Footprint treatment** (6.3): choose between variants in Phase 2.
3. **Example on the public site:** should the published site open with a sample
   footprint (a synthetic career) so visitors see what the feature does before
   adding a CV? Default: yes, synthetic.
4. **Your own footprint in public:** stays off (`publish.personal: none`)
   unless you decide otherwise.
5. **Connections layer:** keep as a private-only extra, or remove with the
   other v1 features? Default: keep, off by default.
6. **Repository and URL rename** from `industry-map`: when, and to what.

## 11. Out of scope for v2

International data; time animation; accounts or a backend; saving or sharing
footprints by link; comparing two careers; any recommendation of where to go.
