export interface Point {
  time: number;
  price: number;
}

export interface HLineDrawing {
  id: string;
  type: "hline";
  price: number;
}

export interface TrendDrawing {
  id: string;
  type: "trend";
  a: Point;
  b: Point;
}

export interface FibDrawing {
  id: string;
  type: "fib";
  /** Start of the swing. 100% sits here. */
  a: Point;
  /** End of the swing. 0% sits here. */
  b: Point;
}

export interface PitchforkDrawing {
  id: string;
  type: "pitchfork";
  a: Point;
  b: Point;
  c: Point;
}

export interface AvwapDrawing {
  id: string;
  type: "avwap";
  time: number;
  slot: 1 | 2;
}

export type TradeDirection = "long" | "short" | "context";

export interface TradeDrawing {
  id: string;
  type: "trade";
  direction: TradeDirection;
  entryLow: number | null;
  entryHigh: number | null;
  stop: number | null;
  t1: number | null;
  t2: number | null;
}

export type Drawing = HLineDrawing | TrendDrawing | FibDrawing | PitchforkDrawing | AvwapDrawing | TradeDrawing;

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** 0% at the end of the swing (b), 100% at the start (a). */
export function fibLevels(a: number, b: number): { ratio: number; price: number }[] {
  return FIB_RATIOS.map((ratio) => ({ ratio, price: b + ratio * (a - b) }));
}

export function riskReward(t: Pick<TradeDrawing, "entryLow" | "entryHigh" | "stop" | "t1" | "t2">): {
  mid: number;
  risk: number;
  rr1: number | null;
  rr2: number | null;
  stopAtr: number | null;
} | null {
  if (t.entryLow == null || t.entryHigh == null || t.stop == null) return null;
  if (![t.entryLow, t.entryHigh, t.stop].every((n) => Number.isFinite(n))) return null;
  const mid = (t.entryLow + t.entryHigh) / 2;
  const risk = Math.abs(t.stop - mid);
  if (risk === 0) return null;
  return {
    mid,
    risk,
    rr1: t.t1 == null || !Number.isFinite(t.t1) ? null : Math.abs(t.t1 - mid) / risk,
    rr2: t.t2 == null || !Number.isFinite(t.t2) ? null : Math.abs(t.t2 - mid) / risk,
    stopAtr: null,
  };
}

export function timeForIndex(times: number[], index: number): number {
  if (!times.length) return 0;
  if (index <= 0) return times[0];
  const last = times.length - 1;
  if (index >= last) {
    const step = last > 0 ? times[last] - times[last - 1] : 3600;
    return times[last] + (index - last) * step;
  }
  const i0 = Math.floor(index);
  const f = index - i0;
  return times[i0] + f * (times[i0 + 1] - times[i0]);
}

export function indexForTime(times: number[], time: number): number {
  if (!times.length) return 0;
  if (time <= times[0]) return 0;
  const last = times.length - 1;
  if (time >= times[last]) {
    const step = last > 0 ? times[last] - times[last - 1] : 3600;
    return last + (time - times[last]) / (step || 1);
  }
  let lo = 0;
  let hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  return span === 0 ? lo : lo + (time - times[lo]) / span;
}

export interface ForkLines {
  median: { i: number; price: number }[];
  upper: { i: number; price: number }[];
  lower: { i: number; price: number }[];
  handle: boolean;
}

/** Andrews pitchfork in bar-index space. Null if two pivots share a bar. */
export function pitchforkLines(
  a: { i: number; price: number },
  b: { i: number; price: number },
  c: { i: number; price: number },
  extendTo: number,
): ForkLines | null {
  if (a.i === b.i || a.i === c.i || b.i === c.i) return null;
  const mi = (b.i + c.i) / 2;
  const mp = (b.price + c.price) / 2;
  if (mi === a.i) return null;
  const slope = (mp - a.price) / (mi - a.i);
  const from = Math.min(a.i, b.i, c.i);
  const to = Math.max(extendTo, a.i, b.i, c.i);
  const samples = [from, a.i, b.i, c.i, mi, to];
  const uniq = [...new Set(samples.map((n) => Math.round(n * 1000) / 1000))].sort((x, y) => x - y);
  const along = (originI: number, originP: number) =>
    uniq.filter((i) => i >= originI - 1e-6).map((i) => ({ i, price: originP + slope * (i - originI) }));
  return {
    median: along(a.i, a.price),
    upper: along(b.i, b.price),
    lower: along(c.i, c.price),
    handle: true,
  };
}

export interface Swing {
  highIndex: number;
  lowIndex: number;
}

/**
 * Most recent swing inside the window, matching the analyst's chart script.
 * "short" and "context" retrace a down-swing; "long" retraces an up-swing.
 */
export function autoSwing(bars: { high: number; low: number }[], direction: "long" | "short" | "context"): Swing | null {
  const n = bars.length;
  if (n < 10) return null;
  const r0 = n - Math.max(Math.floor(n / 3), 5);
  const back = Math.max(Math.floor(n / 2), 10);
  if (direction === "long") {
    let hi = r0;
    for (let i = r0; i < n; i++) if (bars[i].high > bars[hi].high) hi = i;
    const s0 = Math.max(0, hi - back);
    let lo = s0;
    for (let i = s0; i <= hi; i++) if (bars[i].low < bars[lo].low) lo = i;
    if (lo === hi) return null;
    return { highIndex: hi, lowIndex: lo };
  }
  let lo = r0;
  for (let i = r0; i < n; i++) if (bars[i].low < bars[lo].low) lo = i;
  const s0 = Math.max(0, lo - back);
  let hi = s0;
  for (let i = s0; i <= lo; i++) if (bars[i].high > bars[hi].high) hi = i;
  if (lo === hi) return null;
  return { highIndex: hi, lowIndex: lo };
}

export interface ZigZagPivot {
  index: number;
  price: number;
  kind: "H" | "L";
}

/** Alternating pivots with a minimum percent reversal. Last running extreme is kept. */
export function zigzag(bars: { high: number; low: number }[], pct: number): ZigZagPivot[] {
  if (!bars.length) return [];
  const piv: ZigZagPivot[] = [];
  let trend = 0;
  let hiI = 0;
  let hiP = bars[0].high;
  let loI = 0;
  let loP = bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].high > hiP) {
      hiI = i;
      hiP = bars[i].high;
    }
    if (bars[i].low < loP) {
      loI = i;
      loP = bars[i].low;
    }
    if (trend >= 0 && bars[i].low <= hiP * (1 - pct) && hiI < i) {
      if (trend === 0 || !piv.length || piv[piv.length - 1].kind !== "H") piv.push({ index: hiI, price: hiP, kind: "H" });
      trend = -1;
      loI = i;
      loP = bars[i].low;
    } else if (trend <= 0 && bars[i].high >= loP * (1 + pct) && loI < i) {
      if (trend === 0 || !piv.length || piv[piv.length - 1].kind !== "L") piv.push({ index: loI, price: loP, kind: "L" });
      trend = 1;
      hiI = i;
      hiP = bars[i].high;
    }
    if (trend === -1 && bars[i].low < loP) {
      loI = i;
      loP = bars[i].low;
    }
    if (trend === 1 && bars[i].high > hiP) {
      hiI = i;
      hiP = bars[i].high;
    }
  }
  return piv;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}
