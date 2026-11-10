import { type Bundle, type Link, type NodeRec, fmtDollars, fmtGrowth, fmtJobs, fmtWorks, levelMaxSize, links } from "./data";
import type { State } from "./state";

function presence(state: State, n: NodeRec): string {
  const o = state.overlay?.nodes[String(state.level)]?.[n.id];
  if (!state.overlay) return "";
  if (!o || !o.total) return "<p class='hint'>Your footprint: no presence at this node.</p>";
  const f = (x: number) => x.toFixed(2);
  return "<h3>Your footprint here (private)</h3><p>Own footprint " + f(o.total) + " <small>tenure " + f(o.tenure) + " &middot; skills and education " + f(o.skills) + "</small></p><p>Network (connections, partial coverage) " + f(o.connections) + "</p>";
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number) => Math.round(x * 100) + "%";

const section = (title: string, items: string, empty = "") =>
  items ? "<h3>" + title + "</h3><ul>" + items + "</ul>" : empty ? "<h3>" + title + "</h3><p class='hint'>" + empty + "</p>" : "";

function bridgeList(items: Link[]): string {
  return items.map((l) => {
    const s = l.signals;
    const detail = s && s.occupational !== undefined
      ? "<small>score " + l.weight.toFixed(2) + " &middot; occupation match " + pct(s.occupational) + " &middot; text similarity " + s.semantic.toFixed(2) + "</small>"
      : s ? "<small>text similarity " + s.semantic.toFixed(2) + "</small>"
      : "<small>score " + l.weight.toFixed(2) + "</small>";
    return "<li>" + (l.node.type === "ind" ? "▲ " : "▼ ") + esc(l.node.label) + "<br>" + detail + "</li>";
  }).join("");
}
function simpleList(items: Link[]): string {
  return items.map((l) => "<li>" + esc(l.node.label) + " <small>similarity " + l.weight.toFixed(2) + "</small></li>").join("");
}

const LEVEL_NAMES = ["Level 0 (sector / field)", "Level 1 (detailed industry / subfield)", "Level 2 (deep zone)"];
function lineage(b: Bundle, n: NodeRec): string {
  const parent = n.parent ? b.byId.get(n.parent) : undefined;
  const kids = b.childCount.get(n.id) ?? 0;
  const est = n.provenance === "estimated" ? " <strong>Estimated</strong>" + (n.size_proxy ? " (size proxy: " + esc(n.size_proxy) + ")" : "") + "." : "";
  return "<p class='sub'>" + LEVEL_NAMES[n.level] + (parent ? " &middot; inside " + esc(parent.label) : "")
    + (kids ? " &middot; " + kids + " finer nodes (zoom in)" : "") + "." + est + "</p>";
}

function industryDetails(b: Bundle, n: NodeRec): string {
  const occ = (n.top_occupations ?? []).map((o) => "<li>" + esc(o.title) + " <small>" + o.share_pct.toFixed(1) + "%</small></li>").join("");
  const unrev = n.level === 2 && b.meta.deep_topic_links_reviewed === false ? "Text-similarity links to research topics; not yet reviewed by the owner." : "";
  const members = n.members && n.members.length ? "<h3>Example organisations</h3><p>" + n.members.map(esc).join(", ") + "</p>" : "";
  return "<h2>" + (n.provenance === "estimated" ? "\u2248 " : "") + "▲ " + esc(n.label) + "</h2>" + lineage(b, n)
    + "<p class='sub'>Industry &middot; " + esc(n.title) + (n.naics_code ? " &middot; NAICS " + esc(n.naics_code) : n.zone ? " &middot; zone: " + esc(n.zone) : "") + " &middot; " + n.provenance + "</p>"
    + "<dl><dt>Employment 2025</dt><dd>" + fmtJobs(n.size.employment) + " jobs</dd>"
    + "<dt>Projected 2035</dt><dd>" + fmtJobs(n.size.employment_2035) + " jobs</dd>"
    + "<dt>Projected growth</dt><dd>" + fmtGrowth(n.growth) + " over ten years</dd></dl>"
    + (unrev && links(b, n.id, "fld").length ? "<p class='hint'>" + unrev + "</p>" : "")
    + section("Strongest research links", bridgeList(links(b, n.id, "fld")), "No research links computed for this node.")
    + members
    + section("Most similar industries", simpleList(links(b, n.id, "ind", 3)))
    + section("Largest occupations", occ);
}

function fieldDetails(b: Bundle, n: NodeRec): string {
  const subs = (n.top_subfields ?? []).map((s) => "<li>" + esc(s.name) + " <small>" + fmtWorks(s.works_us) + " works</small></li>").join("");
  const rd = n.size.rd > 0 ? fmtDollars(n.size.rd) + " <small>(estimated split of HERD)</small>" : "no HERD source";
  return "<h2>▼ " + esc(n.label) + "</h2>" + lineage(b, n)
    + "<p class='sub'>Research &middot; " + esc(n.domain ?? "") + " &middot; " + n.provenance + "</p>"
    + "<dl><dt>US publications</dt><dd>" + fmtWorks(n.size.works) + " <small>(2021-25)</small></dd>"
    + "<dt>University R&amp;D</dt><dd>" + rd + "</dd>"
    + "<dt>Publication growth</dt><dd>" + fmtGrowth(n.growth) + " <small>(2019 to 2024)</small></dd></dl>"
    + section("Strongest industry links", bridgeList(links(b, n.id, "ind")), n.level === 2 && b.meta.deep_topic_links_reviewed === false ? "Links from topics to industry categories are text-similarity only and not yet reviewed." : "")
    + section("Most similar research", simpleList(links(b, n.id, "fld", 3)))
    + (n.keywords && n.keywords.length ? "<h3>Keywords</h3><p>" + n.keywords.map(esc).join(", ") + "</p>" : "")
    + (n.level === 2 && n.description ? "<h3>About</h3><p>" + esc(n.description) + "</p>" : "")
    + section(n.level === 0 ? "Largest subfields" : "Largest topics", subs);
}

export function buildPanel(b: Bundle, state: State, onPick: (n: NodeRec) => void): void {
  const search = el<HTMLInputElement>("search"), details = el("details");
  const lists = { ind: el<HTMLUListElement>("list-ind"), fld: el<HTMLUListElement>("list-fld") };
  const items = new Map<string, HTMLButtonElement>();
  const key = () => ({ ind: "employment", fld: state.researchMeasure });
  const sizeText = (n: NodeRec) => n.type === "ind" ? fmtJobs(n.size.employment) : state.researchMeasure === "rd" ? fmtDollars(n.size.rd) : fmtWorks(n.size.works);
  const query = () => search.value.trim().toLowerCase();
  // With no query the lists show the nodes drawn at the current level; a query searches every loaded level.
  const pool = (type: "ind" | "fld") => {
    const q = query();
    return b.nodes.filter((n) => n.type === type && (q ? n.label.toLowerCase().includes(q) || n.title.toLowerCase().includes(q) : state.visibleIds.has(n.id)))
      .sort((a, c) => (c.size[key()[type]] ?? 0) - (a.size[key()[type]] ?? 0));
  };

  const build = () => {
    items.clear();
    let shown = 0;
    for (const type of ["ind", "fld"] as const) {
      lists[type].innerHTML = "";
      for (const n of pool(type)) {
        const li = document.createElement("li"), btn = document.createElement("button");
        btn.type = "button";
        btn.innerHTML = "<span>" + (n.provenance === "estimated" ? "\u2248 " : "") + esc(n.label) + (query() ? " <small>L" + n.level + "</small>" : "") + "</span><small>" + sizeText(n) + "</small>";
        btn.addEventListener("click", () => onPick(n));
        btn.addEventListener("pointerenter", () => state.setHover(n));
        btn.addEventListener("pointerleave", () => state.setHover(null));
        btn.addEventListener("focus", () => state.setHover(n));
        btn.addEventListener("blur", () => state.setHover(null));
        li.appendChild(btn); lists[type].appendChild(li); items.set(n.id, btn); shown++;
      }
    }
    el("search-count").textContent = query() ? shown + " match" + (shown === 1 ? "" : "es") : "";
  };
  search.addEventListener("input", build);
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = b.nodes.find((n) => items.has(n.id) && state.isVisible(n)) ?? b.nodes.find((n) => items.has(n.id));
    if (first) onPick(first);
  });

  let lastMeasure = state.researchMeasure, lastLevel = -1;
  const render = () => {
    if (state.researchMeasure !== lastMeasure || state.level !== lastLevel) { lastMeasure = state.researchMeasure; lastLevel = state.level; build(); }
    el("group-ind").hidden = !state.showsIndustry(); el("group-fld").hidden = !state.showsResearch();
    const n = state.active;
    for (const [id, btn] of items) btn.classList.toggle("active", id === (n?.id ?? ""));
    if (!n) { details.innerHTML = "<p class='hint'>Hover or select a node. Peaks (\u25B2) are industry sectors, valleys (\u25BC) are research fields. Zoom in, or use the Detail control, for finer levels.</p>"; return; }
    details.innerHTML = (n.type === "ind" ? industryDetails(b, n) : fieldDetails(b, n)) + presence(state, n)
      + (state.overlay && state.footprint !== "off" ? "<p class='hint'>" + esc(state.overlay.caveat) + (state.overlay.centroid[String(state.level)]?.between_clusters ? " At this level the centroid does sit away from every occupied node." : "") + "</p>" : "");
  };
  state.subscribe(render); render();


  const src = b.meta.sources[0], br = b.meta.bridge;
  el("source").textContent = "Industry: " + src.name + ", " + src.release + ". Research: OpenAlex US-affiliated works 2021-25, NSF HERD FY 2024. Retrieved " + src.retrieved + "."
    + (br.field_to_cip_reviewed ? "" : " The field-to-program (CIP) mapping behind the occupation signal has not been reviewed yet.");
}
