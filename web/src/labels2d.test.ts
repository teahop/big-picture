// Run with `npm test`. The 2D label placer on the real Level 1 bundle at three zoom levels: no two labels overlap, and
// career industries are always placed when their summit is on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { logTicks, mapLines, niceTicks, overlapFree, placeLabels, type LabelItem } from "./labels2d.ts";

type N = { id: string; label: string; size: { employment: number }; xy_by?: { activity: [number, number] }; xy: [number, number] };
const nodes = JSON.parse(readFileSync(new URL("../../data/public/nodes_l1.json", import.meta.url), "utf8")) as N[];
const VIEW = { w: 1100, h: 800 };
const CAREER = new Set(nodes.slice().sort((a, b) => b.size.employment - a.size.employment).filter((_, i) => i % 37 === 5).slice(0, 4).map((n) => n.id));

function items(zoom: number): LabelItem[] {
  const px = (VIEW.h / 2.4) * zoom;                     // layout units -> pixels (the map spans about 2.4 units at zoom 1)
  return nodes.map((n) => {
    const [x, y] = n.xy_by?.activity ?? n.xy, lines = mapLines(n.label);
    return { id: n.id, x: VIEW.w / 2 + x * px, y: VIEW.h / 2 + y * px, w: Math.max(...lines.map((l) => l.length)) * 6.6 + 8, h: lines.length * 13 + 4,
             priority: (CAREER.has(n.id) ? 1e9 : 0) + n.size.employment };
  });
}

for (const zoom of [1, 2.5, 6]) {
  test(`labels never overlap and career labels are placed (zoom ${zoom})`, () => {
    const its = items(zoom), placed = placeLabels(its, VIEW);
    assert.ok(overlapFree(placed));
    const ids = new Set(placed.map((p) => p.id));
    for (const it of its) if (CAREER.has(it.id) && it.x > it.w && it.x < VIEW.w - it.w && it.y > it.h && it.y < VIEW.h - it.h) assert.ok(ids.has(it.id), it.id);
    console.log(`zoom ${zoom}: ${placed.length} of ${its.length} labels shown`);
  });
}

test("zooming in names a larger share of the hills on screen", () => {
  const share = (z: number) => {
    const its = items(z), on = its.filter((it) => it.x >= 0 && it.x <= VIEW.w && it.y >= 0 && it.y <= VIEW.h);
    return placeLabels(its, VIEW).length / on.length;
  };
  assert.ok(share(6) > share(2.5) && share(2.5) > share(1));
});

test("long names wrap to two even lines and very long ones are shortened", () => {
  assert.deepEqual(mapLines("Hospitals"), ["Hospitals"]);
  assert.deepEqual(mapLines("General medical and surgical hospitals"), ["General medical and", "surgical hospitals"]);
  assert.ok(mapLines("x ".repeat(60)).every((l) => l.length <= 26));
});

test("ticks are round and inside the range", () => {
  assert.deepEqual(niceTicks(-10.96, 14.01, 4), [-10, -5, 0, 5, 10]);
  assert.deepEqual(logTicks(11.2, 7661.9), [30, 100, 300, 1000, 3000]);
});
