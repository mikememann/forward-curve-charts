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

export interface IgPricesBody {
  prices?: IgPriceBar[];
  metadata?: { allowance?: Partial<IgAllowance> };
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

/** Keep the newest bar for each timestamp. */
export function mergeBars(existing: Bar[], incoming: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of existing) byTime.set(bar.time, bar);
  for (const bar of incoming) byTime.set(bar.time, bar);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
