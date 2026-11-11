import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Bundle, type LevelGrids, type NodeRec, levelMaxSize, sampleAt } from "./data";
import { readTheme, terrainColour } from "./theme";
import { SPECIES, bloomCells, flowers, owners, touchedMask, type Owners } from "./footprintLayer";
import type { State } from "./state";

const STRETCH_X = 1.45, STRETCH_Z = 1.25;   // spread the layout out; the terrain is only moved, not redrawn
const SPAN = 12;      // world units across the layout
const MAX_LABELS = 60; // labels drawn at once (largest first); the rest stay hidden until hover or select
const PICK_PX = 30;   // screen-space radius for hover and click
const AUTO_L1 = 11.5; // camera distance below which Auto switches to Level 1
const AUTO_L2 = 7.0;  // ... and to Level 2
const CFG = __VIEWER__;

// Shared, low-poly marker geometry (one instance for every node)
const RING = new THREE.RingGeometry(0.82, 1, 24);

interface Marker { ring: THREE.Object3D; label: HTMLButtonElement; text: string; anchor: THREE.Vector3; rel: number; r: number; w: number; h: number; vis: boolean }
const RECEDE = 0.6;   // how far untouched hills move toward the dry-sage colour while a career is shown

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private mesh!: THREE.Mesh;
  private markers = new Map<string, Marker>();   // created the first time a node is shown
  private scale: number; private cx: number; private cy: number;
  private flyTo: THREE.Vector3 | null = null;
  private flyDist: number | null = null;      // camera distance to reach while flying (step-down)
  private flyDir: THREE.Vector3 | null = null; // camera direction from the target to reach while flying
  private owners: Owners | null = null; private ownersKey = "";
  private fpObjects: THREE.Object3D[] = [];
  private hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 1.7);
  private sun = new THREE.DirectionalLight(0xffffff, 1.3);
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
    el.setAttribute("aria-label", "3D terrain of US industries. Height is size (jobs or value added); similar industries sit near each other. Zoom in to reveal finer levels. Arrow keys pan, mouse drag orbits, scroll zooms. Use the lists for keyboard selection.");
    host.appendChild(el);

    const g = b.grids[0]!;
    this.scale = SPAN / (g.x[1] - g.x[0]);
    this.cx = (g.x[0] + g.x[1]) / 2; this.cy = (g.y[0] + g.y[1]) / 2;

    this.camera.position.set(0, 11, 15);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3; this.controls.maxDistance = 40;
    this.controls.target.set(0, 1, 0);
    this.controls.listenToKeyEvents(el);

    this.scene.add(this.hemi, this.sun); this.sun.position.set(-6, 12, 8);
    this.scene.add(this.group);
    this.ground = new THREE.GridHelper(SPAN * 1.2, 24, 0x888888, 0x888888);
    (this.ground.material as THREE.Material).transparent = true; (this.ground.material as THREE.Material).opacity = 0.25;
    this.ground.scale.set(STRETCH_X, 1, STRETCH_Z); this.ground.position.y = -0.01;
    this.scene.add(this.ground);

    this.buildMesh();
    this.applyTheme();
    this.sync(true);
    this.bindPointer(el);
    state.subscribe(() => this.sync(false));
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  // ---- heights
  private grid(): LevelGrids { return this.b.grids[this.state.level]!; }
  private values(): number[] { return this.grid().settings[this.state.size].height; }
  private maxH(): number { return this.b.maxHeight[this.state.level]![this.state.size]; }
  private h(v: number): number { return (v / this.maxH()) * CFG.peak_height; }
  private rel(n: NodeRec): number {
    const m = this.state.measure;
    return (n.size[m] ?? 0) / levelMaxSize(this.b, this.state.level, m);
  }
  private local(x: number, y: number, h = 0): THREE.Vector3 { return new THREE.Vector3((x - this.cx) * this.scale * STRETCH_X, h, (y - this.cy) * this.scale * STRETCH_Z); }

  private buildMesh(): void {
    const n = this.b.grids[0]!.n;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);
  }

  private refreshHeights(): void {
    const g = this.grid(), n = g.n, v = this.values(), pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = g.x[0] + ((g.x[1] - g.x[0]) * i) / (n - 1), y = g.y[0] + ((g.y[1] - g.y[0]) * j) / (n - 1);
      const p = this.local(x, y, this.h(v[j * n + i]));
      pos.setXYZ(j * n + i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
  }

  private refreshColours(): void {
    const t = readTheme(), height = this.values(), max = this.maxH();
    const col = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const touched = this.state.touchedNow(), mask = touched ? touchedMask(this.ownerGrid(), touched) : null;
    for (let k = 0; k < height.length; k++) {
      let [r, g, b] = terrainColour(t, height[k] / max);
      if (mask && !mask[k]) { r += (t.muted[0] - r) * RECEDE; g += (t.muted[1] - g) * RECEDE; b += (t.muted[2] - b) * RECEDE; }
      col.setXYZ(k, r / 255, g / 255, b / 255);
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
    } else {
      ring = new THREE.Mesh(RING, mat); ring.rotation.x = -Math.PI / 2;
    }
    this.group.add(ring);
    const btn = document.createElement("button");
    btn.className = "node-label" + (node.provenance === "estimated" ? " est" : "") + " lvl" + node.level;
    btn.type = "button"; btn.tabIndex = -1; btn.style.visibility = "hidden";
    const text = (node.provenance === "estimated" ? "≈ " : "") + node.label;
    btn.textContent = text;
    btn.addEventListener("pointerenter", () => this.state.setHover(node));
    btn.addEventListener("pointerleave", () => this.state.setHover(null));
    btn.addEventListener("click", () => this.state.setSelected(node));
    this.labelLayer.appendChild(btn);
    m = { ring, label: btn, text, anchor: new THREE.Vector3(), rel: 0, r: 1, w: 0, h: 0, vis: false };
    this.markers.set(node.id, m);
    return m;
  }

  private drawOrder: { id: string; node: NodeRec; m: Marker }[] = [];   // visible nodes, largest first

  private placeMarkers(): void {
    for (const [id, m] of this.markers) { const on = this.state.visibleIds.has(id); m.ring.visible = on && this.ringed(id); if (!on) { m.label.style.visibility = "hidden"; m.vis = false; } }
    const visible = this.b.nodes.filter((n) => this.state.visibleIds.has(n.id));
    const g = this.grid(), v = this.values();
    for (const node of visible) {
      const m = this.marker(node), [x, y] = node.xy;
      const h = this.h(sampleAt(g, v, x, y));
      m.rel = this.rel(node);
      const r = (0.07 + 0.34 * Math.sqrt(m.rel)) * (node.level === 0 ? 1 : node.level === 1 ? 0.8 : 0.6);
      m.ring.position.copy(this.local(x, y, h + 0.04));
      m.r = r; m.ring.scale.setScalar(r);
      m.anchor.copy(this.local(x, y, h + 0.35 + r));
    }
    this.sortLabels();
  }

  /** Largest first, but touched nodes claim label space before everything else when a footprint is shown. */
  private sortLabels(): void {
    const touched = this.state.touchedNow();
    const key = (n: NodeRec, m: Marker) => (touched?.has(n.id) ? 10 + (touched.get(n.id) ?? 0) : m.rel);
    this.drawOrder = this.b.nodes.filter((n) => this.state.visibleIds.has(n.id) && this.markers.has(n.id)).map((node) => ({ id: node.id, node, m: this.markers.get(node.id)! }))
      .sort((a, c) => key(c.node, c.m) - key(a.node, a.m));
  }

  // ---- footprint on the terrain
  /** Which touched industry each grid point belongs to (owners over the touched industries only, sized against the
   *  level's largest industry, so a small touched peak keeps its ground beside a taller neighbour). */
  private ownerGrid(): Owners {
    const touched = this.state.touchedNow();
    const k = [this.state.size, this.state.level, this.state.fpVersion].join("|");
    if (!this.owners || this.ownersKey !== k) {
      const visible = this.b.nodes.filter((n) => this.state.visibleIds.has(n.id)), m = this.state.measure;
      const max = visible.reduce((a, x) => Math.max(a, x.size[m] ?? 0), 0);
      this.owners = owners(this.grid(), visible.filter((n) => touched?.has(n.id)), m, this.b.meta.terrain, max);
      this.ownersKey = k;
    }
    return this.owners;
  }

  private gridPoint(fi: number, fj: number, lift: number): THREE.Vector3 {
    const g = this.grid(), n = g.n;
    const x = g.x[0] + ((g.x[1] - g.x[0]) * fi) / (n - 1), y = g.y[0] + ((g.y[1] - g.y[0]) * fj) / (n - 1);
    return this.local(x, y, this.h(sampleAt(g, this.values(), x, y)) + lift);
  }

  private refreshFootprint(): void {
    for (const o of this.fpObjects) { this.group.remove(o); (o as THREE.Mesh).geometry?.dispose(); ((o as THREE.Mesh).material as THREE.Material)?.dispose(); }
    this.fpObjects = [];
    const touched = this.state.touchedNow();
    for (const [id, m] of this.markers) {                  // labels: touched ones carry their share; the rest recede
      const s = touched?.get(id);
      const text = s !== undefined ? m.text + " \u00b7 " + Math.round(s * 100) + "%" : m.text;
      if (m.label.textContent !== text) { m.label.textContent = text; m.w = 0; }
      m.label.classList.toggle("touched", s !== undefined);
    }
    this.sortLabels();
    if (!touched || !touched.size) return;
    const o = this.ownerGrid(), n = this.grid().n;
    const fl = flowers(bloomCells(o, touched, n, this.values()), n);
    const pos = new Float32Array(fl.length * 3), col = new Float32Array(fl.length * 3);
    const cs = getComputedStyle(document.documentElement);
    const palette = SPECIES.map((_, i) => new THREE.Color(cs.getPropertyValue("--flower-" + (i + 1)).trim()));
    fl.forEach(([i, j, c], k) => { const p = this.gridPoint(i, j, 0.03); pos.set([p.x, p.y, p.z], k * 3); col.set([palette[c].r, palette[c].g, palette[c].b], k * 3); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: [0.24, 0.16, 0.12][this.state.level] ?? 0.12, vertexColors: true, map: dotTexture(), alphaTest: 0.5, transparent: true }));
    pts.name = "footprint-flowers"; this.group.add(pts); this.fpObjects.push(pts);
  }

  /** Fly the camera to frame these visible nodes (step-down). */
  frameNodes(ids: string[]): void {
    const pts = ids.map((id) => this.markers.get(id)?.anchor).filter((p): p is THREE.Vector3 => !!p);
    if (!pts.length) return;
    const c = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    const spread = Math.max(...pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z)), 0.6);
    c.y = Math.max(0.5, c.y - 1);
    this.flyTo = c;
    const lvl = this.state.level;
    this.flyDist = Math.min(lvl >= 2 ? AUTO_L2 * 0.95 : lvl === 1 ? AUTO_L1 * 0.95 : 18, Math.max(lvl >= 2 ? 5.5 : 7.5, spread * 3.2));
    // look down from higher up so taller untouched peaks do not hide the touched ones
    const off = this.camera.position.clone().sub(this.controls.target), az = Math.atan2(off.x, off.z), elev = 1.0;
    this.flyDir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
  }

  /** Back to the whole map. */
  frameAll(): void { this.flyTo = new THREE.Vector3(0, 1, 0); this.flyDist = 18.6; this.flyDir = new THREE.Vector3(0, 11, 15).normalize(); }

  // ---- state sync
  private sync(force: boolean): void {
    const shape = [this.state.size, this.state.level].join("|");
    const key = [shape, this.state.fpVersion].join("|");
    if (force || key !== this.key) {
      const shapeChanged = force || !this.key.startsWith(shape + "|");
      this.key = key;
      if (shapeChanged) { this.refreshHeights(); this.placeMarkers(); }
      this.refreshColours(); this.refreshFootprint();
    }
    this.refreshHighlight();
  }

  applyTheme(): void {
    this.scene.background = new THREE.Color(readTheme().sky);
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    this.hemi.intensity = dark ? 0.8 : 1.7; this.sun.intensity = dark ? 0.9 : 1.3;   // moonlit hills at night
    this.refreshColours(); this.refreshFootprint(); this.refreshHighlight();
  }

  /** Rings only mark the selected and hovered nodes; the terrain itself shows where the peaks are. */
  private ringed(id: string): boolean { return this.state.active?.id === id || this.state.selected?.id === id; }

  private refreshHighlight(): void {
    const t = readTheme(), act = this.state.active, sel = this.state.selected;
    for (const [id, m] of this.markers) {
      const on = act?.id === id || sel?.id === id;
      const mat = (m.ring as THREE.Mesh | THREE.LineLoop).material as THREE.MeshBasicMaterial | THREE.LineDashedMaterial;
      mat.color.set(on ? t.accent : t.fg);
      m.ring.scale.setScalar(m.r * (on ? 1.5 : 1));
      m.ring.visible = this.state.visibleIds.has(id) && on;
      m.label.classList.toggle("active", on);
    }
  }

  // ---- interaction (screen-space picking)
  private nodeNear(ev: PointerEvent): NodeRec | null {
    const rect = this.renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    let best: NodeRec | null = null, bd = PICK_PX;
    for (const n of this.b.nodes) {
      const m = this.markers.get(n.id);
      if (!this.state.isVisible(n) || !m) continue;
      v.copy(m.anchor).add(new THREE.Vector3(0, -0.5, 0)).project(this.camera);
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

  focus(node: NodeRec): void {
    const m = this.markers.get(node.id);
    this.flyTo = (m ? m.anchor.clone() : new THREE.Vector3()).add(new THREE.Vector3(0, -0.6, 0));
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h;
    // narrow screens (phones): widen the vertical field of view so the whole map still fits across the width
    const narrow = Math.max(1, 1.3 / this.camera.aspect);
    this.camera.fov = Math.min(100, (2 * Math.atan(Math.tan((45 * Math.PI) / 360) * narrow) * 180) / Math.PI);
    this.camera.updateProjectionMatrix();
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
      this.camera.position.add(delta.clone().multiplyScalar(0.12));   // move with the target so the view keeps its angle
      if (delta.length() < 0.01) this.flyTo = null;
    }
    if (this.flyDir) {
      const off = this.camera.position.clone().sub(this.controls.target), d = off.length();
      const dir = off.clone().normalize().lerp(this.flyDir, 0.12).normalize();
      this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(d));
      if (dir.angleTo(this.flyDir) < 0.01) this.flyDir = null;
    }
    if (this.flyDist !== null) {
      const off = this.camera.position.clone().sub(this.controls.target), d = off.length();
      const next = d + (this.flyDist - d) * 0.12;
      this.camera.position.copy(this.controls.target).add(off.multiplyScalar(next / d));
      if (Math.abs(this.flyDist - next) < 0.02) this.flyDist = null;
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
      m.ring.visible = this.ringed(n.id);
      const priority = active || m.label.classList.contains("touched");
      if (this.state.fp && !priority) { setVis(m, false); continue; }   // with a career shown, other labels appear on hover
      if (placed.length >= MAX_LABELS && !priority) { setVis(m, false); continue; }
      v.copy(m.anchor).project(this.camera);
      if (v.z >= 1) { setVis(m, false); continue; }
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      if (!m.w) { m.w = m.label.offsetWidth || 120; m.h = m.label.offsetHeight || 20; }   // measured once, not every frame
      const r = { x0: x - m.w / 2, x1: x + m.w / 2, y0: y - m.h, y1: y };
      let clash = false;
      for (let i = 0; i < placed.length && !clash; i++) { const p = placed[i]; clash = r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0; }
      const show = priority || !clash;
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

let dot: THREE.Texture | null = null;
/** Round point sprite (shared) so flowers draw as dots, not squares. */
function dotTexture(): THREE.Texture {
  if (dot) return dot;
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();
  dot = new THREE.CanvasTexture(c);
  return dot;
}

export function webglAvailable(): boolean {
  try { return !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl"); }
  catch { return false; }
}
