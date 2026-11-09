import { type Bundle, type Link, type NodeRec, fmtDollars, fmtGrowth, fmtJobs, fmtWorks, links } from "./data";
import type { State } from "./state";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number) => Math.round(x * 100) + "%";

function bridgeList(items: Link[]): string {
  return items.map((l) => {
    const s = l.signals;
    const detail = s
      ? "<small>score " + l.weight.toFixed(2) + " &middot; occupation match " + pct(s.occupational) + " &middot; text similarity " + s.semantic.toFixed(2) + "</small>"
      : "<small>score " + l.weight.toFixed(2) + "</small>";
    return "<li>" + (l.node.type === "ind" ? "▲ " : "▼ ") + esc(l.node.label) + "<br>" + detail + "</li>";
  }).join("");
}
function simpleList(items: Link[]): string {
  return items.map((l) => "<li>" + esc(l.node.label) + " <small>similarity " + l.weight.toFixed(2) + "</small></li>").join("");
}

function industryDetails(b: Bundle, n: NodeRec): string {
  const occ = (n.top_occupations ?? []).map((o) => "<li>" + esc(o.title) + " <small>" + o.share_pct.toFixed(1) + "%</small></li>").join("");
  return "<h2>▲ " + esc(n.label) + "</h2>"
    + "<p class='sub'>Industry sector &middot; " + esc(n.title) + " &middot; NAICS " + esc(n.naics_code ?? "") + " &middot; " + n.provenance + "</p>"
    + "<dl><dt>Employment 2025</dt><dd>" + fmtJobs(n.size.employment) + " jobs</dd>"
    + "<dt>Projected 2035</dt><dd>" + fmtJobs(n.size.employment_2035) + " jobs</dd>"
    + "<dt>Projected growth</dt><dd>" + fmtGrowth(n.growth) + " over ten years</dd></dl>"
    + "<h3>Strongest research links</h3><ul>" + bridgeList(links(b, n.id, "fld")) + "</ul>"
    + "<h3>Most similar sectors</h3><ul>" + simpleList(links(b, n.id, "ind", 3)) + "</ul>"
    + "<h3>Largest occupations</h3><ul>" + occ + "</ul>";
}

function fieldDetails(b: Bundle, n: NodeRec): string {
  const subs = (n.top_subfields ?? []).map((s) => "<li>" + esc(s.name) + " <small>" + fmtWorks(s.works_us) + " works</small></li>").join("");
  const rd = n.size.rd > 0 ? fmtDollars(n.size.rd) + " <small>(estimated split of HERD)</small>" : "no HERD source";
  return "<h2>▼ " + esc(n.label) + "</h2>"
    + "<p class='sub'>Research field &middot; " + esc(n.domain ?? "") + " &middot; " + n.provenance + "</p>"
    + "<dl><dt>US publications</dt><dd>" + fmtWorks(n.size.works) + " <small>(2021-25)</small></dd>"
    + "<dt>University R&amp;D</dt><dd>" + rd + "</dd>"
    + "<dt>Publication growth</dt><dd>" + fmtGrowth(n.growth) + " <small>(2019 to 2024)</small></dd></dl>"
    + "<h3>Strongest industry links</h3><ul>" + bridgeList(links(b, n.id, "ind")) + "</ul>"
    + "<h3>Most similar fields</h3><ul>" + simpleList(links(b, n.id, "fld", 3)) + "</ul>"
    + "<h3>Largest subfields</h3><ul>" + subs + "</ul>";
}

export function buildPanel(b: Bundle, state: State, onPick: (n: NodeRec) => void): void {
  const search = el<HTMLInputElement>("search"), details = el("details");
  const lists = { ind: el<HTMLUListElement>("list-ind"), fld: el<HTMLUListElement>("list-fld") };
  const items = new Map<string, HTMLButtonElement>();
  const key = () => ({ ind: "employment", fld: state.researchMeasure });
  const sizeText = (n: NodeRec) => n.type === "ind" ? fmtJobs(n.size.employment) : state.researchMeasure === "rd" ? fmtDollars(n.size.rd) : fmtWorks(n.size.works);
  const sorted = (type: "ind" | "fld") => b.nodes.filter((n) => n.type === type)
    .sort((a, c) => (c.size[key()[type]] ?? 0) - (a.size[key()[type]] ?? 0));

  const build = () => {
    for (const type of ["ind", "fld"] as const) {
      lists[type].innerHTML = "";
      for (const n of sorted(type)) {
        const li = document.createElement("li"), btn = document.createElement("button");
        btn.type = "button"; btn.innerHTML = "<span>" + esc(n.label) + "</span><small>" + sizeText(n) + "</small>";
        btn.addEventListener("click", () => onPick(n));
        btn.addEventListener("pointerenter", () => state.setHover(n));
        btn.addEventListener("pointerleave", () => state.setHover(null));
        btn.addEventListener("focus", () => state.setHover(n));
        btn.addEventListener("blur", () => state.setHover(null));
        li.appendChild(btn); lists[type].appendChild(li); items.set(n.id, btn);
      }
    }
    filter();
  };
  const filter = () => {
    const q = search.value.trim().toLowerCase(); let shown = 0;
    for (const n of b.nodes) {
      const hit = !q || n.label.toLowerCase().includes(q) || n.title.toLowerCase().includes(q);
      items.get(n.id)!.parentElement!.hidden = !hit; if (hit) shown++;
    }
    el("search-count").textContent = q ? shown + " match" + (shown === 1 ? "" : "es") : "";
  };
  search.addEventListener("input", filter);
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = b.nodes.find((n) => !items.get(n.id)!.parentElement!.hidden && state.isVisible(n))
      ?? b.nodes.find((n) => !items.get(n.id)!.parentElement!.hidden);
    if (first) onPick(first);
  });

  let lastMeasure = state.researchMeasure;
  const render = () => {
    if (state.researchMeasure !== lastMeasure) { lastMeasure = state.researchMeasure; build(); }
    el("group-ind").hidden = !state.showsIndustry(); el("group-fld").hidden = !state.showsResearch();
    const n = state.active;
    for (const [id, btn] of items) btn.classList.toggle("active", id === (n?.id ?? ""));
    if (!n) { details.innerHTML = "<p class='hint'>Hover or select a node. Peaks (▲) are industry sectors, valleys (▼) are research fields.</p>"; return; }
    details.innerHTML = n.type === "ind" ? industryDetails(b, n) : fieldDetails(b, n);
  };
  build(); state.subscribe(render); render();

  const src = b.meta.sources[0], br = b.meta.bridge;
  el("source").textContent = "Industry: " + src.name + ", " + src.release + ". Research: OpenAlex US-affiliated works 2021-25, NSF HERD FY 2024. Retrieved " + src.retrieved + "."
    + (br.field_to_cip_reviewed ? "" : " The field-to-program (CIP) mapping behind the occupation signal has not been reviewed yet.");
}
