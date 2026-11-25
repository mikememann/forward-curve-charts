import "server-only";
import type { MarketView } from "@/lib/marketModel";
import { delayNoteFor, findMarketByTicker } from "@/lib/marketModel";
import { bucketBars } from "@/lib/bucket";
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
}): Promise<OhlcResponse> {
  const { ticker, timeframe } = opts;
  const market = opts.market === undefined ? findMarketByTicker(ticker) : opts.market;
  const want = clamp(opts.bars ?? defaultBars(timeframe), 20, 5000);
  const warnings: string[] = [];

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
  },
): OhlcResponse {
  const last = bars[bars.length - 1];
  const lastBarUnix = last?.time ?? null;
  const stale = Boolean(ctx.market?.hideStale && isStaleQuote(lastBarUnix));
  const now = Date.now();
  const quoteTimeUnix = ctx.quoteTime;
  const ageBasis = quoteTimeUnix ?? lastBarUnix;
  const continuous = Boolean(ctx.market?.continuous && ctx.market.continuous.toUpperCase() === ctx.ticker.toUpperCase());
  let lastPrice: number | null = meta.regularMarketPrice ?? last?.close ?? null;
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
    contractLabel: continuous ? null : ctx.market?.contractLabel ?? null,
    continuous,
    proxyNote: ctx.market?.proxyNote ?? null,
    source: "Yahoo Finance",
    delayNote: delayNoteFor(asset, Boolean(ctx.market?.fxClose22)),
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
  lines.push(`# source,Yahoo Finance`);
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
