import assert from "node:assert/strict";
import { test } from "node:test";
import { watchlistMatches } from "./watchlistFilter";

test("empty filter keeps every row", () => {
  assert.equal(watchlistMatches("   ", ["London Cocoa", "LCC", "Softs/Grains"]), true);
});

test("filter matches name, ticker, or group, ignoring case", () => {
  assert.equal(watchlistMatches("WHEAT", ["Chicago Wheat", "ZW=F", "Softs/Grains"]), true);
  assert.equal(watchlistMatches("zw=f", ["Chicago Wheat", "ZW=F", "Softs/Grains"]), true);
  assert.equal(watchlistMatches("softs", ["London Cocoa", "LCC", "Softs/Grains"]), true);
  assert.equal(watchlistMatches("copper", ["London Cocoa", "LCC", "Softs/Grains"]), false);
});
