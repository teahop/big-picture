import { readFileSync } from "node:fs";
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

export default defineConfig({
  base: "./",
  define: { __DISPLAY_NAME__: JSON.stringify(site.display_name) },
  plugins: [siteName()],
});
