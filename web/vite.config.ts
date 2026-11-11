import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { parse } from "yaml";

// The display name and subtitle live only in ../config/site.yaml.
const site = parse(readFileSync(new URL("../config/site.yaml", import.meta.url), "utf8")) as {
  display_name: string;
  subtitle: string;
};

// Settings tuned by eye (peak height, neutral band, fade) live in ../config/viewer.yaml.
const viewer = parse(readFileSync(new URL("../config/viewer.yaml", import.meta.url), "utf8")) as Record<string, number>;

const siteName = (): Plugin => ({
  name: "site-name",
  transformIndexHtml: (html) => html.replaceAll("%DISPLAY_NAME%", site.display_name).replaceAll("%SUBTITLE%", site.subtitle),
});

// Local-only route for the private footprint. It exists only on the dev and preview servers and reads
// ../private/overlay.json when that file is there; `vite build` never copies it, so published output cannot contain it.
const privateOverlay = (): Plugin => {
  const handler = (req: { url?: string }, res: { setHeader(k: string, v: string): void; end(b: string): void; statusCode: number }, next: () => void) => {
    if (!req.url?.match(/^\/_private\/overlay\.json/)) return next();
    const file = new URL("../private/overlay.json", import.meta.url);
    if (!existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(file, "utf8"));
  };
  return { name: "private-overlay", configureServer: (s) => { s.middlewares.use(handler as never); }, configurePreviewServer: (s) => { s.middlewares.use(handler as never); } };
};

export default defineConfig({
  base: "./",
  // The viewer loads the tracked public bundle straight from data/public.
  publicDir: "../data/public",
  server: { fs: { allow: [".."] } },
  define: { __VIEWER__: JSON.stringify(viewer) },
  plugins: [siteName(), privateOverlay()],
});
