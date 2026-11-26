import assert from "node:assert/strict";
import { test } from "node:test";
import { IgPathError, assertIgPath, igCall } from "./igAllow";

test("the IG client allows only session, watchlists, markets and prices", () => {
  for (const call of [
    ["POST", "/session"],
    ["GET", "/session"],
    ["DELETE", "/session"],
    ["GET", "/watchlists"],
    ["GET", "/watchlists/6bbb7b9a-3290-4e30-8907-a710fffc2034"],
    ["GET", "/markets/CC.D.LCO.USS.IP"],
    ["GET", "/markets?searchTerm=feed%20wheat"],
    ["GET", "/prices/CC.D.LCC.USS.IP?resolution=DAY&max=120"],
  ] as const) {
    assert.doesNotThrow(() => assertIgPath(call[0], call[1]));
  }
});

test("positions, working orders and confirms throw before any request is sent", async () => {
  let called = 0;
  const fetchImpl: typeof fetch = async () => {
    called += 1;
    throw new Error("fetch should not run");
  };
  for (const path of ["/positions", "/positions/ABC", "/workingorders", "/workingorders/1", "/confirms/1", "/dealing/orders"]) {
    await assert.rejects(() => igCall("POST", path, fetchImpl), IgPathError);
    await assert.rejects(() => igCall("GET", path, fetchImpl), IgPathError);
  }
  await assert.rejects(() => igCall("PUT", "/session", fetchImpl), IgPathError);
  await assert.rejects(() => igCall("GET", "/accounts", fetchImpl), IgPathError);
  assert.equal(called, 0);
});
