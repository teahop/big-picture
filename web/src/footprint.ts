/** Footprint weights (SPEC 6.2), computed in the page from a footprint's entries. Pure: it knows nothing about where
 *  the footprint came from (the owner's private file, the synthetic sample, or, from Phase 3, a CV read in the browser).
 *
 *  weight(node) = sum over entries of share * years * recency (roles; recency halves every half-life since the role
 *  ended) or share * degree_years (degrees). Weights roll up: a Level 1 industry passes its weight to its sector, a
 *  deep: node to the industries it replaces (replaces_share). Every level holds the same total. A node is touched when
 *  it holds at least `touched_threshold` of the total. The Python twin is pipeline/src/imap/footprint.py. */

export interface Entry { kind: "role" | "degree"; label: string; years?: number; end_year?: number | null; nodes: Record<string, number> }
export interface FootprintData { schema: number; as_of: number; entries: Entry[]; note?: string }
export interface FootprintCfg { half_life_years: number; degree_years: number; touched_threshold: number }
export interface HierNode { id: string; level: number; parent: string | null; replaces_share?: Record<string, number> }
export type Weights = Map<string, number>;

export interface Hierarchy { level: Map<string, number>; up: Map<string, Record<string, number>> }

export function hierarchy(nodes: HierNode[]): Hierarchy {
  const level = new Map<string, number>(), up = new Map<string, Record<string, number>>();
  for (const n of nodes) {
    level.set(n.id, n.level);
    up.set(n.id, n.replaces_share ?? (n.parent ? { [n.parent]: 1 } : {}));
  }
  return { level, up };
}

export function entryWeight(e: Entry, asOf: number, cfg: FootprintCfg): number {
  if (e.kind === "degree") return cfg.degree_years;
  const age = e.end_year === null || e.end_year === undefined ? 0 : Math.max(0, asOf - e.end_year);
  return (e.years ?? 0) * Math.pow(0.5, age / cfg.half_life_years);
}

/** Weights at Level 0, 1 and 2 from weights on the finest nodes. Unknown ids are skipped and reported. */
export function rollUp(finest: Weights, h: Hierarchy): { levels: [Weights, Weights, Weights]; unknown: string[] } {
  const unknown = [...finest.keys()].filter((id) => !h.level.has(id));
  const l2: Weights = new Map([...finest].filter(([id]) => h.level.has(id)));
  const lift = (src: Weights, target: number): Weights => {
    const out: Weights = new Map();
    for (const [id, w] of src) {
      const stack: [string, number][] = [[id, w]];
      while (stack.length) {
        const [n, v] = stack.pop()!;
        const up = h.up.get(n) ?? {};
        if ((h.level.get(n) ?? 0) <= target || !Object.keys(up).length) out.set(n, (out.get(n) ?? 0) + v);
        else for (const [p, s] of Object.entries(up)) stack.push([p, v * s]);
      }
    }
    return out;
  };
  const l1 = lift(l2, 1);
  return { levels: [lift(l1, 0), l1, l2], unknown };
}

/** Touched nodes and their share of the total, largest first. */
export function touched(w: Weights, threshold: number): Map<string, number> {
  const total = [...w.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return new Map();
  return new Map([...w].map(([id, v]) => [id, v / total] as [string, number]).filter(([, s]) => s >= threshold).sort((a, b) => b[1] - a[1]));
}

export interface Computed {
  levels: [Weights, Weights, Weights];
  touched: [Map<string, number>, Map<string, number>, Map<string, number>];
  /** per entry, its own weights at each level (for "why is this node touched") */
  perEntry: { entry: Entry; weight: number; levels: [Weights, Weights, Weights] }[];
  unknown: string[];
}

/** Weights of a footprint from its entries. */
export function compute(fp: FootprintData, h: Hierarchy, cfg: FootprintCfg): Computed {
  const fromFinest = (f: Weights) => rollUp(f, h);
  const total: Weights = new Map();
  const perEntry = fp.entries.map((entry) => {
    const weight = entryWeight(entry, fp.as_of, cfg);
    const f: Weights = new Map(Object.entries(entry.nodes).map(([id, s]) => [id, s * weight]));
    for (const [id, v] of f) total.set(id, (total.get(id) ?? 0) + v);
    return { entry, weight, levels: fromFinest(f).levels };
  });
  const r = fromFinest(total);
  return { levels: r.levels, touched: r.levels.map((l) => touched(l, cfg.touched_threshold)) as Computed["touched"], perEntry, unknown: r.unknown };
}

/** Entries behind a node at a level, largest contribution first. */
export function entriesAt(c: Computed, id: string, level: number): { entry: Entry; share: number }[] {
  const total = c.levels[level].get(id) ?? 0;
  if (!total) return [];
  return c.perEntry.map((p) => ({ entry: p.entry, share: (p.levels[level].get(id) ?? 0) / total }))
    .filter((x) => x.share > 0.005).sort((a, b) => b.share - a.share);
}

/** True when `id` rolls up into `ancestor` (or is it). */
export function descends(h: Hierarchy, id: string, ancestor: string): boolean {
  const stack = [id], seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === ancestor) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...Object.keys(h.up.get(n) ?? {}));
  }
  return false;
}

/** The footprint the page opens with: the owner's private file on the dev and preview servers when it is there,
 *  otherwise the synthetic sample career (made up; SPEC 10, question 3). `?footprint=synthetic` forces the sample. */
export async function loadFootprint(): Promise<{ data: FootprintData; sample: boolean } | null> {
  const sample = async () => ({ data: (await import("./fixtures/synthetic_footprint.json")).default as unknown as FootprintData, sample: true });
  if (new URLSearchParams(location.search).get("footprint") === "synthetic") return sample();
  if (import.meta.env.DEV || location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    try {
      const res = await fetch("_private/footprint.json", { cache: "no-store" });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) return { data: (await res.json()) as FootprintData, sample: false };
    } catch { /* no private file: fall through to the sample */ }
  }
  return sample();
}
