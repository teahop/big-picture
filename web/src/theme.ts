export interface Theme { bg: string; fg: string; accent: string; rampLo: [number, number, number]; rampHi: [number, number, number] }

function hex(s: string): [number, number, number] {
  const v = s.trim().replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  return { bg: get("--bg"), fg: get("--fg"), accent: get("--accent"), rampLo: hex(get("--ramp-lo")), rampHi: hex(get("--ramp-hi")) };
}

export const BANDS = 8;
/** Terraced colour: one flat colour per height band so contours read without relying on hue alone. */
export function bandColour(t: Theme, h01: number): [number, number, number] {
  const band = Math.min(Math.floor(Math.max(h01, 0) * BANDS), BANDS - 1);
  const f = band / (BANDS - 1);
  return [0, 1, 2].map((i) => t.rampLo[i] + (t.rampHi[i] - t.rampLo[i]) * f) as [number, number, number];
}

export function onThemeChange(cb: () => void): void {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", cb);
}
