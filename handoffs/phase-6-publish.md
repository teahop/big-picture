# Phase 6 kickoff — Polish and publish

Read `CLAUDE.md` (rule 5), `SPEC.md` sections 9 and 10, and `PLAN.md`.

1. Visual pass on the viewer: typography, legend, an "about the data" panel with
   sources and releases, loading states, mobile layout, 2D fallback.
2. Accessibility pass per the Phase 6 checks.
3. Build `web/dist` from the public bundle only. Run the blocklist scan over the
   build output and over the full git history.
4. Read `publish.personal` in the private profile. If `aggregate`, show me the
   exact file that would be published and wait for a yes.
5. Add a GitHub Actions workflow that builds and deploys to GitHub Pages. Do not
   enable Pages yet.
6. Ask me to confirm. On yes, enable Pages and report the URL.
