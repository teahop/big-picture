/** A hill's name laid into the grass of its slope, like a hillside sign of white stones: a text texture on a curved mesh
 *  strip that follows the ground around the front of the hill. */
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

/** A name on one line, or, when it is long and has a space, on two lines split as evenly as possible (so it can be
 *  lettered larger on a hill). */
export function balancedLines(text: string, oneLineMax = 12): string[] {
  if (text.length <= oneLineMax || !text.includes(" ")) return [text];
  let best = [text], worst = Infinity;
  for (let i = text.indexOf(" "); i >= 0; i = text.indexOf(" ", i + 1)) {
    const a = text.slice(0, i).trim(), c = text.slice(i + 1).trim(), w = Math.max(a.length, c.length);
    if (a && c && w < worst) { worst = w; best = [a, c]; }
  }
  return best;
}

/** Seeded random numbers, so a name always gets the same irregularities. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
}

/** Letters like a hillside sign of laid white stones: capitals spaced wide apart, each letter slightly tilted and off the
 *  baseline, cut by thin breaks so it reads as separate slabs, with a few weathered specks. */
export function letteringTexture(lines: string[], soft: boolean): { tex: THREE.CanvasTexture; aspect: number } {
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

export interface Lettering { tex: THREE.CanvasTexture; aspect: number }

/** A hill's name curved around the front of the hill, partway up its flank, like a sign laid along a contour: the text's
 *  baseline follows an ellipse around `centre` (radii `ra` along the ridge, `rb` across it, ridge angle `ang`), centred on
 *  the side facing `toward` (a unit vector in layout units, from the hill toward the viewer), with the top of the letters
 *  toward the summit. `arc` is the text's length along the curve (layout units); `shift` turns it around the hill
 *  (radians). The text never runs more than about halfway round; longer names get smaller. */
export function makeWrapLabel(l: Lettering, centre: [number, number], ra: number, rb: number, ang: number, toward: [number, number],
                              arc: number, ground: (x: number, y: number) => THREE.Vector3, shift = 0): THREE.Mesh {
  const N = 720, ca = Math.cos(ang), sa = Math.sin(ang);
  const at = (phi: number): [number, number] => {
    const u = ra * Math.cos(phi), v = rb * Math.sin(phi);
    return [u * ca - v * sa, u * sa + v * ca];                       // offset from the centre
  };
  // the point of the ellipse that faces the viewer, then turned by `shift`
  let phi0 = 0, best = -Infinity;
  for (let i = 0; i < N; i++) { const ph = (i / N) * Math.PI * 2, [dx, dy] = at(ph), d = (dx * toward[0] + dy * toward[1]) / Math.hypot(dx, dy); if (d > best) { best = d; phi0 = ph; } }
  phi0 += shift;
  // arc length along the ellipse, as a table from phi0 - pi to phi0 + pi
  const phis: number[] = [], lens: number[] = [0];
  for (let i = 0; i <= N; i++) phis.push(phi0 - Math.PI + (i / N) * Math.PI * 2);
  for (let i = 1; i <= N; i++) { const [x0, y0] = at(phis[i - 1]), [x1, y1] = at(phis[i]); lens.push(lens[i - 1] + Math.hypot(x1 - x0, y1 - y0)); }
  const half = lens[N] / 2, maxArc = lens[N] * 0.48;
  if (arc > maxArc) arc = maxArc;                                    // never more than about halfway round
  const phiAt = (s: number) => {                                    // phi at arc length s from phi0 (negative = before)
    const t = Math.min(lens[N], Math.max(0, half + s));
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lens[mid] < t) lo = mid; else hi = mid; }
    const f = (t - lens[lo]) / ((lens[hi] - lens[lo]) || 1);
    return phis[lo] + (phis[hi] - phis[lo]) * f;
  };
  // read left to right as the viewer sees it: screen right is toward x (rotated by the view direction)
  const right: [number, number] = [toward[1], -toward[0]];
  const [ax, ay] = at(phi0 - 0.01), [bx, by] = at(phi0 + 0.01);
  const dir = (bx - ax) * right[0] + (by - ay) * right[1] >= 0 ? 1 : -1;
  const height = arc / l.aspect, rMean = Math.sqrt(ra * rb);
  const cols = 64, rows = 10;
  const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), idx: number[] = [];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1), v = j / (rows - 1), k = j * cols + i;
    const [ox, oy] = at(phiAt(dir * (u - 0.5) * arc));
    const f = 1 + ((0.5 - v) * height) / rMean;                     // v = 1 (top of the letters) lies toward the summit
    const x = centre[0] + ox * f, y = centre[1] + oy * f;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    const p = ground(x, y);
    pos.set([p.x, p.y + 0.07, p.z], k * 3); uv.set([u, v], k * 2);
    if (i < cols - 1 && j < rows - 1) idx.push(k, k + 1, k + cols, k + 1, k + cols + 1, k + cols);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: l.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "grass-label"; mesh.renderOrder = 2;
  mesh.userData.rect = [x0, x1, y0, y1];
  // which ground the letters cover (with a small margin), so the flowers can leave it mown
  const pa = phiAt(-arc / 2), pb = phiAt(arc / 2), lo = Math.min(pa, pb), hi = Math.max(pa, pb), m = 0.25 * height;
  const band = (height / 2 + m) / rMean, edge = m / rMean;
  mesh.userData.covers = (x: number, y: number): boolean => {
    const dx = x - centre[0], dy = y - centre[1], u = (dx * ca + dy * sa) / ra, v = (-dx * sa + dy * ca) / rb;
    if (Math.abs(Math.hypot(u, v) - 1) > band) return false;
    let ph = Math.atan2(v, u);
    while (ph < phi0 - Math.PI) ph += Math.PI * 2;
    while (ph > phi0 + Math.PI) ph -= Math.PI * 2;
    return ph >= lo - edge && ph <= hi + edge;
  };
  return mesh;
}
