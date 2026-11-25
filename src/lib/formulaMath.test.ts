import assert from "node:assert/strict";
import { test } from "node:test";
import { evalFormula, formulaIds, parseFormula } from "./formulaMath";

test("formulas need spaces around operators so ids can contain hyphens", () => {
  const ast = parseFormula("us-10y - us-1y");
  assert.deepEqual(formulaIds(ast), ["us-10y", "us-1y"]);
  assert.equal(evalFormula(ast, { "us-10y": 4.2, "us-1y": 3.7 }), 0.5);
  const ratio = parseFormula("( brent - wti ) / brent");
  assert.equal(evalFormula(ratio, { brent: 80, wti: 75 }), 5 / 80);
  assert.equal(evalFormula(parseFormula("a / b"), { a: 1, b: 0 }), null);
  assert.deepEqual(formulaIds(parseFormula("brent-wti")), ["brent-wti"]);
  assert.throws(() => parseFormula("brent -"), /ended early|not between/);
});
