import { barsFromCache, decodeKv } from "@/lib/igParse";
import { londonYmd } from "@/lib/time";
import type { Bar } from "@/lib/types";

/** Ten years of daily bars, including weekends for power and macro series. */
export const HISTORY_BARS_1D = 4000;
/** About ten years of weeks. */
export const HISTORY_BARS_1W = 600;
/**
 * Recent IG daily bars joined onto the free history.
 * Ten years is never requested from IG.
 */
export const IG_TAIL_BARS = 40;

const SCALES = [0.01, 0.1, 1, 10, 100, 1000, 10000];

export function dayKey(unix: number): string {
  return londonYmd(new Date(unix * 1000));
}

/**
 * Median of primary/other closes on shared London days, snapped to a power of ten.
 * Brent's IG quote is about 100× the USD price. FX is about 10,000×. A noisy or
 * thin overlap returns null so the series is not joined.
 */
export function inferScale(primary: Bar[], other: Bar[]): number | null {
  const otherByDay = new Map<string, number>();
  for (const bar of other) {
    if (bar.close !== 0) otherByDay.set(dayKey(bar.time), bar.close);
  }
  const ratios: number[] = [];
  for (const bar of primary) {
    const ref = otherByDay.get(dayKey(bar.time));
    if (ref == null || ref === 0 || bar.close === 0) continue;
    ratios.push(bar.close / ref);
  }
  if (ratios.length < 8) return null;
  ratios.sort((a, b) => a - b);
  const mid = ratios[Math.floor(ratios.length / 2)];
  const low = ratios[Math.floor(ratios.length * 0.1)];
  const high = ratios[Math.floor(ratios.length * 0.9)];
  if (!(low > 0) || high / low > 1.12) return null;
  let best = SCALES[0];
  let err = Infinity;
  for (const scale of SCALES) {
    const next = Math.abs(mid - scale) / scale;
    if (next < err) {
      err = next;
      best = scale;
    }
  }
  if (err > 0.08) return null;
  return best;
}

/** Scale from the latest shared days. Older drift, such as a back-adjusted contract, is ignored. */
export function recentScale(primary: Bar[], other: Bar[]): number | null {
  const tail = [...primary].sort((a, b) => a.time - b.time).slice(-30);
  return inferScale(tail, other);
}

/** Divide OHLC by the IG/free factor so both series share the free unit. */
export function scaleBars(bars: Bar[], divisor: number): Bar[] {
  if (divisor === 1) return bars;
  return bars.map((bar) => ({
    time: bar.time,
    open: bar.open / divisor,
    high: bar.high / divisor,
    low: bar.low / divisor,
    close: bar.close / divisor,
    volume: bar.volume,
  }));
}

/** Overlay wins when both series have the same London day. */
export function stitchByDay(base: Bar[], overlay: Bar[]): Bar[] {
  const map = new Map<string, Bar>();
  for (const bar of base) map.set(dayKey(bar.time), bar);
  for (const bar of overlay) map.set(dayKey(bar.time), bar);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export function yearsBack(bars: Bar[], nowSec: number): number {
  const first = bars[0]?.time;
  if (!first) return 0;
  return (nowSec - first) / (365.25 * 86400);
}

export interface CachedHistory {
  bars: Bar[];
  freeLabel: string;
  sourceLabel: string;
  warnings: string[];
  units: string | null;
  continuousNote: string | null;
  exchangeName: string | null;
  currency: string | null;
  shortName: string | null;
  savedAt: number;
}

export function historyFromCache(input: unknown): CachedHistory | null {
  const value = decodeKv(input);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const bars = barsFromCache(row.bars);
  if (!bars?.length) return null;
  return {
    bars,
    freeLabel: typeof row.freeLabel === "string" ? row.freeLabel : "Free",
    sourceLabel: typeof row.sourceLabel === "string" ? row.sourceLabel : "Free",
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((w): w is string => typeof w === "string") : [],
    units: typeof row.units === "string" ? row.units : null,
    continuousNote: typeof row.continuousNote === "string" ? row.continuousNote : null,
    exchangeName: typeof row.exchangeName === "string" ? row.exchangeName : null,
    currency: typeof row.currency === "string" ? row.currency : null,
    shortName: typeof row.shortName === "string" ? row.shortName : null,
    savedAt: typeof row.savedAt === "number" ? row.savedAt : 0,
  };
}
