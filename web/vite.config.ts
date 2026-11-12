import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { parse } from "yaml";

// The display name and subtitle live only in ../config/site.yaml.
const site = parse(readFileSync(new URL("../config/site.yaml", import.meta.url), "utf8")) as {
  display_name: string;
  subtitle: string;
};

// Settings tuned by eye (peak height, footprint weights) live in ../config/viewer.yaml.
const viewer = parse(readFileSync(new URL("../config/viewer.yaml", import.meta.url), "utf8")) as Record<string, unknown>;

const siteName = (): Plugin => ({
  name: "site-name",
  transformIndexHtml: (html) => html.replaceAll("%DISPLAY_NAME%", site.display_name).replaceAll("%SUBTITLE%", site.subtitle),
});

// Local-only route for the owner's private footprint. It exists only on the dev and preview servers and reads
// ../private/footprint.json when that file is there; `vite build` never copies it, so published output cannot contain it.
const privateFootprint = (): Plugin => {
  const handler = (req: { url?: string }, res: { setHeader(k: string, v: string): void; end(b: string): void; statusCode: number }, next: () => void) => {
    if (!req.url?.match(/^\/_private\/footprint\.json/)) return next();
    const file = new URL("../private/footprint.json", import.meta.url);
    if (!existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(file, "utf8"));
  };
  return { name: "private-footprint", configureServer: (s) => { s.middlewares.use(handler as never); }, configurePreviewServer: (s) => { s.middlewares.use(handler as never); } };
};

// Local stand-in for the CV proxy (the Cloudflare Worker in production): POST /api/cv with {text} reads the CV with the
// model and returns {entries}. The key comes from ../.env (OPENAI_API_KEY, or OPEN_API_KEY); nothing is stored or logged.
const cvRoute = (): Plugin => ({
  name: "cv-route",
  configureServer: (server) => {
    server.middlewares.use(async (req, res, next) => {
      if (req.method !== "POST" || !req.url?.startsWith("/api/cv")) return next();
      const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); };
      try {
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 200_000) return send(413, { error: "too large" }); }
        const { text } = JSON.parse(raw) as { text: string };
        const env = existsSync(new URL("../.env", import.meta.url)) ? readFileSync(new URL("../.env", import.meta.url), "utf8") : "";
        const key = /^OPENAI_API_KEY=(.+)$/m.exec(env)?.[1] ?? /^OPEN_API_KEY=(.+)$/m.exec(env)?.[1] ?? process.env.OPENAI_API_KEY;
        if (!key) return send(503, { error: "no API key configured" });
        const { readCv } = await server.ssrLoadModule("/server/cvRead.ts");
        const cv = (viewer as { cv: { model: string; effort: "low" | "medium" | "high" } }).cv;
        // ?model= lets the hit-rate script compare models on the dev server; only the listed models are accepted.
        const asked = new URL(req.url, "http://x").searchParams.get("model");
        const model = asked && ["gpt-6.1-sol", "gpt-6-luna"].includes(asked) ? asked : cv.model;
        send(200, { entries: await readCv(text, { apiKey: key.trim(), model, effort: cv.effort }), model });
      } catch (e) {
        send(502, { error: e instanceof Error ? e.message.slice(0, 200) : "failed" });
      }
    });
  },
});

// The two config files above are read once; restart the dev server when either changes so edits show up.
const restartOnConfig = (): Plugin => ({
  name: "restart-on-config",
  configureServer: (s) => {
    const files = ["../config/viewer.yaml", "../config/site.yaml"].map((f) => new URL(f, import.meta.url).pathname);
    s.watcher.add(files);
    s.watcher.on("change", (f) => { if (files.includes(f)) void s.restart(); });
  },
});

// Content Security Policy for the built page (SPEC 7.5): scripts, styles and data from the site itself, and network
// requests only to the site and the CV proxy. Dev keeps Vite's defaults (HMR needs inline scripts and a websocket).
const cvCfg = (viewer as { cv: { endpoint: string; proxy_url?: string } }).cv;
if (process.env.CV_PROXY_URL) cvCfg.proxy_url = process.env.CV_PROXY_URL;   // e.g. a local `wrangler dev` for testing the built page
const proxyOrigin = cvCfg.proxy_url ? new URL(cvCfg.proxy_url).origin : "";
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  `connect-src 'self'${proxyOrigin ? " " + proxyOrigin : ""}`, "worker-src 'self' blob:", "font-src 'self'",
  "object-src 'none'", "base-uri 'self'",
].join("; ");
const csp = (): Plugin => ({
  name: "csp", apply: "build",
  transformIndexHtml: (html) => html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig(({ command }) => ({
  base: "./",
  // The viewer loads the tracked public bundle straight from data/public.
  publicDir: "../data/public",
  server: { fs: { allow: [".."] } },
  // The built page calls the Worker; the dev server calls its own route.
  define: { __VIEWER__: JSON.stringify(command === "build" ? { ...viewer, cv: { endpoint: cvCfg.proxy_url ?? "" } } : viewer) },
  plugins: [siteName(), privateFootprint(), restartOnConfig(), cvRoute(), csp()],
}));
