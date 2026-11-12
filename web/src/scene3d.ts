import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Bundle, type LevelGrids, type NodeRec, levelMaxSize, sampleAt } from "./data";
import { readTheme, terrainColour } from "./theme";
import { SPECIES, bloomCells, flowers, noise, owners, type Owners } from "./footprintLayer";
import { flowerTexture } from "./flowerSprites";
import { makeBillboard } from "./billboard";
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
/** Label slots tried in order, in label widths (x) and label heights (y, negative = up). */
const LABEL_SLOTS: [number, number][] = [[0, 0], [0, -1], [0, -2], [0.55, -1], [-0.55, -1], [0, -3], [0.55, -2], [-0.55, -2], [0, -4], [1.1, -1], [-1.1, -1], [0, 1], [0.55, 0], [-0.55, 0]];
const MESH_N = 256;   // mesh points per side
const EXTEND = 2.2;   // the mesh covers this many times the data area, so land runs past every edge of the view
const BASE = 0.3;     // rolling base hills (decoration, no data), as a share of the peak height
const RIDGE = 2.2;    // how much taller the base grows far beyond the map (distant ridges)

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
  private billboard: { id: string; group: THREE.Group } | null = null;   // prototype: one sign on the largest touched hill
  private hemi = new THREE.HemisphereLight(0xdcecff, 0x4a5a2a, 1.1);   // sky light from above, grass bounce below
  private sun = new THREE.DirectionalLight(0xfff3dc, 2.2);            // low side sun models the slopes
  private running = false;
  private key = "";
  private meshXY = new Float32Array(MESH_N * MESH_N * 2);   // layout coordinates of each mesh point
  private base = new Float32Array(MESH_N * MESH_N);          // rolling base height at each mesh point (world units)
  private autoLevel = 0;
  private frameMs = 0;        // moving average of CPU time spent per frame (render + label layout)
  private labelsShown = 0;
  onAutoLevel: (level: number) => void = () => {};

  private stemPath: SVGPathElement;

  constructor(private host: HTMLElement, private labelLayer: HTMLElement, private b: Bundle, private state: State) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "stems"); svg.setAttribute("aria-hidden", "true");
    this.stemPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(this.stemPath); labelLayer.appendChild(svg);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });   // see-through: the page's sky shows behind the hills
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    el.setAttribute("aria-label", "3D terrain of US industries. Height is size (jobs or value added); similar industries sit near each other. Zoom in to reveal finer levels. Arrow keys pan, mouse drag orbits, scroll zooms. Use the lists for keyboard selection.");
    host.appendChild(el);

    const g = b.grids[0]!;
    this.scale = SPAN / (g.x[1] - g.x[0]);
    this.cx = (g.x[0] + g.x[1]) / 2; this.cy = (g.y[0] + g.y[1]) / 2;

    this.camera.position.set(0, 6.2, 12.5);   // low oblique view across the hills; the horizon sits near the top
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3; this.controls.maxDistance = 40;
    this.controls.target.set(0, 0.6, 0);
    this.controls.maxPolarAngle = Math.PI * 0.47;   // never below the ground
    this.controls.listenToKeyEvents(el);

    this.scene.add(this.hemi, this.sun); this.sun.position.set(-12, 5, 3);
    this.scene.add(this.group);

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

  /** Rolling base hills in world units at layout point (x, y): two octaves of smooth noise, swelling into ridges
   *  beyond the map. Decoration only; every industry's height comes from the data on top of it. */
  private baseAt(x: number, y: number): number {
    const g = this.b.grids[0]!, half = (g.x[1] - g.x[0]) / 2, r = Math.hypot(x - this.cx, y - this.cy) / half;
    const n = 0.7 * noise(x * 40, y * 40, 34, 3) + 0.3 * noise(x * 40, y * 40, 15, 4);
    const far = Math.min(1, Math.max(0, (r - 1.1) / 1.0));
    return CFG.peak_height * BASE * n * (1 + RIDGE * far * far);
  }

  private buildMesh(): void {
    const n = MESH_N, g = this.b.grids[0]!;
    const wx = (g.x[1] - g.x[0]) * EXTEND, wy = (g.y[1] - g.y[0]) * EXTEND;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = this.cx + (i / (n - 1) - 0.5) * wx, y = this.cy + (j / (n - 1) - 0.5) * wy;
      this.meshXY[2 * k] = x; this.meshXY[2 * k + 1] = y; this.base[k] = this.baseAt(x, y);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);
  }

  /** Data height (world units) at a layout point: the industries' hills, zero outside the data grid. */
  private dataAt(x: number, y: number): number {
    const g = this.grid();
    if (x < g.x[0] || x > g.x[1] || y < g.y[0] || y > g.y[1]) return 0;
    return this.h(sampleAt(g, this.values(), x, y));
  }
  /** Ground height (world units) at a layout point: data plus the rolling base. */
  private heightAt(x: number, y: number): number { return this.dataAt(x, y) + this.baseAt(x, y); }

  private refreshHeights(): void {
    const pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < MESH_N * MESH_N; k++) {
      const x = this.meshXY[2 * k], y = this.meshXY[2 * k + 1];
      const p = this.local(x, y, this.dataAt(x, y) + this.base[k]);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
  }

  private refreshColours(): void {
    const t = readTheme(), top = CFG.peak_height * (1 + BASE);
    const pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let k = 0; k < MESH_N * MESH_N; k++) {          // every hill the same green; only the flowers mark a career
      const [r, gg, b] = terrainColour(t, pos.getY(k) / top);
      col.setXYZ(k, r / 255, gg / 255, b / 255);
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
    for (const node of visible) {
      const m = this.marker(node), [x, y] = node.xy;
      const h = this.heightAt(x, y);
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
    return this.local(x, y, this.heightAt(x, y) + lift);
  }

  private refreshFootprint(): void {
    for (const o of this.fpObjects) {
      this.group.remove(o);
      o.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; m?.map?.dispose(); m?.dispose(); });
    }
    this.fpObjects = []; this.billboard = null;
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
    // prototype: a wooden sign on the largest touched hill instead of its floating label
    const [topId, topShare] = [...touched][0];
    const node = this.b.byId.get(topId);
    if (node) {
      const sign = makeBillboard(node.label, Math.round(topShare * 100) + "% of your career", [1.1, 0.7, 0.5][this.state.level] ?? 0.5);
      sign.position.copy(this.local(node.xy[0], node.xy[1], this.heightAt(node.xy[0], node.xy[1]) - 0.02));
      this.group.add(sign); this.fpObjects.push(sign); this.billboard = { id: topId, group: sign };
    }
    const fl = flowers(bloomCells(o, touched, n, this.values()), n);
    const size = [0.3, 0.2, 0.15][this.state.level] ?? 0.15;
    SPECIES.forEach((sp, c) => {
      const mine = fl.filter((f) => f[2] === c);
      if (!mine.length) return;
      const pos = new Float32Array(mine.length * 3);
      mine.forEach(([i, j], k) => { const p = this.gridPoint(i, j, 0.04); pos.set([p.x, p.y, p.z], k * 3); });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: size * (sp.name === "lupine" ? 1.25 : 1), map: flowerTexture(sp.name), alphaTest: 0.35, transparent: true, depthWrite: false }));
      pts.name = "footprint-flowers-" + sp.name; this.group.add(pts); this.fpObjects.push(pts);
    });
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
    const off = this.camera.position.clone().sub(this.controls.target), az = Math.atan2(off.x, off.z), elev = 0.55;
    this.flyDir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
  }

  /** Back to the whole map. */
  frameAll(): void { this.flyTo = new THREE.Vector3(0, 0.6, 0); this.flyDist = 13.9; this.flyDir = new THREE.Vector3(0, 6.2, 12.5).normalize(); }

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
    const t = readTheme();
    this.scene.fog = new THREE.Fog(new THREE.Color(t.horizon), 24, 70);   // distant hills fade into the horizon haze
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    this.hemi.intensity = dark ? 0.6 : 1.1; this.sun.intensity = dark ? 0.9 : 2.2;   // moonlit hills at night
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
    if (this.billboard) {                                  // the sign turns to face the viewer (about its vertical axis only)
      const p = this.billboard.group.position;
      this.billboard.group.rotation.y = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z);
    }
    // Auto level of detail from the camera's distance to its target (with a little hysteresis)
    const dist = this.camera.position.distanceTo(this.controls.target);
    const want = dist < AUTO_L2 * (this.autoLevel === 2 ? 1.08 : 1) ? 2 : dist < AUTO_L1 * (this.autoLevel >= 1 ? 1.08 : 1) ? 1 : 0;
    if (this.state.lod === "auto" && want !== this.autoLevel) { this.autoLevel = want; this.onAutoLevel(want); }
    this.renderer.render(this.scene, this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new THREE.Vector3();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const setVis = (m: Marker, on: boolean) => { if (m.vis !== on) { m.vis = on; m.label.style.visibility = on ? "visible" : "hidden"; } };
    const stems: string[] = [];
    if (this.billboard) {                                  // floating labels keep clear of the sign
      const box = new THREE.Box3().setFromObject(this.billboard.group), c = new THREE.Vector3();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
        c.set(cx, cy, cz).project(this.camera);
        if (c.z >= 1) continue;
        const sx = ((c.x + 1) / 2) * w, sy = ((1 - c.y) / 2) * h;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
      if (x0 < x1) placed.push({ x0, x1, y0, y1 });
    }
    const free = (r: { x0: number; x1: number; y0: number; y1: number }) =>
      r.x0 >= 2 && r.x1 <= w - 2 && r.y0 >= 2 && r.y1 <= h - 2 && !placed.some((p) => r.x0 < p.x1 + 3 && r.x1 > p.x0 - 3 && r.y0 < p.y1 + 2 && r.y1 > p.y0 - 2);
    for (const { node: n, m } of this.drawOrder) {          // career labels first, then the largest nodes
      const active = m.label.classList.contains("active");
      if (!this.state.isVisible(n)) { m.ring.visible = false; setVis(m, false); continue; }
      m.ring.visible = this.ringed(n.id);
      if (this.billboard?.id === n.id && !active) { setVis(m, false); continue; }   // the sign stands in for this label
      const priority = active || m.label.classList.contains("touched");
      if (this.state.fp && !priority) { setVis(m, false); continue; }   // with a career shown, other labels appear on hover
      if (placed.length >= MAX_LABELS && !priority) { setVis(m, false); continue; }
      v.copy(m.anchor).project(this.camera);
      if (v.z >= 1) { setVis(m, false); continue; }
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      if (!m.w) { m.w = m.label.offsetWidth || 120; m.h = m.label.offsetHeight || 20; }   // measured once, not every frame
      // Career and hovered labels look for a free slot nearby (stacked up, then shifted sideways) instead of overlapping;
      // other labels only take their own spot.
      let best: { x0: number; x1: number; y0: number; y1: number } | null = null, bx = x, by = y;
      for (const [dx, dy] of priority ? LABEL_SLOTS : [[0, 0]]) {
        const cx = Math.min(Math.max(x + dx * m.w, m.w / 2 + 2), w - m.w / 2 - 2), cy = y + dy * (m.h + 4);
        const r = { x0: cx - m.w / 2, x1: cx + m.w / 2, y0: cy - m.h, y1: cy };
        if (free(r)) { best = r; bx = cx; by = cy; break; }
      }
      if (!best && priority) { bx = x; by = y; best = { x0: x - m.w / 2, x1: x + m.w / 2, y0: y - m.h, y1: y }; }   // nowhere free: draw it anyway
      setVis(m, !!best);
      if (!best) continue;
      placed.push(best);
      m.label.style.transform = "translate(-50%, -100%) translate(" + bx.toFixed(1) + "px, " + by.toFixed(1) + "px)";
      if (Math.abs(bx - x) > 1 || Math.abs(by - y) > 1) stems.push("M" + x.toFixed(1) + " " + y.toFixed(1) + "L" + bx.toFixed(1) + " " + by.toFixed(1));
    }
    this.stemPath.setAttribute("d", stems.join(""));
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

export function webglAvailable(): boolean {
  try { return !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl"); }
  catch { return false; }
}
