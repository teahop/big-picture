import { ensureLevel, loadBundle, visibleAt, type NodeRec, type SizeSetting } from "./data";
import { Scene3D, webglAvailable } from "./scene3d";
import { State, type Fade, type FootprintMode, type LodSetting, type Look } from "./state";
import { compute, hierarchy, loadFootprint } from "./footprint";
import { buildFootprintPanel, touchedChildren } from "./fpui";
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
  // ---- footprint (the owner's private file on a local server, or the synthetic sample in development)
  const fpData = await loadFootprint();
  let extra: ((n: NodeRec) => string) | undefined;
  if (fpData) {
    await ensureLevel(bundle, 2);                         // weights roll up across every level
    const h = hierarchy(bundle.nodes), cfg = __VIEWER__.footprint;
    const set = (m: FootprintMode) => {
      const c = m === "off" ? null : compute(fpData, h, cfg, m);
      if (c?.unknown.length) $("notice").textContent = "Some footprint entries name industries that are not on the map: " + c.unknown.slice(0, 3).join(", ");
      state.setFocus([]); state.setFootprint(m, c);
    };
    const mode = $<HTMLSelectElement>("fp-mode"), look = $<HTMLSelectElement>("fp-look"), fade = $<HTMLSelectElement>("fp-fade");
    for (const id of ["fp-wrap", "fp-look-wrap", "fp-fade-wrap"]) $(id).hidden = false;
    (mode.querySelector("option[value=network]") as HTMLOptionElement).hidden = !Object.keys(fpData.layers?.connections ?? {}).length;
    mode.addEventListener("change", () => set(mode.value as FootprintMode));
    look.addEventListener("change", () => state.setLook(look.value as Look));
    fade.addEventListener("change", () => state.setFade(fade.value as Fade));
    const goLevel = async (level: number, auto = false) => {
      state.setLod(auto ? "auto" : String(level) as LodSetting); lod.value = auto ? "auto" : String(level);
      await applyLevel();
    };
    const stepInto = async (n: NodeRec) => {
      const kids = touchedChildren(state, h, n.id, n.level);
      state.setFocus([...state.focus.slice(0, n.level), n.id]);
      await goLevel(n.level + 1);
      state.setSelected(null);
      scene3d?.frameNodes(kids.length ? kids : [n.id]);
    };
    const stepTo = async (depth: number) => {
      const path = state.focus.slice(0, depth);
      state.setFocus(path); state.setSelected(null);
      if (!depth) { await goLevel(0, true); scene3d?.frameAll(); return; }
      await goLevel(depth);
      const id = path[depth - 1];
      scene3d?.frameNodes(touchedChildren(state, h, id, depth - 1));
    };
    extra = buildFootprintPanel(bundle, state, h, { stepInto: (n) => void stepInto(n), stepTo: (d) => void stepTo(d), select: pick });
    set("career");
    (window as unknown as { __fp: object }).__fp = { stepInto, stepTo, set, data: fpData };
  }
  buildPanel(bundle, state, pick, extra);
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
    setLook: (v: Look) => { ($("fp-look") as HTMLSelectElement).value = v; state.setLook(v); },
    setFade: (v: Fade) => { ($("fp-fade") as HTMLSelectElement).value = v; state.setFade(v); },
    setLod: (l: LodSetting) => { lod.value = l; state.setLod(l); return applyLevel(); },
  };
}

start().catch((err) => { $("notice").textContent = "Could not load the map data: " + String(err); });
