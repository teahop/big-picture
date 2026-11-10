/** Where-next ranking in the viewer. The private score file holds each candidate's components; the weighted sum and the
 *  toggle multipliers are applied here so toggles and mission tags respond instantly. Same formula as pipeline/src/imap/score.py. */
export interface ScoreNode {
  id: string; type: "ind" | "fld"; label: string; level: number;
  components: { adjacency: number; growth: number; size: number; novelty: number };
  growth_pct: number | null; presence: number; lq: number | null; lq_how: string; geo_pct: number;
  pay_usd: number | null; pay_pct: number | null; tag: number; tag_source: string; near: string; base: number;
}
export interface ScoreData {
  weights: Record<string, number>; toggles: Record<string, { enabled: boolean }>;
  multiplier_range: [number, number]; pay_available: boolean; nodes: ScoreNode[];
}
export interface Toggles { pay: boolean; mission: boolean; geography: boolean }

export async function loadScore(): Promise<ScoreData | null> {
  try {
    const res = await fetch("_private/score.json", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return (await res.json()) as ScoreData;
  } catch { return null; }
}

const mult = (p: number, [lo, hi]: [number, number]) => lo + (hi - lo) * p;

export function scoreOf(n: ScoreNode, d: ScoreData, t: Toggles, tags: Map<string, number>): number {
  const c = n.components, w = d.weights;
  let s = w.adjacency * c.adjacency + w.growth * c.growth + w.size * c.size + w.novelty * c.novelty;
  if (t.geography) s *= mult(n.geo_pct, d.multiplier_range);
  if (t.pay && n.pay_pct !== null) s *= mult(n.pay_pct, d.multiplier_range);
  if (t.mission) s *= 1 + 0.25 * (tags.get(n.id) ?? n.tag);
  return s;
}

export function rank(d: ScoreData, type: "ind" | "fld", t: Toggles, tags: Map<string, number>): { node: ScoreNode; score: number }[] {
  return d.nodes.filter((n) => n.type === type).map((node) => ({ node, score: scoreOf(node, d, t, tags) })).sort((a, b) => b.score - a.score);
}

/** One plain line on why a node scored as it did: its two strongest weighted components plus any toggle effect. */
export function reason(n: ScoreNode, d: ScoreData, t: Toggles, tags: Map<string, number>): string {
  const w = d.weights, c = n.components;
  const parts: [number, string][] = [
    [w.adjacency * c.adjacency, n.near ? "close to " + n.near : "close to your footprint"],
    [w.growth * c.growth, n.growth_pct === null ? "growth unknown" : (n.growth_pct >= 0 ? "growing " : "shrinking ") + Math.abs(n.growth_pct).toFixed(0) + "%"],
    [w.size * c.size, "large"], [w.novelty * c.novelty, n.presence > 0 ? "partly new to you" : "new to you"],
  ];
  const top = parts.sort((a, b) => b[0] - a[0]).slice(0, 2).map((p) => p[1]);
  const extra: string[] = [];
  if (t.geography && n.lq !== null) extra.push("local concentration " + n.lq.toFixed(1) + "x");
  if (t.pay && n.pay_usd !== null) extra.push("typical pay about $" + Math.round(n.pay_usd / 1000) + "k");
  if (t.mission) { const tag = tags.get(n.id) ?? n.tag; if (tag) extra.push("mission tag " + (tag > 0 ? "+" : "") + tag); }
  return [...top, ...extra].join(", ");
}
