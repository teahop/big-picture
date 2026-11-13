/** Schools of fish for a career on the ocean view (v3 SPEC 5.2): small fish drawn once on a canvas, shown as one
 *  instanced mesh, each turned along its heading. Each school keeps to its own area's water: its centre drifts slowly
 *  round the area, and every fish steers toward its own spot near that centre with a little wobble, so the school
 *  bunches, turns and spreads like a real one. With reduced motion the fish rest in place. */
import * as THREE from "three";

export interface School { x: number; y: number; rx: number; ry: number; count: number; seed: number }   // world units

interface Fish { s: number; px: number; py: number; vx: number; vy: number; ox: number; oy: number; phase: number }

const MAX = 420;                       // fish in all, at most (cheap: one draw call)

function fishTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 64; c.height = 32;
  const g = c.getContext("2d")!;
  // a small golden fish facing right: body, tail, a darker back and a white eye
  const body = g.createLinearGradient(0, 4, 0, 28);
  body.addColorStop(0, "#d9811f"); body.addColorStop(0.45, "#ffc24a"); body.addColorStop(1, "#ffe9a8");
  // a thin dark outline first, so the fish read on pale sand as well as on dark water
  g.strokeStyle = "#5a2a06"; g.lineWidth = 3.2; g.lineJoin = "round";
  g.beginPath(); g.ellipse(36, 16, 20, 9, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(18, 16); g.lineTo(4, 5); g.lineTo(8, 16); g.lineTo(4, 27); g.closePath(); g.stroke();
  g.fillStyle = body;
  g.beginPath(); g.ellipse(36, 16, 20, 9, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(18, 16); g.lineTo(4, 5); g.lineTo(8, 16); g.lineTo(4, 27); g.closePath(); g.fill();
  g.fillStyle = "rgba(150, 70, 10, 0.55)";
  g.beginPath(); g.moveTo(28, 8); g.quadraticCurveTo(38, 2, 46, 8); g.closePath(); g.fill();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(48, 13, 2.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#1a1a1a"; g.beginPath(); g.arc(48.6, 13, 1.3, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FishSchools {
  readonly mesh: THREE.InstancedMesh;
  private fish: Fish[] = [];
  private schools: School[] = [];
  private t = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private z = new THREE.Vector3(0, 0, 1);
  private p = new THREE.Vector3(); private sc = new THREE.Vector3();

  constructor() {
    const mat = new THREE.MeshBasicMaterial({ map: fishTexture(), transparent: true, depthWrite: false, alphaTest: 0.2 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 1), mat, MAX);
    this.mesh.count = 0; this.mesh.position.z = 0.5; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
  }

  /** New schools (or none). Counts are scaled down together if they add up to more than the cap. */
  set(schools: School[]): void {
    const total = schools.reduce((a, s) => a + s.count, 0), k = total > MAX ? MAX / total : 1;
    this.schools = schools; this.fish = [];
    schools.forEach((s, si) => {
      let seed = s.seed;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0, n = Math.max(3, Math.round(s.count * k)); i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
        const ox = Math.cos(a) * r * s.rx * 0.85, oy = Math.sin(a) * r * s.ry * 0.85;   // loose: fish keep some water between them
        this.fish.push({ s: si, px: s.x + ox, py: s.y + oy, vx: 0, vy: 0, ox, oy, phase: rnd() * Math.PI * 2 });
      }
    });
    this.mesh.count = this.fish.length;
  }

  /** Move the fish on by `dt` seconds (or not, with reduced motion) and draw them `size` world units long. */
  step(dt: number, size: number, still: boolean): void {
    if (!this.fish.length) return;
    this.t += still ? 0 : Math.min(dt, 0.05);
    const t = this.t;
    this.fish.forEach((f, i) => {
      const s = this.schools[f.s];
      // the school's centre drifts round its area; each fish heads for its own spot near it, with a wobble
      const ang = t * 0.11 + s.seed * 0.001, cx = s.x + Math.cos(ang) * s.rx * 0.35, cy = s.y + Math.sin(ang * 1.3) * s.ry * 0.35;
      const tx = cx + f.ox + Math.cos(t * 1.7 + f.phase) * s.rx * 0.05, ty = cy + f.oy + Math.sin(t * 1.3 + f.phase) * s.ry * 0.05;
      if (!still) {
        const ax = (tx - f.px) * 1.6 - f.vx * 1.1, ay = (ty - f.py) * 1.6 - f.vy * 1.1;
        f.vx += ax * dt; f.vy += ay * dt;
        f.px += f.vx * dt; f.py += f.vy * dt;
      }
      const heading = Math.hypot(f.vx, f.vy) > 1e-5 ? Math.atan2(f.vy, f.vx) : f.phase;
      this.q.setFromAxisAngle(this.z, heading);
      this.p.set(f.px, f.py, 0); this.sc.set(size, size, 1);
      this.m.compose(this.p, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
