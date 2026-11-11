import { SETTING_MEASURE, type Measure, type NodeRec, type SizeSetting } from "./data";
import type { Computed } from "./footprint";

export type FootprintMode = "off" | "career" | "network";
/** Trial treatments for touched areas (Phase 2 variants; the owner picks one and the switch goes). */
export type Look = "outline" | "flowers";
export type Fade = "light" | "strong";

export type LodSetting = "auto" | "0" | "1" | "2";

/** Shared view state; views subscribe and redraw. */
export class State {
  hover: NodeRec | null = null;
  selected: NodeRec | null = null;
  size: SizeSetting = "activity";
  lod: LodSetting = "auto";
  level = 0;                       // level of detail currently drawn
  visibleIds = new Set<string>();  // nodes drawn at that level
  fpMode: FootprintMode = "off";
  fp: Computed | null = null;      // weights of the footprint being shown (null when off)
  fpVersion = 0;                   // bumps whenever `fp` changes, so views know to redraw
  look: Look = "outline";
  fade: Fade = "light";
  focus: string[] = [];            // breadcrumb: the touched nodes stepped into, outermost first
  private listeners: (() => void)[] = [];
  subscribe(cb: () => void): void { this.listeners.push(cb); }
  setHover(n: NodeRec | null): void { if (n !== this.hover) { this.hover = n; this.emit(); } }
  setSelected(n: NodeRec | null): void { this.selected = n; this.emit(); }
  setSize(s: SizeSetting): void { this.size = s; this.emit(); }
  setLod(l: LodSetting): void { this.lod = l; this.emit(); }
  setFootprint(mode: FootprintMode, fp: Computed | null): void { this.fpMode = mode; this.fp = mode === "off" ? null : fp; this.fpVersion++; this.emit(); }
  setLook(l: Look): void { this.look = l; this.emit(); }
  setFade(f: Fade): void { this.fade = f; this.emit(); }
  setFocus(path: string[]): void { this.focus = path; this.emit(); }
  /** Touched nodes at the level being drawn, with their share of the footprint (null when no footprint is shown). */
  touchedNow(): Map<string, number> | null { return this.fp ? this.fp.touched[this.level as 0 | 1 | 2] : null; }
  setLevel(level: number, ids: Set<string>): void { this.level = level; this.visibleIds = ids; this.emit(); }
  /** Size measure under the current size setting. */
  get measure(): Measure { return SETTING_MEASURE[this.size]; }
  get active(): NodeRec | null { return this.hover ?? this.selected; }
  isVisible(n: NodeRec): boolean { return this.visibleIds.has(n.id); }
  private emit(): void { this.listeners.forEach((l) => l()); }
}
