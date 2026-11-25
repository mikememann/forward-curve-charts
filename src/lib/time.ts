/** Calendar helpers. Display and the FX session are Europe/London. */

export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  ymd: string;
}

export function londonParts(date: Date): LondonParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) bag[p.type] = p.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const ymd = `${bag.year}-${bag.month}-${bag.day}`;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    ymd,
  };
}

export function londonYmd(date: Date): string {
  return londonParts(date).ymd;
}

export function addDaysYmd(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function weekdayIndex(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

/** London business days strictly after `fromYmd` and up to and including `toYmd`. */
export function businessDaysBetween(fromYmd: string, toYmd: string): number {
  if (toYmd <= fromYmd) return 0;
  let n = 0;
  let cur = fromYmd;
  let guard = 0;
  while (cur < toYmd && guard < 4000) {
    cur = addDaysYmd(cur, 1);
    const wd = weekdayIndex(cur);
    if (wd !== 0 && wd !== 6) n++;
    guard++;
  }
  return n;
}

export function formatLondon(unixSec: number, mode: "datetime" | "date" | "time" = "datetime"): string {
  const d = new Date(unixSec * 1000);
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Europe/London" };
  if (mode === "date") {
    opts.day = "2-digit";
    opts.month = "short";
    opts.year = "numeric";
  } else if (mode === "time") {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
    opts.hourCycle = "h23";
  } else {
    opts.day = "2-digit";
    opts.month = "short";
    opts.year = "numeric";
    opts.hour = "2-digit";
    opts.minute = "2-digit";
    opts.hourCycle = "h23";
  }
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "n/a";
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * Price at the 22:00 Europe/London FX close.
 * Hourly bars are stamped at the start of the hour, so the 22:00 print
 * is the close of the bar that starts at 21:00 London.
 * Returns null when that bar is not in the series — callers must not
 * substitute Yahoo's official daily close.
 */
export function fxSessionReference(
  bars: { time: number; close: number }[],
  now = new Date(),
): { close: number; time: number } | null {
  if (!bars.length) return null;
  const nowP = londonParts(now);
  const sessionYmd = nowP.hour >= 22 ? nowP.ymd : addDaysYmd(nowP.ymd, -1);
  const matches = bars.filter((b) => {
    const p = londonParts(new Date(b.time * 1000));
    return p.ymd === sessionYmd && p.hour === 21;
  });
  const bar = matches[matches.length - 1];
  if (!bar || !Number.isFinite(bar.close)) return null;
  return { close: bar.close, time: bar.time + 3600 };
}

export function isStaleQuote(lastBarUnix: number | null, now = new Date()): boolean {
  if (lastBarUnix == null) return true;
  const lastYmd = londonYmd(new Date(lastBarUnix * 1000));
  const today = londonYmd(now);
  return businessDaysBetween(lastYmd, today) > 1;
}
