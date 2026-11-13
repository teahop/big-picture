# v2 Phase 4 kickoff — Download and release

Read `CLAUDE.md` (rule 5), `SPEC.md` sections 8 and 9, and `PLAN.md`. Work on
branch `v2` until I say to release.

1. Download: one button that builds a single JPG in the page (target
   2400 × 1600): the map from the current camera with the footprint on, the
   name and subtitle from `config/site.yaml`, the touched Level 0 areas with
   shares, the type legend, the site address, and an optional caption typed by
   the visitor. Draw the WebGL frame, labels and text onto one canvas and save
   with `canvas.toBlob("image/jpeg")`. No upload and no request of any kind.
2. Check the image in light and dark, with a small footprint and a broad one,
   and with a long caption. Check the download in current Chrome, Safari and
   Firefox, and on a phone.
3. Polish: empty and loading states for the CV flow, phone layout for the
   confirm screen and the footprint list, keyboard access to the footprint
   list, the step-down and the download, contrast of the receded terrain in
   both themes. Update the About dialog for v2 (one map, how heights are
   scaled, what the CV feature does and does not do).
4. Clean-up: remove anything left from the variant switch or other temporary
   controls; update `README.md`; make sure `docs/v1/` is the only place v1
   behaviour is described.
5. Release checks: build `web/dist` from a clean clone with no private files;
   run the blocklist scan over the build, all tracked files and the full
   history; confirm the Pages workflow's expected-file list matches the v2
   bundle; re-run the no-network browser test against the built site.
6. Read `publish.personal` in the private profile. If it is anything other
   than `none`, show me exactly what would be published and wait.
7. Ask me to confirm the release. On yes: merge `v2` into `main`, push, wait
   for the deploy, then check the live site (name, one map, CV flow on a
   synthetic CV, download, no private route).
8. Ask separately whether to rename the repository and URL. Do nothing about it
   without a yes; if yes, list what breaks (old links, the Pages address) first.

Stop at the Phase 4 checks. Report the live URL and what was verified on it.
