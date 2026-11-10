import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import { parse } from "yaml";

// The display name lives only in ../config/site.yaml.
const site = parse(readFileSync(new URL("../config/site.yaml", import.meta.url), "utf8")) as {
  display_name: string;
};

const siteName = (): Plugin => ({
  name: "site-name",
  transformIndexHtml: (html) => html.replaceAll("%DISPLAY_NAME%", site.display_name),
});

// Local-only route for the private footprint. It exists only on the dev and preview servers and reads
// ../private/overlay.json when that file is there; `vite build` never copies it, so published output cannot contain it.
const privateOverlay = (): Plugin => {
  const handler = (req: { url?: string }, res: { setHeader(k: string, v: string): void; end(b: string): void; statusCode: number }, next: () => void) => {
    const m = req.url?.match(/^\/_private\/(overlay|score)\.json/);
    if (!m) return next();
    const file = new URL(`../private/${m[1]}.json`, import.meta.url);
    if (!existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(file, "utf8"));
  };
  // Mission tags typed in the viewer are saved to the private folder only (never a tracked path).
  const saveTag = (req: IncomingMessage & { method?: string }, res: ServerResponse, next: () => void) => {
    if (req.method !== "POST" || !req.url?.startsWith("/_private/mission-tag")) return next();
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try {
        const { id, tag } = JSON.parse(body) as { id: string; tag: number };
        if (typeof id !== "string" || !/^[a-z]+:[A-Za-z0-9._-]+$/.test(id) || ![-2, -1, 0, 1, 2].includes(tag)) throw new Error("bad tag");
        const file = new URL("../private/mission_tags.local.yaml", import.meta.url);
        const tags: Record<string, number> = {};
        if (existsSync(file)) for (const line of readFileSync(file, "utf8").split("\n")) { const m = line.match(/^"([^"]+)":\s*(-?\d)$/); if (m) tags[m[1]] = Number(m[2]); }
        tags[id] = tag;
        writeFileSync(file, Object.entries(tags).map(([k, v]) => `"${k}": ${v}`).join("\n") + "\n");
        res.statusCode = 204; res.end();
      } catch { res.statusCode = 400; res.end("bad request"); }
    });
  };
  return { name: "private-overlay", configureServer: (s) => { s.middlewares.use(handler as never); s.middlewares.use(saveTag as never); }, configurePreviewServer: (s) => { s.middlewares.use(handler as never); s.middlewares.use(saveTag as never); } };
};

export default defineConfig({
  base: "./",
  // The viewer loads the tracked public bundle straight from data/public.
  publicDir: "../data/public",
  server: { fs: { allow: [".."] } },
  define: { __DISPLAY_NAME__: JSON.stringify(site.display_name) },
  plugins: [siteName(), privateOverlay()],
});
