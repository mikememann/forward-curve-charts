import "server-only";
import { DataError } from "@/lib/errors";
import { loadExternal } from "@/lib/sources";
import { delayNoteFor, findMarketByTicker, type MarketView } from "@/lib/marketModel";
import { bucketBars } from "@/lib/bucket";
import { resolveContract } from "@/lib/contracts";
import { loadIceSeries } from "@/lib/ice";
import { enrich, lastSma } from "@/lib/indicators";
import { formatLondon, isStaleQuote } from "@/lib/time";
import type { OhlcResponse, Timeframe } from "@/lib/types";
import { yahooChart, YahooError } from "@/lib/yahoo";

const RANGE: Record<Timeframe, string> = {
  "15m": "60d",
  "1h": "730d",
  "1d": "5y",
  "1w": "10y",
};

const INTERVAL: Record<Timeframe, string> = {
  "15m": "15m",
  "1h": "1h",
  "1d": "1d",
  "1w": "1wk",
};

const DEFAULT_BARS: Record<Timeframe, number> = {
  "15m": 1200,
  "1h": 1800,
  "1d": 800,
  "1w": 520,
};

export function defaultBars(tf: Timeframe): number {
  return DEFAULT_BARS[tf];
}

export function isTimeframe(v: string | null): v is Timeframe {
  return v === "15m" || v === "1h" || v === "1d" || v === "1w";
}

export async function loadOhlc(opts: {
  ticker: string;
  timeframe: Timeframe;
  bars?: number;
  market?: MarketView | null;
  /** ICE delivery strip, e.g. "Dec26" or "Dec 2026". Empty uses the front contract. */
  strip?: string | null;
}): Promise<OhlcResponse> {
  let { ticker, timeframe } = opts;
  const market = opts.market === undefined ? findMarketByTicker(ticker) : opts.market;
  const want = clamp(opts.bars ?? defaultBars(timeframe), 20, 5000);
  const warnings: string[] = [];
  if (market?.sourceKind === "ice" && market.ice) {
    try {
      return await loadIceOhlc(market, timeframe, want, opts.strip ?? null);
    } catch (e) {
      if (!market.iceFallback) throw e instanceof DataError ? e : new DataError(e instanceof Error ? e.message : "ICE request failed", market.id);
      const message = e instanceof Error ? e.message : "ICE request failed";
      const standIn = fallbackView(market);
      const body = await loadOhlc({ ticker: standIn.ticker, timeframe, bars: want, market: standIn });
      body.warnings = [`ICE charting did not load (${message}). These endpoints are undocumented and may have changed. Showing the old stand-in.`, ...body.warnings];
      body.proxyNote = standIn.proxyNote;
      body.exactness = "proxy";
      body.infoNote = standIn.infoNote;
      body.units = standIn.units;
      return body;
    }
  }
  if (market?.intradayOnly && (timeframe === "1d" || timeframe === "1w")) {
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
      timeframe,
    );
    warnings.push(...loaded.warnings);
    const enriched = enrich(loaded.bars);
    return pack(enriched.slice(-want), {
      currency: loaded.currency,
      shortName: loaded.instrumentName,
      exchangeName: null,
      instrumentType: null,
      regularMarketPrice: null,
    }, {
      ticker: market.seriesId ?? market.ticker,
      timeframe,
      market,
      sma200Daily: null,
      warnings: [...warnings, "sma200 on these bars is 200 observations of this series, not a 200-day average."],
      quoteTime: loaded.quoteTime,
      sourceLabel: loaded.sourceLabel,
    });
  }
  if (market?.dailyOnly && (timeframe === "15m" || timeframe === "1h")) {
    warnings.push("No intraday bars for this symbol. Showing the daily series instead of inventing them.");
    timeframe = "1d";
  }

  let chart;
  try {
    chart = await yahooChart(ticker, INTERVAL[timeframe], RANGE[timeframe]);
  } catch (e) {
    const message = e instanceof YahooError ? e.message : "Yahoo Finance request failed";
    throw new YahooError(message, ticker);
  }

  const bucketed = bucketBars(chart.bars, timeframe);
  if (!bucketed.length) {
    throw new YahooError(`Yahoo Finance returned no bars for ${ticker}`, ticker);
  }

  let sma200Daily: number | null = null;
  if (timeframe === "1d") {
    const enrichedFull = enrich(bucketed);
    sma200Daily = enrichedFull[enrichedFull.length - 1]?.sma200 ?? null;
    if (sma200Daily == null) warnings.push(`200-day SMA unavailable: ${bucketed.length} daily bars (200 required).`);
    const sliced = enrichedFull.slice(-want);
    return pack(sliced, chart.meta, { ticker, timeframe, market, sma200Daily, warnings, quoteTime: chart.meta.regularMarketTime });
  }

  const dailyPromise = yahooChart(ticker, "1d", "2y").catch(() => null);
  const enriched = enrich(bucketed);
  const sliced = enriched.slice(-want);
  const daily = await dailyPromise;
  if (daily && daily.bars.length) {
    const closes = bucketBars(daily.bars, "1d").map((b) => b.close);
    sma200Daily = lastSma(closes, 200);
    if (sma200Daily == null) warnings.push(`200-day SMA unavailable: ${closes.length} daily bars (200 required).`);
  } else {
    warnings.push("200-day SMA unavailable: daily history could not be loaded.");
  }
  if ((timeframe === "15m" || timeframe === "1h") && sliced.length && sliced[sliced.length - 1].sma200 == null) {
    warnings.push(`SMA200 of this timeframe is n/a: fewer than 200 ${timeframe} bars were available.`);
  }
  return pack(sliced, chart.meta, { ticker, timeframe, market, sma200Daily, warnings, quoteTime: chart.meta.regularMarketTime });
}

async function loadIceOhlc(market: MarketView, timeframe: Timeframe, want: number, strip: string | null): Promise<OhlcResponse> {
  const loaded = await loadIceSeries(market.ice!, timeframe, strip);
  const warnings = [...loaded.warnings];
  const enriched = enrich(loaded.bars, { closeOnly: loaded.closeOnly });
  const dailyCloses = loaded.dailyCloses.map((b) => b.close);
  const sma200Daily = lastSma(dailyCloses, 200);
  if (sma200Daily == null) warnings.push(`200-day SMA unavailable: ${dailyCloses.length} daily closes (200 required).`);
  if (timeframe !== "1d" && enriched.length && enriched[enriched.length - 1].sma200 == null) {
    warnings.push(`SMA200 of this timeframe is n/a: fewer than 200 ${timeframe} bars were available.`);
  }
  const currency = market.units.startsWith("GBP") ? "GBP" : market.units.startsWith("USD") ? "USD" : null;
  const body = pack(enriched.slice(-want), {
    currency,
    shortName: `${loaded.contract.label} · ${loaded.contract.marketId}`,
    exchangeName: "ICE Futures Europe",
    instrumentType: "FUTURE",
    regularMarketPrice: loaded.contract.lastPrice,
  }, {
    ticker: market.ticker,
    timeframe,
    market,
    sma200Daily,
    warnings,
    quoteTime: loaded.quoteTime,
    sourceLabel: "ICE",
    contractLabel: loaded.contract.label,
  });
  body.iceContracts = loaded.contracts.map((c) => ({ marketId: c.marketId, strip: c.strip, label: c.label, nearExpiry: c.nearExpiry }));
  body.iceStrip = loaded.rolled ? "front" : loaded.contract.strip;
  return body;
}

function fallbackView(market: MarketView): MarketView {
  const fb = market.iceFallback;
  if (!fb) return market;
  if (fb.kind === "yahoo") {
    const contract = resolveContract(fb.contract);
    return {
      ...market,
      sourceKind: "yahoo",
      ice: null,
      iceFallback: null,
      units: fb.units,
      ticker: contract.ticker,
      contractTicker: contract.ticker,
      contractLabel: contract.label,
      contract,
      continuous: null,
      proxyNote: fb.note,
      infoNote: fb.note,
      exactness: "proxy",
      licence: "Yahoo terms: free to view, personal use, no redistribution",
      attribution: "Yahoo Finance",
    };
  }
  return {
    ...market,
    sourceKind: "fred",
    ice: null,
    iceFallback: null,
    units: fb.units,
    ticker: fb.seriesId,
    seriesId: fb.seriesId,
    nativeFrequency: fb.nativeFrequency,
    proxyNote: fb.note,
    infoNote: fb.note,
    exactness: "proxy",
    licence: "Public domain (FRED / source agency)",
    attribution: "FRED, IMF primary commodity prices",
    delayNote: "Monthly IMF average.",
  };
}

function pack(
  bars: OhlcResponse["bars"],
  meta: { currency: string | null; shortName: string | null; exchangeName: string | null; instrumentType: string | null; regularMarketPrice: number | null },
  ctx: {
    ticker: string;
    timeframe: Timeframe;
    market: MarketView | null;
    sma200Daily: number | null;
    warnings: string[];
    quoteTime: number | null;
    sourceLabel?: string;
    contractLabel?: string | null;
  },
): OhlcResponse {
  const last = bars[bars.length - 1];
  const lastBarUnix = last?.time ?? null;
  const stale = Boolean(ctx.market?.hideStale && isStaleQuote(lastBarUnix));
  const now = Date.now();
  const quoteStamp = ctx.quoteTime;
  const metaFresh = quoteStamp != null && lastBarUnix != null && lastBarUnix - quoteStamp < 5 * 86_400;
  const quoteTimeUnix = metaFresh ? quoteStamp : lastBarUnix ?? quoteStamp;
  const ageBasis = quoteTimeUnix ?? lastBarUnix;
  const continuous = Boolean(ctx.market?.continuous && ctx.market.continuous.toUpperCase() === ctx.ticker.toUpperCase());
  let lastPrice: number | null = (metaFresh ? meta.regularMarketPrice : null) ?? last?.close ?? null;
  let staleReason: string | null = null;
  if (stale) {
    lastPrice = null;
    staleReason = lastBarUnix
      ? `No fresh quote. Last bar ${formatLondon(lastBarUnix, "date")}. That close is not shown as a current price.`
      : "No fresh quote.";
  }
  const asset = ctx.market?.assetClass ?? (meta.instrumentType === "FUTURE" ? "future" : meta.instrumentType === "CURRENCY" ? "fx" : null);
  return {
    ticker: ctx.ticker,
    marketId: ctx.market?.id ?? null,
    name: ctx.market?.name ?? null,
    timeframe: ctx.timeframe,
    currency: ctx.market?.pence ? "GBp" : meta.currency,
    units: ctx.market?.units ?? null,
    pence: Boolean(ctx.market?.pence),
    instrumentName: meta.shortName,
    exchange: meta.exchangeName,
    contractLabel: continuous ? null : ctx.contractLabel ?? ctx.market?.contractLabel ?? null,
    continuous,
    proxyNote: ctx.market?.proxyNote ?? null,
    infoNote: ctx.market?.infoNote ?? null,
    exactness: ctx.market?.exactness ?? null,
    licence: ctx.market?.licence ?? null,
    attribution: ctx.market?.attribution ?? null,
    source: ctx.sourceLabel ?? "Yahoo Finance",
    delayNote: ctx.market?.delayNote ?? delayNoteFor(asset, Boolean(ctx.market?.fxClose22)),
    times: "Europe/London",
    fetchedAt: new Date(now).toISOString(),
    lastBarUnix,
    quoteTimeUnix,
    ageSeconds: ageBasis == null ? null : Math.max(0, Math.round(now / 1000 - ageBasis)),
    lastPrice,
    stale,
    staleReason,
    sma200Daily: ctx.sma200Daily,
    warnings: ctx.warnings,
    bars,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export function ohlcToCsv(payload: OhlcResponse): string {
  const lines: string[] = [];
  lines.push(`# source,${payload.source}`);
  if (payload.licence) lines.push(`# licence,${payload.licence.replaceAll(",", ";")}`);
  if (payload.attribution) lines.push(`# attribution,${payload.attribution.replaceAll(",", ";")}`);
  lines.push(`# ticker,${payload.ticker}`);
  lines.push(`# timeframe,${payload.timeframe}`);
  lines.push(`# currency,${payload.currency ?? ""}`);
  lines.push(`# units,${payload.units ?? ""}`);
  lines.push(`# fetched_at,${payload.fetchedAt}`);
  lines.push(`# sma200_daily,${payload.sma200Daily ?? ""}`);
  lines.push(`# sma200_column,200-period SMA of this timeframe; sma200_daily is the 200-day SMA`);
  lines.push(`# delay,${payload.delayNote}`);
  lines.push(`# stale,${payload.stale}`);
  if (payload.staleReason) lines.push(`# stale_reason,${payload.staleReason}`);
  for (const w of payload.warnings) lines.push(`# warning,${w.replaceAll(",", ";")}`);
  const header = [
    "time_utc",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "sma20",
    "sma50",
    "sma200",
    "sma200_daily",
    "bb_mid",
    "bb_upper",
    "bb_lower",
    "rsi14",
    "stoch_k",
    "stoch_d",
    "atr14",
    "macd",
    "macd_signal",
    "macd_hist",
  ];
  lines.push(header.join(","));
  for (const b of payload.bars) {
    const row = [
      new Date(b.time * 1000).toISOString(),
      b.open,
      b.high,
      b.low,
      b.close,
      b.volume,
      b.sma20,
      b.sma50,
      b.sma200,
      payload.sma200Daily,
      b.bbMid,
      b.bbUpper,
      b.bbLower,
      b.rsi14,
      b.stochK,
      b.stochD,
      b.atr14,
      b.macd,
      b.macdSignal,
      b.macdHist,
    ];
    lines.push(row.map((v) => (v == null ? "" : String(v))).join(","));
  }
  return lines.join("\n") + "\n";
}
