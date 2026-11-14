/** "Add your CV" dialog (SPEC 7.2, 7.4): choose a PDF or text file, paste text, or fill in rows by hand; the model reads
 *  the CV through the proxy and the result goes straight onto the map. "Make adjustments" reopens the rows so the
 *  visitor can change each one's industry and years. Everything lives in page memory: nothing goes to browser storage,
 *  cookies or the URL, and the text goes only to the configured endpoint. Clear CV drops the rows. */
import type { Bundle } from "./data";
import type { FootprintData } from "./footprint";
import { blankRow, checkedRows, loadLookups, pdfText, readWithModel, rulesRow, toFootprint, type Row } from "./cv";

const MAX_FILE = 5_000_000;          // bytes; a CV PDF is rarely over 1 MB
const MAX_CHARS = 24_000;            // matches the proxy's limit (server/cvRead.ts)
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Industries a row can point at: the Level 1 industries (the finest level drawn). */
export function finestIds(b: Bundle): Map<string, string> {
  return new Map(b.nodes.filter((n) => n.level === 1).map((n) => [n.id, n.label]));
}

export function buildCvDialog(b: Bundle, show: (fp: FootprintData | null) => void): { open(): void; adjust(): void; forget(): void } {
  const dlg = document.getElementById("cv") as HTMLDialogElement;
  const body = dlg.querySelector<HTMLElement>(".cv-body")!;
  const year = new Date().getFullYear();
  let rows: Row[] = [];
  let kept: Row[] = [];               // the rows behind the career on the map (page memory only), for Make adjustments
  const title = dlg.querySelector<HTMLElement>("#cv-title")!;
  const draw = (fp: FootprintData) => { kept = structuredClone(rows); show(fp); dlg.close(); };
  let names = new Map<string, string>(), byName = new Map<string, string>();
  const known = () => { if (!names.size) { names = finestIds(b); byName = new Map([...names].map(([id, l]) => [l.toLowerCase(), id])); } return names; };

  const status = (msg: string, busy = false) => {
    const el = dlg.querySelector<HTMLElement>(".cv-status")!;
    el.textContent = msg; el.classList.toggle("busy", busy);
  };

  // ---- step 1: the CV
  const start = () => {
    rows = []; title.textContent = "Add your CV";
    body.innerHTML = `
      <p class="hint">Your CV is sent to this site's reader, which asks a language model (OpenAI) to list your roles and degrees
      and suggest an industry for each. Nothing is stored, by the site or in your browser. Your career is drawn straight away; use Make adjustments in the panel to change any row.</p>
      <label class="cv-file">Choose a PDF or text file <input type="file" accept=".pdf,.txt,application/pdf,text/plain" /></label>
      <label class="cv-paste">or paste the text<textarea rows="8" maxlength="${MAX_CHARS}" placeholder="Paste your CV here"></textarea></label>
      <div class="cv-actions"><button type="button" class="primary" data-act="read">Read my CV</button>
      <button type="button" class="link" data-act="manual">Fill in by hand instead</button></div>
      <p class="cv-status" role="status"></p>
      <p class="hint cv-limits">The map is of the United States, and only a few industries have a finer third level. The result is a guess you can correct, not an assessment.</p>`;
  };

  const readText = async () => {
    const file = body.querySelector<HTMLInputElement>("input[type=file]")!.files?.[0];
    let text = body.querySelector<HTMLTextAreaElement>("textarea")!.value;
    if (file) {
      if (file.size > MAX_FILE) return status("That file is larger than 5 MB. Paste the text instead.");
      status("Reading the file…", true);
      try { text = /\.pdf$/i.test(file.name) || file.type === "application/pdf" ? await pdfText(file) : await file.text(); }
      catch { return status("Could not read that file. Paste the text instead."); }
    }
    text = text.trim();
    if (text.length < 40) return status(file ? "No text found in that file (a scanned PDF has none). Paste the text instead." : "Choose a file or paste your CV first.");
    if (text.length > MAX_CHARS) return status(`That CV is longer than ${MAX_CHARS.toLocaleString()} characters. Paste a shorter version.`);
    status("Reading your CV… this takes a few seconds.", true);
    const [L] = await Promise.all([loadLookups(), known()]);
    try {
      const entries = await readWithModel(__VIEWER__.cv.endpoint, text);
      text = "";
      rows = checkedRows(entries, L, known(), year);
      if (!rows.length) return status("No roles or degrees found. Fill them in by hand instead.");
      const fp = toFootprint(rows, year);
      if (fp.entries.length) return draw(fp);              // straight to the map; Make adjustments reopens the rows
      confirm("No industry could be suggested for these rows. Pick one for each.");
    } catch (e) {
      text = "";
      rows = [blankRow("role"), blankRow("degree")];
      confirm("The reader is unavailable right now (" + (e instanceof Error ? e.message : "error") + "). Fill in your roles and degrees; suggestions come from job-title and degree lists.");
    }
  };

  // ---- step 2: confirm
  const options = () => [...known()].map(([, l]) => `<option value="${esc(l)}"></option>`).join("");
  const rowHtml = (r: Row, i: number) => {
    const chips = r.guesses.map((g) => `<button type="button" class="chip${g.id === r.chosen ? " on" : ""}" data-pick="${esc(g.id)}" aria-pressed="${g.id === r.chosen}">${esc(names.get(g.id) ?? g.id)}</button>`).join("");
    const role = r.kind === "role";
    return `<fieldset class="cv-row" data-i="${i}"><legend>${role ? "Role" : "Degree"}</legend>
      <div class="cv-grid">
        <label>${role ? "Job title" : "Subject"}<input data-f="${role ? "title" : "subject"}" value="${esc(role ? r.title : r.subject || r.title)}" /></label>
        <label>${role ? "Employer" : "School"}<input data-f="organisation" value="${esc(r.organisation)}" /></label>
        ${role ? `<label class="yr">From<input data-f="start" inputmode="numeric" maxlength="4" value="${r.start ?? ""}" /></label>
        <label class="yr">To<input data-f="end" inputmode="numeric" maxlength="4" value="${r.current ? "" : r.end ?? ""}" ${r.current ? "disabled" : ""} /></label>
        <label class="now"><input type="checkbox" data-f="current" ${r.current ? "checked" : ""} /> now</label>` : ""}
      </div>
      <div class="cv-guess"><span class="hint">Industry:</span> ${chips || "<span class='hint'>no suggestion yet</span>"}
        <input class="cv-search" list="cv-industries" placeholder="search all industries" aria-label="Search all industries" data-f="search" /></div>
      ${r.check ? `<p class="cv-check">Check: ${esc(r.check)}</p>` : ""}
      <button type="button" class="link cv-del" data-act="del">Remove</button></fieldset>`;
  };
  const confirm = (msg = "") => {
    body.innerHTML = `<p class="hint">Check each row: pick the industry that fits best, fix the years, remove anything that should not count.</p>
      <datalist id="cv-industries">${options()}</datalist>
      <div class="cv-rows">${rows.map(rowHtml).join("")}</div>
      <div class="cv-actions"><button type="button" class="link" data-act="add-role">+ role</button><button type="button" class="link" data-act="add-degree">+ degree</button></div>
      <div class="cv-actions"><button type="button" class="primary" data-act="show">Show on map</button><button type="button" class="link" data-act="restart">Start again</button></div>
      <p class="cv-status" role="status">${esc(msg)}</p>
      <p class="hint cv-limits">The map is of the United States, and only a few industries have a finer third level. The result is a guess you can correct, not an assessment.</p>`;
  };
  const redrawRow = (i: number) => {
    const el = body.querySelector(`.cv-row[data-i="${i}"]`);
    if (el) el.outerHTML = rowHtml(rows[i], i);
  };

  body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement, act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    const rowEl = t.closest<HTMLElement>(".cv-row"), i = rowEl ? Number(rowEl.dataset.i) : -1;
    const pick = t.closest<HTMLElement>("[data-pick]")?.dataset.pick;
    if (pick && i >= 0) { rows[i].chosen = pick; redrawRow(i); return; }
    if (act === "read") void readText();
    else if (act === "manual") { void loadLookups(); known(); rows = [blankRow("role"), blankRow("degree")]; confirm(); }
    else if (act === "restart") start();
    else if (act === "del" && i >= 0) { rows.splice(i, 1); confirm(); }
    else if (act === "add-role" || act === "add-degree") { rows.push(blankRow(act === "add-role" ? "role" : "degree")); confirm(); }
    else if (act === "show") {
      const fp = toFootprint(rows, year);
      if (!fp.entries.length) return status("Pick an industry for at least one row.");
      draw(fp);
    }
  });
  const num = (v: string) => (/^\d{4}$/.test(v.trim()) ? Number(v) : null);
  body.addEventListener("change", async (e) => {
    const t = e.target as HTMLInputElement, f = t.dataset.f, rowEl = t.closest<HTMLElement>(".cv-row");
    if (!f || !rowEl) return;
    const i = Number(rowEl.dataset.i), r = rows[i];
    if (f === "search") {
      const id = byName.get(t.value.trim().toLowerCase());
      if (id) { if (!r.guesses.some((g) => g.id === id)) r.guesses.unshift({ id, confidence: 1 }); r.chosen = id; redrawRow(i); }
      return;
    }
    if (f === "title" || f === "subject") {
      r[f] = t.value;
      if (!r.chosen || r.guesses.every((g) => g.confidence < 1)) { rows[i] = rulesRow(await loadLookups(), r); redrawRow(i); }
      return;
    }
    if (f === "organisation") r.organisation = t.value;
    else if (f === "start") r.start = num(t.value);
    else if (f === "end") r.end = num(t.value);
    else if (f === "current") { r.current = t.checked; redrawRow(i); }
    const bad = r.start !== null && ((r.start > year) || (!r.current && r.end !== null && r.end < r.start));
    r.check = bad ? "the years look wrong" : null;
    if (f !== "current") redrawRow(i);
  });
  dlg.addEventListener("close", () => { rows = []; body.innerHTML = ""; });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  const manualOnly = () => { void loadLookups(); known(); rows = [blankRow("role"), blankRow("degree")];
    confirm("Fill in your roles and degrees; suggestions come from job-title and degree lists. Nothing leaves this page."); };
  const open = () => { if (__VIEWER__.cv.endpoint) start(); else manualOnly(); dlg.showModal(); };
  return {
    open,
    adjust: () => {
      if (!kept.length) return open();
      void loadLookups(); known(); rows = structuredClone(kept); title.textContent = "Make adjustments";
      confirm(); dlg.showModal();
    },
    forget: () => { kept = []; },
  };
}
