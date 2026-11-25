import "server-only";
import { bucketBars } from "@/lib/bucket";
import { previousFromChange } from "@/lib/format";
import { delayNoteFor, presentMarkets, type MarketView } from "@/lib/marketModel";
import { formatLondon, fxSessionReference, isStaleQuote } from "@/lib/time";
import type { Quote } from "@/lib/types";
import { yahooChart, YahooError } from "@/lib/yahoo";

export async function loadQuotes(extraTickers: string[] = []): Promise<Quote[]> {
  const views = presentMarkets();
  const main = await mapPool(views, 6, (view) => quoteForView(view));
  const extras = extraTickers.filter((t) => !views.some((v) => v.ticker.toUpperCase() === t.toUpperCase() || v.continuous?.toUpperCase() === t.toUpperCase() || v.contractTicker?.toUpperCase() === t.toUpperCase()));
  const custom = await mapPool(extras, 4, (ticker) => quoteForCustom(ticker));
  return [...main, ...custom];
}

async function quoteForView(view: MarketView): Promise<Quote> {
  try {
    return await buildQuote(view.ticker, view);
  } catch (e) {
    return blank(view, e instanceof Error ? e.message : "Couldn't load");
  }
}

async function quoteForCustom(ticker: string): Promise<Quote> {
  const stub: MarketView = {
    id: `custom:${ticker}`,
    name: ticker,
    group: "Custom",
    units: "",
    assetClass: "equity",
    ticker,
    contractTicker: null,
    contractLabel: null,
    contract: null,
    continuous: null,
    preferContinuous: false,
    proxyNote: null,
    pence: false,
    fxClose22: false,
    hideStale: false,
    decimals: 2,
    curveId: null,
  };
  try {
    const q = await buildQuote(ticker, stub);
    q.name = q.currency ? ticker : ticker;
    return q;
  } catch (e) {
    return blank(stub, e instanceof Error ? e.message : "Couldn't load");
  }
}

async function buildQuote(ticker: string, view: MarketView): Promise<Quote> {
  const interval = view.fxClose22 ? "1h" : "1d";
  const chart = await yahooChart(ticker, interval, "10d");
  const bars = bucketBars(chart.bars, view.fxClose22 ? "1h" : "1d");
  if (!bars.length && chart.meta.regularMarketPrice == null) {
    throw new YahooError(`No quote for ${ticker}`, ticker);
  }
  const lastBar = bars[bars.length - 1] ?? null;
  const asOfUnix = chart.meta.regularMarketTime ?? lastBar?.time ?? null;
  const stale = view.hideStale && isStaleQuote(lastBar?.time ?? asOfUnix);
  const currency = view.pence ? "GBp" : chart.meta.currency;
  const base: Quote = {
    id: view.id,
    ticker,
    name: chart.meta.shortName && view.group === "Custom" ? chart.meta.shortName : view.name,
    group: view.group,
    units: view.units || (view.pence ? "p" : currency || ""),
    contractLabel: view.preferContinuous ? null : view.contractLabel,
    proxy: Boolean(view.proxyNote),
    proxyNote: view.proxyNote,
    pence: view.pence,
    decimals: view.decimals,
    last: null,
    change: null,
    changePct: null,
    changeBasis: null,
    referenceTimeUnix: null,
    currency,
    asOfUnix,
    lastUpdatedLabel: lastBar ? formatLondon(lastBar.time, "date") : null,
    stale,
    delayNote: delayNoteFor(view.assetClass, view.fxClose22),
    hasCurve: Boolean(view.curveId),
    error: null,
  };
  if (stale) {
    base.last = null;
    base.change = null;
    base.changePct = null;
    base.changeBasis = null;
    return base;
  }
  const last = chart.meta.regularMarketPrice ?? lastBar?.close ?? null;
  if (view.fxClose22) {
    const ref = fxSessionReference(bars.map((b) => ({ time: b.time, close: b.close })));
    base.last = last;
    if (ref && last != null && ref.close !== 0) {
      base.change = last - ref.close;
      base.changePct = (base.change / ref.close) * 100;
      base.changeBasis = "22:00 UK";
      base.referenceTimeUnix = ref.time;
    } else {
      base.change = null;
      base.changePct = null;
      base.changeBasis = "22:00 UK unavailable";
    }
    return base;
  }
  let prev: number | null = null;
  if (last != null && chart.meta.regularMarketChangePercent != null) {
    prev = previousFromChange(last, chart.meta.regularMarketChangePercent);
  }
  if (prev == null && chart.meta.previousClose != null) prev = chart.meta.previousClose;
  if (prev == null && bars.length >= 2) prev = bars[bars.length - 2].close;
  base.last = last;
  if (last != null && prev != null && prev !== 0) {
    base.change = last - prev;
    base.changePct = (base.change / prev) * 100;
    base.changeBasis = "previous close";
  }
  if (view.pence) base.units = "p";
  if (!base.lastUpdatedLabel && asOfUnix) base.lastUpdatedLabel = formatLondon(asOfUnix, "date");
  return base;
}

function blank(view: MarketView, error: string): Quote {
  return {
    id: view.id,
    ticker: view.ticker,
    name: view.name,
    group: view.group,
    units: view.units,
    contractLabel: view.contractLabel,
    proxy: Boolean(view.proxyNote),
    proxyNote: view.proxyNote,
    pence: view.pence,
    decimals: view.decimals,
    last: null,
    change: null,
    changePct: null,
    changeBasis: null,
    referenceTimeUnix: null,
    currency: null,
    asOfUnix: null,
    lastUpdatedLabel: null,
    stale: false,
    delayNote: delayNoteFor(view.assetClass, view.fxClose22),
    hasCurve: Boolean(view.curveId),
    error,
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}
