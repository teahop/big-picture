import type { NodeRec, ResearchMeasure } from "./data";

export type LayerMode = "industry" | "research" | "stacked" | "overlaid";

/** Shared view state; views subscribe and redraw. */
export class State {
  hover: NodeRec | null = null;
  selected: NodeRec | null = null;
  mode: LayerMode = "overlaid";
  researchMeasure: ResearchMeasure = "works";
  private listeners: (() => void)[] = [];
  subscribe(cb: () => void): void { this.listeners.push(cb); }
  setHover(n: NodeRec | null): void { if (n !== this.hover) { this.hover = n; this.emit(); } }
  setSelected(n: NodeRec | null): void { this.selected = n; this.emit(); }
  setMode(m: LayerMode): void { this.mode = m; this.emit(); }
  setResearchMeasure(m: ResearchMeasure): void { this.researchMeasure = m; this.emit(); }
  get active(): NodeRec | null { return this.hover ?? this.selected; }
  showsIndustry(): boolean { return this.mode !== "research"; }
  showsResearch(): boolean { return this.mode !== "industry"; }
  isVisible(n: NodeRec): boolean { return n.type === "ind" ? this.showsIndustry() : this.showsResearch(); }
  private emit(): void { this.listeners.forEach((l) => l()); }
}
