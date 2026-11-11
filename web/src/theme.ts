type RGB = [number, number, number];
/** Terrain colours: ground (flat), the two type hues and the neutral middle of the mix ramp. */
export interface Theme { bg: string; fg: string; accent: string; footprint: string; ground: RGB; ind: RGB; res: RGB; neutral: RGB }

function hex(s: string): RGB {
  const v = s.trim().replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: get("--bg"), fg: get("--fg"), accent: get("--accent"), footprint: get("--footprint"),
    ground: hex(get("--terrain-ground")), ind: hex(get("--terrain-ind")), res: hex(get("--terrain-res")), neutral: hex(get("--terrain-neutral")),
  };
}

export const BANDS = 8;
const mix = (a: RGB, b: RGB, f: number): RGB => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];

/** Position on the two-hue ramp: -1 all research, 0 neutral, +1 all industry. Shares within `neutralBand` of an even
 *  mix read as neutral; `fade` (0..1) pulls a faded type's side back toward neutral. */
export function mixPosition(share: number, neutralBand: number, fadeInd = 0, fadeRes = 0): number {
  const d = (share - 0.5) * 2, a = Math.abs(d);
  const t = a <= neutralBand ? 0 : Math.sign(d) * Math.min(1, (a - neutralBand) / (1 - neutralBand));
  return t * (1 - (t > 0 ? fadeInd : fadeRes));
}

/** Terrain colour: hue from the mix, lightness from the height band (terraced, so contours read without hue). */
export function terrainColour(t: Theme, mixPos: number, h01: number): RGB {
  const band = Math.min(Math.floor(Math.max(h01, 0) * BANDS), BANDS - 1);
  const hue = mixPos >= 0 ? mix(t.neutral, t.ind, mixPos) : mix(t.neutral, t.res, -mixPos);
  return mix(t.ground, hue, 0.35 + 0.65 * (band / (BANDS - 1)));
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
