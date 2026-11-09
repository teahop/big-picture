import { loadBundle } from "./data";
import { Map2D } from "./map2d";
import { Scene3D, webglAvailable } from "./scene3d";
import { State } from "./state";
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

  let mode: "3d" | "2d" = gl ? "3d" : "2d";
  const toggle = $<HTMLButtonElement>("mode");
  const apply = () => {
    scene3d?.show(mode === "3d"); map2d.show(mode === "2d");
    toggle.textContent = mode === "3d" ? "Switch to 2D map" : "Switch to 3D terrain";
    toggle.setAttribute("aria-pressed", String(mode === "2d"));
  };
  toggle.disabled = !gl;
  if (!gl) $("notice").textContent = "WebGL is not available, so the 2D contour map is shown.";
  toggle.addEventListener("click", () => { mode = mode === "3d" ? "2d" : "3d"; apply(); });
  apply();

  buildPanel(bundle, state, (n) => { state.setSelected(n); scene3d?.focus(n); });
  onThemeChange(() => { scene3d?.applyTheme(); map2d.applyTheme(); });
  (window as unknown as { __viewer: object }).__viewer = { state, bundle, setMode: (m: "3d" | "2d") => { mode = m; apply(); } };
}

start().catch((err) => { $("notice").textContent = `Could not load the map data: ${String(err)}`; });
