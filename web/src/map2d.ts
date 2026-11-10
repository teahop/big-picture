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

  constructor(private host: HTMLElement, private b: Bundle, private state: State) {
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Top-down contour map of industry sectors and research fields. Use the lists for keyboard selection.");
    host.appendChild(this.canvas);
    const g = b.grids[0]!.employment;
    this.spanX = g.x[1] - g.x[0]; this.spanY = g.y[1] - g.y[0];
    this.canvas.addEventListener("pointermove", (e) => this.state.setHover(this.nodeAt(e)));
    this.canvas.addEventListener("pointerleave", () => this.state.setHover(null));
    this.canvas.addEventListener("click", (e) => this.state.setSelected(this.nodeAt(e)));
    state.subscribe(() => this.draw());
    new ResizeObserver(() => this.resize()).observe(host);
  }

  private measure(layer: Layer): Measure { return layer === "ind" ? "employment" : this.state.researchMeasure; }
  private grid(layer: Layer): Grid { return this.b.grids[this.state.level]![this.measure(layer)]; }
  private maxAbs(layer: Layer): number { return this.b.maxAbs[this.state.level]![this.measure(layer)]; }

  private panels(): Panel[] {
    const w = this.canvas.width, h = this.canvas.height, m = this.state.mode;
    if (m === "stacked") return [{ x: 0, y: 0, w, h: h / 2, layers: ["ind"] }, { x: 0, y: h / 2, w, h: h / 2, layers: ["fld"] }];
    return [{ x: 0, y: 0, w, h, layers: m === "industry" ? ["ind"] : m === "research" ? ["fld"] : ["fld", "ind"] }];
  }

  private geom(p: Panel) {
    const s = Math.min(p.w / this.spanX, p.h / this.spanY) * 0.96;
    return { s, ox: p.x + (p.w - this.spanX * s) / 2, oy: p.y + (p.h - this.spanY * s) / 2 };
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
    const key = [this.state.mode, this.state.researchMeasure, this.state.level, this.state.footprint].join("|");
    if (!this.bg || key !== this.bgKey) {
      const off = document.createElement("canvas"); off.width = this.canvas.width; off.height = this.canvas.height;
      const c = off.getContext("2d")!;
      for (const p of this.panels()) this.paintPanel(c, p);
      this.bg = off; this.bgKey = key;
    }
    const t = readTheme(), ctx = this.ctx, d = this.dpr;
    ctx.drawImage(this.bg, 0, 0);
    ctx.font = 12 * d + "px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const p of this.panels()) {
      const nodes = this.b.nodes.filter((n) => p.layers.includes(n.type) && this.state.visibleIds.has(n.id))
        .sort((a, c) => this.rel(c) - this.rel(a));
      for (const n of nodes) {
        const [x, y] = this.px(p, n);
        const on = this.state.active?.id === n.id || this.state.selected?.id === n.id;
        const r = (3 + 11 * Math.sqrt(this.rel(n))) * d * (n.level === 0 ? 1 : n.level === 1 ? 0.8 : 0.65);
        const top = this.state.ranked.has(n.id);
        ctx.lineWidth = (on || top ? 3 : 1.5) * d; ctx.strokeStyle = on ? t.accent : top ? "#ff5e14" : t.fg;
        ctx.setLineDash(n.provenance === "estimated" ? [4 * d, 3 * d] : []);
        ctx.beginPath();
        if (n.type === "ind") ctx.arc(x, y, r, 0, Math.PI * 2);
        else { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
        ctx.stroke(); ctx.setLineDash([]);
        const text = (n.provenance === "estimated" ? "\u2248 " : "") + (n.type === "ind" ? "▲ " : "▼ ") + n.label, w = ctx.measureText(text).width, ly = y - r - 3 * d;
        const box = { x0: x - w / 2, x1: x + w / 2, y0: ly - 14 * d, y1: ly };
        if (!on && placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) continue;
        placed.push(box);
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
      ctx.strokeStyle = "#ff5e14"; ctx.lineWidth = 3 * d;
      ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
      ctx.font = 12 * d + "px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3 * d; ctx.strokeStyle = t.bg; ctx.strokeText("centroid (a summary)", x + r + 4 * d, y);
      ctx.fillStyle = t.fg; ctx.fillText("centroid (a summary)", x + r + 4 * d, y);
    }
  }

  private rel(n: NodeRec): number {
    const m = n.type === "ind" ? "employment" : this.state.researchMeasure;
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
