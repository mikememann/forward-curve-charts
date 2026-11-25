import assert from "node:assert/strict";
import { test } from "node:test";
import { igMid, mergeBars, parseIgPrices } from "./igParse";

test("OHLC is the mid of bid and ask", () => {
  assert.equal(igMid({ bid: 9047.5, ask: 9048.5, lastTraded: null }), 9048);
  assert.equal(igMid({ bid: null, ask: null, lastTraded: 4201 }), 4201);
  const parsed = parseIgPrices({
    prices: [
      {
        snapshotTime: "2026/11/23 05:00:00",
        snapshotTimeUTC: "2026-11-23T05:00:00",
        openPrice: { bid: 100, ask: 102, lastTraded: null },
        highPrice: { bid: 110, ask: 112, lastTraded: null },
        lowPrice: { bid: 90, ask: 92, lastTraded: null },
        closePrice: { bid: 104, ask: 106, lastTraded: null },
        lastTradedVolume: 12,
      },
    ],
    metadata: { allowance: { remainingAllowance: 9800, totalAllowance: 10000, allowanceExpiry: 604800 } },
  });
  assert.equal(parsed.bars[0].open, 101);
  assert.equal(parsed.bars[0].high, 111);
  assert.equal(parsed.bars[0].low, 91);
  assert.equal(parsed.bars[0].close, 105);
  assert.equal(parsed.bars[0].time, Date.parse("2026-11-23T05:00:00Z") / 1000);
  assert.equal(parsed.allowance?.remainingAllowance, 9800);
});

test("merging bars replaces the same timestamp and keeps older history", () => {
  const older = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 }];
  const newer = [
    { time: 1, open: 2, high: 2, low: 2, close: 2, volume: 0 },
    { time: 2, open: 3, high: 3, low: 3, close: 3, volume: 0 },
  ];
  const merged = mergeBars(older, newer);
  assert.deepEqual(merged.map((b) => b.close), [2, 3]);
});
