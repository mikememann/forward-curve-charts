import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { IceProduct } from "@/config/markets";
import { DataError } from "@/lib/errors";
import {
  approxOhlc,
  closeBar,
  isNearExpiry,
  londonYmdFromUnix,
  parseIceGmt,
  parseIceStamp,
  stripLabel,
  stripMonthKey,
  weeklyCloses,
  type IcePrint,
} from "@/lib/iceBars";
import { closeOnOrBefore, curveSpreads, trimCurve } from "@/lib/curveMath";
import type { Bar, CurveResponse, Timeframe } from "@/lib/types";

/**
 * ICE Futures Europe charting JSON.
 *
 * Free to view for personal use. Not licensed for redistribution.
 * The product HTML pages sit behind Cloudflare; these JSON routes answer
 * a browser User-Agent from the server. Do not republish the prices.
 *
 * Product and hub ids (not the public spec id) were read from
 * /api/productguide/spec/{specId} on 25 Nov 2026:
 *   London cocoa  spec 37089076  product 15246  hub 17450  symbol C
 *   White sugar   spec 37089080  product 15249  hub 17453  symbol W
 *   Robusta       spec 37089079  product 15247  hub 17451  symbol RC
 *   UK feed wheat spec 37089081  product 15248  hub 17452  symbol T
 * These charting routes are undocumented and can change. Callers fall back
 * to the saved market ids, then to the old Yahoo or FRED stand-in.
 *
 * Cocoa marketId 8012782 is Dec26 and was already near expiry on 25 Nov 2026.
 * The default is the auto-roll front month, which was Mar27 (8174255).
 *
 * Intraday 10-minute closes are appended to a file
 * (ICE_CACHE_DIR, or the system temp directory). On Vercel that file lives
 * on the instance disk, so history builds up for the life of the instance.
 */

const ICE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const INTRADAY_TTL = 5 * 60_000;
const DAILY_TTL = 60 * 60_000;

export interface IceContract {
  marketId: number;
  /** ICE strip code, e.g. "Mar27". */
  strip: string;
  label: string;
  monthKey: string;
  lastPrice: number | null;
  /** Percent change versus the previous close, as ICE sends it (0.67 means +0.67%). */
  changePct: number | null;
  lastTimeUnix: number | null;
  /** Delivery month has started, or starts within 14 days. */
  nearExpiry: boolean;
}

/** Saved market ids used when contract-data does not answer. Checked on 25 Nov 2026. */
const FALLBACK_IDS: Record<number, { strip: string; marketId: number }[]> = {
  15246: [
    { strip: "Dec26", marketId: 8012782 },
    { strip: "Mar27", marketId: 8174255 },
    { strip: "May27", marketId: 8281909 },
    { strip: "Jul27", marketId: 8371777 },
    { strip: "Sep27", marketId: 8455871 },
    { strip: "Dec27", marketId: 8619196 },
    { strip: "Mar28", marketId: 8780483 },
    { strip: "May28", marketId: 8868778 },
    { strip: "Jul28", marketId: 8986762 },
  ],
  15249: [
    { strip: "Mar27", marketId: 7727276 },
    { strip: "May27", marketId: 7818934 },
    { strip: "Aug27", marketId: 7872615 },
    { strip: "Oct27", marketId: 7968671 },
    { strip: "Dec27", marketId: 8136768 },
  ],
  15247: [
    { strip: "Jan27", marketId: 8294126 },
    { strip: "Mar27", marketId: 8382509 },
    { strip: "May27", marketId: 8468273 },
    { strip: "Jul27", marketId: 8590646 },
    { strip: "Sep27", marketId: 8692529 },
    { strip: "Nov27", marketId: 8792341 },
  ],
  15248: [
    { strip: "May27", marketId: 8293778 },
    { strip: "Nov27", marketId: 8363327 },
  ],
};

const CLOSE_RANGE_WARNING =
  "Close-based series. Stochastic and ATR use this close range, so they understate the traded high and low.";

interface CacheEntry<T> {
  exp: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const job = load()
    .then((value) => {
      cache.set(key, { exp: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function iceJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ICE_UA,
        Accept: "application/json,text/plain,*/*",
        Referer: "https://www.ice.com/",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new DataError(`ICE HTTP ${res.status}`, url);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof DataError) throw e;
    throw new DataError(e instanceof Error ? e.message : "ICE request failed", url);
  } finally {
    clearTimeout(timer);
  }
}

interface ContractRow {
  marketId?: number;
  marketStrip?: string;
  lastPrice?: number | null;
  change?: number | null;
  lastTime?: string | null;
}

function withExpiry(row: Omit<IceContract, "nearExpiry">, now = new Date()): IceContract {
  return { ...row, nearExpiry: isNearExpiry(row.strip, now) };
}

function fallbackContracts(productId: number, now = new Date()): IceContract[] {
  return (FALLBACK_IDS[productId] ?? []).map((row) => withExpiry({
    marketId: row.marketId,
    strip: row.strip,
    label: stripLabel(row.strip),
    monthKey: stripMonthKey(row.strip),
    lastPrice: null,
    changePct: null,
    lastTimeUnix: null,
  }, now));
}

/** Live contract list. Falls back to the saved market ids when the endpoint fails. */
export async function loadContracts(product: IceProduct, now = new Date()): Promise<{ list: IceContract[]; fromFallback: boolean }> {
  const url = `https://www.ice.com/marketdata/api/productguide/charting/contract-data?productId=${product.productId}&hubId=${product.hubId}`;
  try {
    const list = await cached(`ice:contracts:${product.productId}:${product.hubId}`, INTRADAY_TTL, async () => {
      const rows = await iceJson<ContractRow[]>(url);
      if (!Array.isArray(rows) || rows.length === 0) throw new DataError("ICE returned no contracts", url);
      const parsed = rows
        .filter((row) => row.marketId != null && row.marketStrip)
        .map((row) => withExpiry({
          marketId: Number(row.marketId),
          strip: String(row.marketStrip),
          label: stripLabel(String(row.marketStrip)),
          monthKey: stripMonthKey(String(row.marketStrip)),
          lastPrice: typeof row.lastPrice === "number" && Number.isFinite(row.lastPrice) ? row.lastPrice : null,
          changePct: typeof row.change === "number" && Number.isFinite(row.change) ? row.change : null,
          lastTimeUnix: row.lastTime ? parseIceGmt(row.lastTime) : null,
        }, now));
      if (!parsed.length) throw new DataError("ICE contract list had no market ids", url);
      return parsed;
    });
    return { list, fromFallback: false };
  } catch {
    const list = fallbackContracts(product.productId, now);
    if (!list.length) throw new DataError("ICE contract list failed and there is no saved market id for this product", url);
    return { list, fromFallback: true };
  }
}

/** Auto-roll front month: first contract with a price that is not near expiry. */
export function front(list: IceContract[], now = new Date()): IceContract | null {
  const eligible = list.filter((c) => !isNearExpiry(c.strip, now));
  return eligible.find((c) => c.lastPrice != null) ?? eligible[0] ?? list.find((c) => c.lastPrice != null) ?? list[0] ?? null;
}

export function marketIdFor(list: IceContract[], strip: string): number | null {
  const wanted = strip.trim().toLowerCase();
  return list.find((c) => c.strip.toLowerCase() === wanted || c.label.toLowerCase() === wanted)?.marketId ?? null;
}

function cacheFile(marketId: number): string {
  const dir = process.env.ICE_CACHE_DIR || path.join(os.tmpdir(), "mm-charts-ice");
  return path.join(dir, `${marketId}.json`);
}

/** Merge today's 10-minute closes into the on-disk intraday cache and return every stored print. */
export async function appendIntradayCache(marketId: number, prints: IcePrint[]): Promise<IcePrint[]> {
  const file = cacheFile(marketId);
  await mkdir(path.dirname(file), { recursive: true });
  let days: Record<string, [number, number][]> = {};
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { days?: Record<string, [number, number][]> };
    days = parsed.days ?? {};
  } catch {
    days = {};
  }
  for (const p of prints) {
    const day = londonYmdFromUnix(p.time);
    const list = days[day] ?? [];
    const at = list.findIndex(([t]) => t === p.time);
    if (at >= 0) list[at] = [p.time, p.price];
    else list.push([p.time, p.price]);
    list.sort((a, b) => a[0] - b[0]);
    days[day] = list;
  }
  await writeFile(file, JSON.stringify({ days }));
  const all: IcePrint[] = [];
  for (const list of Object.values(days)) {
    for (const [time, price] of list) all.push({ time, price });
  }
  all.sort((a, b) => a.time - b.time);
  return all;
}

async function readPrints(url: string): Promise<IcePrint[]> {
  const body = await iceJson<{ bars?: [string, number][] }>(url);
  const bars = body.bars ?? [];
  const prints: IcePrint[] = [];
  for (const row of bars) {
    const time = parseIceStamp(String(row[0]));
    const price = Number(row[1]);
    if (time == null || !Number.isFinite(price)) continue;
    prints.push({ time, price });
  }
  prints.sort((a, b) => a.time - b.time);
  return prints;
}

/** historicalSpan 1 ≈ 3 months, 2 ≈ 1 year, 3 = the longest series ICE returns. */
export async function daily(marketId: number, span: 1 | 2 | 3): Promise<IcePrint[]> {
  const url = `https://www.ice.com/marketdata/api/productguide/charting/data/historical?marketId=${marketId}&historicalSpan=${span}`;
  return cached(`ice:daily:${marketId}:${span}`, DAILY_TTL, async () => {
    const prints = await readPrints(url);
    if (!prints.length) throw new DataError("ICE returned no daily closes", url);
    return prints;
  });
}

/** Today's 10-minute closes, merged into the persisted intraday cache. */
export async function intraday(marketId: number): Promise<IcePrint[]> {
  const url = `https://www.ice.com/marketdata/api/productguide/charting/data/current-day?marketId=${marketId}`;
  const today = await cached(`ice:intraday:${marketId}`, INTRADAY_TTL, async () => {
    const prints = await readPrints(url);
    if (!prints.length) throw new DataError("ICE returned no intraday prices", url);
    return prints;
  });
  return appendIntradayCache(marketId, today);
}

/** Daily closes plus today's last 10-minute price when the history stops at the previous session. */
export async function dailyWithToday(marketId: number, span: 1 | 2 | 3): Promise<{ bars: Bar[]; todayCount: number; intradayNote: string | null }> {
  const history = await daily(marketId, span);
  const bars = history.map((p) => closeBar(p.time, p.price));
  try {
    const live = await intraday(marketId);
    const today = londonYmdFromUnix(live[live.length - 1]?.time ?? 0);
    const session = live.filter((p) => londonYmdFromUnix(p.time) === today);
    const candle = approxOhlc(session, "day")[0];
    if (candle && !bars.some((b) => londonYmdFromUnix(b.time) === today)) {
      bars.push(candle);
      return { bars, todayCount: session.length, intradayNote: "Today's point is the latest 10-minute price, not the daily settlement." };
    }
    return { bars, todayCount: session.length, intradayNote: null };
  } catch {
    return { bars, todayCount: 0, intradayNote: "Today's 10-minute prices were unavailable, so the chart ends on the last historical close." };
  }
}

export interface IceSeries {
  bars: Bar[];
  dailyCloses: Bar[];
  warnings: string[];
  contract: IceContract;
  contracts: IceContract[];
  quoteTime: number | null;
  closeOnly: boolean;
  /** True when the chart is the auto-roll front month rather than a named strip. */
  rolled: boolean;
}

export async function loadIceSeries(product: IceProduct, timeframe: Timeframe, strip: string | null): Promise<IceSeries> {
  const { list, fromFallback } = await loadContracts(product);
  const contract = pickContract(list, strip);
  if (!contract) throw new DataError("ICE has no contract to chart", String(product.specId));
  const warnings = [CLOSE_RANGE_WARNING];
  if (fromFallback) {
    warnings.push("The contract list is the saved market ids. ICE's contract-data endpoint did not answer; these routes are undocumented and can change.");
  }
  const asked = strip?.trim().toLowerCase();
  const usingFront = !asked || asked === "front";
  if (!usingFront && contract.strip.toLowerCase() !== asked && contract.label.toLowerCase() !== asked) {
    warnings.push(`No ICE contract matched “${strip}”. Showing the front month, ${contract.label}.`);
  }
  if (contract.nearExpiry) warnings.push(`${contract.label} is in or near expiry. Front would have rolled past it.`);

  if (timeframe === "15m" || timeframe === "1h") {
    const prints = await intraday(contract.marketId);
    const today = londonYmdFromUnix(prints[prints.length - 1]?.time ?? 0);
    const todayCount = prints.filter((p) => londonYmdFromUnix(p.time) === today).length;
    const dailyBars = await daily(contract.marketId, 3).then((rows) => rows.map((p) => closeBar(p.time, p.price))).catch(() => [] as Bar[]);
    noteSparse(warnings, product, todayCount);
    if (timeframe === "1h") {
      warnings.push("1h candles are approximate. High and low are the max and min of the stored 10-minute closes in that hour, not the traded range. A new server has today only until the cache fills.");
      return series(approxOhlc(prints, "hour"), dailyBars, warnings, contract, list, prints.at(-1)?.time ?? null, usingFront);
    }
    warnings.push("The 15m view shows ICE's 10-minute closes. ICE does not publish 15-minute bars.");
    return series(prints.map((p) => closeBar(p.time, p.price)), dailyBars, warnings, contract, list, prints.at(-1)?.time ?? null, usingFront);
  }

  const built = await dailyWithToday(contract.marketId, 3);
  if (built.intradayNote) warnings.push(built.intradayNote);
  noteSparse(warnings, product, built.todayCount);
  if (timeframe === "1w") {
    warnings.push("Each weekly point is the last ICE daily close of that London week, not an OHLC week.");
    return series(weeklyCloses(built.bars), built.bars, warnings, contract, list, contract.lastTimeUnix ?? built.bars.at(-1)?.time ?? null, usingFront);
  }
  return series(built.bars, built.bars, warnings, contract, list, contract.lastTimeUnix ?? built.bars.at(-1)?.time ?? null, usingFront);
}

function series(
  bars: Bar[],
  dailyCloses: Bar[],
  warnings: string[],
  contract: IceContract,
  contracts: IceContract[],
  quoteTime: number | null,
  rolled: boolean,
): IceSeries {
  return { bars, dailyCloses, warnings, contract, contracts, quoteTime, closeOnly: false, rolled };
}

function noteSparse(warnings: string[], product: IceProduct, todayCount: number) {
  if (product.productId === 15248 && todayCount < 12) {
    warnings.push(`UK feed wheat intraday is thin${todayCount ? ` (${todayCount} ten-minute prices today)` : ""}. No prices are filled in to hide that.`);
  } else if (todayCount > 0 && todayCount < 6) {
    warnings.push(`Only ${todayCount} ten-minute prices so far today.`);
  }
}

/** "front" or blank rolls to the first contract that is not near expiry. A named strip is kept even if it is expiring. */
export function pickContract(list: IceContract[], strip: string | null, now = new Date()): IceContract | null {
  const wanted = strip?.trim().toLowerCase();
  if (wanted && wanted !== "front") {
    const hit = list.find((c) => c.strip.toLowerCase() === wanted || c.label.toLowerCase() === wanted);
    if (hit) return hit;
  }
  return front(list, now);
}

const DAY = 86_400;

/** Forward curve from the contract board only. Does not request a history file per month. */
export async function loadIceBoard(opts: {
  id: string;
  name: string;
  units: string;
  decimals: number;
  note: string;
  product: IceProduct;
  keep: (strip: string) => boolean;
}): Promise<CurveResponse> {
  const { list } = await loadContracts(opts.product);
  const kept = list.filter((c) => opts.keep(c.strip));
  const points = kept.map((c) => ({
    ticker: String(c.marketId),
    contract: c.label,
    month: c.monthKey,
    price: c.lastPrice,
    priceTimeUnix: c.lastTimeUnix,
    week: null,
    weekTimeUnix: null,
    monthAgo: null,
    monthAgoTimeUnix: null,
  }));
  return {
    id: opts.id,
    name: opts.name,
    units: opts.units,
    decimals: opts.decimals,
    source: "ICE",
    delayNote: "Delayed ICE last prices. Not a settlement file and not for redistribution.",
    fetchedAt: new Date().toISOString(),
    note: opts.note,
    points: trimCurve(points),
    gaps: points.filter((p) => p.price == null).map((p) => `${p.contract}: no price`),
    spreads: curveSpreads(points),
  };
}

export async function loadIceCurve(opts: {
  id: string;
  name: string;
  units: string;
  decimals: number;
  note: string;
  product: IceProduct;
}, now = new Date()): Promise<CurveResponse> {
  const discovered = await loadContracts(opts.product);
  const curveContracts = discovered.list;
  if (discovered.fromFallback) opts.note = `${opts.note} Contract months are the saved market ids because contract-data did not answer.`;
  const nowSec = Math.floor(now.getTime() / 1000);
  const histories = await mapPool(curveContracts, 4, async (c) => {
    try {
      const prints = await daily(c.marketId, 1);
      return { c, bars: prints.map((p) => closeBar(p.time, p.price)), error: null as string | null };
    } catch (e) {
      return { c, bars: [] as Bar[], error: e instanceof Error ? e.message : "no history" };
    }
  });
  const gaps: string[] = [];
  const points = histories.map(({ c, bars, error }) => {
    const lastHist = bars.at(-1) ?? null;
    const price = c.lastPrice ?? lastHist?.close ?? null;
    const priceTime = c.lastTimeUnix ?? lastHist?.time ?? null;
    if (price == null) {
      gaps.push(error ? `${c.label}: ${error}` : `${c.label}: no price`);
      return empty(c);
    }
    const fresh = priceTime != null && nowSec - priceTime <= 6 * DAY;
    if (!fresh) gaps.push(`${c.label}: last price is older than 6 days`);
    const week = closeOnOrBefore(bars, nowSec - 7 * DAY, 4 * DAY);
    const monthAgo = closeOnOrBefore(bars, nowSec - 30 * DAY, 7 * DAY);
    return {
      ticker: String(c.marketId),
      contract: c.label,
      month: c.monthKey,
      price: fresh ? price : null,
      priceTimeUnix: fresh ? priceTime : null,
      week: week?.close ?? null,
      weekTimeUnix: week?.time ?? null,
      monthAgo: monthAgo?.close ?? null,
      monthAgoTimeUnix: monthAgo?.time ?? null,
    };
  });
  const trimmed = trimCurve(points);
  return {
    id: opts.id,
    name: opts.name,
    units: opts.units,
    decimals: opts.decimals,
    source: "ICE",
    delayNote: "Delayed ICE last prices. Not a settlement file and not for redistribution.",
    fetchedAt: now.toISOString(),
    note: opts.note,
    points: trimmed,
    gaps,
    spreads: curveSpreads(trimmed),
  };
}

function empty(c: IceContract) {
  return {
    ticker: String(c.marketId),
    contract: c.label,
    month: c.monthKey,
    price: null,
    priceTimeUnix: null,
    week: null,
    weekTimeUnix: null,
    monthAgo: null,
    monthAgoTimeUnix: null,
  };
}

/** Front-month daily closes. Not a back-adjusted continuous series. */
export async function continuous(product: IceProduct): Promise<Bar[]> {
  const { list } = await loadContracts(product);
  const chosen = front(list);
  if (!chosen) throw new DataError("No front ICE contract", String(product.productId));
  return (await dailyWithToday(chosen.marketId, 3)).bars;
}

/** Front-month quote. Uses the last 10-minute price when the contract list has none. */
export async function quote(product: IceProduct): Promise<IceContract | null> {
  const { list } = await loadContracts(product);
  const chosen = front(list);
  if (!chosen) return null;
  if (chosen.lastPrice != null) return chosen;
  try {
    const prints = await intraday(chosen.marketId);
    const last = prints.at(-1);
    if (!last) return chosen;
    return { ...chosen, lastPrice: last.price, lastTimeUnix: last.time };
  } catch {
    return chosen;
  }
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}
