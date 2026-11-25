import type { SourceChain, Timeframe } from "@/lib/types";

/** Below this, stop spending the weekly historical allowance and use the free series. */
export const IG_LOW_ALLOWANCE = 500;

/**
 * How many IG bars the visible chart asks for.
 * A full pass of the 15 MM markets at these sizes is 15 × 120 = 1,800 points,
 * not the 7,500 of loading 300 daily and 200 hourly bars for every market.
 */
export const IG_DEFAULT_BARS: Record<"15m" | "1h" | "1d", number> = {
  "15m": 64,
  "1h": 120,
  "1d": 120,
};

/** Hard cap for one epic. Daily 300 and hourly 200 match the allowance example. */
export const IG_MAX_BARS: Record<"15m" | "1h" | "1d", number> = {
  "15m": 100,
  "1h": 200,
  "1d": 300,
};

/** Daily requests above this use the free source. IG is for the recent candle window. */
export const IG_DAILY_SWITCH = 300;

export interface ChooseInput {
  chain: SourceChain | null;
  timeframe: Timeframe;
  /** Bars the caller asked for, before the IG cap. */
  requestedBars: number;
  epic: string | null;
  /** False when IG_API_KEY / IG_USERNAME / IG_PASSWORD are unset. */
  configured: boolean;
  /** Null until the first prices response. Treated as unknown, not low. */
  allowanceRemaining: number | null;
  /** User picked Free or IG. "auto" follows the chain. */
  override: "auto" | "ig" | "free";
}

export interface ChooseResult {
  feed: "ig" | "free";
  /** How many IG points to request when feed is ig. */
  igBars: number;
  reason: string | null;
}

export function chooseFeed(input: ChooseInput): ChooseResult {
  const long = input.timeframe === "1w" || (input.timeframe === "1d" && input.requestedBars > IG_DAILY_SWITCH);
  if (input.override === "free") {
    return { feed: "free", igBars: 0, reason: null };
  }
  if (input.timeframe === "1w") {
    return {
      feed: "free",
      igBars: 0,
      reason: input.override === "ig" ? "IG weekly history is not requested. Showing the free series." : null,
    };
  }
  const wantIg = input.override === "ig" || (!long && (input.chain?.candles[0] === "ig")) || (long && input.chain?.history[0] === "ig");
  if (!wantIg) {
    return {
      feed: "free",
      igBars: 0,
      reason: long && input.chain?.candles.includes("ig")
        ? "Longer history stays on the free source. IG points are a different unit and are not stitched on."
        : null,
    };
  }
  if (!input.epic) return { feed: "free", igBars: 0, reason: input.override === "ig" ? "This market has no IG epic." : null };
  if (!input.configured) return { feed: "free", igBars: 0, reason: input.override === "ig" ? "IG is not configured on the server, so the free series is shown." : null };
  if (input.allowanceRemaining != null && input.allowanceRemaining < IG_LOW_ALLOWANCE) {
    return { feed: "free", igBars: 0, reason: `IG historical allowance is ${input.allowanceRemaining}, under ${IG_LOW_ALLOWANCE}. Showing the free series.` };
  }
  const key = input.timeframe === "15m" || input.timeframe === "1h" || input.timeframe === "1d" ? input.timeframe : "1d";
  const igBars = Math.min(input.override === "ig" ? input.requestedBars : IG_DEFAULT_BARS[key], IG_MAX_BARS[key]);
  return { feed: "ig", igBars: Math.max(20, igBars), reason: null };
}

/** Points a full explicit load would spend: 15 markets × (300 daily + 200 hourly). Not the default. */
export function exampleFullLoadPoints(markets = 15): number {
  return markets * (IG_MAX_BARS["1d"] + IG_MAX_BARS["1h"]);
}
