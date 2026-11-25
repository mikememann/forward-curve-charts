import assert from "node:assert/strict";
import { test } from "node:test";
import { presentMarket, allCurves } from "./marketModel";
import { markets } from "@/config/markets";

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
  assert.equal(ticker("cocoa", on).ticker, "CCH27.NYB");
  assert.equal(ticker("sugar", on).ticker, "SBH27.NYB");
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

test("curves cover the futures book plus WTI and Henry Hub", () => {
  const ids = allCurves().map((c) => c.id).sort();
  assert.deepEqual(ids, ["brent", "cocoa", "corn", "gold", "hh", "sugar", "ttf", "wheat", "wti"]);
});
