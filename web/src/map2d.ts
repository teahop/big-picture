/** The 2D views (v3 SPEC 4): the same height grid seen straight down, drawn like a classic topographic map: elevation
 *  tints, contour lines with a heavier index line every fifth, soft hill shading from the north-west, paper around it
 *  and a neat border, with the axes in the margins and map lettering that never overlaps. A career is drawn as rainbow
 *  contour bands on the hills it touches. Pan and zoom like a map; zooming out past the whole map hands back to 3D.
 *
 *  Layout coordinates map to world X (right) and Y (up); the back of the map (larger industries, smaller layout y) is
 *  the top of the screen, as in the 3D view. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Bundle, type NodeRec, axisScale, fmtMeasure } from "./data";
import type { Owners } from "./footprintLayer";
import { logTicks, mapLines, niceTicks, placeLabels, type LabelItem } from "./labels2d";
import type { State } from "./state";

const HEIGHT_EASE = 0.8;     // same easing as the 3D heights
const CONTOUR = 0.05;        // contour interval (share of the tallest peak, after easing); every fifth is an index contour
const BORDER = 1.1;          // the neat border, in layout units (the hills fill -1..1)
const MIN_ZOOM = 0.8;
const HILL_FLOOR = 0.2;      // rainbow bands cover a career hill down to this share of its own top (not the flats around it)
const MARGIN = { top: 70, bottom: 30, left: 60, right: 10 };   // screen space kept clear around the whole map (pixels)        // zooming out past this returns to the 3D Sectors view
export type Rainbow = "share" | "whole";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
uniform sampler2D hTex, mTex;
uniform vec2 texel, gx, gy;
uniform float interval, border;
uniform vec3 paper, low, mid, high, line, accent;
varying vec2 vUv;
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
void main() {
  vec2 t = vec2(vUv.x, 1.0 - vUv.y);                        // texture row 0 is the back of the map (top of the screen)
  float h = texture2D(hTex, t).r;
  float dx = texture2D(hTex, t + vec2(texel.x, 0.0)).r - texture2D(hTex, t - vec2(texel.x, 0.0)).r;
  float dup = texture2D(hTex, t - vec2(0.0, texel.y)).r - texture2D(hTex, t + vec2(0.0, texel.y)).r;
  vec3 n = normalize(vec3(-dx * 9.0, -dup * 9.0, 1.0));
  float shade = clamp(dot(n, normalize(vec3(-1.0, 1.0, 1.3))), 0.0, 1.0);
  // hypsometric tints: paper on the flat, then low green through buff to pale brown on the tops
  float e = clamp(h / 0.9, 0.0, 1.0);
  vec3 tint = e < 0.5 ? mix(low, mid, e / 0.5) : mix(mid, high, (e - 0.5) / 0.5);
  tint = mix(paper, tint, smoothstep(0.004, 0.03, h));
  vec4 m = texture2D(mTex, t);
  // a career: rainbow bands between the contour lines, violet at the foot of the hill to red at its top
  if (m.r > 0.5) {
    float band = (floor(h / interval) + 0.5) * interval, top = max(m.g, m.a + interval);
    float rel = clamp((band - m.a) / (top - m.a), 0.0, 1.0);
    tint = mix(tint, hsv(0.78 * (1.0 - rel), 0.62, 0.97), 0.88);
  }
  vec3 col = tint * (0.78 + 0.32 * shade);
  // contours: thin lines every interval, heavier every fifth; drawn in the accent colour on the hovered hill
  float c = h / interval, f = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  bool idx = mod(floor(c + 0.5), 5.0) < 0.5;
  float hov = step(0.5, m.b);
  float wdt = (idx ? 1.25 : 0.7) + hov * 0.8;
  float ink = (1.0 - smoothstep(wdt - 0.5, wdt + 0.5, f)) * step(0.004, h) * (idx ? 0.8 : 0.45);
  col = mix(col, col * 1.06 + accent * 0.1, hov * 0.55);         // the hovered hill is lit a little...
  col = mix(col, mix(line, accent, hov), clamp(ink + hov * 0.45 * step(0.01, ink), 0.0, 1.0));   // ...and its contours turn red
  // the neat border
  vec2 L = vec2(gx.x + vUv.x * (gx.y - gx.x), gy.x + t.y * (gy.y - gy.x));
  vec2 bd = abs(abs(L) - border) / fwidth(L);
  float frame = (1.0 - smoothstep(0.6, 1.6, min(bd.x, bd.y))) * step(abs(L.x), border + 0.002) * step(abs(L.y), border + 0.002);
  col = mix(col, line, frame * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

interface Palette { paper: string; low: string; mid: string; high: string; line: string; accent: string }

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement), g = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { paper: g("--topo-paper", "#f3eedd"), low: g("--topo-low", "#c4d6a0"), mid: g("--topo-mid", "#e6dbab"), high: g("--topo-high", "#bf9b72"),
           line: g("--topo-line", "#7a5c3c"), accent: g("--topo-accent", "#d0302a") };
}

export class Map2D {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  readonly controls: OrbitControls;
  private plane: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private hTex: THREE.DataTexture | null = null;
  private mTex: THREE.DataTexture | null = null;
  private overlay: HTMLDivElement; private labelsEl: HTMLDivElement; private axisX: HTMLDivElement; private axisY: HTMLDivElement;
  private labels = new Map<string, { el: HTMLDivElement; w: number; h: number }>();
  private key = ""; private maskKey = ""; private viewKey = "";
  private w = 1; private h = 1;
  // whole career hills by default; `?rainbow=share` colours only the career's share of each hill, from the top down
  rainbow: Rainbow = new URLSearchParams(location.search).get("rainbow") === "share" ? "share" : "whole";
  onLeave: () => void = () => {};
  labelsShown = 0;

  constructor(private canvas: HTMLElement, labelLayer: HTMLElement, private b: Bundle, private state: State,
              private ownerGrid: () => Owners, private scale: number, private cx: number, private cy: number,
              private sx: number, private sy: number) {
    this.camera.position.set(0, 0, 50); this.camera.up.set(0, 1, 0); this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableRotate: false, screenSpacePanning: true, zoomToCursor: true, enableDamping: true, minZoom: 0.6, maxZoom: 14, enabled: false });
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => { if (this.camera.zoom < MIN_ZOOM && this.controls.enabled) this.onLeave(); });
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: {
      hTex: { value: null }, mTex: { value: null }, texel: { value: new THREE.Vector2() }, gx: { value: new THREE.Vector2() }, gy: { value: new THREE.Vector2() },
      interval: { value: CONTOUR }, border: { value: BORDER }, paper: { value: new THREE.Color() }, low: { value: new THREE.Color() }, mid: { value: new THREE.Color() },
      high: { value: new THREE.Color() }, line: { value: new THREE.Color() }, accent: { value: new THREE.Color() } } });
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.scene.add(this.plane);
    this.overlay = document.createElement("div"); this.overlay.className = "map2d"; this.overlay.hidden = true;
    this.labelsEl = document.createElement("div"); this.labelsEl.className = "map2d-labels";
    this.axisX = document.createElement("div"); this.axisX.className = "map2d-axis x";
    this.axisY = document.createElement("div"); this.axisY.className = "map2d-axis y";
    this.overlay.append(this.labelsEl, this.axisX, this.axisY);
    labelLayer.appendChild(this.overlay);
    this.applyTheme();
  }

  // ---- coordinates
  world(x: number, y: number): THREE.Vector3 { return new THREE.Vector3((x - this.cx) * this.scale * this.sx, -(y - this.cy) * this.scale * this.sy, 0); }
  private layoutAt(wx: number, wy: number): [number, number] { return [wx / (this.scale * this.sx) + this.cx, -wy / (this.scale * this.sy) + this.cy]; }
  private screen(x: number, y: number): [number, number] {
    const v = this.world(x, y).project(this.camera);
    return [((v.x + 1) / 2) * this.w, ((1 - v.y) / 2) * this.h];
  }

  setActive(on: boolean): void { this.controls.enabled = on; this.overlay.hidden = !on; if (on) this.viewKey = ""; }

  // ---- heights, career and hover
  /** Redraw for the current level and size setting (and career). */
  refresh(): void {
    const lvl = this.state.level, g = this.b.grids[lvl]!, key = [lvl, this.state.size].join("|");
    if (key !== this.key) {
      this.key = key;
      const vals = g.settings[this.state.size].height, max = this.b.maxHeight[lvl]![this.state.size], n = g.n;
      const half = new Uint16Array(n * n);
      for (let k = 0; k < n * n; k++) half[k] = THREE.DataUtils.toHalfFloat(Math.pow(Math.max(0, vals[k] / max), HEIGHT_EASE));
      this.hTex?.dispose();
      this.hTex = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
      Object.assign(this.hTex, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, needsUpdate: true });
      const u = this.mat.uniforms;
      u.hTex.value = this.hTex; u.texel.value.set(1 / n, 1 / n); u.gx.value.set(g.x[0], g.x[1]); u.gy.value.set(g.y[0], g.y[1]);
      const a = this.world(g.x[0], g.y[0]), c = this.world(g.x[1], g.y[1]);
      this.plane.geometry.dispose();
      this.plane.geometry = new THREE.PlaneGeometry(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
      this.plane.position.set((a.x + c.x) / 2, (a.y + c.y) / 2, 0);
      this.buildLabels(); this.maskKey = ""; this.viewKey = "";
    }
    this.refreshMask();
  }

  /** The career (rainbow) and hover marks per grid point: R = rainbow here, G = the hill's own top and A = the foot of its
   *  coloured ground (eased heights), B = hovered. */
  refreshMask(): void {
    const touched = this.state.touchedNow(), act = this.state.active, sel = this.state.selected;
    const key = [this.key, this.state.fpVersion, this.rainbow, act?.id ?? "", sel?.id ?? ""].join("|");
    if (key === this.maskKey) return;
    this.maskKey = key;
    const lvl = this.state.level, g = this.b.grids[lvl]!, n = g.n, o = this.ownerGrid();
    const vals = g.settings[this.state.size].height, max = this.b.maxHeight[lvl]![this.state.size];
    const h = (k: number) => Math.pow(Math.max(0, vals[k] / max), HEIGHT_EASE);
    const data = new Uint8Array(n * n * 4);
    if (touched?.size) {
      const cells = new Map<number, number[]>();
      for (let k = 0; k < o.owner.length; k++) { const w = o.owner[k]; if (w >= 0 && touched.has(o.ids[w])) (cells.get(w) ?? cells.set(w, []).get(w)!).push(k); }
      for (const [w, ks] of cells) {
        ks.sort((p, q) => h(q) - h(p));                  // summit first
        // the hill itself: not the low ground at its edges that only loosely belongs to it
        const floor = h(ks[0]) * HILL_FLOOR, cut = ks.findIndex((k) => h(k) < floor);
        if (cut > 0) ks.length = cut;
        const keep = Math.max(1, this.rainbow === "whole" ? ks.length : Math.round(ks.length * Math.min(1, touched.get(o.ids[w]) ?? 0)));
        const top = h(ks[0]), foot = Math.floor(h(ks[keep - 1]) / CONTOUR) * CONTOUR;   // violet starts at the contour below the lowest coloured ground
        for (const k of ks.slice(0, keep)) { data[4 * k] = 255; data[4 * k + 1] = Math.round(top * 255); data[4 * k + 3] = Math.round(foot * 255); }
      }
    }
    // copy each coloured cell's top and foot one cell outward, so the edge blends into the band colour, not toward red
    const src = data.slice();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (src[4 * k]) continue;
      for (let dj = -1; dj <= 1 && !data[4 * k + 1]; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj, q = jj * n + ii;
        if (ii >= 0 && jj >= 0 && ii < n && jj < n && src[4 * q]) { data[4 * k + 1] = src[4 * q + 1]; data[4 * k + 3] = src[4 * q + 3]; break; }
      }
    }
    const lit = new Set([act?.id, sel?.id].filter((x): x is string => !!x).map((id) => o.ids.indexOf(id)).filter((i) => i >= 0));
    if (lit.size) for (let k = 0; k < o.owner.length; k++) if (lit.has(o.owner[k])) data[4 * k + 2] = 255;
    this.mTex?.dispose();
    this.mTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    Object.assign(this.mTex, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, needsUpdate: true });
    this.mat.uniforms.mTex.value = this.mTex;
    for (const [id, l] of this.labels) l.el.classList.toggle("active", id === act?.id || id === sel?.id);
    if (touched) for (const [id, l] of this.labels) l.el.classList.toggle("career", touched.has(id));
    this.viewKey = "";
  }

  applyTheme(): void {
    const p = palette(), u = this.mat.uniforms;
    for (const k of ["paper", "low", "mid", "high", "line", "accent"] as const) u[k].value.set(p[k]);
    this.scene.background = new THREE.Color(p.paper);
    this.viewKey = ""; for (const l of this.labels.values()) l.w = 0;
  }

  // ---- camera
  /** Pixels per world unit at zoom 1: the whole bordered map fits the space left by the header (top), the axes (bottom
   *  and left) and a small gap on the right. */
  private ppu = 1;
  resize(w: number, h: number): void {
    this.w = w; this.h = h;
    const a = this.world(-BORDER - 0.02, -BORDER - 0.02), c = this.world(BORDER + 0.02, BORDER + 0.02);
    this.ppu = Math.min((w - MARGIN.left - MARGIN.right) / Math.abs(c.x - a.x), (h - MARGIN.top - MARGIN.bottom) / Math.abs(c.y - a.y));
    const hw = w / 2 / this.ppu, hh = h / 2 / this.ppu;
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.camera.updateProjectionMatrix(); this.viewKey = "";
  }

  /** The whole map, centred in the space between the header and the axes. */
  fit(): void {
    const c = this.world(0, 0);
    this.look(c.x - (MARGIN.left - MARGIN.right) / 2 / this.ppu, c.y + (MARGIN.top - MARGIN.bottom) / 2 / this.ppu, 1);
  }

  /** Frame these nodes (career step-down). */
  frame(ids: string[]): void {
    const ns = ids.map((id) => this.b.byId.get(id)).filter((n): n is NodeRec => !!n);
    if (!ns.length) return this.fit();
    const xs = ns.map((n) => n.xy[0]), ys = ns.map((n) => n.xy[1]), pad = 0.3;
    const a = this.world(Math.min(...xs) - pad, Math.min(...ys) - pad), c = this.world(Math.max(...xs) + pad, Math.max(...ys) + pad);
    const zoom = Math.min((this.camera.right - this.camera.left) / Math.abs(c.x - a.x), (this.camera.top - this.camera.bottom) / Math.abs(c.y - a.y));
    this.look((a.x + c.x) / 2, (a.y + c.y) / 2, Math.min(3.2, Math.max(1, zoom)));
  }

  center(n: NodeRec): void { const p = this.world(n.xy[0], n.xy[1]); this.look(p.x, p.y, Math.max(this.camera.zoom, 2.5)); }

  private look(x: number, y: number, zoom: number): void {
    this.controls.target.set(x, y, 0); this.camera.position.set(x, y, 50); this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix(); this.controls.update(); this.viewKey = "";
  }

  // ---- picking
  /** The hill under the pointer: the industry that owns that ground. */
  nodeAt(ev: PointerEvent): NodeRec | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector3(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1, 0).unproject(this.camera);
    const [x, y] = this.layoutAt(v.x, v.y), g = this.b.grids[this.state.level]!, o = this.ownerGrid();
    const i = Math.round(((x - g.x[0]) / (g.x[1] - g.x[0])) * (g.n - 1)), j = Math.round(((y - g.y[0]) / (g.y[1] - g.y[0])) * (g.n - 1));
    if (i < 0 || j < 0 || i >= g.n || j >= g.n) return null;
    const w = o.owner[j * g.n + i];
    return w >= 0 ? this.b.byId.get(o.ids[w]) ?? null : null;
  }

  // ---- lettering and axes
  private buildLabels(): void {
    this.labelsEl.replaceChildren(); this.labels.clear();
    const m = this.state.measure, vis = this.b.nodes.filter((n) => this.state.visibleIds.has(n.id));
    const sizes = vis.map((n) => n.size[m] ?? 0).sort((a, c) => c - a), big = sizes[Math.floor(sizes.length * 0.1)] ?? 0;
    for (const n of vis) {
      const el = document.createElement("div");
      el.className = "map-label" + ((n.size[m] ?? 0) >= big ? " big" : "") + (n.provenance === "estimated" ? " est" : "");
      el.textContent = mapLines((n.provenance === "estimated" ? "≈ " : "") + n.label).join("\n");
      // (names let the pointer through: hover, click, drag and zoom all go to the map, which knows whose ground is under it)
      this.labelsEl.appendChild(el);
      this.labels.set(n.id, { el, w: 0, h: 0 });
    }
  }

  /** Place the names and the axis ticks for the current view (only when the view or the career changed). */
  private layout(): void {
    const key = [this.camera.zoom.toFixed(4), this.camera.position.x.toFixed(4), this.camera.position.y.toFixed(4), this.w, this.h, this.maskKey].join("|");
    if (key === this.viewKey) return;
    this.viewKey = key;
    const touched = this.state.touchedNow(), m = this.state.measure, items: LabelItem[] = [];
    for (const [id, l] of this.labels) {
      const n = this.b.byId.get(id)!;
      if (!l.w) { l.w = l.el.offsetWidth || 80; l.h = l.el.offsetHeight || 14; }
      const [x, y] = this.screen(n.xy[0], n.xy[1]);
      items.push({ id, x, y, w: l.w, h: l.h, priority: (touched?.has(id) ? 1e12 * (1 + (touched.get(id) ?? 0)) : 0) + (n.size[m] ?? 0) });
    }
    const placed = new Map(placeLabels(items, { w: this.w - 4, h: this.h - 40 }, 4).map((p) => [p.id, p]));
    for (const [id, l] of this.labels) {
      const p = placed.get(id);
      l.el.style.visibility = p ? "visible" : "hidden";
      if (p) l.el.style.transform = `translate(${(p.x - l.w / 2).toFixed(1)}px, ${(p.y - l.h / 2).toFixed(1)}px)`;
    }
    this.labelsShown = placed.size;
    this.drawAxes();
  }

  private drawAxes(): void {
    const sc = axisScale(this.b, this.state.size, this.state.level);
    if (!sc) { this.axisX.replaceChildren(); this.axisY.replaceChildren(); return; }
    const tick = (cls: string, text: string, x: number, y: number) => {
      const s = document.createElement("span"); s.className = cls; s.textContent = text;
      s.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; return s;
    };
    const xs: HTMLElement[] = [], ys: HTMLElement[] = [], m = this.state.measure;
    for (const t of niceTicks(sc.g_lo, sc.g_hi, 5)) {
      const [px] = this.screen(-1 + (2 * (t - sc.g_lo)) / (sc.g_hi - sc.g_lo), 0);
      if (px > 70 && px < this.w - 190) xs.push(tick("t", (t > 0 ? "+" : "") + t + "%", px, 0));   // clear of the axis title
    }
    xs.push(tick("title", "Projected growth to 2035 →", this.w - 12, 0));
    for (const v of logTicks(sc.s_lo, sc.s_hi)) {
      const [, py] = this.screen(0, 1 - (2 * (Math.log(v) - Math.log(sc.s_lo))) / (Math.log(sc.s_hi) - Math.log(sc.s_lo)));
      if (py > 20 && py < this.h - 40) ys.push(tick("t", fmtMeasure(m, v), 0, py));
    }
    ys.push(tick("title", (m === "employment" ? "Jobs" : "Value added") + " ↑", 0, 10));
    this.axisX.replaceChildren(...xs); this.axisY.replaceChildren(...ys);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.controls.update();
    this.layout();
    renderer.render(this.scene, this.camera);
  }
}
