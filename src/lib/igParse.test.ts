import assert from "node:assert/strict";
import { test } from "node:test";
import { allowanceFromCache, barsFromCache, extraPageNumbers, igMid, mergeBars, pageQuery, parseIgPrices, priceQuery, sessionFromCache } from "./igParse";

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

function day(iso: string, close: number) {
  return {
    snapshotTimeUTC: `${iso}T00:00:00`,
    openPrice: { bid: close, ask: close, lastTraded: null },
    highPrice: { bid: close, ask: close, lastTraded: null },
    lowPrice: { bid: close, ask: close, lastTraded: null },
    closePrice: { bid: close, ask: close, lastTraded: null },
    lastTradedVolume: 1,
  };
}

test("a paged DAY history keeps the newest page, for MINUTE_15 and HOUR too", () => {
  for (const resolution of ["DAY", "MINUTE_15", "HOUR"]) {
    const query = priceQuery(resolution, 20);
    assert.equal(query.get("pageSize"), "0");
    assert.equal(query.get("max"), "20");
    assert.equal(query.get("resolution"), resolution);
  }
  const older = Array.from({ length: 20 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`, 100 + i));
  const newer = ["2026-11-21", "2026-11-24", "2026-11-25", "2026-11-26"].map((iso, i) => day(iso, 200 + i));
  const page1 = parseIgPrices({
    prices: older,
    metadata: { pageData: { pageNumber: 1, pageSize: 20, totalPages: 2 }, allowance: { remainingAllowance: 9000, totalAllowance: 10000, allowanceExpiry: 100 } },
  });
  assert.deepEqual(extraPageNumbers({ pageNumber: 1, pageSize: 20, totalPages: 2 }), [2]);
  assert.deepEqual(extraPageNumbers({ pageNumber: 1, pageSize: 0, totalPages: 1 }), []);
  const follow = pageQuery("DAY", 20, 2, 20);
  assert.equal(follow.get("pageNumber"), "2");
  assert.equal(follow.get("pageSize"), "20");
  const page2 = parseIgPrices({ prices: newer, metadata: { pageData: { pageNumber: 2, pageSize: 20, totalPages: 2 } } });
  const newest = mergeBars(page1.bars, page2.bars).slice(-20);
  assert.equal(newest.length, 20);
  assert.equal(newest.at(-1)?.time, Date.parse("2026-11-26T00:00:00Z") / 1000);
  assert.ok(newest.every((bar, i) => i === 0 || bar.time > newest[i - 1].time));
  assert.equal(page1.bars.at(-1)?.time, Date.parse("2026-10-20T00:00:00Z") / 1000);
});

const sample = [{ time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11, volume: 4 }];

test("KV cache accepts a JSON string or an already-parsed value, and rejects anything else", () => {
  const asString = { result: JSON.stringify(sample) };
  const asParsed = { result: sample };
  const doubleEncoded = { result: JSON.stringify(JSON.stringify(sample)) };
  assert.deepEqual(barsFromCache(asString), sample);
  assert.deepEqual(barsFromCache(asParsed), sample);
  assert.deepEqual(barsFromCache(doubleEncoded), sample);
  assert.deepEqual(barsFromCache(JSON.stringify(sample)), sample);
  assert.equal(barsFromCache({ result: { not: "bars" } }), null);
  assert.equal(barsFromCache({ result: "not-json" }), null);
  assert.equal(barsFromCache({ result: null }), null);
  assert.ok(Array.isArray(barsFromCache(doubleEncoded)));
  assert.deepEqual(barsFromCache(doubleEncoded)?.map((bar) => bar.close), [11]);

  const allowance = { remainingAllowance: 9000, totalAllowance: 10000, allowanceExpiry: 50 };
  assert.deepEqual(allowanceFromCache({ result: JSON.stringify(allowance) }), allowance);
  assert.deepEqual(allowanceFromCache({ result: allowance }), allowance);
  assert.equal(allowanceFromCache({ result: JSON.stringify({ remainingAllowance: "9000" }) }), null);
  assert.equal(allowanceFromCache({ result: sample }), null);

  const session = { cst: "abc", token: "def" };
  assert.deepEqual(sessionFromCache({ result: JSON.stringify(session) }), session);
  assert.deepEqual(sessionFromCache({ result: session }), session);
  assert.equal(sessionFromCache({ result: { cst: "", token: "def" } }), null);
  assert.equal(sessionFromCache({ result: "\"nope\"" }), null);
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
