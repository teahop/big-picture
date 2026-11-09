export interface Occupation { soc: string; title: string; share_pct: number }
export interface NodeRec {
  id: string; label: string; title: string; type: string; level: number; parent: string | null;
  naics_code: string; provenance: "official" | "estimated";
  size: { employment: number; employment_2035: number };
  growth: number; xy: [number, number]; top_occupations: Occupation[];
}
export interface Edge { source: string; target: string; type: string; weight: number }
export interface Grid { n: number; x: [number, number]; y: [number, number]; values: number[] }
export interface Bundle {
  nodes: NodeRec[]; edges: Edge[]; grid: Grid; maxHeight: number;
  meta: { sources: { name: string; release: string; url: string; retrieved: string }[] };
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(name);
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`);
  return (await res.json()) as T;
}

export async function loadBundle(): Promise<Bundle> {
  const [nodes, edges, grids, meta] = await Promise.all([
    getJson<NodeRec[]>("nodes.json"), getJson<Edge[]>("edges.json"),
    getJson<{ industry: { measures: { employment: Grid } } }>("grids.json"),
    getJson<Bundle["meta"]>("meta.json"),
  ]);
  const grid = grids.industry.measures.employment;
  let maxHeight = 0;
  for (const v of grid.values) if (v > maxHeight) maxHeight = v;
  return { nodes, edges, grid, maxHeight, meta };
}

/** Bilinear height at layout coordinates (x, y). */
export function heightAt(g: Grid, x: number, y: number): number {
  const fx = ((x - g.x[0]) / (g.x[1] - g.x[0])) * (g.n - 1);
  const fy = ((y - g.y[0]) / (g.y[1] - g.y[0])) * (g.n - 1);
  const i = Math.min(Math.max(Math.floor(fx), 0), g.n - 2);
  const j = Math.min(Math.max(Math.floor(fy), 0), g.n - 2);
  const tx = Math.min(Math.max(fx - i, 0), 1), ty = Math.min(Math.max(fy - j, 0), 1);
  const v = (a: number, b: number) => g.values[b * g.n + a];
  return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - ty) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * ty;
}

export function neighbours(b: Bundle, id: string, k = 3): { node: NodeRec; weight: number }[] {
  const byId = new Map(b.nodes.map((n) => [n.id, n]));
  return b.edges
    .filter((e) => e.source === id || e.target === id)
    .map((e) => ({ node: byId.get(e.source === id ? e.target : e.source)!, weight: e.weight }))
    .sort((a, c) => c.weight - a.weight)
    .slice(0, k);
}

export function fmtJobs(thousands: number): string {
  return thousands >= 1000 ? `${(thousands / 1000).toFixed(1)} million` : `${Math.round(thousands)} thousand`;
}
export function fmtGrowth(pct: number): string { return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`; }
