export type Timeframe = "15m" | "1h" | "1d" | "1w";

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EnrichedBar extends Bar {
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  bbMid: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  rsi14: number | null;
  stochK: number | null;
  stochD: number | null;
  atr14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  tenkan: number | null;
  kijun: number | null;
  spanA: number | null;
  spanB: number | null;
}

export interface Divergence {
  kind: "bull" | "bear";
  osc: "rsi" | "stoch";
  time1: number;
  time2: number;
  price1: number;
  price2: number;
  osc1: number;
  osc2: number;
}

export interface OhlcResponse {
  ticker: string;
  marketId: string | null;
  name: string | null;
  timeframe: Timeframe;
  currency: string | null;
  units: string | null;
  pence: boolean;
  instrumentName: string | null;
  exchange: string | null;
  contractLabel: string | null;
  continuous: boolean;
  proxyNote: string | null;
  infoNote: string | null;
  exactness: string | null;
  licence: string | null;
  attribution: string | null;
  source: string;
  delayNote: string;
  times: "Europe/London";
  fetchedAt: string;
  lastBarUnix: number | null;
  quoteTimeUnix: number | null;
  /** Age of the Yahoo quote timestamp, in seconds, at fetchedAt. */
  ageSeconds: number | null;
  lastPrice: number | null;
  stale: boolean;
  staleReason: string | null;
  sma200Daily: number | null;
  warnings: string[];
  bars: EnrichedBar[];
  /** ICE delivery months, when this chart is an ICE contract. */
  iceContracts?: { marketId: number; strip: string; label: string; nearExpiry?: boolean }[];
  /** Strip actually plotted, e.g. "Dec26". */
  iceStrip?: string | null;
  error?: string;
}

export interface Quote {
  id: string;
  ticker: string;
  name: string;
  group: string;
  units: string;
  contractLabel: string | null;
  proxy: boolean;
  proxyNote: string | null;
  exactness: string | null;
  sourceName: string | null;
  licence: string | null;
  pence: boolean;
  decimals: number;
  last: number | null;
  change: number | null;
  changePct: number | null;
  changeBasis: string | null;
  referenceTimeUnix: number | null;
  currency: string | null;
  asOfUnix: number | null;
  lastUpdatedLabel: string | null;
  stale: boolean;
  delayNote: string;
  hasCurve: boolean;
  error: string | null;
}

export interface CurvePoint {
  ticker: string;
  contract: string;
  month: string;
  price: number | null;
  priceTimeUnix: number | null;
  week: number | null;
  weekTimeUnix: number | null;
  monthAgo: number | null;
  monthAgoTimeUnix: number | null;
}

export interface CurveSpread {
  label: string;
  from: string | null;
  to: string | null;
  value: number | null;
  structure: "backwardation" | "contango" | "flat" | null;
  reason: string | null;
}

export interface CurveResponse {
  id: string;
  name: string;
  units: string;
  decimals: number;
  source: string;
  delayNote: string;
  fetchedAt: string;
  note: string;
  points: CurvePoint[];
  gaps: string[];
  spreads: CurveSpread[];
  error?: string;
}

export interface SearchHit {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
}
