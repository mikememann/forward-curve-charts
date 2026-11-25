import type { NativeFrequency } from "@/config/markets";
import { londonYmd } from "@/lib/time";
import type { Bar, Timeframe } from "@/lib/types";

const RANK: Record<NativeFrequency | Timeframe, number> = {
  "15m": 1,
  "30m": 2,
  "1h": 3,
  "1d": 4,
  "1w": 5,
  "1mo": 6,
};

/** Turn a finer series into the requested step, or keep the native step if the request is finer. */
export function fitFrequency(
  bars: Bar[],
  native: NativeFrequency,
  requested: Timeframe,
): { bars: Bar[]; warning: string | null } {
  if (!bars.length) return { bars, warning: null };
  if (RANK[requested] < RANK[native]) {
    return {
      bars,
      warning: `No ${requested} history. Showing the ${label(native)} observations instead of filling the gaps.`,
    };
  }
  if (RANK[requested] === RANK[native] || (native === "30m" && requested === "15m")) {
    return { bars, warning: native === "30m" ? "Half-hourly prints. Not 15-minute bars." : null };
  }
  const step = requested === "1h" ? "1h" : requested === "1d" ? "1d" : requested === "1w" ? "1w" : "1mo";
  if (RANK[step] <= RANK[native]) return { bars, warning: null };
  return {
    bars: bucket(bars, step),
    warning:
      step === "1d"
        ? "Daily bars are the open, high, low and close of the finer prints that day, not an exchange settlement."
        : step === "1w"
          ? "Weekly bars are aggregated from the finer series."
          : null,
  };
}

function label(f: NativeFrequency): string {
  if (f === "1mo") return "monthly";
  if (f === "1w") return "weekly";
  if (f === "1d") return "daily";
  if (f === "30m") return "half-hourly";
  if (f === "1h") return "hourly";
  return "15-minute";
}

export function bucket(bars: Bar[], step: "1h" | "1d" | "1w" | "1mo"): Bar[] {
  const map = new Map<string, Bar>();
  for (const b of bars) {
    const key = keyOf(b.time, step);
    const prev = map.get(key);
    if (!prev) map.set(key, { ...b });
    else {
      prev.high = Math.max(prev.high, b.high);
      prev.low = Math.min(prev.low, b.low);
      prev.close = b.close;
      prev.volume += b.volume;
      prev.time = b.time;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function keyOf(unix: number, step: "1h" | "1d" | "1w" | "1mo"): string {
  if (step === "1h") return String(Math.floor(unix / 3600) * 3600);
  const ymd = londonYmd(new Date(unix * 1000));
  if (step === "1d") return ymd;
  if (step === "1mo") return ymd.slice(0, 7);
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc.toISOString().slice(0, 10);
}

export function bar(time: number, close: number, volume = 0): Bar {
  return { time, open: close, high: close, low: close, close, volume };
}

export function parseDay(ymd: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = Date.parse(`${ymd}T12:00:00Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}

export function parseMonthCode(code: string): number | null {
  const m = /^(\d{4})M(\d{2})$/.exec(code.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-01T12:00:00Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}
