/** Map labels for the 2D views: which names to show and where, so no two overlap. Pure: it knows only screen boxes.
 *
 *  Greedy, highest priority first (career industries before all others, then larger industries): each name is tried
 *  centred on its hill's summit, then at a few nearby offsets; it is shown at the first spot that is inside the view and
 *  clear of every name already placed, and hidden otherwise. Zooming in spreads the summits apart, so more names fit. */

export interface LabelItem {
  id: string;
  x: number; y: number;        // the summit on screen (pixels)
  w: number; h: number;        // the label's box (pixels)
  priority: number;            // higher goes first
}
export interface Placed { id: string; x: number; y: number; w: number; h: number }   // centre and size

/** Offsets tried in turn, in label widths (x) and heights (y; negative = up). */
export const OFFSETS: [number, number][] = [[0, 0], [0, -0.9], [0, 0.9], [0.62, 0], [-0.62, 0], [0.5, -0.9], [-0.5, -0.9], [0.5, 0.9], [-0.5, 0.9]];

export function placeLabels(items: LabelItem[], view: { w: number; h: number }, pad = 3, offsets = OFFSETS): Placed[] {
  const placed: Placed[] = [];
  const clear = (x: number, y: number, w: number, h: number) =>
    x - w / 2 >= 0 && x + w / 2 <= view.w && y - h / 2 >= 0 && y + h / 2 <= view.h
    && placed.every((p) => Math.abs(p.x - x) * 2 >= p.w + w + pad * 2 || Math.abs(p.y - y) * 2 >= p.h + h + pad * 2);
  for (const it of [...items].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1))) {
    for (const [ox, oy] of offsets) {
      const x = it.x + ox * it.w, y = it.y + oy * it.h;
      if (clear(x, y, it.w, it.h)) { placed.push({ id: it.id, x, y, w: it.w, h: it.h }); break; }
    }
  }
  return placed;
}

/** True when no two placed boxes overlap (for tests and checks). */
export function overlapFree(placed: Placed[]): boolean {
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h) return false;
  }
  return true;
}

/** A name on the map: one line, or two lines split evenly when long; very long names are shortened (the full name is
 *  in the panel and on hover). */
export function mapLines(text: string, oneLine = 16, max = 26): string[] {
  const t = text.length > max * 2 ? text.slice(0, max * 2 - 1).trimEnd() + "…" : text;
  if (t.length <= oneLine || !t.includes(" ")) return [t];
  let best = [t], worst = Infinity;
  for (let i = t.indexOf(" "); i >= 0; i = t.indexOf(" ", i + 1)) {
    const a = t.slice(0, i).trim(), b = t.slice(i + 1).trim(), w = Math.max(a.length, b.length);
    if (a && b && w < worst) { worst = w; best = [a, b]; }
  }
  return best.map((l) => (l.length > max ? l.slice(0, max - 1).trimEnd() + "…" : l));
}

/** About `count` round tick values inside lo..hi (the largest step of 1, 2, 2.5 or 5 times a power of ten that fits). */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / Math.max(1, count), p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [10, 5, 2.5, 2, 1].map((m) => m * p).find((v) => v <= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

/** Round values on a log scale inside lo..hi: 1, 3, 10, 30, ... times a power of ten. */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 3]) { const v = m * Math.pow(10, e); if (v >= lo && v <= hi) out.push(v); }
  return out;
}
