/** "Download image" (SPEC 8): one JPG drawn in the page from the current view, the name and subtitle, the touched
 *  Level 0 areas with shares, a legend, the site address and an optional caption. Nothing is uploaded and no request
 *  is made: the image is composed on a canvas and handed to the browser as a blob. The caption is not kept. */
import type { Bundle } from "./data";
import type { State } from "./state";

export const W = 2400, H = 1600;
export interface Snap { image: HTMLCanvasElement; labels: { text: string; x: number; y: number; touched: boolean }[] }

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const FONT = "'DM Sans', system-ui, sans-serif";

/** The heading's lettering (outlined SVG) as an image, in the given colour. */
async function titleImage(colour: string): Promise<HTMLImageElement | null> {
  const svg = document.querySelector<SVGSVGElement>("#title .title-art");
  if (!svg) return null;
  const src = svg.outerHTML.replace(/currentColor/g, colour);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
  await img.decode();
  return img;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) {
    const next = line ? line + " " + w : w;
    if (ctx.measureText(next).width > max && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

/** Compose the image. Pure drawing: everything it needs is passed in or read from the page. */
export async function compose(b: Bundle, state: State, snap: Snap, opts: { caption: string; address: string; subtitle: string; name: string; dark: boolean }): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  // sky, as on the page
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, css("--sky-top")); sky.addColorStop(0.45, css("--sky-mid")); sky.addColorStop(1, css("--horizon"));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  if (opts.dark) {                                   // the moon
    const mx = W * 0.6, my = 190, r = 70;
    const glow = ctx.createRadialGradient(mx, my, r * 0.8, mx, my, r * 2.2);
    glow.addColorStop(0, "rgb(255 248 220 / .28)"); glow.addColorStop(1, "rgb(255 248 220 / 0)");
    ctx.fillStyle = glow; ctx.fillRect(mx - r * 3, my - r * 3, r * 6, r * 6);
    const disc = ctx.createRadialGradient(mx - r * 0.25, my - r * 0.28, 0, mx, my, r);
    disc.addColorStop(0, "#fffdf4"); disc.addColorStop(0.55, "#f3edd9"); disc.addColorStop(1, "#d9d1b8");
    ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.drawImage(snap.image, 0, 0);

  // floating labels from the view
  ctx.font = `600 30px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  const boxes: number[][] = [];
  for (const l of snap.labels.sort((a, z) => Number(z.touched) - Number(a.touched))) {
    const tw = ctx.measureText(l.text).width + 24, x0 = l.x - tw / 2, y0 = l.y - 48;
    if (x0 < 10 || x0 + tw > W - 10 || y0 < 10 || boxes.some(([a, bb, cc, d]) => x0 < cc && x0 + tw > a && y0 < d && y0 + 44 > bb)) continue;
    boxes.push([x0, y0, x0 + tw, y0 + 44]);
    ctx.fillStyle = l.touched ? "rgb(255 255 255 / .92)" : "rgb(255 255 255 / .75)";
    roundRect(ctx, x0, y0, tw, 40, 8); ctx.fill();
    ctx.fillStyle = "#1d2a14"; ctx.fillText(l.text, l.x, y0 + 36);
  }

  // header: name (title lettering), subtitle, caption
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgb(0 0 0 / .3)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  const title = await titleImage("#ffffff");
  let y = 70;
  if (title) { const h = 92, w = h * (title.naturalWidth / title.naturalHeight || 12); ctx.drawImage(title, 64, y, w, h); y += h + 44; }
  else { ctx.fillStyle = "#fff"; ctx.font = `700 84px ${FONT}`; ctx.fillText(opts.name, 64, y + 76); y += 120; }
  ctx.fillStyle = "#fff"; ctx.font = `400 38px ${FONT}`; ctx.fillText(opts.subtitle, 66, y); y += 64;
  if (opts.caption) {
    ctx.font = `600 46px ${FONT}`;
    for (const line of wrap(ctx, opts.caption, 1100).slice(0, 3)) { ctx.fillText(line, 66, y); y += 58; }
  }
  ctx.shadowColor = "transparent";

  // touched sectors with shares
  const touched = state.fp ? [...state.fp.touched[0]] : [];
  const panelW = 640, px = W - panelW - 56;
  let py = 64;
  if (touched.length) {
    const rows = touched.slice(0, 10), ph = 120 + rows.length * 74;
    ctx.fillStyle = opts.dark ? "rgb(18 33 15 / .86)" : "rgb(31 58 22 / .78)";
    roundRect(ctx, px, py, panelW, ph, 22); ctx.fill();
    ctx.fillStyle = "#d4e3b6"; ctx.font = `700 26px ${FONT}`;
    ctx.fillText((state.fpSample ? "SAMPLE CAREER" : "CAREER FOOTPRINT") + " BY SECTOR", px + 36, py + 62);
    let ry = py + 124;
    for (const [id, share] of rows) {
      const label = b.byId.get(id)?.label ?? id;
      ctx.fillStyle = "#f7f4e6"; ctx.font = `500 32px ${FONT}`; ctx.textAlign = "left";
      ctx.fillText(label.length > 30 ? label.slice(0, 29) + "…" : label, px + 36, ry);
      ctx.textAlign = "right"; ctx.fillText((share < 0.01 ? "<1" : Math.round(share * 100)) + "%", px + panelW - 36, ry);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgb(255 255 255 / .16)"; roundRect(ctx, px + 36, ry + 14, panelW - 72, 10, 5); ctx.fill();
      ctx.fillStyle = "#f5a524"; roundRect(ctx, px + 36, ry + 14, Math.max(10, (panelW - 72) * share / rows[0][1]), 10, 5); ctx.fill();
      ry += 74;
    }
    py += ph + 24;
  }

  // legend and address along the bottom
  const by = H - 56;
  ctx.fillStyle = "rgb(0 0 0 / .42)"; roundRect(ctx, 40, by - 64, W - 80, 88, 18); ctx.fill();
  ctx.font = `500 30px ${FONT}`; ctx.fillStyle = "#fff"; ctx.textAlign = "left";
  const size = state.size === "activity" ? "jobs" : "value added";
  ctx.font = `600 30px ${FONT}`;
  const room = W - 72 - ctx.measureText(opts.address).width - 60 - (touched.length ? 116 : 72);
  ctx.font = `500 30px ${FONT}`;
  const items = [`Each hill is a US industry; its height is its ${size} (2025).`,
    touched.length ? "Wildflowers cover each hill by its share of the career." : "", "Nearby hills employ similar work."].filter(Boolean);
  while (items.length > 1 && ctx.measureText(items.join("  ·  ")).width > room) items.pop();   // drop the least important first
  const legend = items.join("  ·  ");
  if (touched.length) {                              // a small poppy as the flower key
    ctx.fillStyle = "#f28c1b";
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(84 + Math.cos(a) * 9, by - 20 + Math.sin(a) * 9, 9, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#ffd166"; ctx.beginPath(); ctx.arc(84, by - 20, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
  }
  ctx.fillText(legend, touched.length ? 116 : 72, by - 8);
  ctx.textAlign = "right"; ctx.font = `600 30px ${FONT}`; ctx.fillText(opts.address, W - 72, by - 8);
  return c;
}

/** Wire the Download button and its small dialog (optional caption, then save). */
export function buildDownload(b: Bundle, state: State, snapshot: (w: number, h: number) => Snap | null, site: { name: string; subtitle: string; address: string }): void {
  // Load the type weights the image uses now, so making the image itself needs no request at all.
  void Promise.all(["400", "500", "600", "700"].map((w) => document.fonts.load(`${w} 30px 'DM Sans'`))).catch(() => {});
  const dlg = document.getElementById("dl") as HTMLDialogElement;
  const input = dlg.querySelector<HTMLInputElement>("input")!, go = dlg.querySelector<HTMLButtonElement>("[data-act=save]")!;
  const status = dlg.querySelector<HTMLElement>(".dl-status")!;
  document.getElementById("dl-open")!.addEventListener("click", () => { input.value = ""; status.textContent = ""; dlg.showModal(); input.focus(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { input.value = ""; });
  go.addEventListener("click", async () => {
    const snap = snapshot(W, H);
    if (!snap) { status.textContent = "This browser cannot draw the map (WebGL is off)."; return; }
    status.textContent = "Drawing…"; go.disabled = true;
    try {
      const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      const canvas = await compose(b, state, snap, { caption: input.value.trim().slice(0, 120), dark, ...site });
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      if (!blob) throw new Error("no image");
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = site.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".jpg";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      dlg.close();
    } catch { status.textContent = "Could not make the image in this browser."; }
    finally { go.disabled = false; }
  });
}
