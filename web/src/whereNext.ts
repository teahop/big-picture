import type { Bundle, NodeRec } from "./data";
import { type ScoreData, type Toggles, rank, reason } from "./score";
import type { State } from "./state";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const BARS: [string, "adjacency" | "growth" | "size" | "novelty"][] = [["Adjacency", "adjacency"], ["Growth", "growth"], ["Size", "size"], ["Novelty", "novelty"]];

/** Ranked "where next" panel (private; only when a local score file exists). Mission tags are saved to the private
 *  folder through the dev server; they never touch tracked files. */
export function buildWhereNext(b: Bundle, state: State, data: ScoreData, onPick: (n: NodeRec) => void): void {
  const host = document.getElementById("where-next")!;
  host.hidden = false;
  const toggles: Toggles = { pay: false, mission: false, geography: false };
  const tags = new Map<string, number>();
  let layer: "ind" | "fld" = "ind";

  const render = () => {
    const ranked = rank(data, layer, toggles, tags), shown = ranked.slice(0, 15);
    state.setRanked(new Set(ranked.slice(0, 10).map((r) => r.node.id)));
    host.innerHTML = "<h3>Where next (private)</h3>"
      + "<div class='wn-controls'><label>Rank <select id='wn-layer'><option value='ind'" + (layer === "ind" ? " selected" : "") + ">industries</option><option value='fld'" + (layer === "fld" ? " selected" : "") + ">research fields</option></select></label>"
      + "<label><input type='checkbox' id='wn-geo'" + (toggles.geography ? " checked" : "") + "> Local concentration</label>"
      + "<label><input type='checkbox' id='wn-mission'" + (toggles.mission ? " checked" : "") + "> Mission tags</label>"
      + "<label title='" + (data.pay_available ? "" : "Needs the OEWS wage file (hand download)") + "'><input type='checkbox' id='wn-pay'" + (data.pay_available ? "" : " disabled") + "> Pay" + (data.pay_available ? "" : " (needs wage data)") + "</label></div>"
      + "<ol class='wn-list'>" + shown.map((r, i) => {
        const bars = BARS.map(([name, k]) => "<span class='bar' title='" + name + " " + r.node.components[k].toFixed(2) + "'><i style='width:" + Math.round(r.node.components[k] * 100) + "%'></i></span>").join("");
        const tag = tags.get(r.node.id) ?? r.node.tag;
        return "<li><button type='button' data-id='" + esc(r.node.id) + "'><span>" + (i + 1) + ". " + esc(r.node.label) + "</span><small>" + r.score.toFixed(2) + "</small></button>"
          + "<div class='bars'>" + bars + "</div><small class='why'>" + esc(reason(r.node, data, toggles, tags)) + "</small>"
          + "<label class='tag'>Mission tag <select data-tag='" + esc(r.node.id) + "'>" + [-2, -1, 0, 1, 2].map((v) => "<option value='" + v + "'" + (v === tag ? " selected" : "") + ">" + (v > 0 ? "+" : "") + v + "</option>").join("") + "</select>" + (r.node.tag_source && !tags.has(r.node.id) ? " <small>(" + r.node.tag_source + ")</small>" : "") + "</label></li>";
      }).join("") + "</ol><p class='hint'>Bars: adjacency, growth, size, novelty (0 to 1). Toggles scale a score by 0.5 to 1.5. Mission tags are saved to your private folder.</p>";
    host.querySelector<HTMLSelectElement>("#wn-layer")!.addEventListener("change", (e) => { layer = (e.target as HTMLSelectElement).value as "ind" | "fld"; render(); });
    host.querySelector<HTMLInputElement>("#wn-geo")!.addEventListener("change", (e) => { toggles.geography = (e.target as HTMLInputElement).checked; render(); });
    host.querySelector<HTMLInputElement>("#wn-mission")!.addEventListener("change", (e) => { toggles.mission = (e.target as HTMLInputElement).checked; render(); });
    host.querySelector<HTMLInputElement>("#wn-pay")!.addEventListener("change", (e) => { toggles.pay = (e.target as HTMLInputElement).checked; render(); });
    host.querySelectorAll<HTMLButtonElement>("button[data-id]").forEach((btn) => btn.addEventListener("click", () => { const n = b.byId.get(btn.dataset.id!); if (n) onPick(n); }));
    host.querySelectorAll<HTMLSelectElement>("select[data-tag]").forEach((sel) => sel.addEventListener("change", async () => {
      const id = sel.dataset.tag!, v = Number(sel.value);
      tags.set(id, v);
      try { await fetch("_private/mission-tag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, tag: v }) }); } catch { /* the tag still applies in this session */ }
      render();
    }));
  };
  render();
}
