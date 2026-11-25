"use client";

import { hitTest, renderScene, type AvwapPath, type CloudSeg, type DrawScene } from "@/components/drawLayer";
import type { ChartType, IndicatorToggles, Tool } from "@/components/uiTypes";
import { anchoredVwap, findDivergences } from "@/lib/indicators";
import { indexForTime, newId, timeForIndex, type Drawing, type Point } from "@/lib/drawings";
import type { Divergence, EnrichedBar, OhlcResponse } from "@/lib/types";
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type MouseEventParams,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

const UP = "#26a69a";
const DN = "#ef5350";
const SMA20 = "#ffb300";
const SMA50 = "#42a5f5";
const SMA200 = "#ab47bc";
const BB = "#90a4ae";

export interface CompareSeries {
  ticker: string;
  color: string;
  bars: { time: number; close: number }[];
}

interface Props {
  payload: OhlcResponse;
  chartType: ChartType;
  logScale: boolean;
  show: IndicatorToggles;
  drawings: Drawing[];
  tool: Tool;
  compare: CompareSeries[];
  selectedId: string | null;
  onDrawingsChange: (next: Drawing[]) => void;
  onSelect: (id: string | null) => void;
  onHover: (bar: EnrichedBar | null) => void;
  onStatus: (message: string | null) => void;
}

export function PriceChart(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const extraRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const barsRef = useRef<EnrichedBar[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const draftRef = useRef<Point[]>([]);
  const cursorRef = useRef<Point | null>(null);
  const keyRef = useRef<string | null>(null);
  const [chartReady, setChartReady] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0e1117" },
        textColor: "#d7dde6",
        fontFamily: "var(--font-sans), 'Segoe UI', sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#2a2f3a" },
        horzLines: { color: "#2a2f3a" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2f3a" },
      timeScale: {
        borderColor: "#2a2f3a",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;
    setChartReady((n) => n + 1);

    const redraw = () => paint(chart);
    const onRange = () => redraw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onClick = (param: MouseEventParams) => handleClick(param);
    const onMove = (param: MouseEventParams) => handleMove(param);
    chart.subscribeClick(onClick);
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeClick(onClick);
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      if (chartRef.current === chart) chartRef.current = null;
      seriesRef.current = null;
      extraRef.current = [];
    };
    // Chart instance lives for the lifetime of the pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const bars = dedupe(props.payload.bars);
    barsRef.current = bars;
    const key = `${props.payload.ticker}|${props.payload.timeframe}`;
    const preserve = keyRef.current === key ? chart.timeScale().getVisibleLogicalRange() : null;
    keyRef.current = key;

    for (const s of extraRef.current) {
      try { chart.removeSeries(s); } catch { /* series belonged to a replaced chart */ }
    }
    extraRef.current = [];
    if (seriesRef.current) {
      try { chart.removeSeries(seriesRef.current); } catch { /* series belonged to a replaced chart */ }
      seriesRef.current = null;
    }

    const intraday = props.payload.timeframe === "15m" || props.payload.timeframe === "1h";
    chart.timeScale().applyOptions({ timeVisible: intraday, secondsVisible: false });
    const nonPositive = bars.some((b) => b.low <= 0 || b.close <= 0);
    chart.priceScale("right").applyOptions({
      borderColor: "#2a2f3a",
      mode: props.logScale && !nonPositive ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });

    const decimals = props.payload.pence ? 2 : guessDecimals(props.payload);
    const priceFormat = { type: "price" as const, precision: decimals, minMove: 10 ** -decimals };
    let main: ISeriesApi<SeriesType>;
    if (props.chartType === "line") {
      main = chart.addSeries(LineSeries, { color: "#e6e6e6", lineWidth: 2, priceFormat });
      main.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })));
    } else if (props.chartType === "ohlc") {
      main = chart.addSeries(BarSeries, {
        upColor: UP,
        downColor: DN,
        thinBars: false,
        priceFormat,
      });
      main.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    } else {
      main = chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DN,
        borderUpColor: UP,
        borderDownColor: DN,
        wickUpColor: UP,
        wickDownColor: DN,
        priceFormat,
      });
      main.setData(bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })));
    }
    seriesRef.current = main;

    const hasVolume = bars.some((b) => b.volume > 0);
    if (hasVolume) {
      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
      });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      vol.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          value: b.volume,
          color: b.close >= b.open ? "rgba(38,166,154,0.55)" : "rgba(239,83,80,0.55)",
        })),
      );
      extraRef.current.push(vol);
      main.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.24 } });
    } else {
      main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.06 } });
    }

    const addLine = (values: (number | null)[], color: string, width: 1 | 2 = 2, style?: LineStyle) => {
      const data = bars.flatMap((b, i) => (values[i] == null ? [] : [{ time: b.time as UTCTimestamp, value: values[i] as number }]));
      if (!data.length) return;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
        ...(style != null ? { lineStyle: style } : {}),
      });
      s.setData(data);
      extraRef.current.push(s);
    };

    if (props.show.sma20) addLine(bars.map((b) => b.sma20), SMA20);
    if (props.show.sma50) addLine(bars.map((b) => b.sma50), SMA50);
    if (props.show.sma200) addLine(bars.map((b) => b.sma200), SMA200);
    if (props.show.bb) {
      addLine(bars.map((b) => b.bbUpper), BB, 1);
      addLine(bars.map((b) => b.bbLower), BB, 1);
      addLine(bars.map((b) => b.bbMid), BB, 1, LineStyle.Dotted);
    }
    if (props.show.ichimoku) {
      addLine(bars.map((b) => b.tenkan), "#4dd0e1", 1);
      addLine(bars.map((b) => b.kijun), "#e0e0e0", 1, LineStyle.Dashed);
    }
    if (props.show.sma200day && intraday && props.payload.sma200Daily != null) {
      main.createPriceLine({
        price: props.payload.sma200Daily,
        color: SMA200,
        lineWidth: 2,
        lineStyle: LineStyle.LargeDashed,
        axisLabelVisible: true,
        title: "200-day SMA",
      });
    }

    let pane = 1;
    if (props.show.rsi) {
      const rsi = chart.addSeries(LineSeries, {
        color: "#ce93d8",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      }, pane);
      rsi.setData(bars.flatMap((b) => (b.rsi14 == null ? [] : [{ time: b.time as UTCTimestamp, value: b.rsi14 }])));
      rsi.createPriceLine({ price: 70, color: DN, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      rsi.createPriceLine({ price: 30, color: UP, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      extraRef.current.push(rsi);
      if (props.show.divergence) {
        const marks = findDivergences(bars, "rsi", !intraday).map((d) => ({
          time: d.time2 as UTCTimestamp,
          position: d.kind === "bear" ? ("aboveBar" as const) : ("belowBar" as const),
          color: d.kind === "bear" ? DN : UP,
          shape: d.kind === "bear" ? ("arrowDown" as const) : ("arrowUp" as const),
          text: d.kind === "bear" ? "bear" : "bull",
        }));
        createSeriesMarkers(rsi, marks);
      }
      pane += 1;
    }
    if (props.show.stoch) {
      const k = chart.addSeries(LineSeries, {
        color: "#4fc3f7",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      }, pane);
      const d = chart.addSeries(LineSeries, {
        color: "#ff8a65",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      }, pane);
      k.setData(bars.flatMap((b) => (b.stochK == null ? [] : [{ time: b.time as UTCTimestamp, value: b.stochK }])));
      d.setData(bars.flatMap((b) => (b.stochD == null ? [] : [{ time: b.time as UTCTimestamp, value: b.stochD }])));
      k.createPriceLine({ price: 80, color: DN, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      k.createPriceLine({ price: 20, color: UP, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      extraRef.current.push(k, d);
      pane += 1;
    }
    if (props.show.macd) {
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
      const line = chart.addSeries(LineSeries, { color: "#42a5f5", lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, pane);
      const signal = chart.addSeries(LineSeries, { color: SMA20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane);
      hist.setData(bars.flatMap((b) => (b.macdHist == null ? [] : [{ time: b.time as UTCTimestamp, value: b.macdHist, color: b.macdHist >= 0 ? "rgba(38,166,154,0.8)" : "rgba(239,83,80,0.8)" }])));
      line.setData(bars.flatMap((b) => (b.macd == null ? [] : [{ time: b.time as UTCTimestamp, value: b.macd }])));
      signal.setData(bars.flatMap((b) => (b.macdSignal == null ? [] : [{ time: b.time as UTCTimestamp, value: b.macdSignal }])));
      extraRef.current.push(hist, line, signal);
      pane += 1;
    }

    const panes = chart.panes();
    if (panes[0]) panes[0].setStretchFactor(3.4);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);

    if (props.compare.length && bars.length) {
      const from = bars[0].time;
      const to = bars[bars.length - 1].time;
      const mainPct = percentLine(bars.map((b) => ({ time: b.time, close: b.close })), from, to);
      const mainLine = chart.addSeries(LineSeries, {
        color: "rgba(230,230,230,0.85)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceScaleId: "compare",
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
      });
      mainLine.setData(mainPct);
      extraRef.current.push(mainLine);
      for (const c of props.compare) {
        const s = chart.addSeries(LineSeries, {
          color: c.color,
          lineWidth: 2,
          priceScaleId: "compare",
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
        });
        s.setData(percentLine(c.bars, from, to));
        extraRef.current.push(s);
      }
      chart.priceScale("compare").applyOptions({ visible: true, borderColor: "#2a2f3a" });
    }

    if (preserve) chart.timeScale().setVisibleLogicalRange(preserve);
    else {
      const n = bars.length;
      const view = Math.min(170, n);
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - view), to: n + 4 });
    }
    requestAnimationFrame(() => paint(chart));
  }, [props.payload, props.chartType, props.logScale, props.show, props.compare, chartReady]);

  useEffect(() => {
    draftRef.current = [];
  }, [props.tool]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart) paint(chart);
  }, [props.drawings, props.tool, props.selectedId, props.show.bb, props.show.ichimoku, props.show.divergence]);

  function paint(chart: IChartApi) {
    const canvas = canvasRef.current;
    const series = seriesRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !series || !wrap) return;
    const plotW = chart.timeScale().width();
    const box = pricePaneBox(wrap, plotW);
    canvas.style.left = `${box.left}px`;
    canvas.style.top = `${box.top}px`;
    canvas.style.width = `${box.width}px`;
    canvas.style.height = `${box.height}px`;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(box.width * dpr));
    canvas.height = Math.max(1, Math.round(box.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const bars = barsRef.current;
    const times = bars.map((b) => b.time);
    const p = propsRef.current;
    const scene = buildScene(chart, series, times, box.width, box.height, p, draftRef.current, cursorRef.current);
    renderScene(ctx, scene);
  }

  function handleMove(param: MouseEventParams) {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const bars = barsRef.current;
    if (!chart || !series) return;
    if (param.paneIndex != null && param.paneIndex !== 0) {
      cursorRef.current = null;
      return;
    }
    const point = eventPoint(param, chart, series, bars);
    cursorRef.current = point;
    if (typeof param.logical === "number") {
      const i = Math.round(param.logical);
      propsRef.current.onHover(i >= 0 && i < bars.length ? bars[i] : null);
    } else propsRef.current.onHover(null);
    if (draftRef.current.length) paint(chart);
  }

  function handleClick(param: MouseEventParams) {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const bars = barsRef.current;
    const p = propsRef.current;
    if (!chart || !series || (param.paneIndex != null && param.paneIndex !== 0)) return;
    const point = eventPoint(param, chart, series, bars);
    if (!point || !param.point) return;
    const times = bars.map((b) => b.time);
    const box = pricePaneBox(wrapRef.current!, chart.timeScale().width());
    const scene = buildScene(chart, series, times, box.width, box.height, p, draftRef.current, point);

    if (p.tool === "cursor" || p.tool === "erase") {
      const id = hitTest(scene, param.point.x, param.point.y);
      if (p.tool === "erase") {
        if (id) p.onDrawingsChange(p.drawings.filter((d) => d.id !== id));
      } else p.onSelect(id);
      return;
    }
    if (p.tool === "hline") {
      p.onDrawingsChange([...p.drawings, { id: newId(), type: "hline", price: point.price }]);
      p.onStatus(null);
      return;
    }
    if (p.tool === "avwap") {
      const vol = bars.some((b) => b.volume > 0);
      if (!vol) {
        p.onStatus("No volume on this symbol, so anchored VWAP cannot be computed.");
        return;
      }
      const existing = p.drawings.filter((d) => d.type === "avwap");
      const slot: 1 | 2 = existing.some((d) => d.type === "avwap" && d.slot === 1) && !existing.some((d) => d.type === "avwap" && d.slot === 2) ? 2 : 1;
      const rest = p.drawings.filter((d) => !(d.type === "avwap" && d.slot === slot));
      p.onDrawingsChange([...rest, { id: newId(), type: "avwap", time: snappedTime(bars, point.time), slot }]);
      p.onStatus(slot === 1 ? "VWAP anchor 1 set. Click another bar for a second anchor." : "Second VWAP anchor set.");
      return;
    }
    const need = p.tool === "pitchfork" ? 3 : 2;
    const next = [...draftRef.current, point];
    if (next.length < need) {
      draftRef.current = next;
      p.onStatus(p.tool === "pitchfork" ? `Pivot ${next.length} of 3 set.` : "First point set. Click the second.");
      paint(chart);
      return;
    }
    draftRef.current = [];
    if (p.tool === "trend") {
      p.onDrawingsChange([...p.drawings, { id: newId(), type: "trend", a: next[0], b: next[1] }]);
    } else if (p.tool === "fib") {
      p.onDrawingsChange([...p.drawings, { id: newId(), type: "fib", a: next[0], b: next[1] }]);
    } else if (p.tool === "pitchfork") {
      p.onDrawingsChange([...p.drawings, { id: newId(), type: "pitchfork", a: next[0], b: next[1], c: next[2] }]);
    }
    p.onStatus(null);
    paint(chart);
  }

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="draw-layer" />
    </div>
  );
}

function buildScene(
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  times: number[],
  width: number,
  height: number,
  p: Props,
  draft: Point[],
  cursor: Point | null,
): DrawScene {
  const bars = p.payload.bars;
  const xOfTime = (time: number) => {
    const direct = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (direct != null) return direct as number;
    const x = chart.timeScale().logicalToCoordinate(indexForTime(times, time) as Logical);
    return x == null ? null : (x as number);
  };
  const yOfPrice = (price: number) => {
    const y = series.priceToCoordinate(price);
    return y == null ? null : (y as number);
  };
  const avwap: AvwapPath[] = [];
  for (const d of p.drawings) {
    if (d.type !== "avwap") continue;
    const path = anchoredVwap(bars, d.time);
    if (path) avwap.push({ id: d.id, slot: d.slot, pts: path });
  }
  let cloud: CloudSeg[] | null = null;
  if (p.show.ichimoku && bars.length) {
    cloud = [];
    for (let i = 0; i < bars.length; i++) {
      const j = i + 26;
      cloud.push({ time: timeForIndex(times, j), a: bars[i].spanA, b: bars[i].spanB });
    }
  }
  const divergences: DrawScene["divergences"] = [];
  if (p.show.divergence) {
    const daily = p.payload.timeframe === "1d" || p.payload.timeframe === "1w";
    const all: Divergence[] = [...findDivergences(bars, "rsi", daily), ...findDivergences(bars, "stoch", daily)];
    for (const d of all) {
      divergences.push({
        kind: d.kind,
        time1: d.time1,
        time2: d.time2,
        price1: d.price1,
        price2: d.price2,
        label: `${d.kind} ${d.osc}`,
      });
    }
  }
  return {
    width,
    height,
    times,
    xOfTime,
    yOfPrice,
    drawings: p.drawings,
    selectedId: p.selectedId,
    draft,
    cursor,
    tool: p.tool,
    avwap,
    bb: p.show.bb ? bars.filter((b) => b.bbUpper != null && b.bbLower != null).map((b) => ({ time: b.time, upper: b.bbUpper as number, lower: b.bbLower as number })) : null,
    cloud,
    divergences,
    decimals: guessDecimals(p.payload),
  };
}

function eventPoint(param: MouseEventParams, chart: IChartApi, series: ISeriesApi<SeriesType>, bars: EnrichedBar[]): Point | null {
  if (!param.point || !bars.length) return null;
  const price = series.coordinateToPrice(param.point.y);
  if (price == null) return null;
  const logical = param.logical ?? chart.timeScale().coordinateToLogical(param.point.x);
  if (logical == null) return null;
  const times = bars.map((b) => b.time);
  const time = timeForIndex(times, logical as number);
  return { time: snappedTime(bars, time), price };
}

function snappedTime(bars: EnrichedBar[], time: number): number {
  if (!bars.length) return time;
  if (time <= bars[0].time) return bars[0].time;
  if (time >= bars[bars.length - 1].time) return time;
  let best = bars[0].time;
  let bestD = Infinity;
  for (const b of bars) {
    const d = Math.abs(b.time - time);
    if (d < bestD) {
      bestD = d;
      best = b.time;
    }
  }
  return best;
}

function dedupe(bars: EnrichedBar[]): EnrichedBar[] {
  const out: EnrichedBar[] = [];
  for (const b of bars) {
    if (!out.length || b.time > out[out.length - 1].time) out.push(b);
    else if (b.time === out[out.length - 1].time) out[out.length - 1] = b;
  }
  return out;
}

function percentLine(bars: { time: number; close: number }[], from: number, to: number): { time: UTCTimestamp; value: number }[] {
  const window = bars.filter((b) => b.time >= from && b.time <= to && b.close);
  if (!window.length || !window[0].close) return [];
  const base = window[0].close;
  return window.map((b) => ({ time: b.time as UTCTimestamp, value: (b.close / base - 1) * 100 }));
}

function guessDecimals(payload: OhlcResponse): number {
  const last = payload.lastPrice ?? payload.bars[payload.bars.length - 1]?.close;
  if (payload.units === "USD/t" || (last != null && last >= 1000 && (payload.units === "index" || payload.units === "USD/t"))) {
    return payload.units === "USD/t" ? 0 : 2;
  }
  if (payload.pence) return 2;
  if (last != null && last < 5) return 4;
  if (last != null && last < 50) return 3;
  return 2;
}

function pricePaneBox(container: HTMLElement, plotWidth: number): { left: number; top: number; width: number; height: number } {
  const root = container.getBoundingClientRect();
  let best: DOMRect | null = null;
  for (const td of container.querySelectorAll("td")) {
    const r = td.getBoundingClientRect();
    if (r.height > 40 && Math.abs(r.width - plotWidth) < 4) {
      if (!best || r.top < best.top) best = r;
    }
  }
  if (!best) return { left: 0, top: 0, width: plotWidth, height: Math.max(40, container.clientHeight - 28) };
  return { left: best.left - root.left, top: best.top - root.top, width: best.width, height: best.height };
}
