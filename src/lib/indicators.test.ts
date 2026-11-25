import assert from "node:assert/strict";
import { test } from "node:test";
import { enrich, lastSma } from "./indicators";
import type { Bar } from "./types";

function bars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    time: 1_700_000_000 + i * 86400,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + i,
  }));
}

test("SMA and Bollinger population stdev", () => {
  const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = enrich(bars(closes));
  const last = out[out.length - 1];
  assert.equal(lastSma(closes, 3), 9);
  assert.equal(last.sma20, null);
  const three = enrich(bars([2, 2, 2, 2, 2]));
  assert.equal(three[4].sma20, null);
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
  const e = enrich(bars(twenty));
  const mean = (20 * 21) / 2 / 20;
  assert.equal(e[19].sma20, mean);
  assert.equal(e[19].bbMid, mean);
  let ss = 0;
  for (const v of twenty) ss += (v - mean) ** 2;
  const std = Math.sqrt(ss / 20);
  assert.ok(Math.abs((e[19].bbUpper ?? 0) - (mean + 2 * std)) < 1e-6);
  assert.ok(Math.abs((e[19].bbLower ?? 0) - (mean - 2 * std)) < 1e-6);
});

test("rising closes push RSI up and ATR is finite", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
  const e = enrich(bars(closes));
  const last = e[e.length - 1];
  assert.ok((last.rsi14 ?? 0) > 90);
  assert.ok((last.atr14 ?? 0) > 0);
  assert.ok((last.stochK ?? 0) > 80);
  assert.ok(last.macd != null && last.macd > 0);
});

test("flat market has null stochastic when the range is zero", () => {
  const flat: Bar[] = Array.from({ length: 30 }, (_, i) => ({
    time: i,
    open: 5,
    high: 5,
    low: 5,
    close: 5,
    volume: 1,
  }));
  const e = enrich(flat);
  assert.equal(e[e.length - 1].stochK, null);
  assert.equal(e[e.length - 1].rsi14, 100);
});
