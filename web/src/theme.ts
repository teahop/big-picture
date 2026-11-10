type RGB = [number, number, number];
export interface Theme { bg: string; fg: string; accent: string; footprint: string; ind: [RGB, RGB]; res: [RGB, RGB] }

/** Footprint colour as RGB, refreshed by readTheme() so per-pixel blending never touches the DOM. */
export let heatRgb: RGB = [25, 169, 138];

function hex(s: string): RGB {
  const v = s.trim().replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  heatRgb = hex(get("--footprint"));
  return {
    bg: get("--bg"), fg: get("--fg"), accent: get("--accent"), footprint: get("--footprint"),
    ind: [hex(get("--ramp-lo")), hex(get("--ramp-hi"))], res: [hex(get("--rramp-lo")), hex(get("--rramp-hi"))],
  };
}

export const BANDS = 8;
/** Terraced colour: one flat colour per band so contours read without relying on hue alone. */
export function bandColour(t: Theme, layer: "ind" | "res", h01: number): RGB {
  const band = Math.min(Math.floor(Math.max(h01, 0) * BANDS), BANDS - 1);
  const f = band / (BANDS - 1), [lo, hi] = t[layer];
  return [0, 1, 2].map((i) => lo[i] + (hi[i] - lo[i]) * f) as RGB;
}
export function rgbOf(css: string): RGB { return hex(css); }

const listeners: (() => void)[] = [];
export function onThemeChange(cb: () => void): void {
  listeners.push(cb);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) cb(); });
}

export type ThemeChoice = "light" | "dark";
export function effectiveTheme(): ThemeChoice {
  return (document.documentElement.dataset.theme as ThemeChoice | undefined) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
/** Explicit light or dark, remembered in this browser (storage may be unavailable, so it is optional). */
export function setTheme(t: ThemeChoice): void {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch { /* optional */ }
  listeners.forEach((l) => l());
}
export function restoreTheme(): void {
  try { const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch { /* optional */ }
}
