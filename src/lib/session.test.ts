import assert from "node:assert/strict";
import { test } from "node:test";
import { fibLevels, riskReward } from "./drawings";
import { curveSpreads, trimCurve } from "./curveMath";
import { businessDaysBetween, fxSessionReference, isStaleQuote, londonParts } from "./time";
import type { CurvePoint } from "./types";

test("22:00 UK FX reference uses the 21:00 bar close", () => {
  const bars = [];
  for (let h = 0; h < 48; h++) {
    const time = Date.parse("2026-11-24T00:00:00Z") / 1000 + h * 3600;
    bars.push({ time, close: h === 21 ? 1.31154 : 1.3 });
  }
  const ref = fxSessionReference(bars, new Date("2026-11-25T10:00:00Z"));
  assert.ok(ref);
  assert.equal(ref?.close, 1.31154);
  assert.equal(ref?.time, Date.parse("2026-11-24T22:00:00Z") / 1000);
});

test("London hour in summer is BST", () => {
  const p = londonParts(new Date("2026-07-15T20:00:00Z"));
  assert.equal(p.hour, 21);
  assert.equal(p.ymd, "2026-07-15");
});

test("staleness counts London business days", () => {
  const friday = Date.parse("2026-11-20T16:00:00Z") / 1000;
  assert.equal(isStaleQuote(friday, new Date("2026-11-23T10:00:00Z")), false);
  assert.equal(isStaleQuote(friday, new Date("2026-11-25T10:00:00Z")), true);
  assert.equal(businessDaysBetween("2026-11-20", "2026-11-23"), 1);
});

test("fib retracement and risk/reward", () => {
  const levels = fibLevels(100, 80);
  assert.equal(levels.find((l) => l.ratio === 0)?.price, 80);
  assert.equal(levels.find((l) => l.ratio === 1)?.price, 100);
  assert.ok(Math.abs((levels.find((l) => l.ratio === 0.618)?.price ?? 0) - 92.36) < 1e-9);
  const rr = riskReward({ entryLow: 88, entryHigh: 90, stop: 92, t1: 86, t2: 84 });
  assert.ok(rr);
  assert.equal(rr?.mid, 89);
  assert.equal(rr?.risk, 3);
  assert.ok(Math.abs((rr?.rr1 ?? 0) - 1) < 1e-9);
  assert.ok(Math.abs((rr?.rr2 ?? 0) - 5 / 3) < 1e-9);
  assert.equal(riskReward({ entryLow: 1, entryHigh: 1, stop: 1, t1: 2, t2: null }), null);
});

test("curve gaps are not skipped when naming M6", () => {
  const points: CurvePoint[] = [
    { ticker: "A", contract: "Jan 2027", month: "2027-01", price: 10, priceTimeUnix: 1, week: null, weekTimeUnix: null, monthAgo: null, monthAgoTimeUnix: null },
    { ticker: "B", contract: "Feb 2027", month: "2027-02", price: null, priceTimeUnix: null, week: null, weekTimeUnix: null, monthAgo: null, monthAgoTimeUnix: null },
    { ticker: "C", contract: "Mar 2027", month: "2027-03", price: 8, priceTimeUnix: 1, week: null, weekTimeUnix: null, monthAgo: null, monthAgoTimeUnix: null },
  ];
  const spreads = curveSpreads(points);
  const m2 = spreads.find((s) => s.label === "M1–M2");
  assert.equal(m2?.value, null);
  assert.equal(m2?.to, "Feb 2027");
  const trimmed = trimCurve([
    { price: null, week: null, monthAgo: null },
    { price: 1, week: null, monthAgo: null },
    { price: null, week: null, monthAgo: null },
    { price: 2, week: null, monthAgo: null },
    { price: null, week: null, monthAgo: null },
  ]);
  assert.equal(trimmed.length, 3);
  assert.equal(trimmed[1].price, null);
});
