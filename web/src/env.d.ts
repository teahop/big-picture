/** From config/viewer.yaml, injected at build time by vite.config.ts. */
declare const __VIEWER__: {
  peak_height: number;
  footprint: { half_life_years: number; degree_years: number; touched_threshold: number };
  cv: { endpoint: string };   // empty when no CV reader is configured (the page offers the hand-filled form)
};
/** From config/site.yaml. */
declare const __SITE__: { name: string; subtitle: string; address: string };
