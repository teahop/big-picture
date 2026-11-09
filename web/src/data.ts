export interface Occupation { soc: string; title: string; share_pct: number }
export interface NodeRec {
  id: string; label: string; title: string; type: "ind" | "fld"; level: number; parent: string | null;
  provenance: "official" | "estimated"; size: Record<string, number>; growth: number; xy: [number, number];
  naics_code?: string; top_occupations?: Occupation[];
  domain?: string; description?: string; top_subfields?: { name: string; works_us: number }[];
}
export interface Edge {
  source: string; target: string; type: "ind-ind" | "fld-fld" | "fld-ind"; weight: number;
  signals?: { occupational: number; semantic: number };
}
export interface Grid { n: number; x: [number, number]; y: [number, number]; values: number[] }
export type IndustryMeasure = "employment";
export type ResearchMeasure = "works" | "rd";
interface RawGrids {
  industry: { measures: Record<IndustryMeasure, Grid> };
  research: { measures: Record<ResearchMeasure, Grid> };
}
export interface Meta {
  sources: { name: string; release: string; url: string; retrieved: string }[];
  research_sources: { name: string; url: string; retrieved: string }[];
  measure_labels: Record<string, string>;
  bridge: { field_to_cip_reviewed: boolean; herd_mapping_reviewed: boolean };
}
export interface Bundle {
  nodes: NodeRec[]; edges: Edge[]; meta: Meta; byId: Map<string, NodeRec>;
  grids: { employment: Grid; works: Grid; rd: Grid };
  maxAbs: Record<IndustryMeasure | ResearchMeasure, number>;
  maxSize: Record<string, number>;
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(name);
  if (!res.ok) throw new Error(`Could not load ${name} (${res.status})`);
  return (await res.json()) as T;
}

const absMax = (g: Grid) => g.values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

export async function loadBundle(): Promise<Bundle> {
  const [nodes, edges, raw, meta] = await Promise.all([
    getJson<NodeRec[]>("nodes.json"), getJson<Edge[]>("edges.json"), getJson<RawGrids>("grids.json"), getJson<Meta>("meta.json"),
  ]);
  const grids = { employment: raw.industry.measures.employment, works: raw.research.measures.works, rd: raw.research.measures.rd };
  const maxSize: Record<string, number> = {};
  for (const n of nodes) for (const [k, v] of Object.entries(n.size)) maxSize[k] = Math.max(maxSize[k] ?? 0, v);
  return {
    nodes, edges, meta, grids, byId: new Map(nodes.map((n) => [n.id, n])), maxSize,
    maxAbs: { employment: absMax(grids.employment), works: absMax(grids.works), rd: absMax(grids.rd) },
  };
}

/** Bilinear height at layout coordinates (x, y); signed (research is negative). */
export function heightAt(g: Grid, x: number, y: number): number {
  const fx = ((x - g.x[0]) / (g.x[1] - g.x[0])) * (g.n - 1);
  const fy = ((y - g.y[0]) / (g.y[1] - g.y[0])) * (g.n - 1);
  const i = Math.min(Math.max(Math.floor(fx), 0), g.n - 2);
  const j = Math.min(Math.max(Math.floor(fy), 0), g.n - 2);
  const tx = Math.min(Math.max(fx - i, 0), 1), ty = Math.min(Math.max(fy - j, 0), 1);
  const v = (a: number, b: number) => g.values[b * g.n + a];
  return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - ty) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * ty;
}

export interface Link { node: NodeRec; weight: number; signals?: Edge["signals"] }

/** Strongest links of `id` to nodes of `otherType` (bridge edges when crossing layers). */
export function links(b: Bundle, id: string, otherType: "ind" | "fld", k = 5): Link[] {
  const out: Link[] = [];
  for (const e of b.edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (!other) continue;
    const node = b.byId.get(other)!;
    if (node.type === otherType) out.push({ node, weight: e.weight, signals: e.signals });
  }
  return out.sort((a, c) => c.weight - a.weight).slice(0, k);
}

export function fmtJobs(thousands: number): string {
  return thousands >= 1000 ? (thousands / 1000).toFixed(1) + " million" : Math.round(thousands) + " thousand";
}
export function fmtWorks(n: number): string {
  return n >= 1e6 ? (n / 1e6).toFixed(2) + " million" : Math.round(n / 1000) + " thousand";
}
export function fmtDollars(thousands: number): string {
  return thousands >= 1e6 ? "$" + (thousands / 1e6).toFixed(1) + " billion" : "$" + Math.round(thousands / 1000) + " million";
}
export function fmtGrowth(pct: number): string { return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"; }
