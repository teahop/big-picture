/** Geometry for drawing a footprint on the terrain: which industry owns each grid point, the outline around touched
 *  areas, and where the wildflowers go. Pure functions; scene3d turns the results into three.js objects. */
import type { LevelGrids, Measure, Meta, NodeRec } from "./data";

export interface Owners { owner: Int32Array; ids: string[] }

/** For every grid point, the visible industry whose peak is tallest there (the same rule the terrain is built with:
 *  amplitude (size / largest) ** height_exponent, kernel width shrinking with level), or -1 on flat ground (beyond
 *  about two kernel widths of every peak). */
export function owners(g: LevelGrids, nodes: NodeRec[], measure: Measure, t: Meta["terrain"], max = 0): Owners {
  const n = g.n, best = new Float32Array(n * n), owner = new Int32Array(n * n).fill(-1), floor = new Float32Array(nodes.length);
  max = max || nodes.reduce((m, x) => Math.max(m, x.size[measure] ?? 0), 0) || 1;   // pass the level's largest when `nodes` is a subset
  const dx = (g.x[1] - g.x[0]) / (n - 1), dy = (g.y[1] - g.y[0]) / (n - 1);
  nodes.forEach((node, idx) => {
    const amp = Math.pow(Math.max(node.size[measure] ?? 0, 0) / max, t.height_exponent);
    if (amp <= 0) return;
    floor[idx] = amp * Math.exp(-2);                       // two kernel widths out
    const sigma = t.bandwidth_level0 * Math.pow(t.bandwidth_per_level, node.level), r = 3 * sigma;
    const [px, py] = node.xy;
    const i0 = Math.max(0, Math.floor((px - r - g.x[0]) / dx)), i1 = Math.min(n - 1, Math.ceil((px + r - g.x[0]) / dx));
    const j0 = Math.max(0, Math.floor((py - r - g.y[0]) / dy)), j1 = Math.min(n - 1, Math.ceil((py + r - g.y[0]) / dy));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.x[0] + dx * i - px, y = g.y[0] + dy * j - py;
      const v = amp * Math.exp(-(x * x + y * y) / (2 * sigma * sigma)), k = j * n + i;
      if (v > best[k]) { best[k] = v; owner[k] = idx; }
    }
  });
  for (let k = 0; k < owner.length; k++) if (owner[k] >= 0 && best[k] < floor[owner[k]]) owner[k] = -1;
  return { owner, ids: nodes.map((x) => x.id) };
}

/** Mask of grid points owned by a touched industry. With owners computed over the touched industries only, this is
 *  the ground within about two kernel widths of each touched peak, even where a taller untouched neighbour rises. */
export function touchedMask(o: Owners, touched: Map<string, number>): Uint8Array {
  const m = new Uint8Array(o.owner.length);
  for (let k = 0; k < m.length; k++) m[k] = o.owner[k] >= 0 && touched.has(o.ids[o.owner[k]]) ? 1 : 0;
  return m;
}

/** Outline of a mask by marching squares: a flat list of segment end points in fractional grid coordinates [i, j]. */
export function outline(mask: Uint8Array, n: number): [number, number][] {
  const out: [number, number][] = [];
  const at = (i: number, j: number) => mask[j * n + i];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const c = at(i, j) | (at(i + 1, j) << 1) | (at(i + 1, j + 1) << 2) | (at(i, j + 1) << 3);
    if (c === 0 || c === 15) continue;
    const top: [number, number] = [i + 0.5, j], right: [number, number] = [i + 1, j + 0.5], bottom: [number, number] = [i + 0.5, j + 1], left: [number, number] = [i, j + 0.5];
    const segs: Record<number, [number, number][][]> = {
      1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bottom]], 5: [[left, top], [right, bottom]], 6: [[top, bottom]],
      7: [[left, bottom]], 8: [[bottom, left]], 9: [[top, bottom]], 10: [[top, right], [bottom, left]], 11: [[right, bottom]], 12: [[right, left]],
      13: [[top, right]], 14: [[left, top]],
    };
    for (const [a, b] of segs[c]) out.push(a, b);
  }
  return out;
}

/** Deterministic flower positions over touched ground, densest on the industries with the largest share:
 *  [fractional i, fractional j, colour index 0..3]. */
export function flowers(o: Owners, touched: Map<string, number>, n: number, perPoint = 3): [number, number, number][] {
  const top = Math.max(...touched.values(), 1e-9), out: [number, number, number][] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let k = 0; k < o.owner.length; k++) {
    const id = o.owner[k] >= 0 ? o.ids[o.owner[k]] : undefined, s = id ? touched.get(id) : undefined;
    if (s === undefined) continue;
    const expect = 0.5 + perPoint * Math.sqrt(s / top);
    const count = Math.floor(expect) + (rnd() < expect % 1 ? 1 : 0);
    const i = k % n, j = Math.floor(k / n);
    for (let c = 0; c < count; c++) out.push([i + rnd() - 0.5, j + rnd() - 0.5, Math.floor(rnd() * 4)]);
  }
  return out;
}
