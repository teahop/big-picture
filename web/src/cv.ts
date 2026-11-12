/** "Add your CV" logic (SPEC 7): text from a PDF or paste, the model's reading through the proxy, deterministic rules that
 *  cross-check it (and stand in when the proxy is unavailable), and the confirmed rows turned into a footprint.
 *  Nothing here writes to browser storage or the URL; the CV text goes only to the configured endpoint. */
import type { Entry, FootprintData } from "./footprint";

export interface Guess { id: string; confidence: number }
export interface Row {
  kind: "role" | "degree"; title: string; organisation: string; subject: string;
  start: number | null; end: number | null; current: boolean;
  guesses: Guess[];          // offered guesses, best first (model, then rules)
  chosen: string | null;     // the industry the visitor accepted
  check: string | null;      // a note when the rules disagree with the model or a date looks wrong
}
export interface ModelEntry {
  kind: "role" | "degree"; title: string; organisation: string; subject: string | null;
  start_year: number | null; end_year: number | null; current: boolean; guesses: Guess[];
}

// ---------------------------------------------------------------- text
/** Plain text from a PDF, extracted in the page (pdf.js is loaded only when the CV flow needs it). */
export async function pdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    let line = "", lastY: number | null = null;
    const lines: string[] = [];
    for (const item of content.items as { str?: string; transform?: number[] }[]) {
      if (item.str === undefined) continue;
      const y = item.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line.trim()); line = ""; }
      line += item.str + " "; lastY = y;
    }
    lines.push(line.trim());
    pages.push(lines.filter(Boolean).join("\n"));
  }
  await task.destroy();
  return pages.join("\n\n");
}

// ---------------------------------------------------------------- rules
export interface TitleLookup { socs: string[]; soc_titles: string[]; industries: [string, number][][]; titles: [string, number[]][] }
export interface DegreeLookup { programmes: [string, string, [string, number][]][] }
export interface Lookups { titles: TitleLookup; degrees: DegreeLookup; titleIndex: Map<string, number[]>; tokenIdf: Map<string, number> }

/** Index the two lookup files for the rules (pure, so tests and scripts can use it without a browser). */
export function makeLookups(titles: TitleLookup, degrees: DegreeLookup): Lookups {
  const titleIndex = new Map(titles.titles.map(([t, s]) => [t, s]));
  const df = new Map<string, number>();
  for (const [t] of titles.titles) for (const w of new Set(t.split(" "))) df.set(w, (df.get(w) ?? 0) + 1);
  const n = titles.titles.length, tokenIdf = new Map([...df].map(([w, c]) => [w, Math.log(n / c)]));
  return { titles, degrees, titleIndex, tokenIdf };
}

let lookups: Promise<Lookups> | null = null;
/** The rules' lookup files, fetched from the site itself the first time the CV flow opens. */
export function loadLookups(): Promise<Lookups> {
  lookups ??= Promise.all([
    fetch("lookup_titles.json").then((r) => r.json() as Promise<TitleLookup>),
    fetch("lookup_degrees.json").then((r) => r.json() as Promise<DegreeLookup>),
  ]).then(([t, d]) => makeLookups(t, d));
  lookups.catch(() => { lookups = null; });
  return lookups;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Industries the rules suggest for a job title: the closest O*NET titles by weighted word overlap, then the industries
 *  that employ those occupations (Employment Matrix shares). */
export function rulesForTitle(L: Lookups, title: string, top = 6): Guess[] {
  const q = norm(title);
  if (!q) return [];
  const exact = L.titleIndex.get(q);
  let socs: number[] = exact ?? [];
  if (!socs.length) {
    const words = new Set(q.split(" ").filter((w) => w.length > 1));
    const score = new Map<number, number>();
    for (const [t, ss] of L.titles.titles) {
      let s = 0; const tw = t.split(" ");
      for (const w of tw) if (words.has(w)) s += L.tokenIdf.get(w) ?? 0;
      if (s <= 0) continue;
      s /= Math.sqrt(tw.length);
      for (const i of ss) if (s > (score.get(i) ?? 0)) score.set(i, s);
    }
    socs = [...score].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i]) => i);
  }
  return combine(socs.map((i, k) => [L.titles.industries[i], 1 / (k + 1)] as [[string, number][], number]), top);
}

/** Industries the rules suggest for a degree subject: the closest CIP programme titles, then where graduates work. */
export function rulesForDegree(L: Lookups, subject: string, top = 6): Guess[] {
  const words = new Set(norm(subject).split(" ").filter((w) => w.length > 2 && !["and", "the", "for", "science", "arts", "studies", "general"].includes(w)));
  if (!words.size) return [];
  const scored = L.degrees.programmes.map(([t, , ind]) => {
    const tw = t.split(" "); let s = 0;
    for (const w of tw) if (words.has(w)) s += 1;
    return [s / Math.sqrt(tw.length), ind] as [number, [string, number][]];
  }).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 3);
  return combine(scored.map(([s, ind]) => [ind, s] as [[string, number][], number]), top);
}

function combine(parts: [[string, number][], number][], top: number): Guess[] {
  const acc = new Map<string, number>();
  for (const [ind, w] of parts) for (const [id, share] of ind) acc.set(id, (acc.get(id) ?? 0) + share * w);
  const total = [...acc.values()].reduce((a, b) => a + b, 0) || 1;
  return [...acc].sort((a, b) => b[1] - a[1]).slice(0, top).map(([id, v]) => ({ id, confidence: Math.round((v / total) * 100) / 100 }));
}

// ---------------------------------------------------------------- reading
/** Ask the proxy to read the CV. Throws when it is unavailable, so the caller can fall back to the rules. */
export async function readWithModel(endpoint: string, text: string): Promise<ModelEntry[]> {
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), cache: "no-store" });
  const body = await res.json().catch(() => ({})) as { entries?: ModelEntry[]; error?: string };
  if (!res.ok || !body.entries) throw new Error(body.error ?? "The CV reader is unavailable (" + res.status + ")");
  return body.entries;
}

/** Rows for the confirm screen: the model's entries, each checked against the rules and the calendar. */
export function checkedRows(entries: ModelEntry[], L: Lookups, known: { has(id: string): boolean }, year: number): Row[] {
  return entries.map((e) => {
    const model = e.guesses.filter((g) => known.has(g.id)).slice(0, 3);
    const rules = e.kind === "role" ? rulesForTitle(L, e.title) : rulesForDegree(L, e.subject ?? e.title);
    const notes: string[] = [];
    let start = e.start_year, end = e.current ? null : e.end_year;
    if (start !== null && (start < 1950 || start > year)) { notes.push("start year looks wrong"); start = null; }
    if (end !== null && (end > year || (start !== null && end < start))) { notes.push("end year looks wrong"); end = null; }
    if (e.kind === "role" && model.length && rules.length && !rules.some((r) => r.id === model[0].id)) notes.push("the title points elsewhere too");
    const guesses = [...model];
    for (const r of rules) if (guesses.length < 3 && !guesses.some((g) => g.id === r.id)) guesses.push(r);
    return { kind: e.kind, title: e.title, organisation: e.organisation, subject: e.subject ?? "", start, end, current: e.current,
             guesses, chosen: guesses[0]?.id ?? null, check: notes.length ? notes.join("; ") : null };
  });
}

/** Rows from the rules alone (the proxy is off or the visitor prefers): one blank role and degree to fill in by hand,
 *  or rows that already carry a title or subject. */
export function rulesRow(L: Lookups, row: Row): Row {
  const g = row.kind === "role" ? rulesForTitle(L, row.title, 3) : rulesForDegree(L, row.subject || row.title, 3);
  return { ...row, guesses: g, chosen: row.chosen && g.some((x) => x.id === row.chosen) ? row.chosen : g[0]?.id ?? row.chosen };
}

export const blankRow = (kind: "role" | "degree"): Row =>
  ({ kind, title: "", organisation: "", subject: "", start: null, end: null, current: false, guesses: [], chosen: null, check: null });

// ---------------------------------------------------------------- footprint
/** The confirmed rows as a footprint (SPEC 6.1). Roles without a start year count one year; ongoing roles end now. */
export function toFootprint(rows: Row[], year: number): FootprintData {
  const entries: Entry[] = [];
  for (const r of rows) {
    if (!r.chosen) continue;
    const label = [r.title || r.subject, r.organisation].filter(Boolean).join(", ") || (r.kind === "role" ? "Role" : "Degree");
    if (r.kind === "degree") { entries.push({ kind: "degree", label, nodes: { [r.chosen]: 1 } }); continue; }
    const end = r.current || r.end === null ? year : r.end;
    const years = r.start === null ? 1 : Math.max(0.25, end - r.start + (r.current ? 0.5 : 0));
    entries.push({ kind: "role", label, years, end_year: end, nodes: { [r.chosen]: 1 } });
  }
  return { schema: 1, as_of: year + 0.5, entries };
}
