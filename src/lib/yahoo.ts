import "server-only";
import { DataError } from "@/lib/errors";
import type { Bar } from "@/lib/types";

export interface YahooMeta {
  currency: string | null;
  symbol: string | null;
  exchangeName: string | null;
  instrumentType: string | null;
  shortName: string | null;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  regularMarketChangePercent: number | null;
  previousClose: number | null;
}

export interface YahooChart {
  meta: YahooMeta;
  bars: Bar[];
}

export class YahooError extends DataError {
  constructor(message: string, symbol: string) {
    super(message, symbol);
    this.name = "YahooError";
  }
}

interface CacheEntry {
  expires: number;
  value: YahooChart;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<YahooChart>>();

function ttlFor(interval: string): number {
  if (interval === "1d" || interval === "1wk" || interval === "1mo") return 5 * 60_000;
  return 45_000;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseYahooChart(symbol: string, body: unknown): YahooChart {
  const root = body as { chart?: { result?: unknown[]; error?: { description?: string; code?: string } } };
  const err = root.chart?.error;
  if (err) {
    throw new YahooError(err.description || err.code || "Yahoo Finance returned an error", symbol);
  }
  const result = root.chart?.result?.[0] as
    | {
        meta?: Record<string, unknown>;
        timestamp?: number[];
        indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
      }
    | undefined;
  if (!result) throw new YahooError("Yahoo Finance returned no data", symbol);
  const metaRaw = result.meta ?? {};
  const meta: YahooMeta = {
    currency: typeof metaRaw.currency === "string" ? metaRaw.currency : null,
    symbol: typeof metaRaw.symbol === "string" ? metaRaw.symbol : symbol,
    exchangeName: typeof metaRaw.exchangeName === "string" ? metaRaw.exchangeName : null,
    instrumentType: typeof metaRaw.instrumentType === "string" ? metaRaw.instrumentType : null,
    shortName: typeof metaRaw.shortName === "string" ? metaRaw.shortName : typeof metaRaw.longName === "string" ? metaRaw.longName : null,
    regularMarketPrice: num(metaRaw.regularMarketPrice),
    regularMarketTime: num(metaRaw.regularMarketTime),
    regularMarketChangePercent: num(metaRaw.regularMarketChangePercent),
    previousClose: num(metaRaw.previousClose),
  };
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  const bars: Bar[] = [];
  if (q) {
    for (let i = 0; i < ts.length; i++) {
      const open = q.open?.[i];
      const high = q.high?.[i];
      const low = q.low?.[i];
      const close = q.close?.[i];
      if (open == null || high == null || low == null || close == null) continue;
      if (![open, high, low, close].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      const volume = q.volume?.[i];
      bars.push({
        time: ts[i],
        open,
        high,
        low,
        close,
        volume: typeof volume === "number" && Number.isFinite(volume) ? volume : 0,
      });
    }
  }
  bars.sort((a, b) => a.time - b.time);
  return { meta, bars };
}

async function fetchHost(host: string, symbol: string, interval: string, range: string): Promise<YahooChart> {
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}&includePrePost=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MMCharts/1.0)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new YahooError(`Yahoo Finance HTTP ${res.status}`, symbol);
    }
    const body: unknown = await res.json();
    return parseYahooChart(symbol, body);
  } catch (e) {
    if (e instanceof YahooError) throw e;
    const msg = e instanceof Error ? e.message : "request failed";
    throw new YahooError(`Yahoo Finance request failed (${msg})`, symbol);
  } finally {
    clearTimeout(timer);
  }
}

export async function yahooChart(symbol: string, interval: string, range: string): Promise<YahooChart> {
  const key = `${symbol}|${interval}|${range}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = yahooChartUncached(symbol, interval, range, key).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function yahooChartUncached(symbol: string, interval: string, range: string, key: string): Promise<YahooChart> {
  let last: unknown;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const value = await fetchHost(host, symbol, interval, range);
      cache.set(key, { expires: Date.now() + ttlFor(interval), value });
      return value;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new YahooError("Yahoo Finance request failed", symbol);
}

export async function yahooSearch(query: string): Promise<{ symbol: string; name: string; type: string; exchange: string }[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MMCharts/1.0)", Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new YahooError(`Yahoo search HTTP ${res.status}`, query);
    const body = (await res.json()) as { quotes?: { symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string }[] };
    return (body.quotes ?? [])
      .filter((q) => q.symbol && ["EQUITY", "ETF", "FUTURE", "INDEX", "CURRENCY"].includes(q.quoteType ?? ""))
      .map((q) => ({
        symbol: q.symbol as string,
        name: q.shortname || q.longname || (q.symbol as string),
        type: q.quoteType || "",
        exchange: q.exchDisp || "",
      }));
  } finally {
    clearTimeout(timer);
  }
}
