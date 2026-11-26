import type { CurveResponse, OhlcResponse } from "@/lib/types";

const TTL_MS = 45_000;

interface Entry<T> {
  exp: number;
  body: T;
}

const ohlcCache = new Map<string, Entry<OhlcResponse>>();
const ohlcInflight = new Map<string, Promise<OhlcResponse>>();
const curveCache = new Map<string, Entry<CurveResponse>>();
const curveInflight = new Map<string, Promise<CurveResponse>>();

/** Same symbol and timeframe share one response across panes. */
export function fetchOhlc(url: string): Promise<OhlcResponse> {
  const hit = ohlcCache.get(url);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.body);
  const pending = ohlcInflight.get(url);
  if (pending) return pending;
  const job = fetch(url)
    .then(async (res) => {
      const body = (await res.json()) as OhlcResponse;
      if (!res.ok) throw new Error(body.error || "Couldn't load this symbol");
      ohlcCache.set(url, { exp: Date.now() + TTL_MS, body });
      return body;
    })
    .finally(() => ohlcInflight.delete(url));
  ohlcInflight.set(url, job);
  return job;
}

export function fetchCurve(marketId: string): Promise<CurveResponse> {
  const hit = curveCache.get(marketId);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.body);
  const pending = curveInflight.get(marketId);
  if (pending) return pending;
  const job = fetch(`/api/curve?market=${encodeURIComponent(marketId)}`)
    .then(async (res) => {
      const body = (await res.json()) as CurveResponse;
      if (!res.ok) throw new Error(body.error || "Couldn't load the curve");
      curveCache.set(marketId, { exp: Date.now() + TTL_MS, body });
      return body;
    })
    .finally(() => curveInflight.delete(marketId));
  curveInflight.set(marketId, job);
  return job;
}
