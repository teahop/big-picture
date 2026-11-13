/** Footprint panel: breadcrumb, the touched areas at the current level (largest first, with bars), and the entries
 *  behind a selected node. Entry labels come from the footprint itself, never from the public bundle. */
import type { Bundle, NodeRec } from "./data";
import { descends, entriesAt, type Hierarchy } from "./footprint";
import type { State } from "./state";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (x: number) => (x < 0.01 ? "<1" : String(Math.round(x * 100))) + "%";

export interface StepActions { stepInto(n: NodeRec): void; stepTo(depth: number): void; select(n: NodeRec): void; adjust(): void }

/** Touched nodes one level below `id` (what stepping into it shows). */
export function touchedChildren(state: State, h: Hierarchy, id: string, level: number): string[] {
  const next = state.fp?.touched[(level + 1) as 0 | 1 | 2];
  return next ? [...next.keys()].filter((c) => c !== id && descends(h, c, id)) : [];
}

export function buildFootprintPanel(b: Bundle, state: State, h: Hierarchy, act: StepActions): (n: NodeRec) => string {
  const panel = document.getElementById("fp-panel")!;
  const canStep = (n: NodeRec) => n.level < 2 && n.level === state.level && touchedChildren(state, h, n.id, n.level).length > 0;
  let last = "";
  const render = () => {
    const key = [state.fpSample, state.fpVersion, state.level, state.focus.join(">"), state.size].join("|");
    if (key === last) return;
    last = key;
    panel.hidden = !state.fp;
    if (!state.fp) { panel.innerHTML = ""; return; }
    const touched = state.touchedNow() ?? new Map<string, number>();
    const within = state.focus.length && state.focus.length === state.level ? state.focus[state.focus.length - 1] : null;
    const rows = [...touched].filter(([id]) => !within || (id !== within && descends(h, id, within)));
    const title = state.fpSample ? "Sample career" : "Your career";
    const note = state.fpSample ? "A made-up career, to show how it works. Add your CV to see yours." : "Share of your weighted years (recent roles count more).";
    // a CV goes straight to the map; its rows can be checked and changed afterwards
    const adjust = state.fpSample ? "" : "<button type='button' class='fp-adjust' data-act='adjust'>Make adjustments</button>";
    panel.innerHTML = "<h3>" + title + "</h3><p class='hint'>" + note + "</p><ul class='fp-list'>"
      + rows.map(([id, s]) => {
        const n = b.byId.get(id);
        return n ? "<li><button type='button' data-id='" + esc(id) + "'><span>" + esc(n.label) + (canStep(n) ? " ›" : "") + "</span><span>" + pct(s) + "</span><span class='fp-bar'><i style='width:" + (s / (rows[0]?.[1] || 1) * 100).toFixed(1) + "%'></i></span></button></li>" : "";
      }).join("") + "</ul>" + (rows.length ? "" : "<p class='hint'>Nothing touched at this level.</p>") + adjust;
  };
  panel.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest("button");
    if (!el) return;
    if (el.dataset.act === "adjust") return act.adjust();
    const n = el.dataset.id ? b.byId.get(el.dataset.id) : undefined;
    if (n) (canStep(n) ? act.stepInto(n) : act.select(n));
  });
  document.getElementById("details")!.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest("button[data-step]") as HTMLButtonElement | null;
    const n = el ? b.byId.get(el.dataset.step!) : undefined;
    if (n) act.stepInto(n);
  });
  state.subscribe(render); render();

  // details for a selected node: its share of the footprint and the entries behind it
  return (n: NodeRec) => {
    const s = state.touchedNow()?.get(n.id);
    if (!state.fp || s === undefined) return state.fp ? "<p class='hint'>Not part of your career at this level.</p>" : "";
    const step = canStep(n) ? "<button type='button' class='fp-step' data-step='" + esc(n.id) + "'>Step into " + esc(n.label) + " ›</button>" : "";
    const why = entriesAt(state.fp, n.id, state.level).map(({ entry: e, share }) =>
      "<li>" + esc(e.label) + " <small>" + (e.kind === "role" ? "role, " + (e.years ?? 0).toFixed(1) + " years" + (e.end_year ? ", to " + Math.floor(e.end_year) : "") : "degree") + " &middot; " + pct(share) + " of this area</small></li>").join("");
    const whose = state.fpSample ? "the sample career" : "your career";
    return "<h3>" + (state.fpSample ? "Sample career here" : "Your career here") + "</h3><p>" + pct(s) + " of " + whose + ".</p>" + step + (why ? "<h3>Why</h3><ul class='fp-why'>" + why + "</ul>" : "");
  };
}
