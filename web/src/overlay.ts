/** Optional private footprint (Phase 4). Present only when a local `private/overlay.json` exists and the dev server
 *  exposes it; the public build never contains it, so a published site simply has no footprint control. */
export type Footprint = "off" | "total" | "tenure" | "connections" | "skills" | "education" | "all";
export interface OverlayData {
  components: string[];
  extent: { x: [number, number]; y: [number, number]; n: number };
  nodes: Record<string, Record<string, Record<string, number>>>;
  grids: Record<string, Record<string, { max: number; values: number[] }>>;
}

export async function loadOverlay(): Promise<OverlayData | null> {
  try {
    const res = await fetch("_private/overlay.json", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return (await res.json()) as OverlayData;
  } catch { return null; }
}

/** Footprint colour (teal) blended over a terrain colour; `h` in 0..1. */
import { heatRgb } from "./theme";
export function blendHeat(base: [number, number, number], h: number): [number, number, number] {
  const a = Math.min(1, Math.pow(Math.max(h, 0), 0.7)) * 0.85;
  return [0, 1, 2].map((i) => base[i] * (1 - a) + heatRgb[i] * a) as [number, number, number];
}
