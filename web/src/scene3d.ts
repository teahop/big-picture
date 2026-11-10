import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Bundle, type Grid, type Measure, type NodeRec, heightAt, levelMaxSize } from "./data";
import { BANDS, bandColour, readTheme } from "./theme";
import { blendHeat } from "./overlay";
import type { State } from "./state";

const SPAN = 12;      // world units across the layout
const H_MAX = 5.0;    // world height of the largest peak / depth of the deepest valley
const GAP = 2.6;      // vertical gap between the two terrains in stacked mode
const MAX_LABELS = 60; // labels drawn at once (largest first); the rest stay hidden until hover or select
const PICK_PX = 30;   // screen-space radius for hover and click
const AUTO_L1 = 11.5; // camera distance below which Auto switches to Level 1
const AUTO_L2 = 7.0;  // ... and to Level 2

type Layer = "ind" | "fld";
// Shared, low-poly marker geometry (one instance for every node)
const GEO = { circle: new THREE.RingGeometry(0.82, 1, 24), diamond: new THREE.RingGeometry(0.78, 1, 4) };

interface Marker { ring: THREE.Object3D; label: HTMLButtonElement; anchor: THREE.Vector3; rel: number; r: number; w: number; h: number; vis: boolean }

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private controls: OrbitControls;
  private groups: Record<Layer, THREE.Group> = { ind: new THREE.Group(), fld: new THREE.Group() };
  private meshes = {} as Record<Layer, THREE.Mesh>;
  private markers = new Map<string, Marker>();   // created the first time a node is shown
  private scale: number; private cx: number; private cy: number;
  private flyTo: THREE.Vector3 | null = null;
  private running = false;
  private key = "";
  private ground!: THREE.GridHelper;
  private autoLevel = 0;
  private frameMs = 0;        // moving average of CPU time spent per frame (render + label layout)
  private labelsShown = 0;
  onAutoLevel: (level: number) => void = () => {};

  constructor(private host: HTMLElement, private labelLayer: HTMLElement, private b: Bundle, private state: State) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    el.setAttribute("aria-label", "3D terrain of industry sectors (peaks) and research fields (valleys). Zoom in to reveal finer levels. Arrow keys pan, mouse drag orbits, scroll zooms. Use the lists for keyboard selection.");
    host.appendChild(el);

    const g = b.grids[0]!.employment;
    this.scale = SPAN / (g.x[1] - g.x[0]);
    this.cx = (g.x[0] + g.x[1]) / 2; this.cy = (g.y[0] + g.y[1]) / 2;

    this.camera.position.set(0, 9, 13);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3; this.controls.maxDistance = 40;
    this.controls.listenToKeyEvents(el);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-6, 12, 8); this.scene.add(sun);
    this.scene.add(this.groups.ind, this.groups.fld);
    this.ground = new THREE.GridHelper(SPAN * 1.2, 24, 0x888888, 0x888888);
    (this.ground.material as THREE.Material).transparent = true; (this.ground.material as THREE.Material).opacity = 0.25;
    this.scene.add(this.ground);

    for (const layer of ["ind", "fld"] as Layer[]) this.buildMesh(layer);
    this.applyTheme();
    this.sync(true);
    this.bindPointer(el);
    state.subscribe(() => this.sync(false));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  // ---- measures and heights
  private grids(): Record<Measure, Grid> { return this.b.grids[this.state.level]!; }
  private grid(layer: Layer): Grid { return layer === "ind" ? this.grids().employment : this.grids()[this.state.researchMeasure]; }
  private measure(layer: Layer): Measure { return layer === "ind" ? "employment" : this.state.researchMeasure; }
  private maxAbs(layer: Layer): number { return this.b.maxAbs[this.state.level]![this.measure(layer)]; }
  private h(layer: Layer, v: number): number { return (v / this.maxAbs(layer)) * H_MAX; }
  private rel(n: NodeRec): number {
    const m = n.type === "ind" ? "employment" : this.state.researchMeasure;
    return (n.size[m] ?? 0) / levelMaxSize(this.b, this.state.level, m);
  }
  private local(x: number, y: number, h = 0): THREE.Vector3 { return new THREE.Vector3((x - this.cx) * this.scale, h, (y - this.cy) * this.scale); }

  private buildMesh(layer: Layer): void {
    const n = this.b.grids[0]!.employment.n;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * n * 4), 4));
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.meshes[layer] = new THREE.Mesh(geo, mat);
    this.groups[layer].add(this.meshes[layer]);
  }

  private refreshLayer(layer: Layer): void {
    const g = this.grid(layer), n = g.n, geo = this.meshes[layer].geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = g.x[0] + ((g.x[1] - g.x[0]) * i) / (n - 1), y = g.y[0] + ((g.y[1] - g.y[0]) * j) / (n - 1);
      const p = this.local(x, y, this.h(layer, g.values[j * n + i]));
      pos.setXYZ(j * n + i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    const t = readTheme(), col = geo.getAttribute("color") as THREE.BufferAttribute, max = this.maxAbs(layer);
    const overlaid = this.state.mode === "overlaid", heat = this.state.heatGrid();
    for (let k = 0; k < g.values.length; k++) {
      const h01 = Math.abs(g.values[k]) / max;
      let [r, gg, bb] = bandColour(t, layer === "ind" ? "ind" : "res", h01);
      if (heat && heat.values[k] > 0.02) [r, gg, bb] = blendHeat([r, gg, bb], heat.values[k]);
      col.setXYZW(k, r / 255, gg / 255, bb / 255, overlaid ? (h01 * BANDS < 1 ? 0 : 0.9) : 1);
    }
    col.needsUpdate = true;
  }

  // ---- markers (created lazily; positions follow the active level's terrain)
  private marker(node: NodeRec): Marker {
    let m = this.markers.get(node.id);
    if (m) return m;
    let ring: THREE.Object3D;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    if (node.provenance === "estimated") {            // dashed outline marks estimated nodes
      const pts = Array.from({ length: 49 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * Math.PI * 2), 0, Math.sin((i / 48) * Math.PI * 2)));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.18, gapSize: 0.12 }));
      line.computeLineDistances(); ring = line;
    } else if (node.type === "ind") {
      ring = new THREE.Mesh(GEO.circle, mat); ring.rotation.x = -Math.PI / 2;
    } else {
      ring = new THREE.Mesh(GEO.diamond, mat); ring.rotation.x = -Math.PI / 2;
    }
    this.groups[node.type].add(ring);
    const btn = document.createElement("button");
    btn.className = "node-label " + node.type + (node.provenance === "estimated" ? " est" : "") + " lvl" + node.level;
    btn.type = "button"; btn.tabIndex = -1; btn.style.visibility = "hidden";
    btn.textContent = (node.provenance === "estimated" ? "≈ " : "") + (node.type === "ind" ? "▲ " : "▼ ") + node.label;
    btn.addEventListener("pointerenter", () => this.state.setHover(node));
    btn.addEventListener("pointerleave", () => this.state.setHover(null));
    btn.addEventListener("click", () => this.state.setSelected(node));
    this.labelLayer.appendChild(btn);
    m = { ring, label: btn, anchor: new THREE.Vector3(), rel: 0, r: 1, w: 0, h: 0, vis: false };
    this.markers.set(node.id, m);
    return m;
  }

  private drawOrder: { id: string; node: NodeRec; m: Marker }[] = [];   // visible nodes, largest first

  private placeMarkers(): void {
    for (const [id, m] of this.markers) { const on = this.state.visibleIds.has(id); m.ring.visible = on; if (!on) { m.label.style.visibility = "hidden"; m.vis = false; } }
    const visible = this.b.nodes.filter((n) => this.state.visibleIds.has(n.id));
    for (const node of visible) {
      const m = this.marker(node), layer = node.type, [x, y] = node.xy;
      const h = this.h(layer, heightAt(this.grid(layer), x, y));
      m.rel = this.rel(node);
      const r = (0.07 + 0.34 * Math.sqrt(m.rel)) * (node.level === 0 ? 1 : node.level === 1 ? 0.8 : 0.6);
      m.ring.position.copy(this.local(x, y, h + (layer === "ind" ? 0.04 : -0.04)));
      m.r = r; m.ring.scale.setScalar(r);
      m.anchor.copy(this.local(x, y, h + 0.35 + r));
    }
    this.drawOrder = visible.map((node) => ({ id: node.id, node, m: this.markers.get(node.id)! })).sort((a, c) => c.m.rel - a.m.rel);
  }

  // ---- state sync
  private sync(force: boolean): void {
    const key = [this.state.mode, this.state.researchMeasure, this.state.level, this.state.footprint].join("|");
    if (force || key !== this.key) {
      const prev = this.key.split("|");
      this.key = key;
      const modeChanged = force || prev[0] !== this.state.mode;
      this.refreshLayer("ind"); this.refreshLayer("fld");
      this.placeMarkers();
      this.placeCentroid();
      if (modeChanged) this.applyMode();
    }
    this.refreshHighlight();
  }

  /** Weighted centroid of the footprint: a summary marker only (it can sit between clusters). */
  private centroidMesh: THREE.Mesh | null = null;
  private placeCentroid(): void {
    const c = this.state.footprint !== "off" ? this.state.overlay?.centroid[String(this.state.level)] : null;
    if (!c) { if (this.centroidMesh) this.centroidMesh.visible = false; return; }
    if (!this.centroidMesh) {
      this.centroidMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xff5e14 }));
      this.centroidMesh.name = "footprint-centroid"; this.scene.add(this.centroidMesh);
    }
    const layer: Layer = this.state.showsIndustry() ? "ind" : "fld";
    const h = this.h(layer, heightAt(this.grid(layer), c.xy[0], c.xy[1]));
    const p = this.local(c.xy[0], c.xy[1], h + 0.5);
    p.y += this.groups[layer].position.y;
    this.centroidMesh.position.copy(p); this.centroidMesh.visible = true;
  }

  private applyMode(): void {
    const m = this.state.mode;
    this.groups.ind.visible = this.state.showsIndustry(); this.groups.fld.visible = this.state.showsResearch();
    this.groups.ind.position.y = m === "stacked" ? GAP : 0; this.groups.fld.position.y = 0;
    for (const layer of ["ind", "fld"] as Layer[]) {
      const mat = this.meshes[layer].material as THREE.MeshStandardMaterial;
      mat.transparent = m === "overlaid"; mat.depthWrite = m !== "overlaid"; mat.needsUpdate = true;
    }
    const ty = m === "industry" ? 1.2 : m === "research" ? -1.2 : m === "stacked" ? GAP / 2 : 0;
    this.flyTo = new THREE.Vector3(0, ty, 0);
  }

  applyTheme(): void {
    this.scene.background = new THREE.Color(readTheme().bg);
    this.refreshLayer("ind"); this.refreshLayer("fld"); this.refreshHighlight();
  }

  private refreshHighlight(): void {
    const t = readTheme(), act = this.state.active, sel = this.state.selected;
    for (const [id, m] of this.markers) {
      const on = act?.id === id || sel?.id === id, top = this.state.ranked.has(id);
      const mat = (m.ring as THREE.Mesh | THREE.LineLoop).material as THREE.MeshBasicMaterial | THREE.LineDashedMaterial;
      mat.color.set(on ? t.accent : top ? "#ff5e14" : t.fg);
      m.ring.scale.setScalar(m.r * (on ? 1.5 : top ? 1.3 : 1));
      m.label.classList.toggle("active", on);
    }
  }

  // ---- interaction (screen-space picking works for every layer mode)
  private worldAnchor(node: NodeRec): THREE.Vector3 {
    const m = this.markers.get(node.id);
    return (m ? m.anchor.clone() : new THREE.Vector3()).add(this.groups[node.type].position);
  }

  private nodeNear(ev: PointerEvent): NodeRec | null {
    const rect = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    let best: NodeRec | null = null, bd = PICK_PX;
    for (const n of this.b.nodes) {
      if (!this.state.isVisible(n) || !this.markers.has(n.id)) continue;
      v.copy(this.worldAnchor(n)).add(new THREE.Vector3(0, n.type === "ind" ? -0.5 : 0.5, 0)).project(this.camera);
      if (v.z >= 1) continue;
      const d = Math.hypot((v.x + 1) / 2 * rect.width - (ev.clientX - rect.left), (1 - v.y) / 2 * rect.height - (ev.clientY - rect.top));
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  private bindPointer(el: HTMLElement): void {
    let down: [number, number] | null = null;
    el.addEventListener("pointermove", (ev) => { if (!down) this.state.setHover(this.nodeNear(ev)); });
    el.addEventListener("pointerleave", () => this.state.setHover(null));
    el.addEventListener("pointerdown", (ev) => { down = [ev.clientX, ev.clientY]; });
    el.addEventListener("pointerup", (ev) => {
      if (down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 5) this.state.setSelected(this.nodeNear(ev));
      down = null;
    });
  }

  focus(node: NodeRec): void { this.flyTo = this.worldAnchor(node).add(new THREE.Vector3(0, node.type === "ind" ? -0.6 : 0.6, 0)); }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private frame = (): void => {
    if (!this.running) return;
    this.tick();
    requestAnimationFrame(this.frame);
  };

  private tick(): void {
    const t0 = performance.now();
    if (this.flyTo) {
      const delta = this.flyTo.clone().sub(this.controls.target);
      this.controls.target.add(delta.clone().multiplyScalar(0.12));
      if (delta.length() < 0.01) this.flyTo = null;
    }
    this.controls.update();
    // Auto level of detail from the camera's distance to its target (with a little hysteresis)
    const dist = this.camera.position.distanceTo(this.controls.target);
    const want = dist < AUTO_L2 * (this.autoLevel === 2 ? 1.08 : 1) ? 2 : dist < AUTO_L1 * (this.autoLevel >= 1 ? 1.08 : 1) ? 1 : 0;
    if (this.state.lod === "auto" && want !== this.autoLevel) { this.autoLevel = want; this.onAutoLevel(want); }
    this.renderer.render(this.scene, this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new THREE.Vector3();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const setVis = (m: Marker, on: boolean) => { if (m.vis !== on) { m.vis = on; m.label.style.visibility = on ? "visible" : "hidden"; } };
    for (const { node: n, m } of this.drawOrder) {          // largest nodes claim label space first
      const active = m.label.classList.contains("active");
      if (!this.state.isVisible(n)) { m.ring.visible = false; setVis(m, false); continue; }
      m.ring.visible = true;
      if (placed.length >= MAX_LABELS && !active) { setVis(m, false); continue; }
      v.copy(m.anchor).add(this.groups[n.type].position).project(this.camera);
      if (v.z >= 1) { setVis(m, false); continue; }
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      if (!m.w) { m.w = m.label.offsetWidth || 120; m.h = m.label.offsetHeight || 20; }   // measured once, not every frame
      const r = { x0: x - m.w / 2, x1: x + m.w / 2, y0: y - m.h, y1: y };
      let clash = false;
      for (let i = 0; i < placed.length && !clash; i++) { const p = placed[i]; clash = r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0; }
      const show = active || !clash;
      setVis(m, show);
      if (show) { placed.push(r); m.label.style.transform = "translate(-50%, -100%) translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px)"; }
    }
    this.labelsShown = placed.length;
    this.frameMs = this.frameMs ? 0.9 * this.frameMs + 0.1 * (performance.now() - t0) : performance.now() - t0;
  }

  /** Run the frame work `n` times back to back, waiting for the GPU each time; returns the mean ms per frame.
   *  Independent of display throttling, so it works in a hidden or background pane. */
  benchmark(n = 60): number {
    this.resize();
    const gl = this.renderer.getContext(), t0 = performance.now();
    for (let i = 0; i < n; i++) { this.tick(); gl.finish(); }
    return (performance.now() - t0) / n;
  }

  /** Render statistics for the performance check (CPU time per frame excludes GPU time). */
  stats(): { frameMs: number; drawCalls: number; triangles: number; markers: number; labelsShown: number } {
    const i = this.renderer.info.render;
    return { frameMs: Math.round(this.frameMs * 100) / 100, drawCalls: i.calls, triangles: i.triangles, markers: this.markers.size, labelsShown: this.labelsShown };
  }

  show(on: boolean): void {
    this.host.hidden = !on; this.labelLayer.hidden = !on;
    if (on && !this.running) { this.running = true; this.resize(); requestAnimationFrame(this.frame); }
    if (!on) this.running = false;
  }
}

export const BAND_COUNT = BANDS;
export function webglAvailable(): boolean {
  try { return !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl"); }
  catch { return false; }
}
