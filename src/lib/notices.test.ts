import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNotices, readDismissed, uniqueNotices, writeDismissed, type NoticeStore } from "./notices";

function memoryStore(): NoticeStore {
  const bag = new Map<string, string>();
  return {
    getItem: (key) => bag.get(key) ?? null,
    setItem: (key, value) => {
      bag.set(key, value);
    },
  };
}

test("duplicate notice text is shown once", () => {
  const warnings = [
    "Close-based series. Stochastic and ATR use this close range.",
    "Today's point is the latest 10-minute price.",
    "Close-based series. Stochastic and ATR use this close range.",
    "Today's point is the latest 10-minute price.",
  ];
  const notes = buildNotices({
    infoNote: "ICE London Cocoa, delayed, close-based, GBP/t.",
    warnings,
    extraInfo: "ICE London Cocoa, delayed, close-based, GBP/t.",
  });
  assert.deepEqual(notes.map((n) => n.text), [
    "ICE London Cocoa, delayed, close-based, GBP/t.",
    "Close-based series. Stochastic and ATR use this close range.",
    "Today's point is the latest 10-minute price.",
  ]);
  assert.equal(notes[0].tone, "info");
  assert.equal(notes[1].tone, "warn");
});

test("whitespace-only differences count as the same notice", () => {
  const notes = uniqueNotices([
    { tone: "warn", text: "No 10-year daily file.\nThe series starts 2025-03-17." },
    { tone: "info", text: "No 10-year daily file. The series starts 2025-03-17." },
  ]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, "No 10-year daily file. The series starts 2025-03-17.");
});

test("dismissal is stored per symbol and notice text", () => {
  const storage = memoryStore();
  writeDismissed("cocoa", ["Close-based series.", "Today's point is the latest 10-minute price."], storage);
  writeDismissed("wheat", ["Close-based series."], storage);
  assert.deepEqual([...readDismissed("cocoa", storage)], [
    "Close-based series.",
    "Today's point is the latest 10-minute price.",
  ]);
  assert.deepEqual([...readDismissed("wheat", storage)], ["Close-based series."]);

  writeDismissed("cocoa", ["Today's point is the latest 10-minute price."], storage);
  assert.deepEqual([...readDismissed("cocoa", storage)], ["Today's point is the latest 10-minute price."]);
  assert.deepEqual([...readDismissed("wheat", storage)], ["Close-based series."]);

  writeDismissed("wheat", [], storage);
  assert.equal(readDismissed("wheat", storage).size, 0);
  assert.equal(readDismissed("cocoa", storage).size, 1);
});
