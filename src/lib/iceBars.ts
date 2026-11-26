import type { Bar } from "@/lib/types";
import { londonParts } from "@/lib/time";

/**
 * ICE Futures Europe charting stamps are exchange-local clock times with no
 * zone. London softs trade on the London clock, so these are Europe/London.
 */

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const ICE_STAMP = /^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;

/** Unix seconds for a Europe/London wall-clock time. */
export function londonWallToUnix(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = londonOffsetMs(utcGuess);
  let unixMs = utcGuess - offset;
  const corrected = londonOffsetMs(unixMs);
  if (corrected !== offset) unixMs = utcGuess - corrected;
  return Math.round(unixMs / 1000);
}

function londonOffsetMs(utcMs: number): number {
  const parts = londonParts(new Date(utcMs));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const utcMinute = utcMs - (utcMs % 60_000);
  return asUtc - utcMinute;
}

/** "Wed Nov 25 09:30:00 2026" → unix seconds in Europe/London. */
export function parseIceStamp(value: string): number | null {
  const m = ICE_STAMP.exec(value.trim());
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  return londonWallToUnix(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

/** "11/25/2026 04:52 PM GMT" → unix seconds. The field is explicitly GMT. */
export function parseIceGmt(value: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}) (AM|PM) GMT$/i.exec(value.trim());
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  return Math.round(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5])) / 1000);
}

/** "Dec26" → "Dec 2026". Unknown shapes are returned unchanged. */
export function stripLabel(strip: string): string {
  const m = /^([A-Za-z]{3})(\d{2})$/.exec(strip.trim());
  if (!m || !MONTHS[m[1]]) return strip;
  return `${m[1]} ${2000 + Number(m[2])}`;
}

const NEAR_EXPIRY_DAYS = 14;

/** First calendar day of the delivery month named by a strip such as "Dec26". */
export function deliveryMonthStart(strip: string): { year: number; month: number } | null {
  const m = /^([A-Za-z]{3})(\d{2})$/.exec(strip.trim());
  if (!m || !MONTHS[m[1]]) return null;
  return { year: 2000 + Number(m[2]), month: MONTHS[m[1]] };
}

/**
 * A contract is near expiry when its delivery month has started, or starts
 * within 14 days. On 25 Nov 2026 that drops cocoa Dec26 and keeps robusta Jan27.
 */
export function isNearExpiry(strip: string, now = new Date()): boolean {
  const start = deliveryMonthStart(strip);
  if (!start) return false;
  const today = londonParts(now);
  const days = (Date.UTC(start.year, start.month - 1, 1) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000;
  return days < NEAR_EXPIRY_DAYS;
}

/** "Dec26" → "2026-12", for curve month keys. */
export function stripMonthKey(strip: string): string {
  const m = /^([A-Za-z]{3})(\d{2})$/.exec(strip.trim());
  if (!m || !MONTHS[m[1]]) return strip;
  return `${2000 + Number(m[2])}-${String(MONTHS[m[1]]).padStart(2, "0")}`;
}

export function closeBar(time: number, price: number): Bar {
  return { time, open: price, high: price, low: price, close: price, volume: 0 };
}

export interface IcePrint {
  time: number;
  price: number;
}

/**
 * Approximate OHLC from close-only prints. High and low are the max and min
 * of those closes, so they understate the traded range.
 */
export function approxOhlc(prints: IcePrint[], bucket: "hour" | "day"): Bar[] {
  const groups = new Map<number, number[]>();
  for (const p of prints) {
    const parts = londonParts(new Date(p.time * 1000));
    const key = bucket === "hour"
      ? londonWallToUnix(parts.year, parts.month, parts.day, parts.hour, 0, 0)
      : londonWallToUnix(parts.year, parts.month, parts.day, 0, 0, 0);
    const list = groups.get(key);
    if (list) list.push(p.price);
    else groups.set(key, [p.price]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, prices]) => ({
      time,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: 0,
    }));
}

/** One bar per London hour. High and low are the max and min of the 10-minute closes. */
export function approxHourCandles(prints: IcePrint[]): Bar[] {
  return approxOhlc(prints, "hour");
}

/** One close-only bar per London week, plotted on the day of that week's last daily close. */
export function weeklyCloses(daily: Bar[]): Bar[] {
  const groups = new Map<string, { time: number; close: number }>();
  for (const bar of daily) {
    const parts = londonParts(new Date(bar.time * 1000));
    const key = mondayOf(parts.year, parts.month, parts.day).key;
    const prev = groups.get(key);
    if (!prev || bar.time >= prev.time) groups.set(key, { time: bar.time, close: bar.close });
  }
  return [...groups.values()]
    .sort((a, b) => a.time - b.time)
    .map((g) => closeBar(g.time, g.close));
}

function mondayOf(year: number, month: number, day: number): { key: string } {
  const utc = new Date(Date.UTC(year, month - 1, day));
  const wd = utc.getUTCDay();
  const delta = wd === 0 ? 6 : wd - 1;
  utc.setUTCDate(utc.getUTCDate() - delta);
  const y = utc.getUTCFullYear();
  const m = utc.getUTCMonth() + 1;
  const d = utc.getUTCDate();
  return { key: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

export function londonYmdFromUnix(unix: number): string {
  const p = londonParts(new Date(unix * 1000));
  return p.ymd;
}
