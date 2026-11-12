/** Lettering laid into the grass of a hillside, like mown letters (prototype): a text texture on a small mesh patch that
 *  follows the ground. */
import * as THREE from "three";
import { wrapLabel } from "./billboard";

const FONT = '"DM Sans", system-ui, sans-serif';

function letteringTexture(lines: string[], share: string): { tex: THREE.CanvasTexture; aspect: number } {
  const scale = 4, size = 46, lineH = 52;
  const c = document.createElement("canvas"), g = c.getContext("2d")!;
  g.font = `800 ${size}px ${FONT}`;
  const w = Math.max(...[...lines, share].map((l) => g.measureText(l).width)) + 24;
  const h = (lines.length + 1) * lineH + 12;
  c.width = w * scale; c.height = h * scale;
  g.scale(scale, scale);
  g.textAlign = "center"; g.textBaseline = "top";
  const draw = (text: string, y: number, font: string, fill: string) => {
    g.font = font;
    g.lineJoin = "round"; g.lineWidth = 6; g.strokeStyle = "rgba(48, 72, 18, 0.35)"; g.strokeText(text, w / 2, y);   // soft cut edge
    g.fillStyle = fill; g.fillText(text, w / 2, y);
  };
  lines.forEach((l, i) => draw(l, 6 + i * lineH, `800 ${size}px ${FONT}`, "#f3f6d2"));         // pale, mown-grass letters
  draw(share, 6 + lines.length * lineH, `800 ${size - 6}px ${FONT}`, "#ffd166");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { tex, aspect: w / h };
}

/** A patch of `cols` x `rows` points on the ground. `centre` and `width` are in layout units; the text runs along x and
 *  reads from the viewer's side (its top edge is the side further from the camera). `ground(x, y)` gives a world point. */
export function makeGrassLabel(label: string, share: string, centre: [number, number], width: number,
                               ground: (x: number, y: number) => THREE.Vector3, towardViewer: number): THREE.Mesh {
  const { tex, aspect } = letteringTexture(wrapLabel(label, 18), share);
  const height = width / aspect, cols = 40, rows = 16;
  const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), idx: number[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1), v = j / (rows - 1), k = j * cols + i;
    // v = 1 is the top of the text: further from the viewer
    const p = ground(centre[0] + (u - 0.5) * width, centre[1] + (0.5 - v) * height * towardViewer);
    pos.set([p.x, p.y + 0.025, p.z], k * 3); uv.set([u, v], k * 2);
    if (i < cols - 1 && j < rows - 1) idx.push(k, k + 1, k + cols, k + 1, k + cols + 1, k + cols);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "grass-label";
  // the lettering's area in layout units, so flowers can leave it clear (mown)
  const y0 = centre[1] - height / 2, y1 = centre[1] + height / 2;
  mesh.userData.rect = [centre[0] - width / 2, centre[0] + width / 2, Math.min(y0, y1), Math.max(y0, y1)];
  return mesh;
}
