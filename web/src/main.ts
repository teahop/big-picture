import { ensureLevel, loadBundle, visibleAt, type NodeRec, type SizeSetting } from "./data";
import { Scene3D, webglAvailable } from "./scene3d";
import { State, type FootprintMode, type LodSetting } from "./state";
import { compute, hierarchy, loadFootprint, type FootprintData } from "./footprint";
import { buildCvDialog } from "./cvui";
import { buildFootprintPanel, touchedChildren } from "./fpui";
import { effectiveTheme, onThemeChange, restoreTheme, setTheme, type ThemeChoice } from "./theme";
import { buildPanel } from "./ui";
import { Toggle } from "./controls";

restoreTheme();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function start(): Promise<void> {
  const bundle = await loadBundle();
  const about = $<HTMLDialogElement>("about");
  $("about-open").addEventListener("click", () => about.showModal());
  about.addEventListener("click", (e) => { if (e.target === about) about.close(); });
  const state = new State();
  const gl = webglAvailable();
  // Without WebGL there is no map: say so in one line and leave the lists and details working.
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

  const lod = new Toggle<LodSetting>("lod");
  lod.onChange((v) => { state.setLod(v); void applyLevel(); });
  const size = new Toggle<SizeSetting>("size");
  size.onChange((v) => state.setSize(v));

  const pick = (n: NodeRec) => {
    if (!state.visibleIds.has(n.id)) { state.setLod(String(n.level) as LodSetting); lod.value = String(n.level) as LodSetting; }
    void applyLevel().then(() => { state.setSelected(n); scene3d?.focus(n); });
  };
  // ---- footprint: the owner's private file on a local server, the synthetic sample in development, or a visitor's CV.
  // The machinery is built on first use; `useFootprint(null)` clears it.
  let fpData: FootprintData | null = null, fpReady: Promise<void> | null = null;
  const fpWrap = $("fp-wrap"), on = $<HTMLInputElement>("fp-on"), clear = $<HTMLButtonElement>("cv-clear");
  const panelExtra: { fn?: (n: NodeRec) => string } = {};
  const setMode = (m: FootprintMode) => {
    const c = m === "off" || !fpData ? null : compute(fpData, h(), __VIEWER__.footprint);
    if (c?.unknown.length) $("notice").textContent = "Some footprint entries name industries that are not on the map: " + c.unknown.slice(0, 3).join(", ");
    state.setFocus([]); state.setFootprint(m, c);
  };
  let hier: ReturnType<typeof hierarchy> | null = null;
  const h = () => (hier ??= hierarchy(bundle.nodes));
  const goLevel = async (level: number, auto = false) => {
    state.setLod(auto ? "auto" : String(level) as LodSetting); lod.value = (auto ? "auto" : String(level)) as LodSetting;
    await applyLevel();
  };
  const stepInto = async (n: NodeRec) => {
    const kids = touchedChildren(state, h(), n.id, n.level);
    state.setFocus([...state.focus.slice(0, n.level), n.id]);
    await goLevel(n.level + 1);
    state.setSelected(null);
    scene3d?.frameNodes(kids.length ? kids : [n.id]);
  };
  const stepTo = async (depth: number) => {
    const path = state.focus.slice(0, depth);
    state.setFocus(path); state.setSelected(null);
    if (!depth) { await goLevel(0); scene3d?.frameAll(); return; }
    await goLevel(depth);
    scene3d?.frameNodes(touchedChildren(state, h(), path[depth - 1], depth - 1));
  };
  let fpTicket = 0;
  const useFootprint = async (data: FootprintData | null, fromCv = false, sample = false) => {
    const ticket = ++fpTicket;                            // a later call (e.g. Clear) wins over one still loading
    fpData = data;
    if (!data) { setMode("off"); fpWrap.hidden = true; clear.hidden = true; return; }
    fpReady ??= (async () => {
      await ensureLevel(bundle, 2);                       // weights roll up across every level
      hier = null;
      panelExtra.fn = buildFootprintPanel(bundle, state, h(), { stepInto: (n) => void stepInto(n), stepTo: (d) => void stepTo(d), select: pick });
      on.addEventListener("change", () => setMode(on.checked ? "career" : "off"));
    })();
    await fpReady;
    if (ticket !== fpTicket) return;
    fpWrap.hidden = false; on.checked = true; clear.hidden = !fromCv; state.fpSample = sample;
    setMode("career");
    if (state.level) void stepTo(0);
  };
  const cvDialog = buildCvDialog(bundle, (fp) => void useFootprint(fp, true));
  $("cv-open").addEventListener("click", () => { void ensureLevel(bundle, 2).then(() => cvDialog.open()); });
  const initial = await loadFootprint();
  // Clear drops the CV's footprint from memory and goes back to the one the page opened with (the sample, publicly).
  clear.addEventListener("click", () => void (initial ? useFootprint(initial.data, false, initial.sample) : useFootprint(null)));
  if (initial) await useFootprint(initial.data, false, initial.sample);
  (window as unknown as { __fp: object }).__fp = { stepInto, stepTo, set: setMode, use: useFootprint, data: () => fpData };
  buildPanel(bundle, state, pick, (n) => panelExtra.fn?.(n) ?? "");
  const theme = new Toggle<ThemeChoice>("theme");          // Day / Night
  const syncTheme = () => { theme.value = effectiveTheme(); };
  onThemeChange(() => { scene3d?.applyTheme(); syncTheme(); });
  theme.onChange((v) => setTheme(v));
  syncTheme();
  const aside = document.querySelector("aside")!, showBtn = $<HTMLButtonElement>("panel-show");
  const showPanel = (on: boolean) => { aside.hidden = !on; showBtn.hidden = on; (on ? $("panel-hide") : showBtn).focus(); };
  $("panel-hide").addEventListener("click", () => showPanel(false));
  showBtn.addEventListener("click", () => showPanel(true));
  (window as unknown as { __viewer: object }).__viewer = {
    state, bundle, applyLevel, stats: () => scene3d?.stats(), bench: (n?: number) => scene3d?.benchmark(n),
    setSize: (v: SizeSetting) => { size.value = v; state.setSize(v); },
    setLod: (l: LodSetting) => { lod.value = l; state.setLod(l); return applyLevel(); },
  };
}

start().catch((err) => { $("notice").textContent = "Could not load the map data: " + String(err); });
