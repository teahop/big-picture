/** A hill's name laid into the grass of its slope, like a hillside sign of white stones: a text texture on a small mesh
 *  patch that follows the ground. */
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

/** Seeded random numbers, so a name always gets the same irregularities. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

/** Letters like a hillside sign of laid white stones: capitals spaced wide apart, each letter slightly tilted and off the
 *  baseline, cut by thin breaks so it reads as separate slabs, with a few weathered specks. */
function letteringTexture(lines: string[], soft: boolean): { tex: THREE.CanvasTexture; aspect: number } {
  const scale = 4, size = 46, lineH = 60, track = size * 0.26, font = `700 ${size}px ${FONT}`;
  const rows = lines.map((l) => l.toUpperCase());
  const c = document.createElement("canvas"), g = c.getContext("2d")!;
  g.font = font;
  const rowWidth = (r: string) => [...r].reduce((sum, ch) => sum + g.measureText(ch).width + track, -track);
  const w = Math.max(...rows.map(rowWidth)) + 28, h = rows.length * lineH + 14;
  c.width = w * scale; c.height = h * scale;
  g.scale(scale, scale);
  const rnd = seeded(rows.join("|"));
  g.font = font; g.textBaseline = "top"; g.textAlign = "left";
  g.fillStyle = soft ? "rgba(250, 250, 244, 0.72)" : "#fbfbf6";
  g.shadowColor = "rgba(30, 50, 10, 0.25)"; g.shadowBlur = 1.5; g.shadowOffsetY = 0.8;
  const boxes: [number, number, number][] = [];               // x, y, width of each letter (for the breaks)
  rows.forEach((r, li) => {
    let x = (w - rowWidth(r)) / 2;
    const y0 = 8 + li * lineH;
    for (const ch of r) {
      const cw = g.measureText(ch).width;
      if (ch !== " ") {
        g.save();
        g.translate(x + cw / 2, y0 + size / 2 + (rnd() - 0.5) * 3);
        g.rotate((rnd() - 0.5) * 0.08);
        g.scale(1 + (rnd() - 0.5) * 0.06, 1 + (rnd() - 0.5) * 0.06);
        g.fillText(ch, -cw / 2, -size / 2);
        g.restore();
        boxes.push([x, y0, cw]);
      }
      x += cw + track;
    }
  });
  // breaks between slabs and weathering: cut away thin lines and specks
  g.shadowColor = "transparent"; g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000";
  for (const [x, y, cw] of boxes) {
    const cuts = 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < cuts; k++) {
      if (rnd() < 0.55) g.fillRect(x - 2, y + size * (0.25 + rnd() * 0.5), cw + 4, 1.6 + rnd());      // across the letter
      else g.fillRect(x + cw * (0.25 + rnd() * 0.5), y - 2, 1.6 + rnd(), size + 4);                   // down the letter
    }
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(x + rnd() * cw, y + rnd() * size, 0.6 + rnd() * 1.1, 0, Math.PI * 2); g.fill(); }
  }
  g.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { tex, aspect: w / h };
}

/** A patch of `cols` x `rows` points on the ground. `centre` and `width` are in layout units; the text runs along x and
 *  reads from the viewer's side (its top edge is the side further from the camera). `ground(x, y)` gives a world point. */
export function makeGrassLabel(label: string, centre: [number, number], width: number,
                               ground: (x: number, y: number) => THREE.Vector3, towardViewer: number, soft = false, angle = 0): THREE.Mesh {
  const { tex, aspect } = letteringTexture(wrapLabel(label, 24), soft);
  const height = width / aspect, cols = 40, rows = 16;
  const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), idx: number[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1), v = j / (rows - 1), k = j * cols + i;
    // v = 1 is the top of the text: further from the viewer
    // offsets across (du) and up the text (dv), turned by `angle` so neighbouring names do not line up
    const du = (u - 0.5) * width, dv = (0.5 - v) * height * towardViewer, ca = Math.cos(angle), sa = Math.sin(angle);
    const p = ground(centre[0] + du * ca - dv * sa, centre[1] + du * sa + dv * ca);
    pos.set([p.x, p.y + 0.07, p.z], k * 3); uv.set([u, v], k * 2);
    if (i < cols - 1 && j < rows - 1) idx.push(k, k + 1, k + cols, k + 1, k + cols + 1, k + cols);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "grass-label";
  mesh.renderOrder = 2;                                    // drawn over the flowers (written across the bloom)
  // the lettering's area in layout units, so flowers can leave it clear (mown)
  const y0 = centre[1] - height / 2, y1 = centre[1] + height / 2;
  mesh.userData.rect = [centre[0] - width / 2, centre[0] + width / 2, Math.min(y0, y1), Math.max(y0, y1)];
  return mesh;
}
