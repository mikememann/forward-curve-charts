import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBundesbankCsv, parseFredCsv } from "./parseTables";

test("FRED skips blanks and Bundesbank reads comma decimals", () => {
  const fred = parseFredCsv("observation_date,DCOILBRENTEU\n2026-11-17,64.2\n2026-11-18,\n2026-11-19,.\n2026-11-20,65");
  assert.deepEqual(fred.map((b) => b.close), [64.2, 65]);
  const bb = parseBundesbankCsv("2026-11-23;3,37;\n2026-11-24;.;Kein Wert\n2026-11-25;3,33;");
  assert.deepEqual(bb.map((b) => b.close), [3.37, 3.33]);
});
