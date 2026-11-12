// Run with `npm test`. The CV logic on tiny synthetic lookups (no real people, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankRow, checkedRows, makeLookups, rulesForDegree, rulesForTitle, toFootprint, type ModelEntry, type Row } from "./cv.ts";

const L = makeLookups(
  { socs: ["29-1141", "15-1252"], soc_titles: ["Registered Nurses", "Software Developers"],
    industries: [[["ind:hosp", 0.7], ["ind:home", 0.3]], [["ind:soft", 0.8], ["ind:cons", 0.2]]],
    titles: [["registered nurse", [0]], ["staff nurse", [0]], ["software engineer", [1]], ["software developer", [1]]] },
  { programmes: [["nursing", "51.38", [["ind:hosp", 1]]], ["computer science", "11.07", [["ind:soft", 0.6], ["ind:cons", 0.4]]]] },
);
const known = new Set(["ind:hosp", "ind:home", "ind:soft", "ind:cons"]);
const entry = (e: Partial<ModelEntry>): ModelEntry => ({ kind: "role", title: "", organisation: "Example Co", subject: null, start_year: 2015, end_year: 2020, current: false, guesses: [], ...e });

test("rules map exact and partial titles to industries", () => {
  assert.equal(rulesForTitle(L, "Registered Nurse")[0].id, "ind:hosp");
  assert.equal(rulesForTitle(L, "Senior Software Engineer II")[0].id, "ind:soft");
  assert.deepEqual(rulesForTitle(L, ""), []);
  assert.equal(rulesForDegree(L, "BSc Computer Science")[0].id, "ind:soft");
});

test("checked rows keep only known model ids, fill from the rules, and flag disagreement", () => {
  const [r] = checkedRows([entry({ title: "Software Engineer", guesses: [{ id: "ind:bogus", confidence: 0.9 }, { id: "ind:hosp", confidence: 0.5 }] })], L, known, 2026);
  assert.equal(r.guesses[0].id, "ind:hosp");                 // the unknown id is dropped
  assert.ok(r.guesses.some((g) => g.id === "ind:soft"));      // the rules add theirs
  assert.match(r.check ?? "", /title points elsewhere/);
  assert.equal(r.chosen, "ind:hosp");
});

test("impossible years are cleared and noted; current roles have no end", () => {
  const [a, b] = checkedRows([entry({ start_year: 2031, guesses: [{ id: "ind:soft", confidence: 1 }], title: "Software Engineer" }),
                              entry({ start_year: 2018, end_year: 2016, current: true, title: "Software Engineer", guesses: [{ id: "ind:soft", confidence: 1 }] })], L, known, 2026);
  assert.equal(a.start, null); assert.match(a.check ?? "", /start year/);
  assert.equal(b.end, null); assert.equal(b.check, null);
});

test("toFootprint turns confirmed rows into SPEC 6.1 entries", () => {
  const rows: Row[] = [
    { ...blankRow("role"), title: "Nurse", organisation: "Example Hospital", start: 2018, end: null, current: true, chosen: "ind:hosp" },
    { ...blankRow("role"), title: "Developer", start: 2010, end: 2018, chosen: "ind:soft" },
    { ...blankRow("degree"), subject: "Computer Science", organisation: "Example University", chosen: "ind:soft" },
    { ...blankRow("role"), title: "Unpicked" },
  ];
  const fp = toFootprint(rows, 2026);
  assert.equal(fp.entries.length, 3);
  assert.deepEqual(fp.entries[0], { kind: "role", label: "Nurse, Example Hospital", years: 8.5, end_year: 2026, nodes: { "ind:hosp": 1 } });
  assert.equal(fp.entries[1].years, 8);
  assert.deepEqual(fp.entries[2], { kind: "degree", label: "Computer Science, Example University", nodes: { "ind:soft": 1 } });
});
