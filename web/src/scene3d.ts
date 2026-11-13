import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Bundle, type LevelGrids, type NodeRec, levelMaxSize, sampleAt } from "./data";
import { readTheme, terrainColour } from "./theme";
import { SPECIES, bloomCells, flowers, noise, owners, type Owners } from "./footprintLayer";
import { flowerTexture } from "./flowerSprites";
import { makeGrassLabel } from "./grassLabel";
import type { State } from "./state";

const STRETCH_X = 1.45, STRETCH_Z = 1.25;   // spread the layout out; the terrain is only moved, not redrawn
const SPAN = 16;      // world units across the layout (hills keep their size; more ground between them)
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
const RIDGE = 1.1;    // how much taller the base grows far beyond the map (distant ridges)
const HEIGHT_EASE = 0.8;   // industry heights to this power: the order stays, small hills read better (looks over exactness)
const SOFTEN = 1.6;   // blur of the drawn land, in mesh cells (rounds summits and saddles)

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
  private lettered = new Map<string, THREE.Mesh>();   // hills whose name is lettered into the grass
  private unlettered = new Set<string>();             // hills that wanted lettering but had no clear spot: they keep a floating label
  private hemi = new THREE.HemisphereLight(0xdcecff, 0x4a5a2a, 1.1);   // sky light from above, grass bounce below
  private sun = new THREE.DirectionalLight(0xfff3dc, 2.2);            // low side sun models the slopes
  private running = false;
  private key = "";
  private meshXY = new Float32Array(MESH_N * MESH_N * 2);   // layout coordinates of each mesh point
  private base = new Float32Array(MESH_N * MESH_N);          // rolling base height at each mesh point (world units)
  private land: Float32Array = new Float32Array(0);                      // the drawn ground height at each mesh point (softened)
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

    this.camera.position.set(0, 8.2, 16.4);   // low oblique view across the hills; the horizon sits near the top
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.minDistance = 3; this.controls.maxDistance = 50;
    this.controls.target.set(0, 0.6, 0);
    this.controls.maxPolarAngle = Math.PI * 0.47;   // never below the ground
    this.controls.listenToKeyEvents(el);

    this.scene.add(this.hemi, this.sun);
    // low sun from the back left: long shadows fall across the slopes toward the viewer, as in late-afternoon light
    this.sun.position.set(-17, 5.2, -2.5); this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 80;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04; this.sun.shadow.radius = 4;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  private h(v: number): number { return Math.pow(Math.max(0, v / this.maxH()), HEIGHT_EASE) * CFG.peak_height; }   // closer heights, same order
  private rel(n: NodeRec): number {
    const m = this.state.measure;
    return (n.size[m] ?? 0) / levelMaxSize(this.b, this.state.level, m);
  }
  private local(x: number, y: number, h = 0): THREE.Vector3 { return new THREE.Vector3((x - this.cx) * this.scale * STRETCH_X, h, (y - this.cy) * this.scale * STRETCH_Z); }

  /** Rolling base land in world units at layout point (x, y): three octaves of smooth noise on warped coordinates, so
   *  the ground between the industries' hills rolls like grassland, swelling into soft ranges beyond the map.
   *  No creases or cuts: everything is rounded (decoration only; the industries' heights sit on top). */
  private baseAt(x: number, y: number): number {
    const g = this.b.grids[0]!, half = (g.x[1] - g.x[0]) / 2, r = Math.hypot(x - this.cx, y - this.cy) / half;
    const X = x * 40 + 11 * (noise(x * 40, y * 40, 26, 11) - 0.5), Y = y * 40 + 11 * (noise(x * 40, y * 40, 26, 12) - 0.5);
    const far = Math.min(1, Math.max(0, (r - 1.05) / 1.1));
    const fine = 1 - 0.8 * far;                           // far away only the broad swells remain (soft distant ranges)
    const roll = (0.5 * noise(X, Y, 30, 3) + fine * (0.32 * noise(X, Y, 14, 4) + 0.18 * noise(X, Y, 7, 5))) / (0.5 + fine * 0.5);
    const swell = roll * roll * (3 - 2 * roll);           // smoothstep: round tops, soft hollows
    return CFG.peak_height * BASE / 0.3 * 0.34 * swell * (1 + RIDGE * 1.4 * far * far);
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
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  /** Data height (world units) at a layout point: the industries' hills, zero outside the data grid. */
  private dataAt(x: number, y: number): number {
    const g = this.grid();
    if (x < g.x[0] || x > g.x[1] || y < g.y[0] || y > g.y[1]) return 0;
    return this.h(sampleAt(g, this.values(), x, y));
  }
  /** Ground height (world units) at a layout point: data plus the rolling base. */
  private heightAt(x: number, y: number): number {
    // the drawn (softened) land, so lettering and markers sit on what is shown
    const g = this.b.grids[0]!, n = MESH_N;
    const fi = ((x - this.cx) / ((g.x[1] - g.x[0]) * EXTEND) + 0.5) * (n - 1), fj = ((y - this.cy) / ((g.y[1] - g.y[0]) * EXTEND) + 0.5) * (n - 1);
    if (!this.land.length || fi < 0 || fj < 0 || fi > n - 1 || fj > n - 1) return this.dataAt(x, y) + this.baseAt(x, y);
    const i0 = Math.min(n - 2, Math.floor(fi)), j0 = Math.min(n - 2, Math.floor(fj)), a = fi - i0, c = fj - j0, L = this.land;
    return (L[j0 * n + i0] * (1 - a) + L[j0 * n + i0 + 1] * a) * (1 - c) + (L[(j0 + 1) * n + i0] * (1 - a) + L[(j0 + 1) * n + i0 + 1] * a) * c;
  }

  private refreshHeights(): void {
    const pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute, n = MESH_N;
    const raw = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) raw[k] = this.dataAt(this.meshXY[2 * k], this.meshXY[2 * k + 1]) + this.base[k];
    this.land = blur(raw, n, SOFTEN);                       // round every summit and saddle a little
    for (let k = 0; k < n * n; k++) {
      const p = this.local(this.meshXY[2 * k], this.meshXY[2 * k + 1], this.land[k]);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
    pos.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
  }

  private refreshColours(): void {
    const t = readTheme(), top = CFG.peak_height * (1 + BASE);
    const pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute, c = new THREE.Color();
    for (let k = 0; k < MESH_N * MESH_N; k++) {          // every hill the same green; only the flowers mark a career
      const x = this.meshXY[2 * k], y = this.meshXY[2 * k + 1];
      const patch = noise(x * 40, y * 40, 9, 21) - 0.5;   // meadow patches: some grass a little yellower, some deeper
      const [r, gg, b] = terrainColour(t, Math.max(0, pos.getY(k)) / top, patch);
      c.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace);   // the palette is sRGB; the renderer works in linear
      col.setXYZ(k, c.r, c.g, c.b);
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
    this.fpObjects = []; this.lettered.clear(); this.unlettered.clear();
    const touched = this.state.touchedNow();
    for (const [id, m] of this.markers) {                  // career labels are marked; shares stay in the panel
      if (m.label.textContent !== m.text) { m.label.textContent = m.text; m.w = 0; }
      m.label.classList.toggle("touched", !!touched?.has(id));
    }
    this.sortLabels();
    // Names lettered into the grass: every sector at Level 0 (career sectors bold and sized by share, the rest smaller and
    // softer); at finer levels only the career areas. A hill whose lettering would be hidden or crowded keeps a floating label.
    const lvl = this.state.level, m = this.state.measure, eye = this.viewPoint();
    const viewCam = this.camera.clone(); viewCam.position.copy(eye); viewCam.lookAt(this.flyTo ?? this.controls.target); viewCam.updateMatrixWorld();
    const visible = this.b.nodes.filter((x) => this.state.visibleIds.has(x.id));
    const topSize = Math.max(...visible.map((x) => x.size[m] ?? 0), 1e-9);   // the level's largest industry
    const topShare = touched?.size ? Math.max(...touched.values()) : 1;
    const others = lvl === 0 ? visible.filter((x) => !touched?.has(x.id)).sort((p, q) => (q.size[m] ?? 0) - (p.size[m] ?? 0)).map((x) => [x.id, 0] as [string, number]) : [];
    const queue: [string, number][] = [...(touched ?? new Map()), ...others];
    const rects: number[][] = [], screen: number[][] = [];
    for (const [id, share] of queue) {
      const node = this.b.byId.get(id);
      if (!node || node.label.length > 24) continue;      // long names keep a floating label (they would not fit the ground)
      const career = share > 0;
      // on screen, size follows the share (career) or stays small (other sectors), not how near the hill happens to be
      const here = this.local(node.xy[0], node.xy[1], this.heightAt(node.xy[0], node.xy[1]));
      const far = Math.min(1.4, Math.max(0.55, here.distanceTo(eye) / eye.distanceTo(this.flyTo ?? this.controls.target)));
      const base = [0.74, 0.34, 0.24][lvl] ?? 0.24, step = [0.038, 0.021, 0.015][lvl] ?? 0.015;
      const width = base * (career ? 0.45 + 0.55 * Math.sqrt(share / topShare) : 0.66) * far;
      const ground = (x: number, y: number) => this.local(x, y, this.heightAt(x, y));
      if (lvl === 0) {
        // sectors: always lettered, just below the summit on the viewer's side, each with its own small offset and tilt
        const j1 = hash01(id, 1), j2 = hash01(id, 2), j3 = hash01(id, 3);
        // if it would run into a name already placed, shrink it in steps and nudge it sideways (the larger shares go first)
        const overlaps = (r: number[]) => rects.some((q) => r[0] < q[1] + 0.015 && r[1] > q[0] - 0.015 && r[2] < q[3] + 0.01 && r[3] > q[2] - 0.01);
        let mesh: THREE.Mesh | null = null;
        for (const f of [1, 0.85, 0.72, 0.6]) for (const dx of [0, -0.08, 0.08, -0.15, 0.15]) {
          if (mesh && !overlaps(mesh.userData.rect as number[])) break;
          if (mesh) { mesh.geometry.dispose(); (mesh.material as THREE.MeshBasicMaterial).map?.dispose(); (mesh.material as THREE.Material).dispose(); }
          // offset and jitter scale with the hill's size, so a small hill keeps its name near its top
        const hill = Math.pow(Math.max(node.size[m] ?? 0, 0) / topSize, 0.35), k = 0.35 + 0.65 * hill;
        const c: [number, number] = [node.xy[0] + (j1 - 0.5) * 0.12 * k + dx, node.xy[1] + (0.1 + (j2 - 0.5) * 0.06) * k];
          mesh = makeGrassLabel(node.label, c, width * f, ground, 1, !career, (j3 - 0.5) * 0.28);
        }
        rects.push(mesh!.userData.rect as number[]); this.group.add(mesh!); this.fpObjects.push(mesh!); this.lettered.set(id, mesh!);
        continue;
      }
      // finer levels: try spots down the slope facing the viewer (and a little to each side); keep the first whose whole
      // text area is in line of sight and faces the camera
      let best: [number, number] = [node.xy[0], node.xy[1] + step], bestSeen = -1;
      for (const k of [4, 3, 5, 2, 6, 1, 7]) for (const side of [0, -0.25, 0.25]) {
        const c: [number, number] = [node.xy[0] + side * width, node.xy[1] + k * step];
        const hh = width * 0.11, pts = [[-0.48, -hh], [0, -hh], [0.48, -hh], [-0.48, 0], [0, 0], [0.48, 0], [-0.48, hh], [0, hh], [0.48, hh]];
        const seen = pts.filter(([u, dy]) => this.inView(eye, c[0] + u * width, c[1] + dy)).length;
        if (seen > bestSeen) { best = c; bestSeen = seen; }
        if (seen === pts.length) break;
      }
      const mesh = makeGrassLabel(node.label, best, width, ground, 1, !career);
      const r = mesh.userData.rect as number[], pad = 0.02;
      const sr = this.screenBox(mesh, viewCam), spad = 6;
      const clash = bestSeen < 9 || rects.some((q) => r[0] < q[1] + pad && r[1] > q[0] - pad && r[2] < q[3] + pad && r[3] > q[2] - pad)
        || screen.some((q) => sr[0] < q[1] + spad && sr[1] > q[0] - spad && sr[2] < q[3] + spad && sr[3] > q[2] - spad);
      if (clash) {                                         // hidden or crowded: this hill keeps a floating label
        this.unlettered.add(id);
        mesh.geometry.dispose(); (mesh.material as THREE.MeshBasicMaterial).map?.dispose(); (mesh.material as THREE.Material).dispose();
        continue;
      }
      rects.push(r); screen.push(sr); this.group.add(mesh); this.fpObjects.push(mesh); this.lettered.set(id, mesh);
    }
    if (!touched || !touched.size) return;
    const o = this.ownerGrid(), n = this.grid().n;
    const fl = flowers(bloomCells(o, touched, n, this.values()), n);
    const size = [0.24, 0.18, 0.14][this.state.level] ?? 0.14;
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

  /** Where the camera is, or will be once a step-down flight ends. */
  private viewPoint(): THREE.Vector3 {
    if (!this.flyTo && this.flyDist === null && !this.flyDir) return this.camera.position.clone();
    const target = this.flyTo ?? this.controls.target, off = this.camera.position.clone().sub(this.controls.target);
    const dir = (this.flyDir ?? off.clone().normalize()), dist = this.flyDist ?? off.length();
    return target.clone().add(dir.clone().normalize().multiplyScalar(dist));
  }

  /** Screen rectangle [x0, x1, y0, y1] (pixels) of an object as seen from `cam`. */
  private screenBox(obj: THREE.Object3D, cam: THREE.Camera): number[] {
    const box = new THREE.Box3().setFromObject(obj), c = new THREE.Vector3(), w = this.host.clientWidth, h = this.host.clientHeight;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const cx of [box.min.x, box.max.x]) for (const cy of [box.min.y, box.max.y]) for (const cz of [box.min.z, box.max.z]) {
      c.set(cx, cy, cz).project(cam);
      const sx = ((c.x + 1) / 2) * w, sy = ((1 - c.y) / 2) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return [x0, x1, y0, y1];
  }

  /** True when the ground at layout point (x, y) can be seen from `eye`: no hill in between, and facing the viewer. */
  private inView(eye: THREE.Vector3, x: number, y: number): boolean {
    const p = this.local(x, y, this.heightAt(x, y) + 0.05), steps = 48;
    // the ground must face the viewer, not just be in line of sight (grazing slopes squash lettering to nothing)
    const e = 0.01, sx = this.scale * STRETCH_X, sz = this.scale * STRETCH_Z;
    const nrm = new THREE.Vector3(-(this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e * sx), 1, -(this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e * sz)).normalize();
    if (nrm.dot(eye.clone().sub(p).normalize()) < 0.3) return false;
    for (let i = 1; i < steps; i++) {
      const t = i / steps, q = eye.clone().lerp(p, t);
      const lx = q.x / (this.scale * STRETCH_X) + this.cx, ly = q.z / (this.scale * STRETCH_Z) + this.cy;
      if (q.y < this.heightAt(lx, ly) - 0.02) return false;
    }
    return true;
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
    this.refreshFootprint();                               // place lettering for the view the camera is flying to
  }

  /** Back to the whole map. */
  frameAll(): void { this.flyTo = new THREE.Vector3(0, 0.6, 0); this.flyDist = 18.3; this.flyDir = new THREE.Vector3(0, 8.2, 16.4).normalize(); this.refreshFootprint(); }

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
    this.scene.fog = new THREE.Fog(new THREE.Color(t.haze), 22, 82);   // atmospheric haze: far ridges turn soft and blue
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    this.hemi.intensity = dark ? 0.8 : 0.6; this.sun.intensity = dark ? 1.7 : 3.4;   // moonlit hills at night
    this.hemi.color.set(dark ? 0x9fb4e0 : 0xcfe2ff); this.hemi.groundColor.set(dark ? 0x10180f : 0x2c4a1c);
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
    const stems: string[] = [];
    for (const obj of this.lettered.values()) {         // floating labels keep clear of the lettering
      const box = new THREE.Box3().setFromObject(obj), c = new THREE.Vector3();
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
      if (this.lettered.has(n.id) && !active) { setVis(m, false); continue; }   // the lettering stands in for this label
      const priority = active || m.label.classList.contains("touched");
      if (this.state.fp && !priority && !this.unlettered.has(n.id)) { setVis(m, false); continue; }   // with a career shown, other labels appear on hover
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

/** A stable number in [0, 1) from a node id (so each hill's lettering offset is the same every time). */
function hash01(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

export function webglAvailable(): boolean {
  try { return !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl"); }
  catch { return false; }
}

/** Separable Gaussian blur of an n x n grid (sigma in cells), clamped at the edges. */
function blur(src: Float32Array, n: number, sigma: number): Float32Array<ArrayBuffer> {
  const r = Math.ceil(sigma * 2.5), w: number[] = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = w.reduce((a, b) => a + b, 0), tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0; for (let t = -r; t <= r; t++) v += src[j * n + Math.min(n - 1, Math.max(0, i + t))] * w[t + r];
    tmp[j * n + i] = v / sum;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0; for (let t = -r; t <= r; t++) v += tmp[Math.min(n - 1, Math.max(0, j + t)) * n + i] * w[t + r];
    out[j * n + i] = v / sum;
  }
  return out;
}
