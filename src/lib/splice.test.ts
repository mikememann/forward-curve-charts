import assert from "node:assert/strict";
import { test } from "node:test";
import { averageStates, parseEuroPrice, rateOnOrBefore, scaleBars, SHORT_TON_TO_TONNE, spliceSeries, stepMonthly, toUsd } from "./splice";
import type { Bar } from "./types";

function bar(day: string, close: number): Bar {
  return { time: Date.parse(`${day}T12:00:00Z`) / 1000, open: close, high: close, low: close, close, volume: 0 };
}

test("euro prices and a short ton convert without inventing a level", () => {
  assert.equal(parseEuroPrice("€1452.09"), 1452.09);
  assert.equal(parseEuroPrice("1.103,54"), 1103.54);
  assert.equal(Math.round(775 * SHORT_TON_TO_TONNE * 100) / 100, 854.29);
  const scaled = scaleBars([bar("2019-07-09", 775)], SHORT_TON_TO_TONNE);
  assert.equal(Math.round(scaled[0].close * 100) / 100, 854.29);
});

test("a week averages the states that published and ignores a missing one", () => {
  const t = Date.parse("2024-01-08T12:00:00Z") / 1000;
  const weeks = averageStates([
    { state: "RO", time: t, price: 1000 },
    { state: "PL", time: t, price: 1100 },
    { state: "PL", time: t, price: 1200 },
  ]);
  assert.equal(weeks.length, 1);
  assert.deepEqual(weeks[0].states, ["PL", "RO"]);
  assert.equal(weeks[0].close, (1150 + 1000) / 2);
});

test("the splice keeps both levels and steps the monthly history", () => {
  const monthly = [bar("2020-01-01", 800), bar("2020-02-01", 900)];
  const recent = [bar("2021-03-08", 1200), bar("2021-03-15", 1210)];
  const joined = spliceSeries(monthly, recent);
  assert.equal(joined.spliceTime, recent[0].time);
  assert.equal(joined.monthlyClose, 900);
  assert.equal(joined.recentClose, 1200);
  assert.ok(joined.gap != null && Math.abs(joined.gap - (1200 - 900) / 900) < 1e-9);
  assert.equal(joined.bars.at(-1)?.close, 1210);
  assert.equal(joined.bars[0].close, 800);
  const hold = joined.bars.find((b) => b.time !== monthly[0].time && b.close === 800);
  assert.ok(hold);
  const fx = [bar("2021-03-05", 1.1), bar("2021-03-20", 1.2)];
  const usd = toUsd([{ time: recent[0].time, close: 1000, states: ["PL"] }], fx);
  assert.equal(usd[0].close, 1100);
  assert.equal(rateOnOrBefore(fx, Date.parse("2021-03-01T12:00:00Z") / 1000), null);
  assert.equal(stepMonthly([]).length, 0);
});
