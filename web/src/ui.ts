import { type Bundle, type Link, type NodeRec, fmtGrowth, fmtJobs, fmtMeasure, links } from "./data";
import type { State } from "./state";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const section = (title: string, items: string) => items ? "<h3>" + title + "</h3><ul>" + items + "</ul>" : "";

function simpleList(items: Link[]): string {
  return items.map((l) => "<li>" + esc(l.node.label) + " <small>similarity " + l.weight.toFixed(2) + "</small></li>").join("");
}

const LEVEL_NAMES = ["Level 0 (sector)", "Level 1 (detailed industry)", "Level 2 (deep zone)"];
function lineage(b: Bundle, n: NodeRec): string {
  const parent = n.parent ? b.byId.get(n.parent) : undefined;
  const kids = b.childCount.get(n.id) ?? 0;
  const est = n.provenance === "estimated" ? " <strong>Estimated</strong>" + (n.size_proxy ? " (size proxy: " + esc(n.size_proxy) + ")" : "") + "." : "";
  return "<p class='sub'>" + LEVEL_NAMES[n.level] + (parent ? " &middot; inside " + esc(parent.label) : "")
    + (kids ? " &middot; " + kids + " finer nodes (zoom in)" : "") + "." + est + "</p>";
}

function details(b: Bundle, n: NodeRec): string {
  const occ = (n.top_occupations ?? []).map((o) => "<li>" + esc(o.title) + " <small>" + o.share_pct.toFixed(1) + "%</small></li>").join("");
  const members = n.members && n.members.length ? "<h3>Example organisations</h3><p>" + n.members.map(esc).join(", ") + "</p>" : "";
  return "<h2>" + (n.provenance === "estimated" ? "≈ " : "") + esc(n.label) + "</h2>" + lineage(b, n)
    + "<p class='sub'>" + esc(n.title) + (n.naics_code ? " &middot; NAICS " + esc(n.naics_code) : n.zone ? " &middot; zone: " + esc(n.zone) : "") + " &middot; " + n.provenance + "</p>"
    + "<dl><dt>Employment 2025</dt><dd>" + fmtJobs(n.size.employment) + " jobs</dd>"
    + "<dt>Projected 2035</dt><dd>" + fmtJobs(n.size.employment_2035) + " jobs</dd>"
    + (n.size.value_added !== undefined ? "<dt>Value added 2025</dt><dd>" + fmtMeasure("value_added", n.size.value_added) + " <small>(" + esc(n.value_added_basis ?? "") + ")</small></dd><dt>Per job</dt><dd>" + fmtMeasure("va_per_job", n.size.va_per_job) + "</dd>" : "")
    + "<dt>Projected growth</dt><dd>" + fmtGrowth(n.growth) + " over ten years</dd></dl>"
    + members
    + section("Most similar industries", simpleList(links(b, n.id, 5)))
    + section("Largest occupations", occ);
}

export function buildPanel(b: Bundle, state: State, onPick: (n: NodeRec) => void, extra: (n: NodeRec) => string = () => ""): void {
  const search = el<HTMLInputElement>("search"), panel = el("details"), list = el<HTMLUListElement>("list-ind");
  const items = new Map<string, HTMLButtonElement>();
  const query = () => search.value.trim().toLowerCase();
  // With no query the list shows the industries drawn at the current level; a query searches every loaded level.
  const pool = () => {
    const q = query(), m = state.measure;
    return b.nodes.filter((n) => (q ? n.label.toLowerCase().includes(q) || n.title.toLowerCase().includes(q) : state.visibleIds.has(n.id)))
      .sort((a, c) => (c.size[m] ?? 0) - (a.size[m] ?? 0));
  };

  const build = () => {
    items.clear(); list.innerHTML = "";
    for (const n of pool()) {
      const li = document.createElement("li"), btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = "<span>" + (n.provenance === "estimated" ? "≈ " : "") + esc(n.label) + (query() ? " <small>L" + n.level + "</small>" : "") + "</span><small>" + fmtMeasure(state.measure, n.size[state.measure]) + "</small>";
      btn.addEventListener("click", () => onPick(n));
      btn.addEventListener("pointerenter", () => state.setHover(n));
      btn.addEventListener("pointerleave", () => state.setHover(null));
      btn.addEventListener("focus", () => state.setHover(n));
      btn.addEventListener("blur", () => state.setHover(null));
      li.appendChild(btn); list.appendChild(li); items.set(n.id, btn);
    }
    el("search-count").textContent = query() ? items.size + " match" + (items.size === 1 ? "" : "es") : "";
  };
  search.addEventListener("input", build);
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = b.nodes.find((n) => items.has(n.id) && state.isVisible(n)) ?? b.nodes.find((n) => items.has(n.id));
    if (first) onPick(first);
  });

  let lastSize = state.size, lastLevel = -1;
  const render = () => {
    if (state.size !== lastSize || state.level !== lastLevel) { lastSize = state.size; lastLevel = state.level; build(); }
    el("head-ind").textContent = (state.level === 0 ? "Industry sectors" : "Industries") + " by " + (state.size === "activity" ? "employment" : "value added");
    const n = state.active;
    for (const [id, btn] of items) btn.classList.toggle("active", id === (n?.id ?? ""));
    if (!n) { panel.innerHTML = "<p class='hint'>Hover or select an industry. Height is size (jobs, or value added under Dollars); similar industries sit near each other. Research and academia show up as industries such as colleges and universities and scientific R&amp;D services. Zoom in, or use the Detail control, for finer levels.</p>"; return; }
    panel.innerHTML = extra(n) + details(b, n);
  };
  state.subscribe(render); render();

  const src = b.meta.sources[0];
  el("source").textContent = "Industries: " + src.name + ", " + src.release + ". Value added: BEA GDP by Industry 2025. Retrieved " + src.retrieved + ".";
}
