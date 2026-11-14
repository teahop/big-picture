export interface Occupation { soc: string; title: string; share_pct: number }
export interface NodeRec {
  id: string; label: string; title: string; type: "ind"; level: number; parent: string | null;
  provenance: "official" | "estimated"; size: Record<string, number>; growth: number | null; xy: [number, number];
  naics_code?: string; top_occupations?: Occupation[]; remainder?: boolean;
  size_proxy?: string; value_added_basis?: string; weak_proxy?: boolean; replaces?: string[]; replaces_share?: Record<string, number>; zone?: string; members?: string[];
  hill?: [number, number];   // the hill's stretch (1 = round) and the angle of its long axis
  xy_by?: Record<SizeSetting, [number, number]>;   // v3: position per size setting (y follows the size measure); `xy` is the active one
}
export interface Edge { source: string; target: string; type: "ind-ind"; weight: number }
export type Measure = "employment" | "value_added" | "va_per_job";
/** Size setting: Activity sizes industries by jobs, Dollars by value added. */
export type SizeSetting = "activity" | "dollars";
export const SETTING_MEASURE: Record<SizeSetting, Measure> = { activity: "employment", dollars: "value_added" };
/** One level's terrain: a height grid per size setting. */
export interface LevelGrids { n: number; x: [number, number]; y: [number, number]; settings: Record<SizeSetting, { height: number[] }> }
export interface Meta {
  sources: { name: string; release: string; url: string; retrieved: string }[];
  other_sources: { name: string; url: string; retrieved: string }[];
  measure_labels: Record<string, string>;
  levels: number[]; level_notes?: Record<string, string>;
  terrain: { grid_size: number; margin: number; bandwidth_level0: number; bandwidth_per_level: number; combine: string; height_exponent: number };
  /** v3 axes: per size setting and level, growth clip g_lo..g_hi (percent, x -1..1) and size clip s_lo..s_hi (log, y 1..-1) */
  axes?: { scales: Record<SizeSetting, Record<string, AxisScale>>; params: { pull: number } };
}
export interface AxisScale { g_lo: number; g_hi: number; s_lo: number; s_hi: number }
export interface Bundle {
  nodes: NodeRec[]; edges: Edge[]; meta: Meta; byId: Map<string, NodeRec>;
  grids: Partial<Record<number, LevelGrids>>;
  maxHeight: Partial<Record<number, Record<SizeSetting, number>>>;
  childCount: Map<string, number>;
  setting: SizeSetting;   // which size setting node.xy currently follows
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(name);
  if (!res.ok) throw new Error("Could not load " + name + " (" + res.status + ")");
  return (await res.json()) as T;
}

function addGrids(b: Bundle, level: number, g: LevelGrids): void {
  b.grids[level] = g;
  const max = (v: number[]) => v.reduce((m, x) => Math.max(m, x), 0) || 1;
  b.maxHeight[level] = { activity: max(g.settings.activity.height), dollars: max(g.settings.dollars.height) };
}

function addNodes(b: Bundle, nodes: NodeRec[]): void {
  for (const n of nodes) {
    b.nodes.push(n); b.byId.set(n.id, n);
    if (n.xy_by) n.xy = n.xy_by[b.setting];
    for (const p of [n.parent, ...(n.replaces ?? [])]) if (p) b.childCount.set(p, (b.childCount.get(p) ?? 0) + 1);
  }
}

export async function loadBundle(): Promise<Bundle> {
  const [nodes, edges, raw, meta] = await Promise.all([
    getJson<NodeRec[]>("nodes.json"), getJson<Edge[]>("edges.json"), getJson<LevelGrids>("grids.json"), getJson<Meta>("meta.json"),
  ]);
  const b: Bundle = { nodes: [], edges, meta, byId: new Map(), grids: {}, maxHeight: {}, childCount: new Map(), setting: "activity" };
  addNodes(b, nodes); addGrids(b, 0, raw);
  return b;
}

/** Load Level 1 on first use. Resolves when its nodes, edges and terrain are ready. */
const loading = new Map<number, Promise<void>>();
export function ensureLevel(b: Bundle, level: number): Promise<void> {
  if (level === 0 || b.grids[level]) return Promise.resolve();
  if (!loading.has(level)) {
    loading.set(level, (async () => {
      const sfx = "_l" + level;
      const [nodes, raw] = await Promise.all([getJson<NodeRec[]>("nodes" + sfx + ".json"), getJson<LevelGrids>("grids" + sfx + ".json")]);
      addNodes(b, nodes);
      if (level === 1) b.edges.push(...(await getJson<Edge[]>("edges_l1.json")));
      addGrids(b, level, raw);
    })());
  }
  return loading.get(level)!;
}

/** Nodes drawn at a level of detail: a node is shown at level L if its level <= L and none of its children is (children
 *  replace their parent): Level 0 is the 20 sectors, Level 1 the 304 industries. */
export function visibleAt(b: Bundle, level: number): NodeRec[] {
  const parents = new Set<string>();
  for (const n of b.nodes) if (n.level <= level) for (const p of [n.parent, ...(n.replaces ?? [])]) if (p) parents.add(p);
  return b.nodes.filter((n) => n.level <= level && !parents.has(n.id));
}

export function levelMaxSize(b: Bundle, level: number, measure: string): number {
  return visibleAt(b, level).reduce((m, n) => Math.max(m, n.size[measure] ?? 0), 0) || 1;
}

/** Move every node to its position for a size setting (y follows the size measure, so the hills move). */
export function placeFor(b: Bundle, s: SizeSetting): void {
  b.setting = s;
  for (const n of b.nodes) if (n.xy_by) n.xy = n.xy_by[s];
}

/** The axis scale of a level under a size setting, if the bundle has axes. */
export function axisScale(b: Bundle, s: SizeSetting, level: number): AxisScale | undefined {
  return b.meta.axes?.scales[s]?.[String(level)];
}

/** Bilinear sample of a grid's `values` at layout coordinates (x, y). */
export function sampleAt(g: LevelGrids, values: number[], x: number, y: number): number {
  const fx = ((x - g.x[0]) / (g.x[1] - g.x[0])) * (g.n - 1);
  const fy = ((y - g.y[0]) / (g.y[1] - g.y[0])) * (g.n - 1);
  const i = Math.min(Math.max(Math.floor(fx), 0), g.n - 2);
  const j = Math.min(Math.max(Math.floor(fy), 0), g.n - 2);
  const tx = Math.min(Math.max(fx - i, 0), 1), ty = Math.min(Math.max(fy - j, 0), 1);
  const v = (a: number, c: number) => values[c * g.n + a];
  return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - ty) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * ty;
}

export interface Link { node: NodeRec; weight: number }

/** Most similar industries to `id` (by shared occupations). */
export function links(b: Bundle, id: string, k = 5): Link[] {
  const out: Link[] = [];
  for (const e of b.edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    const node = other ? b.byId.get(other) : undefined;
    if (node) out.push({ node, weight: e.weight });
  }
  return out.sort((a, c) => c.weight - a.weight).slice(0, k);
}

/** Value of a size measure as text. Value added is in billions of dollars, per-job values in thousands. */
export function fmtMeasure(measure: Measure, v: number | undefined): string {
  if (v === undefined || v === null) return "n/a";
  switch (measure) {
    case "employment": return fmtJobs(v);
    case "value_added": return v >= 1000 ? "$" + (v / 1000).toFixed(2) + " trillion" : v >= 1 ? "$" + v.toFixed(0) + " billion" : "$" + (v * 1000).toFixed(0) + " million";
    case "va_per_job": return "$" + Math.round(v) + "k per job";
  }
}
export function fmtJobs(thousands: number): string {
  return thousands >= 1000 ? (thousands / 1000).toFixed(1) + " million" : (thousands < 10 ? thousands.toFixed(1) : String(Math.round(thousands))) + "k";
}
export function fmtGrowth(pct: number | null): string { return pct === null ? "n/a" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"; }
