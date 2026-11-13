/** Hand-painted wooden signs for the axes: planks nailed to a post, each plank cut to an arrow where it points, with
 *  painted capitals that sit a little crooked. Drawn once on a canvas and shown as a sprite (it always faces the camera
 *  and stays upright), with its foot on the ground. */
import * as THREE from "three";

export type Arrow = "left" | "right" | "up" | "down" | "none";
export interface Board { text: string; arrow: Arrow }

const FONT = '"DM Sans", system-ui, sans-serif';
const S = 4;                                   // canvas pixels per drawing unit (sharp when close)

function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

/** A plank's outline: a rectangle, with a pointed end on the side it points to (up/down point from the top/bottom). */
function plankPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, arrow: Arrow): void {
  const tip = h * 0.55;
  g.beginPath();
  if (arrow === "right") { g.moveTo(x, y); g.lineTo(x + w - tip, y); g.lineTo(x + w, y + h / 2); g.lineTo(x + w - tip, y + h); g.lineTo(x, y + h); }
  else if (arrow === "left") { g.moveTo(x + tip, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x + tip, y + h); g.lineTo(x, y + h / 2); }
  else g.rect(x, y, w, h);
  g.closePath();
}

function drawBoard(g: CanvasRenderingContext2D, b: Board, cx: number, y: number, rnd: () => number, size: number): number {
  g.font = `800 ${size}px ${FONT}`;
  const arrowGlyph = b.arrow === "up" ? " ↑" : b.arrow === "down" ? " ↓" : "";
  const label = b.text.toUpperCase() + arrowGlyph;
  const tw = [...label].reduce((s, ch) => s + g.measureText(ch).width + size * 0.08, 0);
  const pad = size * 0.55, tip = (b.arrow === "left" || b.arrow === "right") ? size * 1.0 : 0;
  const w = tw + pad * 2 + tip, h = size * 1.55, x = cx - w / 2 + (b.arrow === "right" ? tip * 0.25 : b.arrow === "left" ? -tip * 0.25 : 0);
  const tilt = (rnd() - 0.5) * 0.09;
  g.save(); g.translate(cx, y + h / 2); g.rotate(tilt); g.translate(-cx, -(y + h / 2));
  // plank: warm weathered wood, darker edge, a few grain streaks
  plankPath(g, x, y, w, h, b.arrow);
  const wood = g.createLinearGradient(0, y, 0, y + h);
  wood.addColorStop(0, "#c8955a"); wood.addColorStop(0.5, "#b07b43"); wood.addColorStop(1, "#946233");
  g.fillStyle = wood; g.fill();
  g.save(); g.clip();
  g.strokeStyle = "rgba(90, 52, 20, 0.35)"; g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const gy = y + h * (0.12 + 0.15 * i + (rnd() - 0.5) * 0.06);
    g.beginPath(); g.moveTo(x, gy);
    g.bezierCurveTo(x + w * 0.3, gy + (rnd() - 0.5) * 4, x + w * 0.7, gy + (rnd() - 0.5) * 4, x + w, gy + (rnd() - 0.5) * 3);
    g.stroke();
  }
  g.restore();
  g.lineWidth = 2.2; g.strokeStyle = "#6b4220"; g.stroke();
  // two nails
  const nx = cx + (b.arrow === "right" ? -tip * 0.25 : b.arrow === "left" ? tip * 0.25 : 0);
  for (const dx of [-0.18, 0.18]) { g.beginPath(); g.arc(nx + dx * size, y + h * 0.5, size * 0.07, 0, Math.PI * 2); g.fillStyle = "#4a3523"; g.fill(); }
  // painted letters: dark brown, each a little off
  g.fillStyle = "#2e1a0c"; g.textBaseline = "middle";
  let lx = x + pad + (b.arrow === "left" ? tip : 0);
  for (const ch of label) {
    const cw = g.measureText(ch).width;
    g.save(); g.translate(lx + cw / 2, y + h / 2 + (rnd() - 0.5) * size * 0.08); g.rotate((rnd() - 0.5) * 0.12);
    g.fillText(ch, -cw / 2, 0); g.restore();
    lx += cw + size * 0.08;
  }
  g.restore();
  return h;
}

/** A sign: one or more boards stacked on a post. `height` is the sprite's height in world units; returns a sprite whose
 *  foot (the bottom of the post) is at its position. */
export function makeSign(boards: Board[], height: number, small = false): THREE.Sprite {
  const size = small ? 20 : 26, rnd = seeded(boards.map((b) => b.text).join("|"));
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `800 ${size}px ${FONT}`;
  const widest = Math.max(...boards.map((b) => [...b.text.toUpperCase() + "  "].reduce((s, ch) => s + probe.measureText(ch).width + size * 0.08, 0) + size * 2.2));
  const boardH = size * 1.55, gap = size * 0.35, post = small ? size * 2.2 : size * 3.4;
  const w = widest + 16, h = boards.length * (boardH + gap) + post + 8;
  const c = document.createElement("canvas"); c.width = Math.ceil(w * S); c.height = Math.ceil(h * S);
  const g = c.getContext("2d")!; g.scale(S, S);
  // post: a rough stake, slightly leaning, darker at the foot
  const px = w / 2, lean = (rnd() - 0.5) * 3, pw = small ? 5 : 8;
  const stake = g.createLinearGradient(px - pw, 0, px + pw, 0);
  stake.addColorStop(0, "#7a5230"); stake.addColorStop(0.5, "#9c6c3e"); stake.addColorStop(1, "#6a4426");
  g.fillStyle = stake;
  g.beginPath(); g.moveTo(px - pw / 2, 6); g.lineTo(px + pw / 2, 6); g.lineTo(px + pw / 2 + lean, h - 2); g.lineTo(px - pw / 2 + lean, h - 2); g.closePath(); g.fill();
  g.fillStyle = "rgba(40, 60, 20, 0.35)"; g.fillRect(px - pw, h - 5, pw * 2 + lean, 4);   // a tuft of shadow where it meets the grass
  let y = 4;
  for (const b of boards) { drawBoard(g, b, px, y, rnd, size); y += boardH + gap; }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1 }));
  sprite.center.set(0.5, 0);                     // the foot of the post sits on the ground
  sprite.scale.set(height * (w / h), height, 1);
  sprite.name = "axis-sign";
  return sprite;
}
