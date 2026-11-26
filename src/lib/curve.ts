import "server-only";
import { curveContractList } from "@/lib/contracts";
import { closeOnOrBefore, curveSpreads, trimCurve } from "@/lib/curveMath";
import type { CurveDef } from "@/lib/marketModel";
import { bucketBars } from "@/lib/bucket";
import type { CurvePoint, CurveResponse } from "@/lib/types";
import { yahooChart } from "@/lib/yahoo";

const DAY = 86_400;

export async function loadCurve(def: CurveDef, now = new Date()): Promise<CurveResponse> {
  if (!def.spec) throw new Error(`No Yahoo contract spec for ${def.id}`);
  const contracts = curveContractList(def.spec, def.count + 2, now);
  const nowSec = Math.floor(now.getTime() / 1000);
  const fetched = await mapPool(contracts, 6, async (c) => {
    try {
      const chart = await yahooChart(c.ticker, "1d", "6mo");
      const bars = bucketBars(chart.bars, "1d");
      return { c, bars, error: null as string | null };
    } catch (e) {
      return { c, bars: [], error: e instanceof Error ? e.message : "no data" };
    }
  });

  const gaps: string[] = [];
  const points: CurvePoint[] = fetched.map(({ c, bars, error }) => {
    const last = bars[bars.length - 1];
    const fresh = last && nowSec - last.time <= 6 * DAY;
    if (!fresh) {
      gaps.push(error ? `${c.ticker} (${c.label}): ${error}` : `${c.ticker} (${c.label}): no daily close in the last 6 days`);
      return emptyPoint(c);
    }
    const week = closeOnOrBefore(bars, nowSec - 7 * DAY, 4 * DAY);
    const monthAgo = closeOnOrBefore(bars, nowSec - 30 * DAY, 7 * DAY);
    return {
      ticker: c.ticker,
      contract: c.label,
      month: c.monthKey,
      price: last.close,
      priceTimeUnix: last.time,
      week: week?.close ?? null,
      weekTimeUnix: week?.time ?? null,
      monthAgo: monthAgo?.close ?? null,
      monthAgoTimeUnix: monthAgo?.time ?? null,
    };
  });

  const trimmed = trimCurve(points);
  return {
    id: def.id,
    name: def.name,
    units: def.units,
    decimals: def.decimals,
    source: "Yahoo Finance",
    delayNote: "Futures settlements on Yahoo are typically delayed 10–30 minutes. Each point is that contract's latest daily bar, timestamped on the point.",
    fetchedAt: now.toISOString(),
    note: def.note,
    points: trimmed,
    gaps,
    spreads: curveSpreads(trimmed),
  };
}

function emptyPoint(c: { ticker: string; label: string; monthKey: string }): CurvePoint {
  return {
    ticker: c.ticker,
    contract: c.label,
    month: c.monthKey,
    price: null,
    priceTimeUnix: null,
    week: null,
    weekTimeUnix: null,
    monthAgo: null,
    monthAgoTimeUnix: null,
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}
