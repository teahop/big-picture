import type { NodeRec } from "./data";

/** Shared hover/selection state; views subscribe and redraw. */
export class State {
  hover: NodeRec | null = null;
  selected: NodeRec | null = null;
  private listeners: (() => void)[] = [];
  subscribe(cb: () => void): void { this.listeners.push(cb); }
  setHover(n: NodeRec | null): void { if (n !== this.hover) { this.hover = n; this.emit(); } }
  setSelected(n: NodeRec | null): void { this.selected = n; this.emit(); }
  get active(): NodeRec | null { return this.hover ?? this.selected; }
  private emit(): void { this.listeners.forEach((l) => l()); }
}
