import type { Bar, Timeframe } from "@/lib/types";
import { londonYmd } from "@/lib/time";

function merge(prev: Bar, b: Bar): Bar {
  return {
    time: b.time,
    open: prev.open,
    high: Math.max(prev.high, b.high),
    low: Math.min(prev.low, b.low),
    close: b.close,
    volume: prev.volume + b.volume,
  };
}

/** Collapse Yahoo's trailing live tick into the bar it belongs to. */
export function bucketBars(bars: Bar[], timeframe: Timeframe): Bar[] {
  if (!bars.length) return [];
  if (timeframe === "15m" || timeframe === "1h") {
    const step = timeframe === "15m" ? 15 * 60 : 60 * 60;
    const map = new Map<number, Bar>();
    for (const b of bars) {
      const key = Math.floor(b.time / step) * step;
      const prev = map.get(key);
      map.set(key, prev ? merge({ ...prev, time: key }, { ...b, time: key }) : { ...b, time: key });
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }
  if (timeframe === "1d" || timeframe === "1w") {
    const map = new Map<string, Bar>();
    for (const b of bars) {
      const key = timeframe === "1d" ? londonYmd(new Date(b.time * 1000)) : String(Math.floor(b.time / (7 * 86400)));
      const prev = map.get(key);
      map.set(key, prev ? merge(prev, b) : { ...b });
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }
  return bars;
}
