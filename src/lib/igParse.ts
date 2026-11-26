import type { Bar } from "@/lib/types";

export interface IgQuote {
  bid?: number | null;
  ask?: number | null;
  lastTraded?: number | null;
}

export interface IgPriceBar {
  snapshotTime?: string;
  snapshotTimeUTC?: string;
  openPrice?: IgQuote;
  highPrice?: IgQuote;
  lowPrice?: IgQuote;
  closePrice?: IgQuote;
  lastTradedVolume?: number | null;
}

export interface IgAllowance {
  remainingAllowance: number;
  totalAllowance: number;
  allowanceExpiry: number;
}

export interface IgPageData {
  pageNumber?: number;
  pageSize?: number;
  totalPages?: number;
}

export interface IgPricesBody {
  prices?: IgPriceBar[];
  metadata?: { allowance?: Partial<IgAllowance>; pageData?: IgPageData };
}

/**
 * IG v3 pages prices. The default page size is 20 and page 1 is the oldest
 * page, so max=N without pageSize=0 can omit the newest bars.
 * pageSize=0 asks for the whole window in one response.
 */
export function priceQuery(resolution: string, max: number): URLSearchParams {
  return new URLSearchParams({
    resolution,
    max: String(max),
    pageSize: "0",
  });
}

/** Page numbers still to fetch when page 1 is not the last page. */
export function extraPageNumbers(page: IgPageData | undefined): number[] {
  const total = page?.totalPages ?? 1;
  const current = page?.pageNumber ?? 1;
  if (!Number.isFinite(total) || !Number.isFinite(current) || total <= current) return [];
  const out: number[] = [];
  for (let n = current + 1; n <= total && out.length < 8; n++) out.push(n);
  return out;
}

export function pageQuery(resolution: string, max: number, pageNumber: number, pageSize: number): URLSearchParams {
  const params = priceQuery(resolution, max);
  params.set("pageSize", String(pageSize > 0 ? pageSize : 20));
  params.set("pageNumber", String(pageNumber));
  return params;
}

/** Mid of bid and ask. Last traded is used only when one side of the quote is missing. */
export function igMid(quote: IgQuote | undefined): number | null {
  if (!quote) return null;
  const bid = typeof quote.bid === "number" ? quote.bid : null;
  const ask = typeof quote.ask === "number" ? quote.ask : null;
  if (bid != null && ask != null) return (bid + ask) / 2;
  if (typeof quote.lastTraded === "number") return quote.lastTraded;
  return bid ?? ask;
}

export function parseIgStamp(utc: string | undefined): number | null {
  if (!utc) return null;
  const ms = Date.parse(utc.endsWith("Z") ? utc : `${utc}Z`);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

export function parseIgPrices(body: IgPricesBody): { bars: Bar[]; allowance: IgAllowance | null } {
  const bars: Bar[] = [];
  for (const row of body.prices ?? []) {
    const time = parseIgStamp(row.snapshotTimeUTC);
    const open = igMid(row.openPrice);
    const high = igMid(row.highPrice);
    const low = igMid(row.lowPrice);
    const close = igMid(row.closePrice);
    if (time == null || open == null || high == null || low == null || close == null) continue;
    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: typeof row.lastTradedVolume === "number" ? row.lastTradedVolume : 0,
    });
  }
  bars.sort((a, b) => a.time - b.time);
  const raw = body.metadata?.allowance;
  const allowance = raw && typeof raw.remainingAllowance === "number" && typeof raw.totalAllowance === "number"
    ? {
        remainingAllowance: raw.remainingAllowance,
        totalAllowance: raw.totalAllowance,
        allowanceExpiry: typeof raw.allowanceExpiry === "number" ? raw.allowanceExpiry : 0,
      }
    : null;
  return { bars, allowance };
}

/**
 * Upstash and Vercel KV REST return `{ result }`. The value may already be
 * parsed (array or object) or still be a JSON string, sometimes twice,
 * because the writer stored `JSON.stringify` of a string.
 * Anything that is not the expected shape is a cache miss.
 */
export function decodeKv(input: unknown): unknown {
  let value = input;
  for (let i = 0; i < 2 && isEnvelope(value); i++) value = value.result;
  for (let i = 0; i < 3 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return value;
}

function isEnvelope(value: unknown): value is { result: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return "result" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function barsFromCache(input: unknown): Bar[] | null {
  const value = decodeKv(input);
  if (!Array.isArray(value)) return null;
  const bars: Bar[] = [];
  for (const row of value) {
    if (!isRecord(row)) return null;
    const time = row.time;
    const open = row.open;
    const high = row.high;
    const low = row.low;
    const close = row.close;
    if (typeof time !== "number" || typeof open !== "number" || typeof high !== "number" || typeof low !== "number" || typeof close !== "number") return null;
    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume: typeof row.volume === "number" ? row.volume : 0,
    });
  }
  return bars;
}

export function allowanceFromCache(input: unknown): IgAllowance | null {
  const value = decodeKv(input);
  if (!isRecord(value)) return null;
  if (typeof value.remainingAllowance !== "number" || typeof value.totalAllowance !== "number") return null;
  return {
    remainingAllowance: value.remainingAllowance,
    totalAllowance: value.totalAllowance,
    allowanceExpiry: typeof value.allowanceExpiry === "number" ? value.allowanceExpiry : 0,
  };
}

/** Session tokens are not written to KV today. This is the same read rule if a payload is ever stored. */
export function sessionFromCache(input: unknown): { cst: string; token: string } | null {
  const value = decodeKv(input);
  if (!isRecord(value)) return null;
  if (typeof value.cst !== "string" || typeof value.token !== "string" || !value.cst || !value.token) return null;
  return { cst: value.cst, token: value.token };
}

/** Keep the newest bar for each timestamp. */
export function mergeBars(existing: Bar[], incoming: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of existing) byTime.set(bar.time, bar);
  for (const bar of incoming) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
