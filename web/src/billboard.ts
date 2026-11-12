/** A small wooden sign on two posts, standing on a hill: the 3D alternative to a floating label (prototype). */
import * as THREE from "three";

const FONT = '"DM Sans", system-ui, sans-serif';

/** Split a label into at most two lines that fit `max` characters, breaking at spaces. */
export function wrapLabel(text: string, max = 22): string[] {
  if (text.length <= max) return [text];
  const words = text.split(" "), lines = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + " " + w).trim().length > max && cur && lines.length < 2) lines.push(w);
    else lines[lines.length - 1] = (cur + " " + w).trim();
  }
  if (lines[1] && lines[1].length > max + 4) lines[1] = lines[1].slice(0, max + 2) + "…";
  return lines;
}

function boardTexture(lines: string[], share: string): { tex: THREE.CanvasTexture; aspect: number } {
  const scale = 4, pad = 18, lineH = 34, shareH = 30;
  const c = document.createElement("canvas"), g = c.getContext("2d")!;
  g.font = `600 26px ${FONT}`;
  const w = Math.max(...lines.map((l) => g.measureText(l).width), 120) + pad * 2;
  const h = pad * 2 + lines.length * lineH + shareH;
  c.width = w * scale; c.height = h * scale;
  g.scale(scale, scale);
  // weathered wood board with a darker frame
  const wood = g.createLinearGradient(0, 0, 0, h);
  wood.addColorStop(0, "#f3e3c3"); wood.addColorStop(1, "#e2c99a");
  g.fillStyle = "#7a5230"; g.beginPath(); g.roundRect(0, 0, w, h, 10); g.fill();
  g.fillStyle = wood; g.beginPath(); g.roundRect(5, 5, w - 10, h - 10, 7); g.fill();
  g.strokeStyle = "rgba(122,82,48,0.18)"; g.lineWidth = 1;
  for (let y = 14; y < h - 8; y += 9) { g.beginPath(); g.moveTo(10, y); g.lineTo(w - 10, y + 1.5); g.stroke(); }   // grain
  g.fillStyle = "#3b2a18"; g.textAlign = "center"; g.textBaseline = "top";
  g.font = `600 26px ${FONT}`;
  lines.forEach((l, i) => g.fillText(l, w / 2, pad + i * lineH));
  g.fillStyle = "#b5560c"; g.font = `700 24px ${FONT}`;
  g.fillText(share, w / 2, pad + lines.length * lineH + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, aspect: w / h };
}

/** A sign group whose origin is at the foot of its posts. `height` is the board's height in world units. */
export function makeBillboard(label: string, share: string, height = 0.55): THREE.Group {
  const { tex, aspect } = boardTexture(wrapLabel(label), share);
  const group = new THREE.Group();
  const bw = height * aspect, post = height * 0.8;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, height), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }));
  board.position.y = post + height / 2;
  group.add(board);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.9 });
  for (const x of [-bw * 0.32, bw * 0.32]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(height * 0.08, post + height * 0.6, height * 0.08), wood);
    p.position.set(x, (post + height * 0.6) / 2, -0.01);
    group.add(p);
  }
  group.name = "billboard";
  return group;
}
