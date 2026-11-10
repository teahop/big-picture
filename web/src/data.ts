export interface Occupation { soc: string; title: string; share_pct: number }
export interface NodeRec {
  id: string; label: string; title: string; type: "ind" | "fld"; level: number; parent: string | null;
  provenance: "official" | "estimated"; size: Record<string, number>; growth: number | null; xy: [number, number];
  naics_code?: string; top_occupations?: Occupation[]; remainder?: boolean;
  domain?: string; description?: string; keywords?: string[]; top_subfields?: { name: string; works_us: number }[];
  size_proxy?: string; weak_proxy?: boolean; replaces?: string[]; zone?: string; members?: string[];
}
export interface Edge {
  source: string; target: string; type: "ind-ind" | "fld-fld" | "fld-ind"; weight: number;
  signals?: { occupational?: number; semantic: number };
}
export interface Grid { n: number; x: [number, number]; y: [number, number]; values: number[] }
export type Measure = "employment" | "works" | "rd";
export type ResearchMeasure = "works" | "rd";
type Grids = Record<Measure, Grid>;
interface RawGrids {
  industry: { measures: { employment: Grid } };
  research: { measures: { works: Grid; rd: Grid } };
}
export interface Meta {
  sources: { name: string; release: string; url: string; retrieved: string }[];
  research_sources: { name: string; url: string; retrieved: string }[];
  measure_labels: Record<string, string>;
  bridge: { field_to_cip_reviewed: boolean; herd_mapping_reviewed: boolean };
  levels: number[]; level_notes?: Record<string, string>; deep_topic_links_reviewed?: boolean;
}
export interface Bundle {
  nodes: NodeRec[]; edges: Edge[]; meta: Meta; byId: Map<string, NodeRec>;
  grids: Partial<Record<number, Grids>>;
  maxAbs: Partial<Record<number, Record<Measure, number>>>;
  childCount: Map<string, number>;
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(name);
  if (!res.ok) throw new Error("Could not load " + name + " (" + res.status + ")");
  return (await res.json()) as T;
}

const absMax = (g: Grid) => g.values.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

function addGrids(b: Bundle, level: number, raw: RawGrids): void {
  const grids: Grids = { employment: raw.industry.measures.employment, works: raw.research.measures.works, rd: raw.research.measures.rd };
  b.grids[level] = grids;
  b.maxAbs[level] = { employment: absMax(grids.employment), works: absMax(grids.works), rd: absMax(grids.rd) };
}

function addNodes(b: Bundle, nodes: NodeRec[]): void {
  for (const n of nodes) {
    b.nodes.push(n); b.byId.set(n.id, n);
    for (const p of [n.parent, ...(n.replaces ?? [])]) if (p) b.childCount.set(p, (b.childCount.get(p) ?? 0) + 1);
  }
}

export async function loadBundle(): Promise<Bundle> {
  const [nodes, edges, raw, meta] = await Promise.all([
    getJson<NodeRec[]>("nodes.json"), getJson<Edge[]>("edges.json"), getJson<RawGrids>("grids.json"), getJson<Meta>("meta.json"),
  ]);
  const b: Bundle = { nodes: [], edges, meta, byId: new Map(), grids: {}, maxAbs: {}, childCount: new Map() };
  addNodes(b, nodes); addGrids(b, 0, raw);
  return b;
}

/** Load Level n on first use (Level 2 needs Level 1 first). Resolves when its nodes, edges and terrain are ready. */
const loading = new Map<number, Promise<void>>();
export function ensureLevel(b: Bundle, level: number): Promise<void> {
  if (level === 0 || b.grids[level]) return Promise.resolve();
  if (!loading.has(level)) {
    loading.set(level, (async () => {
      if (level === 2) await ensureLevel(b, 1);
      const sfx = "_l" + level;
      const [nodes, raw] = await Promise.all([getJson<NodeRec[]>("nodes" + sfx + ".json"), getJson<RawGrids>("grids" + sfx + ".json")]);
      addNodes(b, nodes);
      b.edges.push(...(await getJson<Edge[]>("edges_l" + level + ".json")));
      addGrids(b, level, raw);
    })());
  }
  return loading.get(level)!;
}

/** Nodes drawn at a level of detail: a node is shown at level L if its level <= L and none of
 *  its children is (children replace their parent). Level 2 therefore shows topics inside the
 *  deep zones and Level 1 subfields everywhere else. A deep: industry node can replace several
 *  Level 1 industries (`replaces`), because its size is drawn from all of them. */
export function visibleAt(b: Bundle, level: number): NodeRec[] {
  const parents = new Set<string>();
  for (const n of b.nodes) if (n.level <= level) for (const p of [n.parent, ...(n.replaces ?? [])]) if (p) parents.add(p);
  return b.nodes.filter((n) => n.level <= level && !parents.has(n.id));
}

export function levelMaxSize(b: Bundle, level: number, measure: string): number {
  return visibleAt(b, level).reduce((m, n) => Math.max(m, n.size[measure] ?? 0), 0) || 1;
}

/** Bilinear height at layout coordinates (x, y); signed (research is negative). */
export function heightAt(g: Grid, x: number, y: number): number {
  const fx = ((x - g.x[0]) / (g.x[1] - g.x[0])) * (g.n - 1);
  const fy = ((y - g.y[0]) / (g.y[1] - g.y[0])) * (g.n - 1);
  const i = Math.min(Math.max(Math.floor(fx), 0), g.n - 2);
  const j = Math.min(Math.max(Math.floor(fy), 0), g.n - 2);
  const tx = Math.min(Math.max(fx - i, 0), 1), ty = Math.min(Math.max(fy - j, 0), 1);
  const v = (a: number, c: number) => g.values[c * g.n + a];
  return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - ty) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * ty;
}

export interface Link { node: NodeRec; weight: number; signals?: Edge["signals"] }

/** Strongest links of `id` to nodes of `otherType` (bridge edges when crossing layers). */
export function links(b: Bundle, id: string, otherType: "ind" | "fld", k = 5): Link[] {
  const out: Link[] = [];
  for (const e of b.edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    if (!other) continue;
    const node = b.byId.get(other);
    if (node && node.type === otherType) out.push({ node, weight: e.weight, signals: e.signals });
  }
  return out.sort((a, c) => c.weight - a.weight).slice(0, k);
}

export function fmtJobs(thousands: number): string {
  return thousands >= 1000 ? (thousands / 1000).toFixed(1) + " million" : Math.round(thousands) + " thousand";
}
export function fmtWorks(n: number): string {
  return n >= 1e6 ? (n / 1e6).toFixed(2) + " million" : n >= 1000 ? Math.round(n / 1000) + " thousand" : String(n);
}
export function fmtDollars(thousands: number): string {
  return thousands >= 1e6 ? "$" + (thousands / 1e6).toFixed(1) + " billion" : "$" + Math.round(thousands / 1000) + " million";
}
export function fmtGrowth(pct: number | null): string { return pct === null ? "n/a" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"; }
