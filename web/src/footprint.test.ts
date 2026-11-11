// Run with `npm test`. Same tiny hierarchy and expected numbers as pipeline/tests/test_footprint.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compute, descends, entriesAt, entryWeight, hierarchy, rollUp, touched, type FootprintData } from "./footprint.ts";

const CFG = { half_life_years: 8, degree_years: 2, touched_threshold: 0.03 };
const H = hierarchy([
  { id: "ind:S", level: 0, parent: null }, { id: "ind:T", level: 0, parent: null },
  { id: "ind:s1", level: 1, parent: "ind:S" }, { id: "ind:s2", level: 1, parent: "ind:S" }, { id: "ind:t1", level: 1, parent: "ind:T" },
  { id: "deep:d", level: 2, parent: "ind:s2", replaces_share: { "ind:s2": 0.25, "ind:t1": 0.75 } },
]);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b);

test("recency halves every half-life; degrees do not decay", () => {
  const role = (end: number) => ({ kind: "role" as const, label: "x", years: 2, end_year: end, nodes: { "ind:s1": 1 } });
  close(entryWeight(role(2026), 2026, CFG), 2); close(entryWeight(role(2018), 2026, CFG), 1); close(entryWeight(role(2010), 2026, CFG), 0.5);
  assert.equal(entryWeight({ kind: "degree", label: "d", nodes: { "ind:s1": 1 } }, 2026, CFG), 2);
});

test("weights roll up; every level holds the same total", () => {
  const { levels: [l0, l1, l2] } = rollUp(new Map([["ind:s1", 2], ["deep:d", 2]]), H);
  close(l1.get("ind:s2")!, 0.5); close(l1.get("ind:t1")!, 1.5); close(l0.get("ind:S")!, 2.5); close(l0.get("ind:T")!, 1.5);
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  close(sum(l0), sum(l2)); close(sum(l1), sum(l2));
});

test("threshold drops stray shares", () => {
  assert.deepEqual([...touched(new Map([["a", 9], ["b", 0.9], ["c", 0.1]]), 0.03).keys()], ["a", "b"]);
  assert.equal(touched(new Map(), 0.03).size, 0);
});

test("entries behind a node and ancestry", () => {
  const fp: FootprintData = { schema: 1, as_of: 2026, entries: [
    { kind: "role", label: "A", years: 3, end_year: 2026, nodes: { "ind:s1": 1 } },
    { kind: "degree", label: "B", nodes: { "deep:d": 1 } }] };
  const c = compute(fp, H, CFG);
  const why = entriesAt(c, "ind:S", 0);
  assert.equal(why[0].entry.label, "A"); close(why[0].share, 3 / 3.5); close(why[1].share, 0.5 / 3.5);
  assert.ok(descends(H, "deep:d", "ind:T") && !descends(H, "ind:s1", "ind:T"));
});

test("synthetic footprint is well formed", () => {
  const f = JSON.parse(readFileSync(new URL("./fixtures/synthetic_footprint.json", import.meta.url), "utf8")) as FootprintData;
  for (const e of f.entries) close(Object.values(e.nodes).reduce((a, b) => a + b, 0), 1);
});

import { SPECIES, bloomCells, flowers } from "./footprintLayer.ts";

test("a hill blooms over its share of the career, in drifts that follow the species mix", () => {
  const n = 40, owner = new Int32Array(n * n).fill(-1);
  for (let k = 0; k < n * n; k++) owner[k] = k % n < 20 ? 0 : 1;        // two hills of 800 cells each
  const cells = bloomCells({ owner, ids: ["a", "b"] }, new Map([["a", 0.27], ["b", 0.05]]), n);
  const count = (idx: number) => [...cells.values()].filter((v) => v === idx).length;
  assert.equal(count(0), Math.round(800 * 0.27)); assert.equal(count(1), 40);
  const fl = flowers(cells, n);
  assert.equal(fl.length, cells.size * 6);
  const poppies = fl.filter((f) => f[2] === 0).length / fl.length;
  assert.ok(Math.abs(poppies - SPECIES[0].weight) < 0.2, "poppy share " + poppies);
  assert.deepEqual(flowers(cells, n).slice(0, 5), fl.slice(0, 5));     // deterministic
});
