import { ensureLevel, loadBundle, visibleAt, type IndustryMeasure, type NodeRec, type ResearchMeasure } from "./data";
import { Map2D } from "./map2d";
import { Scene3D, webglAvailable } from "./scene3d";
import { State, type LayerMode, type LodSetting } from "./state";
import { effectiveTheme, onThemeChange, restoreTheme, setTheme } from "./theme";
import { buildPanel } from "./ui";
import { loadOverlay, type Footprint } from "./overlay";
import { loadScore } from "./score";
import { buildWhereNext } from "./whereNext";

restoreTheme();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$("title").textContent = __DISPLAY_NAME__;

async function start(): Promise<void> {
  const bundle = await loadBundle();
  const about = $<HTMLDialogElement>("about");
  $("about-open").addEventListener("click", () => about.showModal());
  about.addEventListener("click", (e) => { if (e.target === about) about.close(); });
  const state = new State();
  state.overlay = await loadOverlay();        // null on the public site: the footprint control stays hidden
  const gl = webglAvailable();
  const maxLevel = Math.max(...bundle.meta.levels);
  let view: "3d" | "2d" = gl ? "3d" : "2d";

  // ---- level of detail: manual override, otherwise driven by the camera distance in 3D (Level 1 in 2D)
  let auto3d = 0, auto2d = 0, applying = 0;
  const wanted = (): number => state.lod !== "auto" ? Math.min(Number(state.lod), maxLevel) : Math.min(view === "2d" ? auto2d : auto3d, maxLevel);
  const applyLevel = async (): Promise<void> => {
    const level = wanted(), ticket = ++applying;
    if (level === state.level && state.visibleIds.size) return;
    if (!bundle.grids[level]) $("notice").textContent = "Loading level " + level + "...";
    await ensureLevel(bundle, level);
    if (ticket !== applying) return;                      // a newer request superseded this one
    $("notice").textContent = "";
    state.setLevel(level, new Set(visibleAt(bundle, level).map((n) => n.id)));
  };
  await ensureLevel(bundle, 0);
  state.setLevel(0, new Set(visibleAt(bundle, 0).map((n) => n.id)));

  const map2d = new Map2D($("view-2d"), bundle, state);
  const scene3d = gl ? new Scene3D($("view-3d"), $("labels"), bundle, state) : null;
  if (scene3d) scene3d.onAutoLevel = (l) => { auto3d = l; if (view === "3d") void applyLevel(); };
  map2d.onAutoLevel = (l) => { auto2d = l; if (view === "2d") void applyLevel(); };

  const toggle = $<HTMLButtonElement>("mode");
  const apply = () => {
    scene3d?.show(view === "3d"); map2d.show(view === "2d");
    toggle.textContent = view === "3d" ? "Switch to 2D map" : "Switch to 3D terrain";
    toggle.setAttribute("aria-pressed", String(view === "2d"));
    void applyLevel();
  };
  toggle.disabled = !gl;
  if (!gl) $("notice").textContent = "WebGL is not available, so the 2D contour map is shown.";
  toggle.addEventListener("click", () => { view = view === "3d" ? "2d" : "3d"; apply(); });
  apply();
  if (gl) $("notice").textContent = "";

  const fp = $<HTMLSelectElement>("footprint");
  if (state.overlay) { $("footprint-wrap").hidden = false; fp.addEventListener("change", () => state.setFootprint(fp.value as Footprint)); }
  const lod = $<HTMLSelectElement>("lod");
  lod.addEventListener("change", () => { state.setLod(lod.value as LodSetting); void applyLevel(); });
  for (const input of document.querySelectorAll<HTMLInputElement>("input[name=layer]")) {
    input.checked = input.value === state.mode;
    input.addEventListener("change", () => { if (input.checked) state.setMode(input.value as LayerMode); });
  }
  const research = $<HTMLSelectElement>("size-research");
  const industry = $<HTMLSelectElement>("size-industry");
  industry.addEventListener("change", () => state.setIndustryMeasure(industry.value as IndustryMeasure));
  research.addEventListener("change", () => state.setResearchMeasure(research.value as ResearchMeasure));
  const syncRadios = () => document.querySelectorAll<HTMLInputElement>("input[name=layer]").forEach((i) => { i.checked = i.value === state.mode; });
  state.subscribe(syncRadios);

  const pick = (n: NodeRec) => {
    if (!state.visibleIds.has(n.id)) { state.setLod(String(n.level) as LodSetting); lod.value = String(n.level); }
    if (!state.isVisible(n)) state.setMode(n.type === "ind" ? "industry" : "research");
    void applyLevel().then(() => { state.setSelected(n); scene3d?.focus(n); });
  };
  buildPanel(bundle, state, pick);
  const score = await loadScore();            // private; null on the public site
  if (score) buildWhereNext(bundle, state, score, pick);
  onThemeChange(() => { scene3d?.applyTheme(); map2d.applyTheme(); syncTheme(); });
  const themeBtn = $<HTMLButtonElement>("theme");
  const syncTheme = () => { themeBtn.textContent = effectiveTheme() === "dark" ? "Light mode" : "Dark mode"; };
  themeBtn.addEventListener("click", () => setTheme(effectiveTheme() === "dark" ? "light" : "dark"));
  syncTheme();
  const panelBtn = $<HTMLButtonElement>("panel-toggle");
  panelBtn.addEventListener("click", () => { const hide = document.querySelector("aside")!.toggleAttribute("hidden"); panelBtn.textContent = hide ? "Show panel" : "Hide panel"; panelBtn.setAttribute("aria-pressed", String(hide)); });
  (window as unknown as { __viewer: object }).__viewer = {
    state, bundle, applyLevel, stats: () => scene3d?.stats(), bench: (n?: number) => scene3d?.benchmark(n),
    setView: (v: "3d" | "2d") => { view = v; apply(); },
    setFootprint: (f: Footprint) => { fp.value = f; state.setFootprint(f); },
    setLod: (l: LodSetting) => { lod.value = l; state.setLod(l); return applyLevel(); },
  };
}

start().catch((err) => { $("notice").textContent = "Could not load the map data: " + String(err); });
