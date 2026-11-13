type RGB = [number, number, number];
/** Terrain colours: ground (flat) and peak (highest band). */
export interface Theme { bg: string; fg: string; accent: string; footprint: string; horizon: string; haze: string; ground: RGB; peak: RGB; muted: RGB }

function hex(s: string): RGB {
  const v = s.trim().replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: get("--bg"), fg: get("--fg"), accent: get("--accent"), footprint: get("--footprint"),
    horizon: get("--horizon"), haze: get("--haze") || get("--horizon"), ground: hex(get("--terrain-ground")), peak: hex(get("--terrain-peak")), muted: hex(get("--terrain-muted")),
  };
}

export const BANDS = 8;
const mix = (a: RGB, b: RGB, f: number): RGB => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** Terrain colour: one smooth meadow green from the valleys (ground) to the tops (peak), with gentle patches (patch in
 *  -0.5..0.5) so the grass is not uniform. The light and shadows do the rest. */
export function terrainColour(t: Theme, h01: number, patch = 0): RGB {
  const f = Math.min(1, Math.max(0, 0.35 + 0.55 * Math.sqrt(Math.max(h01, 0)) + 0.35 * patch));
  return mix(t.ground, t.peak, f);
}

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
export function rgbOf(css: string): RGB { return hex(css); }
