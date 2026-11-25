import assert from "node:assert/strict";
import { test } from "node:test";
import { presentMarket, allCurves, catalog } from "./marketModel";
import { markets } from "@/config/markets";
import { lsegMarkets, unavailableSeries } from "@/config/lseg";

const on = new Date("2026-11-25T12:00:00Z");
const later = new Date("2026-12-20T12:00:00Z");

function ticker(id: string, now: Date) {
  const m = markets.find((x) => x.id === id);
  if (!m) throw new Error(id);
  return presentMarket(m, now);
}

test("chart defaults on 25 Nov 2026 match the configured contracts", () => {
  assert.equal(ticker("brent", on).ticker, "BZG27.NYM");
  assert.equal(ticker("brent", on).contractLabel, "Feb 2027");
  assert.equal(ticker("wheat", on).ticker, "ZWZ26.CBT");
  assert.equal(ticker("wheat", on).contractLabel, "Dec 2026");
  assert.equal(ticker("corn", on).ticker, "ZCH27.CBT");
  assert.equal(ticker("cocoa", on).sourceKind, "ice");
  assert.equal(ticker("cocoa", on).units, "GBP/t");
  assert.equal(ticker("cocoa", on).ice?.productId, 15246);
  assert.equal(ticker("sugar", on).sourceKind, "ice");
  assert.equal(ticker("sugar", on).units, "USD/t");
  assert.equal(ticker("gold", on).ticker, "GC=F");
  assert.equal(ticker("gold", on).contractTicker, "GCZ26.CMX");
  assert.equal(ticker("ttf", on).ticker, "TTF=F");
  assert.equal(ticker("bp", on).ticker, "BP.L");
  assert.equal(ticker("ftse", on).ticker, "^FTSE");
});

test("contracts roll after the expiry rule", () => {
  assert.equal(ticker("brent", later).ticker, "BZH27.NYM");
  assert.equal(ticker("brent", later).contractLabel, "Mar 2027");
  assert.equal(ticker("wheat", later).ticker, "ZWH27.CBT");
});

test("EBM=F is excluded and the layout keeps unavailable rows uncharted", () => {
  const tickers = catalog().flatMap((m) => [m.ticker, m.continuous].filter(Boolean));
  assert.equal(tickers.includes("EBM=F"), false);
  assert.match(unavailableSeries.find((u) => u.id === "matif-wheat")?.reason ?? "", /Micro Bitcoin/);
  assert.ok(lsegMarkets.length >= 45);
  assert.ok(unavailableSeries.length >= 20);
});

test("curves cover the futures book plus WTI and Henry Hub", () => {
  const ids = allCurves().map((c) => c.id).sort();
  assert.deepEqual(ids, ["brent", "cocoa", "corn", "gold", "hh", "robusta", "sugar", "ttf", "uk-wheat", "wheat", "wti"]);
  assert.equal(allCurves().find((c) => c.id === "cocoa")?.ice, true);
  assert.equal(catalog().some((m) => m.id === "uk-wheat" && m.source === "ice"), true);
  assert.equal(unavailableSeries.some((u) => u.id === "uk-wheat" || u.id === "white-sugar" || u.id === "london-cocoa-exact"), false);
});
