import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Bundle, type Grid, type NodeRec, heightAt } from "./data";
import { BANDS, bandColour, readTheme } from "./theme";
import type { State } from "./state";

const SPAN = 12;      // world units across the layout
const H_MAX = 5.0;    // world height of the largest peak / depth of the deepest valley
const GAP = 2.6;      // vertical gap between the two terrains in stacked mode
const PICK_PX = 30;   // screen-space radius for hover and click

type Layer = "ind" | "fld";

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private controls: OrbitControls;
  private groups: Record<Layer, THREE.Group> = { ind: new THREE.Group(), fld: new THREE.Group() };
  private meshes = {} as Record<Layer, THREE.Mesh>;
  private rings = new Map<string, THREE.Mesh>();
  private labels = new Map<string, HTMLButtonElement>();
  private anchors = new Map<string, THREE.Vector3>(); // layer-local label anchors
  private order: NodeRec[];
  private scale: number; private cx: number; private cy: number;
  private flyTo: THREE.Vector3 | null = null;
  private running = false;
  private lastKey = "";
  private ground!: THREE.GridHelper;

  constructor(private host: HTMLElement, private labelLayer: HTMLElement, private b: Bundle, private state: State) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    el.setAttribute("aria-label", "3D terrain of industry sectors (peaks) and research fields (valleys). Arrow keys pan, mouse drag orbits, scroll zooms. Use the lists for keyboard selection.");
    host.appendChild(el);

    const g = b.grids.employment;
    this.scale = SPAN / (g.x[1] - g.x[0]);
    this.cx = (g.x[0] + g.x[1]) / 2; this.cy = (g.y[0] + g.y[1]) / 2;
    this.order = [...b.nodes].sort((a, c) => this.rel(c) - this.rel(a));

    this.camera.position.set(0, 9, 13);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.minDistance = 4; this.controls.maxDistance = 40;
    this.controls.listenToKeyEvents(el);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-6, 12, 8); this.scene.add(sun);
    this.scene.add(this.groups.ind, this.groups.fld);
    this.ground = new THREE.GridHelper(SPAN * 1.2, 24, 0x888888, 0x888888);
    (this.ground.material as THREE.Material).transparent = true; (this.ground.material as THREE.Material).opacity = 0.25;
    this.scene.add(this.ground);

    for (const layer of ["ind", "fld"] as Layer[]) this.buildMesh(layer);
    this.buildMarkers();
    this.applyTheme();
    this.sync(true);
    this.bindPointer(el);
    state.subscribe(() => this.sync(false));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  // ---- measures and heights
  private grid(layer: Layer): Grid { return layer === "ind" ? this.b.grids.employment : this.b.grids[this.state.researchMeasure]; }
  private measure(layer: Layer): string { return layer === "ind" ? "employment" : this.state.researchMeasure; }
  private maxAbs(layer: Layer): number { return this.b.maxAbs[this.measure(layer) as "employment" | "works" | "rd"]; }
  private h(layer: Layer, v: number): number { return (v / this.maxAbs(layer)) * H_MAX; }
  private rel(n: NodeRec): number {
    const m = n.type === "ind" ? "employment" : this.state.researchMeasure;
    return (n.size[m] ?? 0) / this.b.maxSize[m];
  }
  private local(x: number, y: number, h = 0): THREE.Vector3 { return new THREE.Vector3((x - this.cx) * this.scale, h, (y - this.cy) * this.scale); }

  private buildMesh(layer: Layer): void {
    const n = this.b.grids.employment.n;
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
    const overlaid = this.state.mode === "overlaid";
    for (let k = 0; k < g.values.length; k++) {
      const h01 = Math.abs(g.values[k]) / max, [r, gg, bb] = bandColour(t, layer === "ind" ? "ind" : "res", h01);
      // overlaid: flat low ground is see-through so the other terrain shows; terraces stay opaque
      col.setXYZW(k, r / 255, gg / 255, bb / 255, overlaid ? (h01 * BANDS < 1 ? 0 : 0.9) : 1);
    }
    col.needsUpdate = true;
    for (const node of this.b.nodes) if (node.type === layer) this.placeMarker(node);
  }

  private placeMarker(node: NodeRec): void {
    const layer = node.type, [x, y] = node.xy, h = this.h(layer, heightAt(this.grid(layer), x, y));
    const ring = this.rings.get(node.id)!;
    ring.position.copy(this.local(x, y, h + (layer === "ind" ? 0.04 : -0.04)));
    this.anchors.set(node.id, this.local(x, y, h + 0.55));
  }

  private buildMarkers(): void {
    for (const node of this.b.nodes) {
      const r = 0.16 + 0.3 * Math.sqrt(this.rel(node));
      const geo = node.type === "ind" ? new THREE.TorusGeometry(r, 0.035, 8, 40) : new THREE.RingGeometry(r * 0.78, r, 4);
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      ring.rotation.x = node.type === "ind" ? Math.PI / 2 : -Math.PI / 2;   // diamond for fields, circle for sectors
      this.groups[node.type].add(ring); this.rings.set(node.id, ring);
      const btn = document.createElement("button");
      btn.className = "node-label " + node.type; btn.type = "button"; btn.tabIndex = -1;
      btn.textContent = (node.type === "ind" ? "▲ " : "▼ ") + node.label;
      btn.addEventListener("pointerenter", () => this.state.setHover(node));
      btn.addEventListener("pointerleave", () => this.state.setHover(null));
      btn.addEventListener("click", () => this.state.setSelected(node));
      this.labelLayer.appendChild(btn); this.labels.set(node.id, btn);
    }
  }

  // ---- state sync
  private sync(force: boolean): void {
    const key = this.state.mode + "|" + this.state.researchMeasure;
    if (force || key !== this.lastKey) {
      const measureChanged = force || !this.lastKey.endsWith(this.state.researchMeasure);
      const modeChanged = force || !this.lastKey.startsWith(this.state.mode + "|");
      this.lastKey = key;
      if (measureChanged) { this.refreshLayer("fld"); this.refreshLayer("ind"); this.order = [...this.b.nodes].sort((a, c) => this.rel(c) - this.rel(a)); }
      if (modeChanged) { this.applyMode(); this.refreshLayer("ind"); this.refreshLayer("fld"); }
    }
    this.refreshHighlight();
  }

  private applyMode(): void {
    const m = this.state.mode;
    this.groups.ind.visible = this.state.showsIndustry(); this.groups.fld.visible = this.state.showsResearch();
    this.groups.ind.position.y = m === "stacked" ? GAP : 0; this.groups.fld.position.y = 0;
    const see = m === "overlaid";
    for (const layer of ["ind", "fld"] as Layer[]) {
      const mat = this.meshes[layer].material as THREE.MeshStandardMaterial;
      mat.transparent = see; mat.depthWrite = !see; mat.needsUpdate = true;
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
    for (const [id, ring] of this.rings) {
      const on = act?.id === id || sel?.id === id;
      (ring.material as THREE.MeshBasicMaterial).color.set(on ? t.accent : t.fg);
      ring.scale.setScalar(on ? 1.5 : 1);
      this.labels.get(id)!.classList.toggle("active", on);
    }
  }

  // ---- interaction (screen-space picking works for every layer mode)
  private worldAnchor(node: NodeRec): THREE.Vector3 { return this.anchors.get(node.id)!.clone().add(this.groups[node.type].position); }

  private nodeNear(ev: PointerEvent): NodeRec | null {
    const rect = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    let best: NodeRec | null = null, bd = PICK_PX;
    for (const n of this.b.nodes) {
      if (!this.state.isVisible(n)) continue;
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
    if (this.flyTo) {
      const delta = this.flyTo.clone().sub(this.controls.target);
      this.controls.target.add(delta.clone().multiplyScalar(0.12));
      if (delta.length() < 0.01) this.flyTo = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new THREE.Vector3();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const n of this.order) {          // largest nodes claim label space first
      const btn = this.labels.get(n.id)!;
      if (!this.state.isVisible(n)) { btn.style.visibility = "hidden"; continue; }
      v.copy(this.worldAnchor(n)).project(this.camera);
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      const bw = btn.offsetWidth || 120, bh = btn.offsetHeight || 20;
      const r = { x0: x - bw / 2, x1: x + bw / 2, y0: y - bh, y1: y };
      const clash = placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
      const show = v.z < 1 && (btn.classList.contains("active") || !clash);
      btn.style.visibility = show ? "visible" : "hidden";
      if (show) placed.push(r);
      btn.style.transform = "translate(-50%, -100%) translate(" + x + "px, " + y + "px)";
    }
    requestAnimationFrame(this.frame);
  };

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
