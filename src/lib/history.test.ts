import assert from "node:assert/strict";
import { test } from "node:test";
import { historyFromCache, inferScale, scaleBars, stitchByDay } from "./history";
import type { Bar } from "./types";

function bar(day: string, close: number): Bar {
  return { time: Date.parse(`${day}T12:00:00Z`) / 1000, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

function days(start: number, count: number, closeAt: (i: number) => number): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, start + i)).toISOString().slice(0, 10);
    return bar(day, closeAt(i));
  });
}

test("IG scale snaps to 100 or 10000 and rejects a moving ratio", () => {
  const free = days(5, 12, (i) => 90 + i);
  const ig = days(5, 12, (i) => (90 + i) * 100);
  assert.equal(inferScale(ig, free), 100);
  const fx = days(5, 12, (i) => 1.3 + i / 100);
  const igFx = days(5, 12, (i) => (1.3 + i / 100) * 10000);
  assert.equal(inferScale(igFx, fx), 10000);
  assert.equal(inferScale(free, free), 1);
  const drift = days(5, 12, (i) => (90 + i) * (100 + i * 5));
  assert.equal(inferScale(drift, free), null);
  assert.equal(inferScale(ig.slice(0, 4), free), null);
});

test("stitch keeps the overlay on a shared day and accepts a parsed or string cache", () => {
  const older = [bar("2020-01-02", 10), bar("2026-11-02", 20)];
  const recent = [bar("2026-11-02", 21), bar("2026-11-03", 22)];
  const joined = stitchByDay(older, scaleBars(recent, 1));
  assert.deepEqual(joined.map((b) => b.close), [10, 21, 22]);
  const scaled = scaleBars([bar("2026-11-02", 9160)], 100);
  assert.equal(scaled[0].close, 91.6);
  const blob = {
    bars: older,
    freeLabel: "Yahoo Finance",
    sourceLabel: "Yahoo Finance + IG",
    warnings: ["note"],
    units: "USD/bbl",
    continuousNote: null,
    savedAt: 1,
  };
  assert.equal(historyFromCache({ result: blob })?.sourceLabel, "Yahoo Finance + IG");
  assert.equal(historyFromCache({ result: JSON.stringify(blob) })?.bars.length, 2);
  assert.equal(historyFromCache({ result: { bars: { no: "array" } } }), null);
});
