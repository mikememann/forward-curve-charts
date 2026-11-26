import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeLayout, encodeLayout, presetLayout, setLayoutCount, singleLayout } from "./layout";

test("4-pane and 6-pane presets use the requested markets on the daily timeframe", () => {
  const four = presetLayout(4);
  assert.deepEqual(four.panes.map((p) => p.marketId), ["brent", "gbpusd", "gold", "ftse"]);
  assert.ok(four.panes.every((p) => p.timeframe === "1d"));
  assert.equal(four.panes[2].seriesMode, "continuous");
  const six = presetLayout(6);
  assert.deepEqual(six.panes.map((p) => p.marketId), ["brent", "gbpusd", "gold", "ftse", "wheat", "cocoa"]);
});

test("layout round-trips through the query string", () => {
  const desk = presetLayout(4);
  desk.syncCrosshair = true;
  desk.active = 2;
  desk.panes[1].view = "curve";
  desk.panes[1].timeframe = "1h";
  const again = decodeLayout(encodeLayout(desk));
  assert.ok(again);
  assert.equal(again?.layout, 4);
  assert.equal(again?.active, 2);
  assert.equal(again?.syncCrosshair, true);
  assert.equal(again?.panes[1].view, "curve");
  assert.equal(again?.panes[1].timeframe, "1h");
  assert.equal(again?.panes[1].marketId, "gbpusd");
  assert.equal(again?.panes[2].seriesMode, "continuous");
});

test("growing from one chart applies the preset; shrinking keeps the panes", () => {
  const one = singleLayout("nvda", "15m");
  const four = setLayoutCount(one, 4);
  assert.deepEqual(four.panes.map((p) => p.marketId), ["brent", "gbpusd", "gold", "ftse"]);
  const back = setLayoutCount(four, 1);
  assert.equal(back.layout, 1);
  assert.equal(back.panes.length, 4);
  const six = setLayoutCount(back, 6);
  assert.equal(six.layout, 6);
  assert.equal(six.panes[0].marketId, "brent");
  assert.equal(six.panes[4].marketId, "wheat");
  assert.equal(six.panes[5].marketId, "cocoa");
});
