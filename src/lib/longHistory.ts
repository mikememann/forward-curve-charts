import "server-only";
import { bucket } from "@/lib/aggregate";
import { readStoredJson, writeStoredJson } from "@/lib/barStore";
import { DataError } from "@/lib/errors";
import {
  historyFromCache,
  IG_TAIL_BARS,
  inferScale,
  recentScale,
  scaleBars,
  stitchByDay,
  yearsBack,
  type CachedHistory,
} from "@/lib/history";
import { currentAllowance, igConfigured, loadIgBars } from "@/lib/ig";
import { loadContracts, loadIceSeries, pickContract } from "@/lib/ice";
import type { MarketView } from "@/lib/marketModel";
import { chooseFeed } from "@/lib/sourceChain";
import { loadEuronextContinuous } from "@/lib/euronext";
import { loadExtra } from "@/lib/extraSeries";
import { loadSplice } from "@/lib/spliceSeries";
import { loadElexonDaily, loadEnergyDaily, loadExternal } from "@/lib/sources";
import { yahooDaily } from "@/lib/yahoo";
import type { Bar, SpliceInfo } from "@/lib/types";
import { yahooChart } from "@/lib/yahoo";

const FRESH_SEC = 45 * 60;

/** Daily history must use period1. range=max is monthly for some of these futures. */
const YAHOO_PERIOD1: Record<string, number> = {
  "CPO=F": Date.parse("2010-05-25T00:00:00Z") / 1000,
  "UFV=F": Date.parse("2020-02-01T00:00:00Z") / 1000,
  "UME=F": Date.parse("2017-06-01T00:00:00Z") / 1000,
  DBA: Date.parse("2007-01-01T00:00:00Z") / 1000,
  DBE: Date.parse("2007-01-01T00:00:00Z") / 1000,
};

export interface IceListItem {
  marketId: number;
  strip: string;
  label: string;
  nearExpiry: boolean;
}

export interface BuiltDaily {
  bars: Bar[];
  warnings: string[];
  sourceLabel: string;
  units: string | null;
  quoteTime: number | null;
  shortName: string | null;
  exchangeName: string | null;
  regularMarketPrice: number | null;
  currency: string | null;
  contractLabel: string | null;
  iceContracts: IceListItem[] | null;
  iceStrip: string | null;
  closeOnly: boolean;
  infoNote: string | null;
  splice: SpliceInfo | null;
}

/**
 * Daily bars back to about 10 years, where a free source has them.
 * IG contributes only a short recent tail, rescaled into the free unit when
 * the ratio is a stable power of ten. The joined series is cached in KV.
 */
export async function buildDailyHistory(opts: {
  market: MarketView | null;
  ticker: string;
  source: "auto" | "ig" | "free";
  strip: string | null;
}): Promise<BuiltDaily> {
  const market = opts.market;
  if (market?.intradayOnly) {
    throw new DataError(
      `${market.name} has no daily history on Yahoo (only a few days of intraday bars). Open 15m or 1h. Nothing has been backfilled.`,
      market.ticker,
    );
  }
  if (market?.requiresEnv && !process.env[market.requiresEnv]) {
    throw new DataError(
      `${market.name} is off until ${market.requiresEnv} is set. No figure is shown without that key.`,
      market.seriesId ?? market.id,
    );
  }

  const key = `hist:2:${market?.id ?? opts.ticker}:${opts.strip || "front"}:${opts.ticker}:1d`;
  const now = Math.floor(Date.now() / 1000);
  const cached = historyFromCache(await readStoredJson(key));
  let bars: Bar[];
  let warnings: string[];
  let freeLabel: string;
  let sourceLabel: string;
  let exchangeName: string | null = cached?.exchangeName ?? null;
  let currency: string | null = cached?.currency ?? null;
  let shortName: string | null = cached?.shortName ?? null;
  let infoNote: string | null = cached?.infoNote ?? null;
  let splice: SpliceInfo | null = cached?.splice ?? null;
  let continuousNote = cached?.continuousNote ?? null;

  if (cached && now - cached.savedAt < FRESH_SEC) {
    bars = cached.bars;
    warnings = [...cached.warnings];
    freeLabel = cached.freeLabel;
    sourceLabel = cached.sourceLabel;
  } else {
    const free = await loadFree(opts, !cached);
    warnings = [...free.warnings];
    if (continuousNote) warnings.push(continuousNote);
    bars = cached ? stitchByDay(cached.bars, free.bars) : free.bars;
    if (!cached) {
      const extended = await maybeContinuous(opts, bars, warnings);
      bars = extended.bars;
      continuousNote = extended.note;
    }
    const joined = await maybeIg(opts, bars, warnings, free.label);
    bars = joined.bars;
    freeLabel = free.label;
    sourceLabel = joined.usedIg ? `${freeLabel} + IG` : freeLabel;
    exchangeName = free.exchangeName ?? exchangeName;
    currency = free.currency ?? currency;
    shortName = free.shortName ?? shortName;
    infoNote = free.infoNote ?? infoNote;
    splice = free.splice ?? splice;
    if (yearsBack(bars, now) < 9) {
      warnings.push(`No 10-year daily file for this market. The series starts ${bars[0] ? new Date(bars[0].time * 1000).toISOString().slice(0, 10) : "empty"}.`);
    }
    const blob: CachedHistory = {
      bars,
      freeLabel,
      sourceLabel,
      warnings,
      units: market?.units ?? null,
      continuousNote,
      exchangeName,
      currency,
      shortName,
      savedAt: now,
      infoNote,
      splice,
    };
    if (bars.length) await writeStoredJson(key, blob);
  }

  const ice = await iceMeta(market, opts.strip);
  const last = bars[bars.length - 1];
  return {
    bars,
    warnings,
    sourceLabel,
    units: market?.units ?? null,
    quoteTime: last?.time ?? null,
    shortName: ice?.shortName ?? shortName ?? opts.ticker,
    exchangeName: market?.sourceKind === "ice" ? "ICE Futures Europe" : exchangeName,
    regularMarketPrice: last?.close ?? null,
    currency,
    contractLabel: ice?.contractLabel ?? null,
    iceContracts: ice?.contracts ?? null,
    iceStrip: ice?.strip ?? null,
    closeOnly: false,
    infoNote,
    splice,
  };
}

async function loadFree(
  opts: { market: MarketView | null; ticker: string; strip: string | null },
  full: boolean,
): Promise<{ bars: Bar[]; label: string; warnings: string[]; exchangeName: string | null; currency: string | null; shortName: string | null; infoNote: string | null; splice: SpliceInfo | null }> {
  const market = opts.market;
  if (market?.sourceKind === "splice" && market.seriesId) {
    const loaded = await loadSplice(market.seriesId);
    return {
      bars: loaded.bars,
      label: loaded.sourceLabel,
      warnings: loaded.warnings,
      exchangeName: null,
      currency: "USD",
      shortName: loaded.shortName,
      infoNote: loaded.infoNote,
      splice: loaded.splice,
    };
  }
  if (market?.sourceKind === "euronext" && (market.seriesId === "EBM" || market.seriesId === "EMA")) {
    const loaded = await loadEuronextContinuous(market.seriesId);
    const rolls = loaded.rolls.slice(-6);
    return {
      bars: loaded.bars,
      label: `Euronext ${market.seriesId} front month`,
      warnings: rolls.length ? [`Front-month rolls: ${rolls.join("; ")}`] : [],
      exchangeName: "Euronext",
      currency: "EUR",
      shortName: market.seriesId,
      infoNote: "EUR per tonne. Live contracts only, chained into a front-month series. Expired months return nothing, so this is about two to three years. Free to view for personal analysis, not for redistribution.",
      splice: null,
    };
  }
  if (market?.sourceKind === "special" && market.seriesId) {
    const loaded = await loadExtra(market.seriesId);
    return {
      bars: loaded.bars,
      label: loaded.label,
      warnings: loaded.warnings,
      exchangeName: null,
      currency: null,
      shortName: loaded.shortName,
      infoNote: loaded.infoNote,
      splice: loaded.splice,
    };
  }
  if (market?.sourceKind === "ice" && market.ice) {
    const loaded = await loadIceSeries(market.ice, "1d", opts.strip);
    return { bars: loaded.bars, label: "ICE", warnings: [...loaded.warnings], exchangeName: "ICE Futures Europe", currency: null, shortName: null, infoNote: null, splice: null };
  }
  if (market?.sourceKind === "energycharts") {
    return {
      bars: await loadEnergyDaily(),
      label: "Energy-Charts",
      warnings: ["Daily bars are the high and low of the day-ahead auction intervals, not a baseload settlement."],
      exchangeName: null,
      currency: "EUR",
      shortName: "DE-LU",
      infoNote: null,
      splice: null,
    };
  }
  if (market?.sourceKind === "elexon") {
    return {
      bars: await loadElexonDaily(),
      label: "Elexon",
      warnings: ["Daily bars are the high and low of the half-hourly APX index, not a baseload settlement."],
      exchangeName: null,
      currency: "GBP",
      shortName: "APXMIDP",
      infoNote: null,
      splice: null,
    };
  }
  if (market && market.sourceKind !== "yahoo") {
    const loaded = await loadExternal(
      {
        source: market.sourceKind,
        seriesId: market.seriesId ?? undefined,
        ticker: market.ticker,
        name: market.name,
        nativeFrequency: market.nativeFrequency ?? undefined,
        requiresEnv: market.requiresEnv ?? undefined,
      },
      "1d",
    );
    return { bars: loaded.bars, label: loaded.sourceLabel, warnings: [...loaded.warnings], exchangeName: null, currency: loaded.currency, shortName: loaded.instrumentName, infoNote: null, splice: null };
  }
  const span = YAHOO_PERIOD1[opts.ticker.toUpperCase()];
  const chart = span ? await yahooDaily(opts.ticker, span) : await yahooChart(opts.ticker, "1d", full ? "10y" : "6mo");
  return {
    bars: bucket(chart.bars, "1d"),
    label: "Yahoo Finance",
    warnings: [],
    exchangeName: chart.meta.exchangeName,
    currency: chart.meta.currency,
    shortName: chart.meta.shortName,
    infoNote: null,
    splice: null,
  };
}

async function maybeContinuous(
  opts: { market: MarketView | null; ticker: string },
  bars: Bar[],
  warnings: string[],
): Promise<{ bars: Bar[]; note: string | null }> {
  const continuous = opts.market?.continuous;
  if (!continuous || continuous.toUpperCase() === opts.ticker.toUpperCase()) return { bars, note: null };
  if (yearsBack(bars, Math.floor(Date.now() / 1000)) >= 9) return { bars, note: null };
  try {
    const chart = await yahooChart(continuous, "1d", "10y");
    const older = bucket(chart.bars, "1d");
    if (recentScale(bars, older) !== 1) {
      warnings.push(`${continuous} was not joined: its prices do not match ${opts.ticker} on the overlap.`);
      return { bars, note: null };
    }
    const firstContract = bars[0]?.time;
    const note = firstContract
      ? `Bars before ${new Date(firstContract * 1000).toISOString().slice(0, 10)} are ${continuous}, Yahoo's back-adjusted continuous contract. ${opts.ticker} does not list that far. The overlap stays on ${opts.ticker}.`
      : null;
    if (note) warnings.push(note);
    return { bars: stitchByDay(older, bars), note };
  } catch {
    warnings.push(`Could not load ${continuous} for the older history.`);
    return { bars, note: null };
  }
}

async function maybeIg(
  opts: { market: MarketView | null; source: "auto" | "ig" | "free" },
  bars: Bar[],
  warnings: string[],
  freeLabel: string,
): Promise<{ bars: Bar[]; usedIg: boolean }> {
  const market = opts.market;
  if (!market?.igEpic || opts.source === "free" || !bars.length) return { bars, usedIg: false };
  const choice = chooseFeed({
    chain: market.sourceChain,
    timeframe: "1d",
    requestedBars: 120,
    epic: market.igEpic,
    configured: igConfigured(),
    allowanceRemaining: currentAllowance()?.remainingAllowance ?? null,
    override: opts.source,
  });
  if (choice.feed !== "ig") {
    if (choice.reason) warnings.push(choice.reason);
    return { bars, usedIg: false };
  }
  try {
    const loaded = await loadIgBars(market.igEpic, "1d", IG_TAIL_BARS);
    if (!loaded.bars.length) {
      warnings.push("IG returned no recent prices. The history is the free series.");
      return { bars, usedIg: false };
    }
    const scale = inferScale(loaded.bars, bars);
    if (scale == null) {
      warnings.push(`IG points are not a stable multiple of ${market.units}, so they are not joined. This history stays on ${freeLabel}.`);
      return { bars, usedIg: false };
    }
    warnings.push(
      scale === 1
        ? "Recent daily bars are the IG mid. They match this market's units, so they replace the free print on those days."
        : `Recent daily bars are the IG mid divided by ${scale} so they match ${market.units}. Older bars stay on ${freeLabel}.`,
    );
    return { bars: stitchByDay(bars, scaleBars(loaded.bars, scale)), usedIg: true };
  } catch (e) {
    warnings.push(`IG tail did not load (${e instanceof Error ? e.message : "request failed"}). Showing ${freeLabel}.`);
    return { bars, usedIg: false };
  }
}

async function iceMeta(market: MarketView | null, strip: string | null): Promise<{ contracts: IceListItem[]; contractLabel: string | null; strip: string; shortName: string | null } | null> {
  if (!market?.ice) return null;
  try {
    const { list } = await loadContracts(market.ice);
    const contract = pickContract(list, strip);
    const usingFront = !strip || strip.trim().toLowerCase() === "front";
    return {
      contracts: list.map((c) => ({ marketId: c.marketId, strip: c.strip, label: c.label, nearExpiry: c.nearExpiry })),
      contractLabel: contract?.label ?? null,
      strip: usingFront ? "front" : contract?.strip ?? strip ?? "front",
      shortName: contract ? `${contract.label} · ${contract.marketId}` : null,
    };
  } catch {
    return null;
  }
}
