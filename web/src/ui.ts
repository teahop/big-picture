import { type Bundle, type NodeRec, fmtGrowth, fmtJobs, neighbours } from "./data";
import type { State } from "./state";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function buildPanel(b: Bundle, state: State, onPick: (n: NodeRec) => void): void {
  const list = el<HTMLUListElement>("node-list"), search = el<HTMLInputElement>("search"), details = el("details");
  const sorted = [...b.nodes].sort((a, c) => c.size.employment - a.size.employment);
  const items = new Map<string, HTMLButtonElement>();
  for (const n of sorted) {
    const li = document.createElement("li"), btn = document.createElement("button");
    btn.type = "button"; btn.innerHTML = `<span>${esc(n.label)}</span><small>${fmtJobs(n.size.employment)}</small>`;
    btn.addEventListener("click", () => onPick(n));
    btn.addEventListener("pointerenter", () => state.setHover(n));
    btn.addEventListener("pointerleave", () => state.setHover(null));
    btn.addEventListener("focus", () => state.setHover(n));
    btn.addEventListener("blur", () => state.setHover(null));
    li.appendChild(btn); list.appendChild(li); items.set(n.id, btn);
  }
  const apply = () => {
    const q = search.value.trim().toLowerCase(); let shown = 0;
    for (const n of sorted) {
      const hit = !q || n.label.toLowerCase().includes(q) || n.title.toLowerCase().includes(q);
      items.get(n.id)!.parentElement!.hidden = !hit; if (hit) shown++;
    }
    el("search-count").textContent = q ? `${shown} match${shown === 1 ? "" : "es"}` : "";
  };
  search.addEventListener("input", apply);
  search.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = sorted.find((n) => !items.get(n.id)!.parentElement!.hidden);
    if (first) onPick(first);
  });
  const render = () => {
    const n = state.active;
    for (const [id, btn] of items) btn.classList.toggle("active", id === (n?.id ?? ""));
    if (!n) { details.innerHTML = `<p class="hint">Hover or select a sector. Peak height shows employment.</p>`; return; }
    const near = neighbours(b, n.id).map((x) => `<li>${esc(x.node.label)} <small>similarity ${x.weight.toFixed(2)}</small></li>`).join("");
    const occ = n.top_occupations.map((o) => `<li>${esc(o.title)} <small>${o.share_pct.toFixed(1)}%</small></li>`).join("");
    details.innerHTML = `
      <h2>${esc(n.label)}</h2>
      <p class="sub">${esc(n.title)} &middot; NAICS ${esc(n.naics_code)} &middot; ${n.provenance}</p>
      <dl>
        <dt>Employment 2025</dt><dd>${fmtJobs(n.size.employment)} jobs</dd>
        <dt>Projected 2035</dt><dd>${fmtJobs(n.size.employment_2035)} jobs</dd>
        <dt>Projected growth</dt><dd>${fmtGrowth(n.growth)} over ten years</dd>
      </dl>
      <h3>Most similar sectors</h3><ul>${near}</ul>
      <h3>Largest occupations</h3><ul>${occ}</ul>`;
  };
  state.subscribe(render); render();
  const src = b.meta.sources[0];
  el("source").textContent = `${src.name}, ${src.release}. Retrieved ${src.retrieved}. Size: employment.`;
}
