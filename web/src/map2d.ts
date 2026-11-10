import { type Bundle, type Grid, type Measure, type NodeRec, heightAt, levelMaxSize } from "./data";
import { BANDS, bandColour, readTheme, rgbOf } from "./theme";
import { blendHeat } from "./overlay";
import type { State } from "./state";

type Layer = "ind" | "fld";
interface Panel { x: number; y: number; w: number; h: number; layers: Layer[] }
type RGB = [number, number, number];

/** Top-down terraced contour map: the fallback for devices without WebGL and for screenshots.
 *  Stacked mode shows the two terrains one above the other; overlaid blends them. */
export class Map2D {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private bg: HTMLCanvasElement | null = null;
  private bgKey = "";
  private spanX: number; private spanY: number; private dpr = 1;
  private k = 1; private cx: number; private cy: number;     // zoom and the layout point at the centre of the view
  private autoLevel = 0; private moved = false; private raf = 0;
  onAutoLevel: (level: number) => void = () => {};

  constructor(private host: HTMLElement, private b: Bundle, private state: State) {
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Top-down contour map of industry sectors and research fields. Use the lists for keyboard selection.");
    host.appendChild(this.canvas);
    const g = b.grids[0]!.employment;
    this.spanX = g.x[1] - g.x[0]; this.spanY = g.y[1] - g.y[0];
    this.cx = (g.x[0] + g.x[1]) / 2; this.cy = (g.y[0] + g.y[1]) / 2;
    this.bindView();
    this.canvas.addEventListener("pointermove", (e) => this.state.setHover(this.nodeAt(e)));
    this.canvas.addEventListener("pointerleave", () => this.state.setHover(null));
    this.canvas.addEventListener("click", (e) => { if (!this.moved) this.state.setSelected(this.nodeAt(e)); });
    state.subscribe(() => this.draw());
    new ResizeObserver(() => this.resize()).observe(host);
  }

  private measure(layer: Layer): Measure { return layer === "ind" ? this.state.industryMeasure : this.state.researchMeasure; }
  private grid(layer: Layer): Grid { return this.b.grids[this.state.level]![this.measure(layer)]; }
  private maxAbs(layer: Layer): number { return this.b.maxAbs[this.state.level]![this.measure(layer)]; }

  private panels(): Panel[] {
    const w = this.canvas.width, h = this.canvas.height, m = this.state.mode;
    if (m === "stacked") return [{ x: 0, y: 0, w, h: h / 2, layers: ["ind"] }, { x: 0, y: h / 2, w, h: h / 2, layers: ["fld"] }];
    return [{ x: 0, y: 0, w, h, layers: m === "industry" ? ["ind"] : m === "research" ? ["fld"] : ["fld", "ind"] }];
  }

  private geom(p: Panel) {
    const g = this.b.grids[0]!.employment, s = Math.min(p.w / this.spanX, p.h / this.spanY) * 0.96 * this.k;
    return { s, ox: p.x + p.w / 2 - (this.cx - g.x[0]) * s, oy: p.y + p.h / 2 - (g.y[1] - this.cy) * s };
  }
  private px(p: Panel, n: NodeRec): [number, number] {
    const { s, ox, oy } = this.geom(p), g = this.b.grids[0]!.employment;
    return [ox + (n.xy[0] - g.x[0]) * s, oy + (g.y[1] - n.xy[1]) * s]; // north (+y) is up
  }

  private nodeAt(e: MouseEvent): NodeRec | null {
    const r = this.canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * this.dpr, my = (e.clientY - r.top) * this.dpr;
    let best: NodeRec | null = null, bd = 30 * this.dpr;
    for (const p of this.panels()) for (const n of this.b.nodes) {
      if (!p.layers.includes(n.type) || !this.state.visibleIds.has(n.id)) continue;
      const [x, y] = this.px(p, n); const d = Math.hypot(x - mx, y - my);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  applyTheme(): void { this.bg = null; this.draw(); }

  private paintPanel(c: CanvasRenderingContext2D, p: Panel): void {
    const t = readTheme(), { s, ox, oy } = this.geom(p);
    const w = Math.round(p.w), h = Math.round(p.h), img = c.createImageData(w, h);
    const bgRgb = rgbOf(t.bg), fg = rgbOf(t.fg), overlay = p.layers.length > 1;
    const heat = this.state.heatGrid(), hg = heat ? { n: this.grid(p.layers[0]).n, x: this.grid(p.layers[0]).x, y: this.grid(p.layers[0]).y, values: heat.values } : null;
    const bands: Record<string, Int8Array> = {};
    for (const layer of p.layers) {
      const g = this.grid(layer), max = this.maxAbs(layer), arr = new Int8Array(w * h);
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        const x = g.x[0] + (px + p.x - ox) / s, y = g.y[1] - (py + p.y - oy) / s;
        arr[py * w + px] = x < g.x[0] || x > g.x[1] || y < g.y[0] || y > g.y[1] ? -1
          : Math.min(Math.floor((Math.abs(heightAt(g, x, y)) / max) * BANDS), BANDS - 1);
      }
      bands[layer] = arr;
    }
    const edge = (arr: Int8Array, i: number, px: number, py: number) =>
      (px + 1 < w && arr[i + 1] !== arr[i]) || (py + 1 < h && arr[i + w] !== arr[i]);
    const mix = (a: RGB, b: RGB, k: number): RGB => [0, 1, 2].map((q) => a[q] * (1 - k) + b[q] * k) as RGB;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const i = py * w + px;
      let rgb: RGB = bgRgb;
      for (const layer of p.layers) {              // research first, industry on top
        const b = bands[layer][i];
        if (b < 0) continue;
        const col = bandColour(t, layer === "ind" ? "ind" : "res", (b + 0.5) / BANDS);
        if (overlay && layer === "ind") { if (b >= 1) rgb = mix(rgb, col, 0.6); }
        else rgb = col;
        if (edge(bands[layer], i, px, py)) rgb = mix(rgb, fg, 0.4);
      }
      if (hg) {
        const x = hg.x[0] + (px + p.x - ox) / s, y = hg.y[1] - (py + p.y - oy) / s;
        if (x >= hg.x[0] && x <= hg.x[1] && y >= hg.y[0] && y <= hg.y[1]) { const hv = heightAt(hg, x, y); if (hv > 0.02) rgb = blendHeat(rgb, hv); }
      }
      img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    }
    c.putImageData(img, Math.round(p.x), Math.round(p.y));
  }

  draw(): void {
    if (!this.canvas.width) return;
    const key = [this.state.mode, this.state.researchMeasure, this.state.industryMeasure, this.state.level, this.state.footprint, this.k.toFixed(3), this.cx.toFixed(4), this.cy.toFixed(4)].join("|");
    if (!this.bg || key !== this.bgKey) {
      const off = document.createElement("canvas"); off.width = this.canvas.width; off.height = this.canvas.height;
      const c = off.getContext("2d")!;
      for (const p of this.panels()) this.paintPanel(c, p);
      this.bg = off; this.bgKey = key;
    }
    const t = readTheme(), ctx = this.ctx, d = this.dpr;
    ctx.drawImage(this.bg, 0, 0);
    ctx.font = 12 * d + "px \"DM Sans\", system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const p of this.panels()) {
      const nodes = this.b.nodes.filter((n) => p.layers.includes(n.type) && this.state.visibleIds.has(n.id))
        .sort((a, c) => this.rel(c) - this.rel(a));
      let labels = 0;
      for (const n of nodes) {
        const [x, y] = this.px(p, n);
        if (x < -20 * d || y < -20 * d || x > this.canvas.width + 20 * d || y > this.canvas.height + 20 * d) continue;   // off screen
        const on = this.state.active?.id === n.id || this.state.selected?.id === n.id;
        const r = (3 + 11 * Math.sqrt(this.rel(n))) * d * (n.level === 0 ? 1 : n.level === 1 ? 0.8 : 0.65);
        const top = this.state.ranked.has(n.id);
        ctx.lineWidth = (on || top ? 3 : 1.5) * d; ctx.strokeStyle = on ? t.accent : top ? t.footprint : t.fg;
        ctx.setLineDash(n.provenance === "estimated" ? [4 * d, 3 * d] : []);
        ctx.beginPath();
        if (n.type === "ind") ctx.arc(x, y, r, 0, Math.PI * 2);
        else { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
        ctx.stroke(); ctx.setLineDash([]);
        const text = (n.provenance === "estimated" ? "\u2248 " : "") + (n.type === "ind" ? "▲ " : "▼ ") + n.label, w = ctx.measureText(text).width, ly = y - r - 3 * d;
        const box = { x0: x - w / 2, x1: x + w / 2, y0: ly - 14 * d, y1: ly };
        if (!on && (labels >= Map2D.MAX_LABELS || x - w / 2 < 0 || x + w / 2 > this.canvas.width)) continue;   // few labels, none cut by the edge
        if (!on && placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) continue;
        placed.push(box); labels++;
        ctx.lineWidth = 3 * d; ctx.strokeStyle = t.bg; ctx.strokeText(text, x, ly);
        ctx.fillStyle = on ? t.accent : t.fg; ctx.fillText(text, x, ly);
      }
    }
    this.drawCentroid(ctx, d);
  }

  private drawCentroid(ctx: CanvasRenderingContext2D, d: number): void {
    const c = this.state.footprint !== "off" ? this.state.overlay?.centroid[String(this.state.level)] : null;
    if (!c) return;
    const t = readTheme();
    for (const p of this.panels()) {
      const { s, ox, oy } = this.geom(p), g = this.b.grids[0]!.employment;
      const x = ox + (c.xy[0] - g.x[0]) * s, y = oy + (g.y[1] - c.xy[1]) * s, r = 9 * d;
      ctx.strokeStyle = t.footprint; ctx.lineWidth = 3 * d;
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      ctx.font = 12 * d + "px \"DM Sans\", system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3 * d; ctx.strokeStyle = t.bg; ctx.strokeText("centroid (a summary)", x + r + 4 * d, y);
      ctx.fillStyle = t.fg; ctx.fillText("centroid (a summary)", x + r + 4 * d, y);
    }
  }

  // ---- zoom and pan (wheel or pinch zooms about the pointer, drag pans, buttons for keyboard and touch users)
  private static readonly K_MAX = 14;
  private static readonly MAX_LABELS = 22;
  private static readonly AUTO_L1 = 2.2; private static readonly AUTO_L2 = 4.8;
  private schedule(): void { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  private zoomAt(factor: number, mx: number, my: number): void {
    const p = this.panels()[0], before = this.geom(p), g = this.b.grids[0]!.employment;
    const x = g.x[0] + (mx - before.ox) / before.s, y = g.y[1] - (my - before.oy) / before.s;
    this.k = Math.min(Math.max(this.k * factor, 1), Map2D.K_MAX);
    const after = this.geom(p);
    this.cx += x - (g.x[0] + (mx - after.ox) / after.s); this.cy += y - (g.y[1] - (my - after.oy) / after.s);
    this.afterView();
  }
  private clampView(): void {
    const g = this.b.grids[0]!.employment, half = 0.5 / this.k;
    this.cx = Math.min(Math.max(this.cx, g.x[0] + this.spanX * half), g.x[1] - this.spanX * half);
    this.cy = Math.min(Math.max(this.cy, g.y[0] + this.spanY * half), g.y[1] - this.spanY * half);
  }
  private afterView(): void {
    this.clampView();
    const want = this.k >= Map2D.AUTO_L2 ? 2 : this.k >= Map2D.AUTO_L1 ? 1 : 0;
    if (want !== this.autoLevel) { this.autoLevel = want; this.onAutoLevel(want); }
    this.schedule();
  }
  resetView(): void { const g = this.b.grids[0]!.employment; this.k = 1; this.cx = (g.x[0] + g.x[1]) / 2; this.cy = (g.y[0] + g.y[1]) / 2; this.afterView(); }
  private bindView(): void {
    const c = this.canvas, at = (e: { clientX: number; clientY: number }) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * this.dpr, (e.clientY - r.top) * this.dpr] as const; };
    c.addEventListener("wheel", (e) => { e.preventDefault(); const [mx, my] = at(e); this.zoomAt(Math.exp(-e.deltaY * 0.0015), mx, my); }, { passive: false });
    let drag: { x: number; y: number } | null = null;
    c.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; this.moved = false; c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!this.moved && Math.hypot(dx, dy) < 4) return;
      this.moved = true; drag = { x: e.clientX, y: e.clientY };
      const s = this.geom(this.panels()[0]).s;
      this.cx -= (dx * this.dpr) / s; this.cy += (dy * this.dpr) / s; this.afterView();
    });
    const end = () => { drag = null; setTimeout(() => { this.moved = false; }, 0); };
    c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
    c.addEventListener("dblclick", (e) => { const [mx, my] = at(e); this.zoomAt(2, mx, my); });
    c.addEventListener("keydown", (e) => {
      const step = 0.1 / this.k;
      if (e.key === "+" || e.key === "=") this.zoomAt(1.4, c.width / 2, c.height / 2);
      else if (e.key === "-") this.zoomAt(1 / 1.4, c.width / 2, c.height / 2);
      else if (e.key === "0") this.resetView();
      else if (e.key.startsWith("Arrow")) { this.cx += (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0) * this.spanX; this.cy += (e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0) * this.spanY; this.afterView(); }
      else return;
      e.preventDefault();
    });
    const ctl = document.createElement("div");
    ctl.className = "zoomctl";
    for (const [label, name, fn] of [["+", "Zoom in", () => this.zoomAt(1.5, c.width / 2, c.height / 2)], ["\u2212", "Zoom out", () => this.zoomAt(1 / 1.5, c.width / 2, c.height / 2)], ["\u2302", "Reset view", () => this.resetView()]] as [string, string, () => void][]) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-label", name); b.title = name; b.addEventListener("click", fn); ctl.appendChild(b);
    }
    this.host.appendChild(ctl);
  }

  private rel(n: NodeRec): number {
    const m = n.type === "ind" ? this.state.industryMeasure : this.state.researchMeasure;
    return (n.size[m] ?? 0) / levelMaxSize(this.b, this.state.level, m);
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + "px"; this.canvas.style.height = h + "px";
    this.bg = null; this.draw();
  }

  show(on: boolean): void { this.host.hidden = !on; if (on) this.resize(); }
}
