import { DEFAULT_TOGGLES, type ChartType, type IndicatorToggles, type SeriesMode } from "@/components/uiTypes";
import type { Timeframe } from "@/lib/types";

export type LayoutCount = 1 | 2 | 4 | 6;

export interface PaneSettings {
  marketId: string;
  timeframe: Timeframe;
  seriesMode: SeriesMode;
  chartType: ChartType;
  logScale: boolean;
  show: IndicatorToggles;
  view: "chart" | "curve";
  /** ICE delivery strip. "front" rolls past a month that is near expiry. */
  strip: string;
}

export interface DeskLayout {
  layout: LayoutCount;
  active: number;
  syncCrosshair: boolean;
  /** Pan and zoom one pane and the others follow the same time window. */
  syncTime: boolean;
  linkSymbol: boolean;
  /** Stored panes, up to 6. `layout` is how many are on screen. */
  panes: PaneSettings[];
}

const INDICATOR_KEYS: (keyof IndicatorToggles)[] = [
  "sma20",
  "sma50",
  "sma200",
  "sma200day",
  "bb",
  "rsi",
  "stoch",
  "macd",
  "ichimoku",
  "divergence",
];

export function paneSettings(marketId: string, timeframe: Timeframe = "1d", seriesMode: SeriesMode = "contract"): PaneSettings {
  return {
    marketId,
    timeframe,
    seriesMode,
    chartType: "candle",
    logScale: false,
    show: { ...DEFAULT_TOGGLES },
    view: "chart",
    strip: "front",
  };
}

/** Brent Feb contract, GBP/USD, spot gold (continuous), FTSE, all daily. */
export const PRESET_4: PaneSettings[] = [
  paneSettings("brent", "1d", "contract"),
  paneSettings("gbpusd", "1d", "contract"),
  paneSettings("gold", "1d", "continuous"),
  paneSettings("ftse", "1d", "contract"),
];

/** The four-pane preset plus Chicago wheat and London cocoa. */
export const PRESET_6: PaneSettings[] = [
  ...PRESET_4,
  paneSettings("wheat", "1d", "contract"),
  paneSettings("cocoa", "1d", "contract"),
];

export function singleLayout(marketId = "brent", timeframe: Timeframe = "1h"): DeskLayout {
  return {
    layout: 1,
    active: 0,
    syncCrosshair: false,
    syncTime: false,
    linkSymbol: false,
    panes: [paneSettings(marketId, timeframe, marketId === "gold" ? "continuous" : "contract")],
  };
}

export function presetLayout(n: 4 | 6): DeskLayout {
  const panes = (n === 6 ? PRESET_6 : PRESET_4).map((p) => ({ ...p, show: { ...p.show } }));
  return { layout: n, active: 0, syncCrosshair: false, syncTime: false, linkSymbol: false, panes };
}

/**
 * Change how many panes are visible.
 * Switching from a single chart to 4 or 6 applies that preset.
 * Shrinking keeps the panes so expanding again restores them.
 * Growing from an existing multi-chart fills the new slots from the preset.
 */
export function setLayoutCount(desk: DeskLayout, n: LayoutCount): DeskLayout {
  if (n === desk.layout) return desk;
  if ((n === 4 || n === 6) && desk.layout === 1 && desk.panes.length <= 1) {
    return presetLayout(n);
  }
  const panes = desk.panes.map((p) => ({ ...p, show: { ...p.show } }));
  const preset = n === 6 ? PRESET_6 : PRESET_4;
  while (panes.length < n) {
    const seed = preset[panes.length] ?? preset[0];
    panes.push({ ...seed, show: { ...seed.show } });
  }
  return { ...desk, layout: n, active: Math.min(desk.active, n - 1), panes };
}

function maskOf(show: IndicatorToggles): string {
  let bits = 0;
  INDICATOR_KEYS.forEach((key, i) => {
    if (show[key]) bits |= 1 << i;
  });
  return bits.toString(16);
}

function showOf(mask: string): IndicatorToggles {
  const bits = Number.parseInt(mask, 16);
  const show = { ...DEFAULT_TOGGLES };
  if (!Number.isFinite(bits)) return show;
  INDICATOR_KEYS.forEach((key, i) => {
    show[key] = (bits & (1 << i)) !== 0;
  });
  return show;
}

const TF = new Set<Timeframe>(["15m", "1h", "1d", "1w"]);

function encodePane(p: PaneSettings): string {
  const mode = p.seriesMode === "continuous" ? "x" : "c";
  const view = p.view === "curve" ? "v" : "h";
  const type = p.chartType === "line" ? "l" : p.chartType === "ohlc" ? "o" : "k";
  return [p.marketId, p.timeframe, mode, view, type, p.logScale ? "1" : "0", maskOf(p.show), p.strip || "front"].join(".");
}

function decodePane(raw: string): PaneSettings | null {
  const [marketId, tf, mode, view, type, log, mask, strip] = raw.split(".");
  if (!marketId || !TF.has(tf as Timeframe)) return null;
  return {
    marketId,
    timeframe: tf as Timeframe,
    seriesMode: mode === "x" ? "continuous" : "contract",
    view: view === "v" ? "curve" : "chart",
    chartType: type === "l" ? "line" : type === "o" ? "ohlc" : "candle",
    logScale: log === "1",
    show: mask ? showOf(mask) : { ...DEFAULT_TOGGLES },
    strip: strip || "front",
  };
}

export function encodeLayout(desk: DeskLayout): string {
  const params = new URLSearchParams();
  params.set("layout", String(desk.layout));
  params.set("i", String(desk.active));
  if (desk.syncCrosshair) params.set("sync", "1");
  if (desk.syncTime) params.set("time", "1");
  if (desk.linkSymbol) params.set("link", "1");
  params.set("panes", desk.panes.map(encodePane).join(","));
  const active = desk.panes[desk.active];
  if (active) {
    params.set("m", active.marketId);
    params.set("tf", active.timeframe);
    if (active.view === "curve") params.set("view", "curve");
    if (active.strip) params.set("strip", active.strip);
  }
  return params.toString();
}

export function decodeLayout(search: string): DeskLayout | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const panesRaw = params.get("panes");
  if (!panesRaw) return null;
  const panes = panesRaw.split(",").map(decodePane);
  if (panes.some((p) => p == null) || panes.length < 1 || panes.length > 6) return null;
  const layoutNum = Number(params.get("layout") ?? panes.length);
  const layout: LayoutCount = layoutNum === 2 || layoutNum === 4 || layoutNum === 6 ? layoutNum : 1;
  const count = layout === 1 ? 1 : layout;
  const decoded = panes.filter((p): p is PaneSettings => p != null);
  if (decoded.length < count) return null;
  const active = Math.min(Math.max(0, Number(params.get("i") ?? 0) || 0), count - 1);
  return {
    layout,
    active,
    syncCrosshair: params.get("sync") === "1",
    syncTime: params.get("time") === "1",
    linkSymbol: params.get("link") === "1",
    panes: decoded.slice(0, Math.max(count, decoded.length)),
  };
}
