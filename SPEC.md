# Industry Map — Specification

Version 0.2, 2026-11-09 (0.2: source facts verified in Phase 0; see `data/SOURCES.md`). Owner: github.com/teahop.

## 1. Purpose

Show American industry and research fields as terrain in one shared space, place
one person on it from their work history, skills and connections, and score
where they might head next.

The user can answer three questions by looking:

1. What is near what? (Which research fields sit under which industries.)
2. Where am I? (A footprint, not a pin.)
3. Where could I go? (Large or growing areas adjacent to the footprint, filtered
   by pay, mission and geography.)

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Layers | Two separate terrains on one shared layout. Industry rises as peaks; research sinks as valleys. Each viewable alone, stacked with a vertical gap, or overlaid. They are separate meshes, so they never cancel. |
| Industry size | Employment by default; value added as a switch. |
| Research size | Publication volume by default; R&D dollars as a switch. |
| Resolution | Coarse everywhere first, then deeper only in the owner's zones. |
| "Where next" | Adjacency plus growth by default; pay, mission and geography as toggles. |
| Form | Python data pipeline that exports static JSON; static web viewer. |
| Publishing | Must be publishable as a public static site when the owner chooses. |
| Repo | Public. Personal data local only. |

## 3. Data model

Three node types and one extension:

- `ind:` industry (NAICS-based, from the BLS National Employment Matrix).
- `fld:` research field (OpenAlex domain, field, subfield or topic).
- `occ:` occupation (SOC). Occupations are bridge nodes. They are not drawn as
  terrain but connect industries to fields and carry pay data.
- `deep:` custom child nodes inside a deep zone where official taxonomies are
  too coarse (see 5.3).

Every node has: `id`, `label`, `type`, `level`, `parent`, `size_*` measures,
`growth`, `xy`, and `provenance` (official or estimated).

Edges are weighted and typed: `ind-occ` (employment share), `fld-fld`
(similarity), `ind-ind` (similarity), `fld-occ` and `fld-ind` (bridge).

## 4. Data sources

Record exact release, URL and retrieval date in `data/SOURCES.md`. Facts in the
"Checked" column were confirmed on 2026-11-09; everything else must be confirmed
by the build before use.

| Need | Source | Checked 2026-11-09 | Confirm at build |
|---|---|---|---|
| Industries, occupation mix, employment, projections | BLS National Employment Matrix (XLSX) | Cycle 2025-2035; industries coded to NAICS 2022, occupations to SOC 2018. Counts of detailed industries and occupations are not stated on the BLS pages | File layout; count detailed rows from the file |
| Industry value added | BEA GDP by industry | Release 2026-09-30 (Q2 2026). No bulk file found; data is in the interactive tables and the API dataset `GDPByIndustry` (free key) | Which table and years; API or interactive export |
| Research taxonomy and volume | OpenAlex | 4 domains, 26 fields, 252 subfields, 4,516 topics; Counts confirmed. Docs now at help.openalex.org. Keyless basic use works; a free key gives a $1/day budget, 30 requests/s and is required for cursor paging past page one (no "required since 2026-02-13" statement found). About 10% of works have no topic. Topic classifier replaced October 2026 | `group_by` works on works; topic-hierarchy fields (`primary_topic.field.id` etc.) only as a single group_by field. Record classifier version; filter to article, review, book, book-chapter when counting |
| Research dollars | NSF NCSES HERD survey | FY 2024 is the latest (released 2025-12-23); tables cut from 86 to 55; some by-field tables are Table Builder only | Which by-field tables download directly; field list and crosswalk to OpenAlex fields |
| Field to occupation | NCES CIP 2020 to SOC 2018 crosswalk | Expert-judgment mapping, not empirical. XLSX at nces.ed.gov/ipeds/cipcode/Files/CIP2020_SOC2018_Crosswalk.xlsx; CIP 2020 is still current; the CIP code list has no direct URL | Get the CIP code list another way |
| Occupation knowledge, skills, titles | O*NET database | Current release is 31.0 (2026-10); 30.3 renamed files and columns. No "Alternate Titles" file: use Job Titles and Sample of Reported Titles; skills are split across Software, Essential and Transferable Skills files. Licence Creative Commons (CC BY 4.0 per a summary) | Pin 31.0; use its data dictionary; confirm licence page |
| Pay | BLS OEWS (wages by occupation, industry and metro) | May 2025 reference period; files `oesm25nat`, `oesm25in4`, `oesm25ma` ZIPs (XLSX inside) | NAICS edition of the industry file |
| Geography | BLS QCEW (employment by industry and area); OpenAlex institution locations | Annual files through 2025; quarterly files in 2026; CSV slices API on data.bls.gov | NAICS edition; whether the API serves annual slices |
| Business R&D by industry (optional bridge) | NSF NCSES Business Enterprise R&D (BERD) survey, successor to BRDIS | Survey year 2024, released 2026-10-29; by-industry tables are downloadable XLSX; methodology uses 2017 NAICS | Table list; NAICS 2017 vs 2022 mismatch |
| Patent-to-paper links (optional bridge) | "Reliance on Science" dataset | Updated July 2026, through patents granted 2025; Zenodo CSV. **Licence CC BY-NC 4.0 (non-commercial)** | Whether non-commercial terms are acceptable for derived public data |

OpenAlex has no official crosswalk to CIP or NAICS. The project builds its own
(section 6.3) and keeps it as a reviewed, tracked table.

Three source differences from version 0.1 matter to the design: BEA value added has no bulk file, so it comes from the API or interactive export and is optional until proven; OpenAlex topic assignments depend on a classifier that changed in October 2026, so every research count records the classifier version; and Reliance on Science is non-commercial, so it stays out of the public bundle unless the owner accepts that.

## 5. Resolution

### 5.1 Level 0 (Phase 1 and 2)
- Industry: NAICS sectors (about 20).
- Research: OpenAlex fields (26).

### 5.2 Level 1 (Phase 3, everywhere)
- Industry: the detailed industries of the Employment Matrix.
- Research: OpenAlex subfields (252).

### 5.3 Level 2 (Phase 3, deep zones only)
- Research: OpenAlex topics under the subfields named in the private profile.
- Industry: custom `deep:` categories under the industries named in the private
  profile, where NAICS lumps distinct businesses together. The build proposes
  the category list from public sources (company-affiliated publication topics
  in OpenAlex, public filings' business descriptions, published market maps),
  and the owner reviews it before it is used. These have no official employment
  figures, so size is an estimate from documented proxies (member count,
  published headcount). Estimated nodes carry `provenance: estimated` and the
  viewer draws them with a distinct outline.

## 6. Building the space

### 6.1 Similarity
- `ind-ind`: cosine similarity of occupation-share vectors from the Employment
  Matrix.
- `fld-fld`: preferred, co-assignment of topics on the same works via OpenAlex
  `group_by` (confirm the API supports it at acceptable cost). Fallback, cosine
  similarity of text embeddings of field descriptions and keywords.
- Text embeddings use a local sentence-embedding model so no extra key is needed.

### 6.2 Layout: anchored and hierarchical
Variable resolution only works if deepening one zone does not move everything
else. So:

1. Lay out Level 0 nodes of both types together from the combined similarity
   matrix (bridge included) using metric MDS or a seeded force layout. At this
   size UMAP is not appropriate.
2. Freeze those positions.
3. Place each child within its parent's neighbourhood: start at the parent
   position, then relax using similarity to siblings and to already-placed
   nodes, constrained to a radius proportional to the parent's size.
4. All randomness is seeded. Positions are written to a tracked file so the map
   is stable across runs, and re-layout is an explicit command.

### 6.3 Bridge between research and industry
Combine three signals into one `fld-ind` weight, and keep each signal's
contribution so the viewer can explain a link:

1. **Occupational:** field to CIP (project-built mapping, embedding-matched then
   reviewed by hand at the 26-field level), CIP to SOC (NCES crosswalk), SOC to
   industry (Employment Matrix shares).
2. **Semantic:** embedding similarity between field descriptions and industry
   plus O*NET occupation descriptions.
3. **Empirical (optional, later):** share of a field's works with a company
   affiliation in OpenAlex, business R&D by industry, patent-to-paper links.

Sanity pairs that must rank highly before the bridge is accepted are listed in
the Phase 2 handoff.

### 6.4 Terrain
For each layer, height at a point is a sum of Gaussian kernels centred on that
layer's nodes: amplitude `log(1 + size)` scaled to a common range, bandwidth
proportional to the node's level. Industry heights are positive. Research
heights are negative. The viewer receives two height grids per size measure.

## 7. Personal overlay

All inputs are read from `Personal Data/`; all outputs go to `private/`.

### 7.1 Inputs
Role history table (organisation, sector, dates, engagement type), LinkedIn
export (positions, skills, connections) and the owner's existing derived tables
(normalised connections with tie strength, company index). Paths and quirks are
in `Personal Data/PROFILE_NOTES.md`.

### 7.2 Mapping
- **Roles** map to one or more `ind:` or `deep:` nodes and one or more `occ:`
  nodes, with shares that sum to 1. Use O*NET alternate titles and embeddings to
  propose, then write proposals to a private review table the owner corrects.
  Corrections are stored and never overwritten.
- **Umbrella rule:** where an umbrella entity (for example an own consultancy)
  overlaps engagements done through it, count the engagements first and assign
  only the uncovered months to the umbrella. No month counts twice.
- **Durations** are parsed to months; anything ambiguous goes to the review
  table rather than being guessed.
- **Connections:** classify each distinct company to an industry node once,
  cached in a private table (public filings where available, otherwise
  model-assisted with a confidence value; review the highest-count companies by
  hand). Each contact contributes `1 + tie_strength_normalised`.
- **Skills** map to `occ:` and `fld:` nodes by embedding similarity and spread a
  small weight to them.
- **Education** maps to `fld:` nodes through CIP.

### 7.3 Presence
For each node `n`:

```
presence(n) = sum over roles r of share(r,n) * months(r)/12 * 0.5^(years_since_end(r)/half_life)
            + k * log(1 + sum over contacts c at n of (1 + tie(c)))
            + skill_weight * skill_match(n)
```

Parameters live in the private profile. Presence then diffuses one step along
graph edges (weight-proportional, damped) so that neighbours of occupied nodes
get partial credit.

### 7.4 Display
Draw presence as a heat footprint draped on whichever terrain is visible. Also
show the weighted centroid as a marker with a note that it is a summary, since a
centroid between two distant clusters can sit where the person has never worked.
Show three sub-footprints on request: tenure only, connections only, skills only.

## 8. "Where next" score

Each component is normalised to 0..1 across candidate nodes:

- `adjacency`: graph proximity to the footprint (personalised PageRank from
  presence-weighted seeds).
- `growth`: projected employment change (industry) or recent publication growth
  (research).
- `size`: the active size measure.
- `novelty`: `1 - presence`, so the score favours places not already occupied.

`score = weighted sum`, with weights in the private profile. Toggles act as
filters or multipliers:

- **Pay:** wage level for the person's nearest occupations in that industry
  (OEWS); filter by a floor or multiply by a normalised wage.
- **Mission:** owner-assigned tags from -2 to +2 on any node, stored in the
  private profile. There is no public dataset for this; it is the owner's
  judgment.
- **Geography:** concentration of the industry in a chosen metro (location
  quotient from QCEW); for research, share of works from institutions in that
  metro.

The viewer lists the top candidates with a plain breakdown of why each scored as
it did, and marks them on the terrain.

## 9. Privacy and publishing

- The pipeline has two export targets: `public` (base map only) and `private`
  (base map plus personal overlay), written to `data/public/` and `private/`.
- The viewer loads the public bundle by default and a private bundle only when
  one is present locally.
- `publish.personal` in the private profile is `none` or `aggregate`.
  `aggregate` exports node-level presence values rounded to coarse bands and
  nothing else. Contact-level data, company-of-contact data and role text are
  never exported to a public target under any setting.
- A pre-commit hook blocks any staged path under `Personal Data/` or `private/`
  and scans staged files for strings from a private blocklist (contact names).
- Publishing target is GitHub Pages from a built `web/dist`. Turning it on is a
  manual, confirmed step in Phase 6.

## 10. Viewer

Static site: Vite, TypeScript, three.js. No server.

- 3D scene with orbit controls; two meshes (industry, research) on one grid.
- Layer modes: industry only, research only, stacked, overlaid.
- Switches: size measure per layer; level of detail; footprint on or off and
  which sub-footprint; where-next markers; pay, mission and geography toggles.
- Hover or click a node for label, size, growth, top linked nodes and the
  bridge explanation.
- Search by node name.
- Colour: one hue family per layer, readable in light and dark, never relying on
  colour alone (labels and outlines carry the same information).
- A 2D top-down contour mode as a fallback for devices without WebGL and for
  screenshots.

## 11. Out of scope for v1

International data; time animation; multiple users; accounts or a backend;
automatic scraping of connection profiles.

## 12. Open questions for the owner

1. Mission tags: which nodes get which values (Phase 5).
2. Whether the published version should show an aggregate footprint or none.
