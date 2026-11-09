# Phase 2 kickoff — Coarse research layer, bridge, shared layout

Read `CLAUDE.md`, `SPEC.md` sections 4 to 6, and `PLAN.md`. Do only this phase.
Needs `OPENALEX_API_KEY` in `.env`. No personal data.

1. `imap ingest openalex-taxonomy`: fetch domains, fields, subfields and topics
   with descriptions, keywords and work counts. Read the current OpenAlex API
   docs first: confirm authentication, the daily allowance, and which
   `group_by` queries are supported. Use US-affiliated works for size (state the
   exact filter) and also store the global count.
2. Field-to-field similarity at the 26-field level: try topic co-assignment via
   `group_by`; if unsupported or too costly, use embeddings of field text.
   Record which method was used.
3. `imap ingest herd`: research dollars by field from NCSES HERD. Build a small
   reviewed mapping from HERD fields to OpenAlex fields. Second size measure.
4. `imap ingest cip-soc` and `imap ingest onet` (pin one O*NET release; use its
   data dictionary, since file and column names changed in 30.3).
5. Build the field-to-CIP mapping at the 26-field level: propose by embedding
   match against CIP two- and four-digit titles, write to a tracked CSV, and ask
   me to review it before it is used.
6. Bridge per SPEC 6.3: occupational and semantic signals, stored separately and
   combined. Report the top 5 sectors for each field.
7. Joint Level 0 layout of sectors and fields per SPEC 6.2. Freeze and track it.
8. Research terrain grid (negative heights). Export.
9. Viewer: second mesh; layer modes industry only, research only, stacked,
   overlaid; size switches per layer; clicking a node lists its strongest links
   in the other layer with the signal breakdown.

Bridge sanity pairs (sector must be in the field's top 3): Medicine with Health
care; Computer Science with Information or Professional and technical services;
Agricultural and Biological Sciences with Agriculture; Economics, Econometrics
and Finance with Finance and insurance; Engineering with Manufacturing or
Professional and technical services.

Stop at the Phase 2 checks. Send screenshots of all four layer modes.
