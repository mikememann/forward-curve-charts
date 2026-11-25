import assert from "node:assert/strict";
import { test } from "node:test";
import { IG_THEN_FREE } from "@/config/markets";
import { chooseFeed, exampleFullLoadPoints, IG_LOW_ALLOWANCE } from "./sourceChain";

const base = {
  chain: IG_THEN_FREE,
  epic: "CC.D.LCO.USS.IP",
  configured: true,
  allowanceRemaining: 9000,
  override: "auto" as const,
};

test("short candles prefer IG and a long daily or weekly view stays on the free source", () => {
  assert.equal(chooseFeed({ ...base, timeframe: "1d", requestedBars: 120 }).feed, "ig");
  assert.equal(chooseFeed({ ...base, timeframe: "1h", requestedBars: 1800 }).feed, "ig");
  assert.equal(chooseFeed({ ...base, timeframe: "1h", requestedBars: 1800 }).igBars, 120);
  assert.equal(chooseFeed({ ...base, timeframe: "1d", requestedBars: 800 }).feed, "free");
  assert.equal(chooseFeed({ ...base, timeframe: "1w", requestedBars: 520 }).feed, "free");
});

test("a low allowance or missing credentials falls back without calling IG", () => {
  assert.equal(chooseFeed({ ...base, timeframe: "15m", requestedBars: 64, allowanceRemaining: IG_LOW_ALLOWANCE - 1 }).feed, "free");
  assert.equal(chooseFeed({ ...base, timeframe: "1d", requestedBars: 120, configured: false }).feed, "free");
  assert.equal(chooseFeed({ ...base, timeframe: "1d", requestedBars: 120, epic: null }).feed, "free");
  assert.equal(chooseFeed({ ...base, timeframe: "1d", requestedBars: 120, override: "free" }).feed, "free");
});

test("an explicit IG request is capped at 300 daily or 200 hourly points", () => {
  assert.equal(chooseFeed({ ...base, timeframe: "1d", requestedBars: 5000, override: "ig" }).igBars, 300);
  assert.equal(chooseFeed({ ...base, timeframe: "1h", requestedBars: 5000, override: "ig" }).igBars, 200);
  assert.equal(exampleFullLoadPoints(), 15 * (300 + 200));
});

test("markets without a chain never select IG on their own", () => {
  assert.equal(chooseFeed({ ...base, chain: null, timeframe: "1d", requestedBars: 120 }).feed, "free");
});
