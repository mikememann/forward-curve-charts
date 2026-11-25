import type { Bar, Divergence, EnrichedBar } from "@/lib/types";

/**
 * Indicator math aligned with the analyst's chart script:
 * SMA (not EMA) for 20/50/200, Bollinger with population stdev (ddof 0),
 * RSI and ATR as Wilder EWMA (pandas ewm alpha=1/n, adjust=False),
 * slow stochastic (14, 3, 3). MACD is EMA 12/26/9, same EWMA seeding.
 * Ichimoku spans are the unshifted values; plot them 26 bars ahead.
 */

function rollingMean(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function rollingStdPop(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += values[j];
    const mean = sum / n;
    let ss = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = values[j] - mean;
      ss += d * d;
    }
    out[i] = Math.sqrt(ss / n);
  }
  return out;
}

function rollingMin(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.min(m, values[j]);
    out[i] = m;
  }
  return out;
}

function rollingMax(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}

/** EWMA, adjust=False. Leading nulls are skipped; the first finite value seeds. */
function ewm(values: (number | null)[], alpha: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let y: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (x == null || !Number.isFinite(x)) continue;
    y = y == null ? x : alpha * x + (1 - alpha) * y;
    out[i] = y;
  }
  return out;
}

function round(n: number | null, dp = 6): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function lastSma(closes: number[], n: number): number | null {
  if (closes.length < n) return null;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i];
  return sum / n;
}

/**
 * `closeOnly` is for a feed that publishes the close and nothing else.
 * SMA, Bollinger, RSI and MACD still use that close. Stochastic, ATR and
 * Ichimoku need a high and a low, so they are left empty rather than
 * computed from a made-up range.
 */
export function enrich(bars: Bar[], opts?: { closeOnly?: boolean }): EnrichedBar[] {
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const sma20 = rollingMean(close, 20);
  const sma50 = rollingMean(close, 50);
  const sma200 = rollingMean(close, 200);
  const sd = rollingStdPop(close, 20);

  const diff: (number | null)[] = close.map((c, i) => (i === 0 ? null : c - close[i - 1]));
  const up = diff.map((d) => (d == null ? null : d > 0 ? d : 0));
  const dn = diff.map((d) => (d == null ? null : d < 0 ? -d : 0));
  const au = ewm(up, 1 / 14);
  const ad = ewm(dn, 1 / 14);

  const tr: (number | null)[] = bars.map((b, i) => {
    if (i === 0) return null;
    const pc = close[i - 1];
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
  const atr = ewm(tr, 1 / 14);

  const ll = rollingMin(low, 14);
  const hh = rollingMax(high, 14);
  const fastK: (number | null)[] = close.map((c, i) => {
    if (ll[i] == null || hh[i] == null) return null;
    const span = (hh[i] as number) - (ll[i] as number);
    if (span === 0) return null;
    return (100 * (c - (ll[i] as number))) / span;
  });
  const slowK: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (i < 2) continue;
    const w = [fastK[i - 2], fastK[i - 1], fastK[i]];
    if (w.some((v) => v == null)) continue;
    slowK[i] = ((w[0] as number) + (w[1] as number) + (w[2] as number)) / 3;
  }
  const slowD: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i++) {
    if (i < 2) continue;
    const w = [slowK[i - 2], slowK[i - 1], slowK[i]];
    if (w.some((v) => v == null)) continue;
    slowD[i] = ((w[0] as number) + (w[1] as number) + (w[2] as number)) / 3;
  }

  const ema12 = ewm(close, 2 / 13);
  const ema26 = ewm(close, 2 / 27);
  const macdLine: (number | null)[] = close.map((_, i) =>
    ema12[i] == null || ema26[i] == null ? null : (ema12[i] as number) - (ema26[i] as number),
  );
  const signal = ewm(macdLine, 2 / 10);

  const tenkan = donchianMid(high, low, 9);
  const kijun = donchianMid(high, low, 26);
  const spanB = donchianMid(high, low, 52);
  const spanA: (number | null)[] = close.map((_, i) =>
    tenkan[i] == null || kijun[i] == null ? null : ((tenkan[i] as number) + (kijun[i] as number)) / 2,
  );

  return bars.map((b, i) => {
    const rsi = au[i] == null || ad[i] == null ? null : (ad[i] as number) === 0 ? 100 : 100 - 100 / (1 + (au[i] as number) / (ad[i] as number));
    const mid = sma20[i];
    const s = sd[i];
    const closeOnly = Boolean(opts?.closeOnly);
    return {
      ...b,
      sma20: round(mid),
      sma50: round(sma50[i]),
      sma200: round(sma200[i]),
      bbMid: round(mid),
      bbUpper: round(mid == null || s == null ? null : mid + 2 * s),
      bbLower: round(mid == null || s == null ? null : mid - 2 * s),
      rsi14: round(rsi, 4),
      stochK: closeOnly ? null : round(slowK[i], 4),
      stochD: closeOnly ? null : round(slowD[i], 4),
      atr14: closeOnly ? null : round(atr[i]),
      macd: round(macdLine[i]),
      macdSignal: round(signal[i]),
      macdHist: round(macdLine[i] == null || signal[i] == null ? null : (macdLine[i] as number) - (signal[i] as number)),
      tenkan: closeOnly ? null : round(tenkan[i]),
      kijun: closeOnly ? null : round(kijun[i]),
      spanA: closeOnly ? null : round(spanA[i]),
      spanB: closeOnly ? null : round(spanB[i]),
    };
  });
}

function donchianMid(high: number[], low: number[], n: number): (number | null)[] {
  const hi = rollingMax(high, n);
  const lo = rollingMin(low, n);
  return high.map((_, i) => (hi[i] == null || lo[i] == null ? null : ((hi[i] as number) + (lo[i] as number)) / 2));
}

export function findDivergences(bars: EnrichedBar[], osc: "rsi" | "stoch", daily: boolean): Divergence[] {
  const k = daily ? 3 : 2;
  const hiTh = osc === "rsi" ? 55 : 70;
  const loTh = osc === "rsi" ? 45 : 30;
  const value = (i: number) => (osc === "rsi" ? bars[i].rsi14 : bars[i].stochK);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = k; i < bars.length - k; i++) {
    let maxH = -Infinity;
    let minL = Infinity;
    for (let j = i - k; j <= i + k; j++) {
      maxH = Math.max(maxH, bars[j].high);
      minL = Math.min(minL, bars[j].low);
    }
    if (bars[i].high === maxH) highs.push(i);
    if (bars[i].low === minL) lows.push(i);
  }
  const res: Divergence[] = [];
  for (let n = 1; n < highs.length; n++) {
    const a = highs[n - 1];
    const b = highs[n];
    if (b - a < 4) continue;
    const oa = value(a);
    const ob = value(b);
    if (oa == null || ob == null) continue;
    if (bars[b].high > bars[a].high && ob < oa && oa > hiTh) {
      res.push({
        kind: "bear",
        osc,
        time1: bars[a].time,
        time2: bars[b].time,
        price1: bars[a].high,
        price2: bars[b].high,
        osc1: oa,
        osc2: ob,
      });
    }
  }
  for (let n = 1; n < lows.length; n++) {
    const a = lows[n - 1];
    const b = lows[n];
    if (b - a < 4) continue;
    const oa = value(a);
    const ob = value(b);
    if (oa == null || ob == null) continue;
    if (bars[b].low < bars[a].low && ob > oa && oa < loTh) {
      res.push({
        kind: "bull",
        osc,
        time1: bars[a].time,
        time2: bars[b].time,
        price1: bars[a].low,
        price2: bars[b].low,
        osc1: oa,
        osc2: ob,
      });
    }
  }
  const cutoff = bars.length - Math.max(Math.floor(bars.length / 4), 20);
  return res.filter((r) => {
    const i2 = bars.findIndex((b) => b.time === r.time2);
    return i2 >= cutoff;
  });
}

/** Anchored VWAP from the first bar at or after `anchorTime`. Null when there is no volume. */
export function anchoredVwap(
  bars: { time: number; high: number; low: number; close: number; volume: number }[],
  anchorTime: number,
): { time: number; value: number }[] | null {
  const i0 = bars.findIndex((b) => b.time >= anchorTime);
  if (i0 < 0) return null;
  let pv = 0;
  let v = 0;
  const out: { time: number; value: number }[] = [];
  for (let i = i0; i < bars.length; i++) {
    const b = bars[i];
    if (!(b.volume > 0)) continue;
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    v += b.volume;
    out.push({ time: b.time, value: pv / v });
  }
  return v > 0 ? out : null;
}
