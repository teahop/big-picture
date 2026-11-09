import { loadBundle, type ResearchMeasure } from "./data";
import { Map2D } from "./map2d";
import { Scene3D, webglAvailable } from "./scene3d";
import { State, type LayerMode } from "./state";
import { onThemeChange } from "./theme";
import { buildPanel } from "./ui";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$("title").textContent = __DISPLAY_NAME__;

async function start(): Promise<void> {
  const bundle = await loadBundle();
  const state = new State();
  const map2d = new Map2D($("view-2d"), bundle, state);
  const gl = webglAvailable();
  const scene3d = gl ? new Scene3D($("view-3d"), $("labels"), bundle, state) : null;

  let view: "3d" | "2d" = gl ? "3d" : "2d";
  const toggle = $<HTMLButtonElement>("mode");
  const apply = () => {
    scene3d?.show(view === "3d"); map2d.show(view === "2d");
    toggle.textContent = view === "3d" ? "Switch to 2D map" : "Switch to 3D terrain";
    toggle.setAttribute("aria-pressed", String(view === "2d"));
  };
  toggle.disabled = !gl;
  if (!gl) $("notice").textContent = "WebGL is not available, so the 2D contour map is shown.";
  toggle.addEventListener("click", () => { view = view === "3d" ? "2d" : "3d"; apply(); });
  apply();

  for (const input of document.querySelectorAll<HTMLInputElement>("input[name=layer]")) {
    input.checked = input.value === state.mode;
    input.addEventListener("change", () => { if (input.checked) state.setMode(input.value as LayerMode); });
  }
  const research = $<HTMLSelectElement>("size-research");
  research.addEventListener("change", () => state.setResearchMeasure(research.value as ResearchMeasure));

  buildPanel(bundle, state, (n) => {
    if (!state.isVisible(n)) state.setMode(n.type === "ind" ? "industry" : "research"), syncRadios();
    state.setSelected(n); scene3d?.focus(n);
  });
  const syncRadios = () => document.querySelectorAll<HTMLInputElement>("input[name=layer]").forEach((i) => { i.checked = i.value === state.mode; });
  state.subscribe(syncRadios);
  onThemeChange(() => { scene3d?.applyTheme(); map2d.applyTheme(); });
  (window as unknown as { __viewer: object }).__viewer = {
    state, bundle, setView: (v: "3d" | "2d") => { view = v; apply(); },
  };
}

start().catch((err) => { $("notice").textContent = "Could not load the map data: " + String(err); });
