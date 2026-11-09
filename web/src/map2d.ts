import { type Bundle, type NodeRec, heightAt } from "./data";
import { BANDS, bandColour, readTheme } from "./theme";
import type { State } from "./state";

/** Top-down terraced contour map: the fallback for devices without WebGL and for screenshots. */
export class Map2D {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private bg: HTMLCanvasElement | null = null;
  private spanX: number; private spanY: number; private dpr = 1;

  constructor(private host: HTMLElement, private b: Bundle, private state: State) {
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Top-down contour map of industry sectors. Use the sector list for keyboard selection.");
    host.appendChild(this.canvas);
    this.spanX = b.grid.x[1] - b.grid.x[0]; this.spanY = b.grid.y[1] - b.grid.y[0];
    this.canvas.addEventListener("pointermove", (e) => this.state.setHover(this.nodeAt(e)));
    this.canvas.addEventListener("pointerleave", () => this.state.setHover(null));
    this.canvas.addEventListener("click", (e) => this.state.setSelected(this.nodeAt(e)));
    state.subscribe(() => this.draw());
    new ResizeObserver(() => this.resize()).observe(host);
  }

  private geom() {
    const w = this.canvas.width, h = this.canvas.height;
    const s = Math.min(w / this.spanX, h / this.spanY);
    return { s, ox: (w - this.spanX * s) / 2, oy: (h - this.spanY * s) / 2 };
  }
  private px(x: number, y: number): [number, number] {
    const { s, ox, oy } = this.geom();
    return [ox + (x - this.b.grid.x[0]) * s, oy + (this.b.grid.y[1] - y) * s]; // north (+y) is up
  }

  private nodeAt(e: MouseEvent): NodeRec | null {
    const r = this.canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) * this.dpr, my = (e.clientY - r.top) * this.dpr;
    let best: NodeRec | null = null, bd = 30 * this.dpr;
    for (const n of this.b.nodes) { const [x, y] = this.px(...n.xy); const d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  applyTheme(): void { this.bg = null; this.draw(); }

  private paintBackground(): HTMLCanvasElement {
    const t = readTheme(), w = this.canvas.width, h = this.canvas.height, { s, ox, oy } = this.geom();
    const off = document.createElement("canvas"); off.width = w; off.height = h;
    const c = off.getContext("2d")!, img = c.createImageData(w, h);
    const band = new Int8Array(w * h);
    const g = this.b.grid;
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const x = g.x[0] + (px - ox) / s, y = g.y[1] - (py - oy) / s;
      band[py * w + px] = x < g.x[0] || x > g.x[1] || y < g.y[0] || y > g.y[1] ? -1
        : Math.min(Math.floor((heightAt(g, x, y) / this.b.maxHeight) * BANDS), BANDS - 1);
    }
    const bgRgb = [parseInt(t.bg.slice(1, 3), 16), parseInt(t.bg.slice(3, 5), 16), parseInt(t.bg.slice(5, 7), 16)];
    const fg = [parseInt(t.fg.slice(1, 3), 16), parseInt(t.fg.slice(3, 5), 16), parseInt(t.fg.slice(5, 7), 16)];
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const i = py * w + px, b = band[i];
      let rgb = bgRgb;
      if (b >= 0) {
        rgb = bandColour(t, (b + 0.5) / BANDS);
        const edge = (px + 1 < w && band[i + 1] !== b) || (py + 1 < h && band[i + w] !== b);
        if (edge) rgb = [0, 1, 2].map((k) => rgb[k] * 0.55 + fg[k] * 0.45);
      }
      img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    }
    c.putImageData(img, 0, 0);
    return off;
  }

  draw(): void {
    if (!this.canvas.width) return;
    if (!this.bg) this.bg = this.paintBackground();
    const t = readTheme(), ctx = this.ctx, d = this.dpr;
    ctx.drawImage(this.bg, 0, 0);
    const maxSize = Math.max(...this.b.nodes.map((n) => n.size.employment));
    ctx.font = `${12 * d}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const bySize = [...this.b.nodes].sort((a, c) => c.size.employment - a.size.employment);
    for (const n of bySize) {            // largest sectors claim label space first
      const [x, y] = this.px(...n.xy);
      const on = this.state.active?.id === n.id || this.state.selected?.id === n.id;
      const r = (5 + 11 * Math.sqrt(n.size.employment / maxSize)) * d;
      ctx.lineWidth = (on ? 3 : 1.5) * d; ctx.strokeStyle = on ? t.accent : t.fg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      const w = ctx.measureText(n.label).width, ly = y - r - 3 * d;
      const box = { x0: x - w / 2, x1: x + w / 2, y0: ly - 14 * d, y1: ly };
      if (!on && placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      placed.push(box);
      ctx.lineWidth = 3 * d; ctx.strokeStyle = t.bg; ctx.strokeText(n.label, x, ly);
      ctx.fillStyle = on ? t.accent : t.fg; ctx.fillText(n.label, x, ly);
    }
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    this.bg = null; this.draw();
  }

  show(on: boolean): void { this.host.hidden = !on; if (on) this.resize(); }
}
