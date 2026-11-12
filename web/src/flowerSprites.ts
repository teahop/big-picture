/** Small flower drawings for the footprint, one per super-bloom species, drawn once on a canvas and used as point
 *  sprites (they always face the camera, so spikes stay upright). */
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();
const S = 64;

function petals(g: CanvasRenderingContext2D, n: number, len: number, wid: number, fill: string | CanvasGradient, rot = 0, cx = S / 2, cy = S / 2): void {
  g.save(); g.translate(cx, cy); g.rotate(rot);
  for (let i = 0; i < n; i++) {
    g.rotate((Math.PI * 2) / n);
    g.beginPath(); g.ellipse(0, -len / 2, wid / 2, len / 2, 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  }
  g.restore();
}
function dot(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
}

const DRAW: Record<string, (g: CanvasRenderingContext2D) => void> = {
  // California poppy: four broad, cupped golden-orange petals and a pale centre
  poppy: (g) => {
    const grad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, 30);
    grad.addColorStop(0, "#ffb21e"); grad.addColorStop(0.55, "#f58a12"); grad.addColorStop(1, "#e2620b");
    petals(g, 4, 30, 30, grad, Math.PI / 4);
    dot(g, S / 2, S / 2, 4.5, "#f6d36b"); dot(g, S / 2, S / 2, 2, "#c98a1a");
  },
  // goldfields: a small bright-yellow daisy
  goldfields: (g) => {
    petals(g, 11, 24, 9, "#f7cf1d");
    dot(g, S / 2, S / 2, 7, "#e3a313"); dot(g, S / 2, S / 2, 3.5, "#b7790d");
  },
  // lupine: an upright spike of blue-violet pea flowers, paler toward the tip, on a green stem
  lupine: (g) => {
    g.strokeStyle = "#4d7a2a"; g.lineWidth = 3; g.beginPath(); g.moveTo(S / 2, S - 2); g.lineTo(S / 2, 10); g.stroke();
    for (let i = 0; i < 9; i++) {
      const y = S - 12 - i * 5.6, w = 11 - i * 0.8, c = i < 6 ? "#6d55c8" : "#9d8be0";
      for (const side of [-1, 1]) { g.beginPath(); g.ellipse(S / 2 + side * w * 0.55, y, w * 0.55, 3.6, side * 0.4, 0, Math.PI * 2); g.fillStyle = c; g.fill(); }
      dot(g, S / 2 + (i % 2 ? 2 : -2), y - 1, 1.6, "#f2eefc");
    }
  },
  // owl's clover: a rounded pink-magenta tuft with pale yellow-white tips
  "owls-clover": (g) => {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2, r = 9 + (i % 3) * 4;
      dot(g, S / 2 + Math.cos(a) * r * 0.8, S / 2 + 4 + Math.sin(a) * r, 6, i % 2 ? "#cf4f98" : "#e070ae");
    }
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; dot(g, S / 2 + Math.cos(a) * 7, S / 2 - 6 + Math.sin(a) * 6, 3, "#fbefc8"); }
  },
  // popcorn flower: a cluster of tiny white five-petal flowers with yellow eyes
  popcorn: (g) => {
    for (const [x, y, r] of [[22, 26, 9], [40, 22, 8], [32, 40, 9], [46, 40, 7]] as const) {
      petals(g, 5, r, r * 0.9, "#fbfaf4", 0.3, x, y); dot(g, x, y, r * 0.28, "#f2c41f");
    }
  },
};

export function flowerTexture(species: string): THREE.Texture {
  let t = cache.get(species);
  if (t) return t;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.shadowColor = "rgba(0,0,0,0.25)"; g.shadowBlur = 2;
  (DRAW[species] ?? DRAW.poppy)(g);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(species, t);
  return t;
}
