type RGB = [number, number, number];
export interface Theme { bg: string; fg: string; accent: string; ind: [RGB, RGB]; res: [RGB, RGB] }

function hex(s: string): RGB {
  const v = s.trim().replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: get("--bg"), fg: get("--fg"), accent: get("--accent"),
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

export function onThemeChange(cb: () => void): void {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", cb);
}
