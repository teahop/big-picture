# v2 Phase 3 kickoff — Add your CV

Read `CLAUDE.md` (rules 1 and 2), `SPEC.md` sections 7 and 9, and `PLAN.md`.
Work on branch `v2`. This feature is light and for fun: prefer the simplest
thing that gives a believable footprint after a short confirm step.

Never use my CV or anything from `Personal Data/` in a tracked file, fixture or
screenshot. Write three synthetic CVs for fixtures (different careers and
layouts, as PDF and as text).

1. Sources first (rule 2). Before writing any loader, fetch the current
   documentation and file listings for the candidate lookups in SPEC 7.3 and
   record URL, release, licence and retrieval date in `data/SOURCES.md`:
   a public company-to-industry list (candidate: SEC EDGAR company names with
   SIC codes, plus a SIC-to-NAICS concordance), O*NET job titles (already
   ingested), and the CIP 2020 code list. If a candidate is unavailable, has
   changed, or has a licence problem, stop and give me the options.
2. `imap lookup`: build the viewer's lookup files from those sources into
   `data/public/`: organisation name to Level 1 industry, job title to
   occupation to Level 1 industries (Employment Matrix shares), and degree
   subject to research field (CIP titles through the reviewed
   `data/mappings/field_to_cip.csv`). Budget: 1.5 MB in total after gzip. If
   that cannot be met, stop and report what could be cut.
3. Browser parsing: extract text from a PDF with a PDF library bundled into the
   site (no CDN at run time), or take pasted text. Find roles and degrees from
   date ranges and section headings. Expect mistakes; step 4 corrects them.
4. Confirm step, one compact screen: each role and degree with its best guess
   and two or three alternatives as buttons, a search box over all nodes, and
   controls to fix years, delete a row or add one. A manual form reaches the
   same screen without a file. Aim for under a minute on a typical CV.
5. Output: a footprint object in the SPEC 6.1 format, held in memory and passed
   to the Phase 2 footprint module. A "Clear" control drops it. Nothing is
   written to storage or the URL.
6. Privacy, enforced: add a Content-Security-Policy that allows connections
   only to the site's own origin; load the lookup files only when the CV flow
   opens. Add a browser test that chooses a synthetic CV and asserts no request
   leaves the page afterwards and that `localStorage`, `sessionStorage`,
   IndexedDB, cookies and the URL are unchanged.
7. Page text: the one-sentence privacy promise beside the upload control and
   the limits from SPEC 7.4.
8. Ask me whether the public site should open with the synthetic sample
   footprint (default yes).
9. Report hit rates on the synthetic CVs: for how many roles the right Level 1
   industry was the first guess and among the offered guesses, and the same for
   degrees. Targets: among the offered guesses for at least 70% of roles and
   80% of degrees. If text matching falls short, report it with options (SPEC
   7.3 names an in-browser embedding model as the one to weigh) rather than
   adding it unasked.

Stop at the Phase 3 checks. Show me the flow on one synthetic CV from file to
footprint, the network log from the test, and the hit rates.
