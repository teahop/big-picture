import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Bundle, type NodeRec, heightAt } from "./data";
import { BANDS, bandColour, readTheme } from "./theme";
import type { State } from "./state";

const SPAN = 12;       // world units across the layout
const HEIGHT = 5.0;    // world height of the tallest point

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private controls: OrbitControls;
  private mesh!: THREE.Mesh;
  private rings = new Map<string, THREE.Mesh>();
  private labels = new Map<string, HTMLButtonElement>();
  private anchors = new Map<string, THREE.Vector3>();
  private ray = new THREE.Raycaster();
  private scale: number; private cx: number; private cy: number;
  private flyTo: THREE.Vector3 | null = null;
  private running = false;
  private order: string[];

  constructor(private host: HTMLElement, private labelLayer: HTMLElement, private b: Bundle, private state: State) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const el = this.renderer.domElement;
    el.tabIndex = 0;
    el.setAttribute("aria-label", "3D terrain of industry sectors. Arrow keys pan, mouse drag orbits, scroll zooms. Use the sector list for keyboard selection.");
    host.appendChild(el);

    this.order = [...b.nodes].sort((a, c) => c.size.employment - a.size.employment).map((n) => n.id);
    const g = b.grid;
    this.scale = SPAN / (g.x[1] - g.x[0]);
    this.cx = (g.x[0] + g.x[1]) / 2; this.cy = (g.y[0] + g.y[1]) / 2;

    this.camera.position.set(0, 9, 14);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.target.set(0, 1.2, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 4; this.controls.maxDistance = 30;
    this.controls.listenToKeyEvents(el);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-6, 10, 8); this.scene.add(sun);

    this.buildMesh();
    this.buildMarkers();
    this.applyTheme();
    this.bindPointer(el);
    state.subscribe(() => this.refreshHighlight());
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  private world(x: number, y: number, h = 0): THREE.Vector3 {
    return new THREE.Vector3((x - this.cx) * this.scale, h, (y - this.cy) * this.scale);
  }
  private toLayout(p: THREE.Vector3): [number, number] { return [p.x / this.scale + this.cx, p.z / this.scale + this.cy]; }
  private h(v: number): number { return (v / this.b.maxHeight) * HEIGHT; }

  private buildMesh(): void {
    const g = this.b.grid, n = g.n;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = g.x[0] + ((g.x[1] - g.x[0]) * i) / (n - 1), y = g.y[0] + ((g.y[1] - g.y[0]) * j) / (n - 1);
      const p = this.world(x, y, this.h(g.values[j * n + i]));
      pos.set([p.x, p.y, p.z], (j * n + i) * 3);
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.scene.add(this.mesh);
  }

  private buildMarkers(): void {
    const maxSize = Math.max(...this.b.nodes.map((n) => n.size.employment));
    for (const node of this.b.nodes) {
      const [x, y] = node.xy;
      const top = this.h(heightAt(this.b.grid, x, y));
      const r = 0.16 + 0.3 * Math.sqrt(node.size.employment / maxSize);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(this.world(x, y, top + 0.04));
      this.scene.add(ring); this.rings.set(node.id, ring);
      this.anchors.set(node.id, this.world(x, y, top + 0.55));

      const btn = document.createElement("button");
      btn.className = "node-label"; btn.type = "button"; btn.tabIndex = -1; btn.textContent = node.label;
      btn.addEventListener("pointerenter", () => this.state.setHover(node));
      btn.addEventListener("pointerleave", () => this.state.setHover(null));
      btn.addEventListener("click", () => this.state.setSelected(node));
      this.labelLayer.appendChild(btn); this.labels.set(node.id, btn);
    }
  }

  applyTheme(): void {
    const t = readTheme();
    this.scene.background = new THREE.Color(t.bg);
    const col = this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const vals = this.b.grid.values;
    for (let k = 0; k < vals.length; k++) {
      const [r, g, b] = bandColour(t, vals[k] / this.b.maxHeight);
      col.setXYZ(k, r / 255, g / 255, b / 255);
    }
    col.needsUpdate = true;
    this.refreshHighlight();
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

  private nodeNear(ev: PointerEvent): NodeRec | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObject(this.mesh)[0];
    if (!hit) return null;
    const [x, y] = this.toLayout(hit.point);
    let best: NodeRec | null = null, bd = 0.22;
    for (const n of this.b.nodes) { const d = Math.hypot(n.xy[0] - x, n.xy[1] - y); if (d < bd) { bd = d; best = n; } }
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
    const a = this.anchors.get(node.id)!;
    this.flyTo = new THREE.Vector3(a.x, a.y - 0.6, a.z);
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private frame = (): void => {
    if (!this.running) return;
    if (this.flyTo) {
      const delta = this.flyTo.clone().sub(this.controls.target);
      this.controls.target.add(delta.multiplyScalar(0.12));
      if (delta.length() < 0.01) this.flyTo = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight, v = new THREE.Vector3();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const id of this.order) {          // largest sectors claim label space first
      const btn = this.labels.get(id)!;
      v.copy(this.anchors.get(id)!).project(this.camera);
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      const bw = btn.offsetWidth || 120, bh = btn.offsetHeight || 20;
      const r = { x0: x - bw / 2, x1: x + bw / 2, y0: y - bh, y1: y };
      const active = btn.classList.contains("active");
      const clash = placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
      const show = v.z < 1 && (active || !clash);
      btn.style.visibility = show ? "visible" : "hidden";
      if (show) placed.push(r);
      btn.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
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
