import type { NodeRec, ResearchMeasure } from "./data";
import type { Footprint, OverlayData } from "./overlay";

export type LayerMode = "industry" | "research" | "stacked" | "overlaid";
export type LodSetting = "auto" | "0" | "1" | "2";

/** Shared view state; views subscribe and redraw. */
export class State {
  hover: NodeRec | null = null;
  selected: NodeRec | null = null;
  mode: LayerMode = "overlaid";
  researchMeasure: ResearchMeasure = "works";
  lod: LodSetting = "auto";
  footprint: Footprint = "off";
  ranked = new Set<string>();       // top where-next candidates, highlighted on the map (private)
  overlay: OverlayData | null = null;   // private, only when present locally
  level = 0;                       // level of detail currently drawn
  visibleIds = new Set<string>();  // nodes drawn at that level
  private listeners: (() => void)[] = [];
  subscribe(cb: () => void): void { this.listeners.push(cb); }
  setHover(n: NodeRec | null): void { if (n !== this.hover) { this.hover = n; this.emit(); } }
  setSelected(n: NodeRec | null): void { this.selected = n; this.emit(); }
  setMode(m: LayerMode): void { this.mode = m; this.emit(); }
  setResearchMeasure(m: ResearchMeasure): void { this.researchMeasure = m; this.emit(); }
  setLod(l: LodSetting): void { this.lod = l; this.emit(); }
  setRanked(ids: Set<string>): void { this.ranked = ids; this.emit(); }
  setFootprint(f: Footprint): void { this.footprint = f; this.emit(); }
  /** Footprint heat grid for the level being drawn, or null when off or missing. */
  heatGrid(): { max: number; values: number[] } | null {
    return this.footprint === "off" || !this.overlay ? null : this.overlay.grids[String(this.level)]?.[this.footprint] ?? null;
  }
  setLevel(level: number, ids: Set<string>): void { this.level = level; this.visibleIds = ids; this.emit(); }
  get active(): NodeRec | null { return this.hover ?? this.selected; }
  showsIndustry(): boolean { return this.mode !== "research"; }
  showsResearch(): boolean { return this.mode !== "industry"; }
  isVisible(n: NodeRec): boolean {
    return this.visibleIds.has(n.id) && (n.type === "ind" ? this.showsIndustry() : this.showsResearch());
  }
  private emit(): void { this.listeners.forEach((l) => l()); }
}
