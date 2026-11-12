/** Geometry for drawing a footprint on the terrain: which industry owns each grid point, which parts of a touched
 *  hill bloom, and where each flower goes. Pure functions; scene3d turns the results into three.js objects. */
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
    const sigma = t.bandwidth_level0 * Math.pow(t.bandwidth_per_level, node.level);
    const [stretch, ang] = node.hill ?? [1, 0], sa = sigma * Math.sqrt(stretch), sb = sigma / Math.sqrt(stretch), r = 3 * sa;
    const ca = Math.cos(ang), sn = Math.sin(ang);
    const [px, py] = node.xy;
    const i0 = Math.max(0, Math.floor((px - r - g.x[0]) / dx)), i1 = Math.min(n - 1, Math.ceil((px + r - g.x[0]) / dx));
    const j0 = Math.max(0, Math.floor((py - r - g.y[0]) / dy)), j1 = Math.min(n - 1, Math.ceil((py + r - g.y[0]) / dy));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = g.x[0] + dx * i - px, y = g.y[0] + dy * j - py;
      const u = x * ca + y * sn, w = -x * sn + y * ca;   // along and across the ridge (the pipeline's hill shape)
      const v = amp * Math.exp(-(u * u / (2 * sa * sa) + w * w / (2 * sb * sb))), k = j * n + i;
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

/** Smooth deterministic value noise in [0, 1) on grid coordinates (scale = cells per noise period). */
export function hash(i: number, j: number, seed: number): number {
  let v = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

export function noise(x: number, y: number, scale: number, seed: number): number {
  const h = (i: number, j: number) => hash(i, j, seed);
  const fx = x / scale, fy = y / scale, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = h(i, j) + (h(i + 1, j) - h(i, j)) * sx, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * sx;
  return a + (b - a) * sy;
}

/** Super bloom species, most common first, and how often each fills a drift. */
export const SPECIES = [
  { name: "poppy", weight: 0.42 }, { name: "goldfields", weight: 0.2 }, { name: "lupine", weight: 0.2 },
  { name: "owls-clover", weight: 0.12 }, { name: "popcorn", weight: 0.06 },
];

/** Grid points that bloom: on each touched industry's ground, the share of its area equal to its share of the
 *  career (27% of the career -> 27% of that hill), chosen as drifts from a smooth noise field that lean up the hill. */
export function bloomCells(o: Owners, touched: Map<string, number>, n: number, height?: number[]): Map<number, number> {
  const byNode = new Map<number, number[]>();
  for (let k = 0; k < o.owner.length; k++) if (o.owner[k] >= 0) (byNode.get(o.owner[k]) ?? byNode.set(o.owner[k], []).get(o.owner[k])!).push(k);
  const out = new Map<number, number>();                  // cell -> owner index
  for (const [idx, cells] of byNode) {
    const share = touched.get(o.ids[idx]);
    if (!share) continue;
    const keep = Math.round(cells.length * Math.min(1, share));
    // drifts from noise, leaning up the hill (a narrow peak's flat area is mostly its foot, which would bloom as a ring)
    const top = height ? Math.max(...cells.map((k) => height[k]), 1e-9) : 1;
    const score = (k: number) => noise(k % n, Math.floor(k / n), 6, 11) * 0.55 + (height ? (height[k] / top) * 0.45 : 0);
    const ranked = cells.map((k) => [k, score(k)] as [number, number]).sort((a, b) => b[1] - a[1]);
    for (const [k] of ranked.slice(0, keep)) out.set(k, idx);
  }
  return out;
}

/** Deterministic flowers over the blooming cells: [fractional i, fractional j, species index]. Species come in drifts
 *  (a second, coarser noise field), with a few strays mixed in. */
export function flowers(cells: Map<number, number>, n: number, perCell = 6): [number, number, number][] {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cum = SPECIES.reduce<number[]>((a, s) => [...a, (a.at(-1) ?? 0) + s.weight], []);
  const pick = (u: number) => { const i = cum.findIndex((c) => u < c); return i < 0 ? cum.length - 1 : i; };
  const out: [number, number, number][] = [];
  for (const k of [...cells.keys()].sort((a, b) => a - b)) {
    const i = k % n, j = Math.floor(k / n);
    for (let c = 0; c < perCell; c++) {
      const x = i + rnd() - 0.5, y = j + rnd() - 0.5;
      // drifts: one species per warped patch of about 8 cells (uniform hash, so the mix follows SPECIES), some strays
      const wx = x + 6 * noise(x, y, 7, 5), wy = y + 6 * noise(x, y, 7, 6);
      const u = rnd() < 0.12 ? rnd() : hash(Math.floor(wx / 8), Math.floor(wy / 8), 23);
      out.push([x, y, pick(u)]);
    }
  }
  return out;
}
