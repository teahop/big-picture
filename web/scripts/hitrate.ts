/** Hit rates of the CV reader on the synthetic CVs (Phase 3 check). Needs the dev server running (`npm run dev`), which
 *  holds the key; this script never sees it. Usage: node scripts/hitrate.ts [port] [model ...]
 *  A hit: one of the entry's acceptable industries is the first guess / among the guesses. Rules-only = the fallback. */
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { makeLookups, rulesForDegree, rulesForTitle, type ModelEntry } from "../src/cv.ts";

const root = new URL("../src/fixtures/cvs/", import.meta.url);
const pub = new URL("../../data/public/", import.meta.url);
const [port = "5174", ...models] = process.argv.slice(2);
const expected = JSON.parse(readFileSync(new URL("expected.json", root), "utf8")) as Record<string, { kind: "role" | "degree"; match: string; ok: string[] }[]>;
const L = makeLookups(JSON.parse(readFileSync(new URL("lookup_titles.json", pub), "utf8")), JSON.parse(readFileSync(new URL("lookup_degrees.json", pub), "utf8")));

async function pdfText(name: string): Promise<string> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(new URL(name, root))) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) out.push((await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" "));
  return out.join("\n");
}

type Tally = { n: number; first: number; any: number; found: number };
const blank = (): Tally => ({ n: 0, first: 0, any: 0, found: 0 });
function score(entries: { kind: string; text: string; ids: string[] }[], cv: string, t: Record<string, Tally>) {
  for (const exp of expected[cv]) {
    const kind = exp.kind;
    const m = exp.match.toLowerCase(), same = entries.filter((x) => !x.kind || x.kind === kind);
    const e = same.find((x) => x.text.toLowerCase().trim() === m) ?? same.find((x) => x.text.toLowerCase().startsWith(m)) ?? same.find((x) => x.text.toLowerCase().includes(m));
    const k = t[kind] ??= blank(); k.n++;
    if (!e) continue;
    k.found++;
    if (exp.ok.includes(e.ids[0])) k.first++;
    if (e.ids.some((id) => exp.ok.includes(id))) k.any++;
  }
}
const line = (label: string, t: Record<string, Tally>) => console.log(label.padEnd(28) + ["role", "degree"].map((k) => {
  const x = t[k] ?? blank();
  return `${k}s: found ${x.found}/${x.n}, first ${Math.round(100 * x.first / x.n)}%, among guesses ${Math.round(100 * x.any / x.n)}%`;
}).join(" | "));

const rules: Record<string, Tally> = {};
for (const cv of Object.keys(expected).filter((k) => k !== "note")) {
  const txt = readFileSync(new URL(cv + ".txt", root), "utf8");
  // rules alone, given the titles a visitor would type
  score(expected[cv].map((e) => ({ kind: "", text: e.match, ids: (e.kind === "degree" ? rulesForDegree(L, e.match.replace(/^(Bachelor|Master) of (Science|Arts|Public)?\s*(in\s+)?/i, "")) : rulesForTitle(L, e.match)).slice(0, 3).map((g) => g.id) })), cv, rules);
  void txt;
}
line("rules only (typed titles)", rules);

for (const model of models.length ? models : ["gpt-6.1-sol"]) {
  for (const src of ["txt", "pdf"]) {
    const t: Record<string, Tally> = {}; let ms = 0;
    for (const cv of Object.keys(expected).filter((k) => k !== "note")) {
      const text = src === "txt" ? readFileSync(new URL(cv + ".txt", root), "utf8") : await pdfText(cv + ".pdf");
      const t0 = Date.now();
      const res = await fetch(`http://localhost:${port}/api/cv?model=${model}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      ms += Date.now() - t0;
      const body = await res.json() as { entries?: ModelEntry[]; error?: string };
      if (!body.entries) { console.log(model, src, cv, "error:", body.error); continue; }
      score(body.entries.map((e) => ({ kind: e.kind, text: e.title + " " + (e.subject ?? ""), ids: e.guesses.map((g) => g.id) })), cv, t);
    }
    line(`${model} (${src}, ${(ms / 3000).toFixed(1)}s/CV)`, t);
  }
}
