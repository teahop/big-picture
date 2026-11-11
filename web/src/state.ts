import { SETTING_MEASURE, type Measure, type NodeRec, type SizeSetting } from "./data";
import type { OverlayData } from "./overlay";

export type LodSetting = "auto" | "0" | "1" | "2";

/** Shared view state; views subscribe and redraw. */
export class State {
  hover: NodeRec | null = null;
  selected: NodeRec | null = null;
  size: SizeSetting = "activity";
  lod: LodSetting = "auto";
  overlay: OverlayData | null = null;   // private, only when present locally
  level = 0;                       // level of detail currently drawn
  visibleIds = new Set<string>();  // nodes drawn at that level
  private listeners: (() => void)[] = [];
  subscribe(cb: () => void): void { this.listeners.push(cb); }
  setHover(n: NodeRec | null): void { if (n !== this.hover) { this.hover = n; this.emit(); } }
  setSelected(n: NodeRec | null): void { this.selected = n; this.emit(); }
  setSize(s: SizeSetting): void { this.size = s; this.emit(); }
  setLod(l: LodSetting): void { this.lod = l; this.emit(); }
  setLevel(level: number, ids: Set<string>): void { this.level = level; this.visibleIds = ids; this.emit(); }
  /** Size measure under the current size setting. */
  get measure(): Measure { return SETTING_MEASURE[this.size]; }
  get active(): NodeRec | null { return this.hover ?? this.selected; }
  isVisible(n: NodeRec): boolean { return this.visibleIds.has(n.id); }
  private emit(): void { this.listeners.forEach((l) => l()); }
}
