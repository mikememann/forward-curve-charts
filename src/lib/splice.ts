import type { Bar } from "@/lib/types";

/** 1 short ton = 0.907185 metric tonnes, so USD/short ton × this = USD/t. */
export const SHORT_TON_TO_TONNE = 1.10231;

/** A splice gap wider than this is called out. Neither series is rescaled. */
export const LARGE_GAP = 0.1;

export interface WeekPoint {
  time: number;
  close: number;
  states: string[];
}

/** "€1,452.09", "1452.09", or "1.452,09". */
export function parseEuroPrice(raw: string): number | null {
  const cleaned = raw.replace(/€/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  let text = cleaned;
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) text = cleaned.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d+$/.test(cleaned)) text = cleaned.replace(",", ".");
  else text = cleaned.replace(/,/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** One price per member state per week, then the simple average of the states that published. */
export function averageStates(rows: { state: string; time: number; price: number }[]): WeekPoint[] {
  const byWeek = new Map<number, Map<string, number[]>>();
  for (const row of rows) {
    if (!row.state || !Number.isFinite(row.price)) continue;
    let states = byWeek.get(row.time);
    if (!states) {
      states = new Map();
      byWeek.set(row.time, states);
    }
    const list = states.get(row.state) ?? [];
    list.push(row.price);
    states.set(row.state, list);
  }
  const out: WeekPoint[] = [];
  for (const [time, states] of byWeek) {
    const codes = [...states.keys()].sort();
    if (!codes.length) continue;
    const values = codes.map((code) => {
      const list = states.get(code) ?? [];
      return list.reduce((sum, n) => sum + n, 0) / list.length;
    });
    const close = values.reduce((sum, n) => sum + n, 0) / values.length;
    out.push({ time, close, states: codes });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** Latest FX print on or before `time`. */
export function rateOnOrBefore(rates: Bar[], time: number): number | null {
  let best: number | null = null;
  for (const rate of rates) {
    if (rate.time <= time + 36 * 3600) best = rate.close;
    else break;
  }
  return best;
}

export function toUsd(eur: WeekPoint[], rates: Bar[]): Bar[] {
  const bars: Bar[] = [];
  for (const week of eur) {
    const fx = rateOnOrBefore(rates, week.time);
    if (fx == null) continue;
    const close = week.close * fx;
    bars.push({ time: week.time, open: close, high: close, low: close, close, volume: 0 });
  }
  return bars;
}

export function scaleBars(bars: Bar[], factor: number): Bar[] {
  return bars.map((bar) => ({
    time: bar.time,
    open: bar.open * factor,
    high: bar.high * factor,
    low: bar.low * factor,
    close: bar.close * factor,
    volume: bar.volume,
  }));
}

/** Hold each monthly close until the day before the next observation, so the line does not interpolate. */
export function stepMonthly(monthly: Bar[], until?: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < monthly.length; i++) {
    const cur = monthly[i];
    out.push(cur);
    const nextTime = monthly[i + 1]?.time ?? until;
    if (nextTime != null && nextTime - cur.time > 10 * 86400) {
      const hold = nextTime - 86400;
      if (hold > cur.time) out.push({ ...cur, time: hold });
    }
  }
  return out;
}

export interface SpliceJoin {
  bars: Bar[];
  spliceTime: number | null;
  gap: number | null;
  monthlyClose: number | null;
  recentClose: number | null;
}

/** Monthly history up to the first recent bar, then the recent series. No level adjustment. */
export function spliceSeries(monthly: Bar[], recent: Bar[]): SpliceJoin {
  const recentSorted = [...recent].sort((a, b) => a.time - b.time);
  if (!recentSorted.length) {
    return { bars: stepMonthly(monthly), spliceTime: null, gap: null, monthlyClose: null, recentClose: null };
  }
  const start = recentSorted[0].time;
  const prior = monthly.filter((bar) => bar.time < start).sort((a, b) => a.time - b.time);
  const last = prior.at(-1) ?? null;
  const gap = last && last.close !== 0 ? (recentSorted[0].close - last.close) / last.close : null;
  const map = new Map<number, Bar>();
  for (const bar of stepMonthly(prior, start)) map.set(bar.time, bar);
  for (const bar of recentSorted) map.set(bar.time, bar);
  return {
    bars: [...map.values()].sort((a, b) => a.time - b.time),
    spliceTime: start,
    gap,
    monthlyClose: last?.close ?? null,
    recentClose: recentSorted[0].close,
  };
}
