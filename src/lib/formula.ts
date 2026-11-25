import "server-only";
import { bar } from "@/lib/aggregate";
import { DataError } from "@/lib/errors";
import { evalFormula, formulaIds, parseFormula } from "@/lib/formulaMath";
import { enrich } from "@/lib/indicators";
import { findMarket } from "@/lib/marketModel";
import { loadOhlc } from "@/lib/ohlc";
import { londonYmd } from "@/lib/time";
import type { OhlcResponse, Timeframe } from "@/lib/types";

export async function loadFormula(formula: string, timeframe: Timeframe, bars?: number): Promise<OhlcResponse> {
  const ast = parseFormula(formula);
  const ids = [...new Set(formulaIds(ast))];
  if (ids.length < 2) throw new DataError("A formula needs at least two series. Example: brent - wti");
  if (ids.length > 6) throw new DataError("A formula can use at most six series");
  const legs = await Promise.all(ids.map(async (id) => {
    const market = findMarket(id);
    if (!market) throw new DataError(`Unknown series '${id}'. Use a market id such as brent, wti or us-10y.`);
    const payload = await loadOhlc({ ticker: market.ticker, timeframe, bars: 2000, market });
    return { id, payload };
  }));
  const daily = legs.every((leg) => medianGap(leg.payload.bars.map((b) => b.time)) >= 20 * 3600);
  const maps = legs.map((leg) => {
    const map = new Map<string, number>();
    for (const point of leg.payload.bars) {
      map.set(daily ? londonYmd(new Date(point.time * 1000)) : String(point.time), point.close);
    }
    return map;
  });
  const keys = [...maps[0].keys()].filter((key) => maps.every((map) => map.has(key))).sort();
  const computed = keys.flatMap((key) => {
    const values: Record<string, number> = {};
    ids.forEach((id, index) => {
      values[id] = maps[index].get(key) as number;
    });
    const value = evalFormula(ast, values);
    if (value == null) return [];
    const time = daily ? Date.parse(`${key}T12:00:00Z`) / 1000 : Number(key);
    return [bar(time, value)];
  });
  if (!computed.length) throw new DataError("The series do not overlap, so the formula has no points");
  const enriched = enrich(computed).slice(-(bars ?? 800));
  const last = enriched.at(-1);
  return {
    ticker: formula,
    marketId: null,
    name: formula,
    timeframe,
    currency: null,
    units: null,
    pence: false,
    instrumentName: null,
    exchange: null,
    contractLabel: null,
    continuous: false,
    proxyNote: null,
    infoNote: "Custom spread. A point is kept only when every leg has a bar on that timestamp (or that London date, for daily series). Division by zero is left out.",
    exactness: "proxy",
    licence: "Derived from the leg series. Each leg keeps its own licence and must not be redistributed beyond that.",
    attribution: legs.map((leg) => leg.payload.attribution || leg.payload.source).filter(Boolean).join("; "),
    source: "Derived",
    delayNote: "As fresh as the slowest leg.",
    times: "Europe/London",
    fetchedAt: new Date().toISOString(),
    lastBarUnix: last?.time ?? null,
    quoteTimeUnix: last?.time ?? null,
    ageSeconds: last ? Math.max(0, Math.round(Date.now() / 1000 - last.time)) : null,
    lastPrice: last?.close ?? null,
    stale: false,
    staleReason: null,
    sma200Daily: null,
    warnings: legs.flatMap((leg) => leg.payload.warnings.map((w) => `${leg.id}: ${w}`)),
    bars: enriched,
  };
}

function medianGap(times: number[]): number {
  if (times.length < 2) return 86_400;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 86_400;
}
