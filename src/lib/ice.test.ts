import assert from "node:assert/strict";
import { test } from "node:test";
import { enrich } from "./indicators";
import { approxHourCandles, closeBar, isNearExpiry, parseIceGmt, parseIceStamp, stripLabel, stripMonthKey, weeklyCloses } from "./iceBars";

test("ICE stamps are London wall time, including British Summer Time", () => {
  assert.equal(parseIceStamp("Wed Nov 25 09:30:00 2026"), Date.parse("2026-11-25T09:30:00Z") / 1000);
  assert.equal(parseIceStamp("Wed Jul 01 09:30:00 2026"), Date.parse("2026-07-01T08:30:00Z") / 1000);
  assert.equal(parseIceGmt("11/25/2026 04:52 PM GMT"), Date.parse("2026-11-25T16:52:00Z") / 1000);
});

test("Dec26 is near expiry on 25 Nov 2026 and Mar27 and Jan27 are not", () => {
  const at = new Date("2026-11-25T17:07:00Z");
  assert.equal(isNearExpiry("Dec26", at), true);
  assert.equal(isNearExpiry("Jan27", at), false);
  assert.equal(isNearExpiry("Mar27", at), false);
  assert.equal(isNearExpiry("May27", at), false);
});

test("Dec26 is the December 2026 strip", () => {
  assert.equal(stripLabel("Dec26"), "Dec 2026");
  assert.equal(stripMonthKey("Dec26"), "2026-12");
  assert.equal(stripLabel("Mar27"), "Mar 2027");
});

test("hourly candles use the 10-minute close range and are labelled by that construction", () => {
  const hour = Date.parse("2026-11-25T09:00:00Z") / 1000;
  const bars = approxHourCandles([
    { time: hour + 30 * 60, price: 4000 },
    { time: hour + 40 * 60, price: 3980 },
    { time: hour + 50 * 60, price: 4010 },
    { time: hour + 3600 + 10 * 60, price: 4020 },
  ]);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].open, 4000);
  assert.equal(bars[0].high, 4010);
  assert.equal(bars[0].low, 3980);
  assert.equal(bars[0].close, 4010);
  assert.equal(bars[1].open, 4020);
  assert.equal(bars[1].high, 4020);
  assert.equal(bars[1].low, 4020);
});

test("close-only bars do not invent a stochastic or ATR", () => {
  const start = Date.parse("2026-01-01T00:00:00Z") / 1000;
  const bars = Array.from({ length: 30 }, (_, i) => closeBar(start + i * 86400, 4000 + i));
  const enriched = enrich(bars, { closeOnly: true });
  assert.ok(enriched.at(-1)?.sma20 != null);
  assert.ok(enriched.at(-1)?.rsi14 != null);
  assert.equal(enriched.at(-1)?.atr14, null);
  assert.equal(enriched.at(-1)?.stochK, null);
  assert.equal(enriched.at(-1)?.tenkan, null);
});

test("weekly points keep the last close of the London week", () => {
  const mon = parseIceStamp("Mon Nov 23 00:00:00 2026")!;
  const tue = parseIceStamp("Tue Nov 24 00:00:00 2026")!;
  const next = parseIceStamp("Mon Nov 30 00:00:00 2026")!;
  const bars = weeklyCloses([closeBar(mon, 3975), closeBar(tue, 4008), closeBar(next, 4030)]);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].close, 4008);
  assert.equal(bars[0].high, 4008);
  assert.equal(bars[1].close, 4030);
});
