import { type Bundle, type Link, type Measure, type NodeRec, type SizeSetting, axisScale, fmtGrowth, fmtJobs, fmtMeasure, links } from "./data";
import type { State } from "./state";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const section = (title: string, items: string) => items ? "<h3>" + title + "</h3><ul>" + items + "</ul>" : "";

function simpleList(items: Link[]): string {
  return items.map((l) => "<li>" + esc(l.node.label) + " <small>similarity " + l.weight.toFixed(2) + "</small></li>").join("");
}

const LEVEL_NAMES = ["Level 0 (sector)", "Level 1 (detailed industry)"];
function lineage(b: Bundle, n: NodeRec): string {
  const parent = n.parent ? b.byId.get(n.parent) : undefined;
  const kids = b.childCount.get(n.id) ?? 0;
  const est = n.provenance === "estimated" ? " <strong>Estimated</strong>" + (n.size_proxy ? " (size proxy: " + esc(n.size_proxy) + ")" : "") + "." : "";
  return "<p class='sub'>" + LEVEL_NAMES[n.level] + (parent ? " &middot; inside " + esc(parent.label) : "")
    + (kids ? " &middot; " + kids + " finer nodes (zoom in)" : "") + "." + est + "</p>";
}

/** " (beyond the map's scale ...)" when a node's growth or size lies outside the axis scale of its level. */
function beyondScale(b: Bundle, n: NodeRec, setting: SizeSetting, measure: Measure): { growth: string; size: string } {
  const sc = axisScale(b, setting, n.level), v = n.size[measure] ?? 0, out = { growth: "", size: "" };
  if (!sc) return out;
  if (n.growth !== null && n.growth > sc.g_hi) out.growth = " <small>(beyond the map's scale: drawn at the right edge)</small>";
  if (n.growth !== null && n.growth < sc.g_lo) out.growth = " <small>(beyond the map's scale: drawn at the left edge)</small>";
  if (v < sc.s_lo) out.size = " <small>(smaller than the map's scale: drawn at the front edge)</small>";
  return out;
}

function details(b: Bundle, n: NodeRec, setting: SizeSetting, measure: Measure): string {
  const far = beyondScale(b, n, setting, measure);
  const occ = (n.top_occupations ?? []).map((o) => "<li>" + esc(o.title) + " <small>" + o.share_pct.toFixed(1) + "%</small></li>").join("");
  const members = n.members && n.members.length ? "<h3>Example organisations</h3><p>" + n.members.map(esc).join(", ") + "</p>" : "";
  return "<h2>" + (n.provenance === "estimated" ? "≈ " : "") + esc(n.label) + "</h2>" + lineage(b, n)
    + "<p class='sub'>" + esc(n.title) + (n.naics_code ? " &middot; NAICS " + esc(n.naics_code) : n.zone ? " &middot; zone: " + esc(n.zone) : "") + " &middot; " + n.provenance + "</p>"
    + "<dl><dt>Employment 2025</dt><dd>" + fmtJobs(n.size.employment) + " jobs</dd>"
    + "<dt>Projected 2035</dt><dd>" + fmtJobs(n.size.employment_2035) + " jobs</dd>"
    + (n.size.value_added !== undefined ? "<dt>Value added 2025</dt><dd>" + fmtMeasure("value_added", n.size.value_added) + " <small>(" + esc(n.value_added_basis ?? "") + ")</small></dd><dt>Per job</dt><dd>" + fmtMeasure("va_per_job", n.size.va_per_job) + "</dd>" : "")
    + "<dt>Projected growth</dt><dd>" + fmtGrowth(n.growth) + " over ten years" + far.growth + "</dd></dl>" + (far.size ? "<p class='sub'>" + far.size + "</p>" : "")
    + members
    + section("Most similar industries", simpleList(links(b, n.id, 5)))
    + section("Largest occupations", occ);
}

export function buildPanel(b: Bundle, state: State, onPick: (n: NodeRec) => void, extra: (n: NodeRec) => string = () => ""): void {
  const panel = el("details"), list = el<HTMLUListElement>("list-ind");
  const items = new Map<string, HTMLButtonElement>();
  // The list shows the industries drawn at the current level, largest first.
  const pool = () => { const m = state.measure; return b.nodes.filter((n) => state.visibleIds.has(n.id)).sort((a, c) => (c.size[m] ?? 0) - (a.size[m] ?? 0)); };

  const build = () => {
    items.clear(); list.innerHTML = "";
    for (const n of pool()) {
      const li = document.createElement("li"), btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = "<span>" + (n.provenance === "estimated" ? "≈ " : "") + esc(n.label) + "</span><small>" + fmtMeasure(state.measure, n.size[state.measure]) + "</small>";
      btn.addEventListener("click", () => onPick(n));
      // Hovering a line highlights its hill but leaves the details box alone: redrawing the box above the list moved
      // the lines under the pointer, which hovered the next line, and so on (the flicker).
      const on = () => { fromList = true; state.setHover(n); }, off = () => { fromList = false; state.setHover(null); };
      btn.addEventListener("pointerenter", on); btn.addEventListener("pointerleave", off);
      btn.addEventListener("focus", on); btn.addEventListener("blur", off);
      li.appendChild(btn); list.appendChild(li); items.set(n.id, btn);
    }
  };
  let lastSize = state.size, lastLevel = -1, fromList = false, lastShown = "";
  const render = () => {
    if (state.size !== lastSize || state.level !== lastLevel) { lastSize = state.size; lastLevel = state.level; build(); }
    el("head-ind").textContent = (state.level === 0 ? "Industry sectors" : "Industries") + " by " + (state.size === "activity" ? "employment" : "value added");
    for (const [id, btn] of items) btn.classList.toggle("active", id === (state.active?.id ?? ""));
    const n = fromList ? state.selected : state.active;
    const key = [n?.id ?? "", state.fpVersion, state.fpSample, state.level, state.size].join("|");
    if (key === lastShown) return;                         // nothing in the box would change: leave the DOM alone
    lastShown = key;
    if (!n) { panel.innerHTML = "<p class='hint'>Hover or select an industry. Left to right is projected growth to 2035 (faster growth to the right); front to back is size, with the largest at the back, and height is size too. Industries lean a little toward their sector. Research and academia show up as industries such as colleges and universities and scientific R&amp;D services. Use Sectors and Industries to change the level, or see your place by uploading your CV.</p>"; return; }
    panel.innerHTML = extra(n) + details(b, n, state.size, state.measure);
  };
  state.subscribe(render); render();

  const src = b.meta.sources[0];
  el("source").textContent = "Industries: " + src.name + ", " + src.release + ". Value added: BEA GDP by Industry 2025. Retrieved " + src.retrieved + ".";
}
