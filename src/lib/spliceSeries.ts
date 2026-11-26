import "server-only";
import { bucket } from "@/lib/aggregate";
import { DataError } from "@/lib/errors";
import { loadEuWeekly } from "@/lib/euOil";
import { loadExternal } from "@/lib/sources";
import { LARGE_GAP, rateOnOrBefore, scaleBars, SHORT_TON_TO_TONNE, spliceSeries, toUsd } from "@/lib/splice";
import type { Bar, SeriesMark, SpliceInfo } from "@/lib/types";
import { yahooChart } from "@/lib/yahoo";

const SUNFLOWER_BREAKS: SeriesMark[] = [
  { time: Date.parse("2011-02-01T12:00:00Z") / 1000, label: "2011 spec", kind: "break" },
  { time: Date.parse("2020-09-01T12:00:00Z") / 1000, label: "2020 spec", kind: "break" },
  { time: Date.parse("2024-11-01T12:00:00Z") / 1000, label: "2024 spec", kind: "break" },
];

export interface LoadedSplice {
  bars: Bar[];
  warnings: string[];
  sourceLabel: string;
  infoNote: string;
  splice: SpliceInfo;
  shortName: string;
}

export async function loadSplice(id: string): Promise<LoadedSplice> {
  if (id === "rapeseed") return loadOil("Rapeseed oil", "Crude rape oil", ["PL", "DK", "RO"], "Dutch FOB Rotterdam", []);
  if (id === "sunflower") return loadOil("Sunflower oil", "Crude sunflower oil", ["BG", "RO", "ES", "IT"], "EU FOB Rotterdam", SUNFLOWER_BREAKS);
  if (id === "dap") return loadDap();
  throw new DataError(`Unknown spliced series ${id}`, id);
}

async function loadOil(column: string, product: string, states: string[], place: string, breaks: SeriesMark[]): Promise<LoadedSplice> {
  const [monthly, weeks, fx] = await Promise.all([
    worldBank(column),
    loadEuWeekly(product, states),
    fxRates(),
  ]);
  const recent = toUsd(weeks, fx.bars);
  if (!recent.length) throw new DataError(`No USD conversion for ${product}. EURUSD did not cover the EU weeks.`, product);
  const joined = spliceSeries(monthly.bars, recent);
  const lastWeek = weeks.at(-1);
  const lastUsd = joined.bars.at(-1)?.close ?? null;
  const fxLast = lastWeek ? rateOnOrBefore(fx.bars, lastWeek.time) : null;
  const gapText = gapSentence(joined.gap, joined.monthlyClose, joined.recentClose);
  const statesNow = lastWeek ? lastWeek.states.join("/") : states.join("/");
  const spliceDate = joined.spliceTime ? ymd(joined.spliceTime) : "n/a";
  const warnings = gapWarning(joined.gap);
  const marks = marksFor(joined.bars, joined.spliceTime, breaks);
  const legend = `World Bank monthly to ${spliceDate}, then EU weekly avg ${statesNow}`;
  const infoNote = [
    `USD per metric tonne on one axis.`,
    `Through ${spliceDate}: World Bank Pink Sheet monthly ${column}, ${place}, nominal USD/t.`,
    `After that: EU Commission weekly ${product}, the simple average of ${states.join("/")} in the weeks they publish (latest week avg ${statesNow}).`,
    `EUR/t is multiplied by EURUSD=X${fxLast != null ? ` (${fxLast.toFixed(4)} on the latest week)` : ""}. The API prints euro amounts.`,
    gapText,
    `The monthly section is drawn as a step, not a straight line between months.`,
    breaks.length ? "World Bank sunflower oil changed spec in February 2011 (EU crude FOB Rotterdam), September 2020 (Dutch crude FOB Rotterdam) and November 2024 (EU cash FOB Rotterdam). Those dates are marked. The levels are not adjusted." : "",
  ].filter(Boolean).join(" ");
  return {
    bars: joined.bars,
    warnings,
    sourceLabel: legend,
    infoNote,
    shortName: column,
    splice: {
      time: joined.spliceTime,
      gap: joined.gap,
      monthlyClose: joined.monthlyClose,
      recentClose: joined.recentClose,
      states: statesNow,
      nativeLast: lastWeek?.close ?? null,
      nativeUnit: "EUR/t",
      usdLast: lastUsd,
      legend,
      marks,
    },
  };
}

async function loadDap(): Promise<LoadedSplice> {
  const [monthly, yahoo] = await Promise.all([
    worldBank("DAP"),
    yahooChart("DFN=F", "1d", "10y"),
  ]);
  const native = bucket(yahoo.bars, "1d").filter((bar) => bar.close > 0);
  const recent = scaleBars(native, SHORT_TON_TO_TONNE);
  const joined = spliceSeries(monthly.bars, recent);
  const lastNative = native.at(-1)?.close ?? null;
  const lastUsd = joined.bars.at(-1)?.close ?? null;
  const spliceDate = joined.spliceTime ? ymd(joined.spliceTime) : "n/a";
  const gapText = gapSentence(joined.gap, joined.monthlyClose, joined.recentClose);
  const warnings = gapWarning(joined.gap);
  const marks = marksFor(joined.bars, joined.spliceTime, []);
  const legend = `World Bank monthly to ${spliceDate}, then CBOT DAP (DFN=F)`;
  const infoNote = [
    "USD per metric tonne on one axis.",
    `Through ${spliceDate}: World Bank Pink Sheet monthly DAP, FOB US Gulf, USD/t.`,
    `After that: CBOT DAP FOB NOLA futures, Yahoo DFN=F, in USD per short ton multiplied by ${SHORT_TON_TO_TONNE}.`,
    lastNative != null ? `Latest native price ${lastNative.toFixed(2)} USD/short ton, ${lastUsd != null ? lastUsd.toFixed(2) : "n/a"} USD/t.` : "",
    gapText,
    "The monthly section is drawn as a step. The two pieces are not level-adjusted.",
  ].filter(Boolean).join(" ");
  return {
    bars: joined.bars,
    warnings,
    sourceLabel: legend,
    infoNote,
    shortName: "DAP",
    splice: {
      time: joined.spliceTime,
      gap: joined.gap,
      monthlyClose: joined.monthlyClose,
      recentClose: joined.recentClose,
      states: null,
      nativeLast: lastNative,
      nativeUnit: "USD/short ton",
      usdLast: lastUsd,
      legend,
      marks,
    },
  };
}

async function worldBank(column: string): Promise<{ bars: Bar[] }> {
  const loaded = await loadExternal(
    { source: "worldbank", seriesId: column, name: column },
    "1d",
  );
  return { bars: loaded.bars };
}

async function fxRates(): Promise<{ bars: Bar[] }> {
  const chart = await yahooChart("EURUSD=X", "1d", "10y");
  return { bars: bucket(chart.bars, "1d") };
}

function gapSentence(gap: number | null, monthly: number | null, recent: number | null): string {
  if (gap == null || monthly == null || recent == null) return "The splice gap could not be measured.";
  const pct = (gap * 100).toFixed(1);
  return `No level adjustment. At the splice the World Bank close is ${monthly.toFixed(1)} USD/t and the first recent close is ${recent.toFixed(1)} USD/t, a gap of ${pct}%.`;
}

function gapWarning(gap: number | null): string[] {
  if (gap == null || Math.abs(gap) <= LARGE_GAP) return [];
  return [`The splice gap is large (${(gap * 100).toFixed(1)}%). Both series are left unadjusted.`];
}

function marksFor(bars: Bar[], spliceTime: number | null, breaks: SeriesMark[]): SeriesMark[] {
  const first = bars[0]?.time ?? 0;
  const last = bars.at(-1)?.time ?? 0;
  const marks: SeriesMark[] = [];
  if (spliceTime != null) marks.push({ time: spliceTime, label: "splice", kind: "splice" });
  for (const mark of breaks) {
    if (mark.time >= first && mark.time <= last) marks.push(mark);
  }
  return marks;
}

function ymd(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}
