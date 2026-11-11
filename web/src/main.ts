import { ensureLevel, loadBundle, visibleAt, type NodeRec, type SizeSetting } from "./data";
import { Scene3D, webglAvailable } from "./scene3d";
import { State, type LodSetting } from "./state";
import { effectiveTheme, onThemeChange, restoreTheme, setTheme } from "./theme";
import { buildPanel } from "./ui";

restoreTheme();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function start(): Promise<void> {
  const bundle = await loadBundle();
  const about = $<HTMLDialogElement>("about");
  $("about-open").addEventListener("click", () => about.showModal());
  about.addEventListener("click", (e) => { if (e.target === about) about.close(); });
  const state = new State();
  const gl = webglAvailable();
  // Without WebGL there is no map: say so in one line and leave the lists, search and details working.
  const NO_GL = "This browser cannot show the 3D map (WebGL is off or unavailable). The lists below still work.";
  const maxLevel = Math.max(...bundle.meta.levels);

  // ---- level of detail: manual override, otherwise driven by the camera distance
  let auto = 0, applying = 0;
  const wanted = (): number => Math.min(state.lod !== "auto" ? Number(state.lod) : auto, maxLevel);
  const applyLevel = async (): Promise<void> => {
    const level = wanted(), ticket = ++applying;
    if (level === state.level && state.visibleIds.size) return;
    if (!bundle.grids[level]) $("notice").textContent = "Loading level " + level + "...";
    await ensureLevel(bundle, level);
    if (ticket !== applying) return;                      // a newer request superseded this one
    $("notice").textContent = gl ? "" : NO_GL;
    state.setLevel(level, new Set(visibleAt(bundle, level).map((n) => n.id)));
  };
  await ensureLevel(bundle, 0);
  state.setLevel(0, new Set(visibleAt(bundle, 0).map((n) => n.id)));

  const scene3d = gl ? new Scene3D($("view-3d"), $("labels"), bundle, state) : null;
  if (scene3d) { scene3d.onAutoLevel = (l) => { auto = l; void applyLevel(); }; scene3d.show(true); }
  $("map").hidden = !gl;
  $("notice").textContent = gl ? "" : NO_GL;

  const lod = $<HTMLSelectElement>("lod");
  lod.addEventListener("change", () => { state.setLod(lod.value as LodSetting); void applyLevel(); });
  const size = $<HTMLSelectElement>("size");
  size.addEventListener("change", () => state.setSize(size.value as SizeSetting));

  const pick = (n: NodeRec) => {
    if (!state.visibleIds.has(n.id)) { state.setLod(String(n.level) as LodSetting); lod.value = String(n.level); }
    void applyLevel().then(() => { state.setSelected(n); scene3d?.focus(n); });
  };
  buildPanel(bundle, state, pick);
  onThemeChange(() => { scene3d?.applyTheme(); syncTheme(); });
  const themeBtn = $<HTMLButtonElement>("theme");
  const syncTheme = () => { themeBtn.textContent = effectiveTheme() === "dark" ? "Light mode" : "Dark mode"; };
  themeBtn.addEventListener("click", () => setTheme(effectiveTheme() === "dark" ? "light" : "dark"));
  syncTheme();
  const panelBtn = $<HTMLButtonElement>("panel-toggle");
  panelBtn.addEventListener("click", () => { const hide = document.querySelector("aside")!.toggleAttribute("hidden"); panelBtn.textContent = hide ? "Show panel" : "Hide panel"; panelBtn.setAttribute("aria-pressed", String(hide)); });
  (window as unknown as { __viewer: object }).__viewer = {
    state, bundle, applyLevel, stats: () => scene3d?.stats(), bench: (n?: number) => scene3d?.benchmark(n),
    setSize: (v: SizeSetting) => { size.value = v; state.setSize(v); },
    setLod: (l: LodSetting) => { lod.value = l; state.setLod(l); return applyLevel(); },
  };
}

start().catch((err) => { $("notice").textContent = "Could not load the map data: " + String(err); });
