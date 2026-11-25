export type Tool = "cursor" | "hline" | "trend" | "fib" | "pitchfork" | "avwap" | "erase";

export type ChartType = "candle" | "line" | "ohlc";

export type SeriesMode = "contract" | "continuous";

export interface IndicatorToggles {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  sma200day: boolean;
  bb: boolean;
  rsi: boolean;
  stoch: boolean;
  macd: boolean;
  ichimoku: boolean;
  divergence: boolean;
}

export const DEFAULT_TOGGLES: IndicatorToggles = {
  sma20: true,
  sma50: true,
  sma200: true,
  sma200day: true,
  bb: true,
  rsi: true,
  stoch: true,
  macd: false,
  ichimoku: false,
  divergence: false,
};

export const TOOL_HINT: Record<Tool, string> = {
  cursor: "Drag to pan, scroll to zoom. Click a drawing to select it, Delete to remove it.",
  hline: "Click a price to place a horizontal level. Esc returns to the pointer.",
  trend: "Click two points. The line extends to the right.",
  fib: "Click the start of the swing, then the end. 0% is the second point.",
  pitchfork: "Click three pivots: P1 at the base, then P2 and P3.",
  avwap: "Click a bar to anchor VWAP. A second click adds another anchor. Needs volume.",
  erase: "Click a drawing to delete it.",
};
