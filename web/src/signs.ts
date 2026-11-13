/** Hand-lettered cardboard signs for the axes: a white card with a thin dark edge and black capitals written a little
 *  unevenly, held up on a plain wooden stick. Drawn once on a canvas and shown as a sprite (it always faces the camera and
 *  stays upright), with the foot of the stick on the ground. */
import * as THREE from "three";

const FONT = '"DM Sans", system-ui, sans-serif';
const S = 4;                                   // canvas pixels per drawing unit (sharp when close)

function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

/** A sign with these lines of text. `height` is the sprite's height in world units; the sprite's foot (the bottom of the
 *  stick) is at its position. */
export function makeSign(lines: string[], height: number, small = false): THREE.Sprite {
  const size = small ? 22 : 26, rnd = seeded(lines.join("|")), track = size * 0.12, lineH = size * 1.25;
  const rows = lines.map((l) => l.toUpperCase());
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `600 ${size}px ${FONT}`;
  const rowW = (r: string) => [...r].reduce((s, ch) => s + probe.measureText(ch).width + track, -track);
  const pad = size * 0.6, cardW = Math.max(...rows.map(rowW)) + pad * 2, cardH = rows.length * lineH + pad * 1.3;
  const stick = small ? size * 1.6 : size * 2.6, w = cardW + 12, h = cardH + stick + 10;
  const c = document.createElement("canvas"); c.width = Math.ceil(w * S); c.height = Math.ceil(h * S);
  const g = c.getContext("2d")!; g.scale(S, S);
  const cx = w / 2, top = 5, tilt = (rnd() - 0.5) * 0.06;
  // the stick: a plain light-wood handle under the middle of the card
  const sw = small ? 5 : 7;
  const wood = g.createLinearGradient(cx - sw, 0, cx + sw, 0);
  wood.addColorStop(0, "#c99a52"); wood.addColorStop(0.5, "#e2b56a"); wood.addColorStop(1, "#b5843f");
  g.fillStyle = wood; g.strokeStyle = "#6d4a1f"; g.lineWidth = 1.2;
  g.beginPath(); g.rect(cx - sw / 2, top + cardH - 6, sw, stick + 4); g.fill(); g.stroke();
  // the card, slightly turned, with a soft shadow and a thin dark edge
  g.save(); g.translate(cx, top + cardH / 2); g.rotate(tilt);
  g.shadowColor = "rgba(0, 0, 0, 0.25)"; g.shadowBlur = 3; g.shadowOffsetY = 1.5;
  g.fillStyle = "#fbfaf4"; g.fillRect(-cardW / 2, -cardH / 2, cardW, cardH);
  g.shadowColor = "transparent";
  g.strokeStyle = "#2a2a2a"; g.lineWidth = 1.6; g.strokeRect(-cardW / 2, -cardH / 2, cardW, cardH);
  // hand-lettered capitals: each letter a little off the line and turned, black ink
  g.fillStyle = "#151515"; g.font = `600 ${size}px ${FONT}`; g.textBaseline = "middle";
  rows.forEach((r, li) => {
    let x = -rowW(r) / 2;
    const y = -cardH / 2 + pad * 0.65 + lineH * (li + 0.5);
    for (const ch of r) {
      const cw = g.measureText(ch).width;
      g.save(); g.translate(x + cw / 2, y + (rnd() - 0.5) * size * 0.1); g.rotate((rnd() - 0.5) * 0.14);
      g.scale(1 + (rnd() - 0.5) * 0.08, 1 + (rnd() - 0.5) * 0.1);
      g.fillText(ch, -cw / 2, 0); g.restore();
      x += cw + track;
    }
  });
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.1 }));
  sprite.center.set(0.5, 0);                     // the foot of the stick sits on the ground
  sprite.scale.set(height * (w / h), height, 1);
  sprite.name = "axis-sign";
  return sprite;
}
