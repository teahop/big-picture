/** Optional private footprint (v1 Phase 4; v2 Phase 2 rebuilds it, so its control is hidden for now). Present only when a local `private/overlay.json` exists and the dev server
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
