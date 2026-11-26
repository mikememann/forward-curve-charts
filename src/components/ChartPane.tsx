"use client";

import { unavailableSeries } from "@/config/lseg";
import { CurveView } from "@/components/CurveView";
import type { CompareSeries } from "@/components/PriceChart";
import type { Tool } from "@/components/uiTypes";
import dynamic from "next/dynamic";

const PriceChart = dynamic(() => import("@/components/PriceChart").then((m) => m.PriceChart), { ssr: false });
import type { PaneSettings } from "@/lib/layout";
import { fetchCurve, fetchOhlc } from "@/lib/clientCache";
import type { Drawing } from "@/lib/drawings";
import { formatAge, formatLondon } from "@/lib/time";
import { formatPrice } from "@/lib/format";
import type { MarketView } from "@/lib/marketModel";
import type { CurveResponse, EnrichedBar, OhlcResponse, Quote } from "@/lib/types";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState, type ForwardedRef } from "react";

export interface PaneSnapshot {
  payload: OhlcResponse | null;
  error: string | null;
  loading: boolean;
  hover: EnrichedBar | null;
  drawings: Drawing[];
  curve: CurveResponse | null;
  curveError: string | null;
}

export interface PaneHandle {
  setDrawings: (next: Drawing[]) => void;
  getSnapshot: () => PaneSnapshot;
}

interface Props {
  settings: PaneSettings;
  active: boolean;
  tool: Tool;
  compare: CompareSeries[];
  listed: MarketView[];
  quotes: Record<string, Quote>;
  spreads: { id: string; name: string; formula: string }[];
  now: number;
  syncTime: number | null;
  syncRange: { from: number; to: number } | null;
  onActivate: () => void;
  onSyncTime: (time: number | null) => void;
  onSyncRange: (range: { from: number; to: number }) => void;
  onSnapshot: (snap: PaneSnapshot) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onStatus: (message: string | null) => void;
  /** Single-chart mode already has the big header, so the pane chrome stays out of the way. */
  solo?: boolean;
}

function ChartPaneInner(props: Props, ref: ForwardedRef<PaneHandle>) {
  const { settings } = props;
  const [payload, setPayload] = useState<OhlcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<EnrichedBar | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [curve, setCurve] = useState<CurveResponse | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const viewModel = useMemo(() => {
    return props.listed.find((m) => m.id === settings.marketId) ?? null;
  }, [props.listed, settings.marketId]);
  const spread = props.spreads.find((s) => s.id === settings.marketId) ?? null;
  const unavailable = unavailableSeries.find((u) => u.id === settings.marketId) ?? null;
  const quote = viewModel ? props.quotes[viewModel.id] : undefined;
  const ticker = viewModel
    ? settings.seriesMode === "continuous" && viewModel.continuous
      ? viewModel.continuous
      : viewModel.contractTicker ?? viewModel.ticker
    : "";

  useEffect(() => {
    if (!ticker) {
      setDrawings([]);
      return;
    }
    props.onSelect(null);
    try {
      const raw = localStorage.getItem(`mm-charts:drawings:v1:${ticker}`);
      setDrawings(raw ? (JSON.parse(raw) as Drawing[]) : []);
    } catch {
      setDrawings([]);
    }
  }, [ticker]);

  function commitDrawings(next: Drawing[]) {
    setDrawings(next);
    if (ticker) localStorage.setItem(`mm-charts:drawings:v1:${ticker}`, JSON.stringify(next));
  }

  useImperativeHandle(ref, () => ({
    setDrawings: commitDrawings,
    getSnapshot: () => ({ payload, error, loading, hover, drawings, curve, curveError }),
  }));

  const onSnapshotRef = useMemo(() => ({ fn: props.onSnapshot }), []);
  onSnapshotRef.fn = props.onSnapshot;
  useEffect(() => {
    if (!props.active) return;
    onSnapshotRef.fn({ payload, error, loading, hover, drawings, curve, curveError });
  }, [props.active, payload, error, loading, hover, drawings, curve, curveError, onSnapshotRef]);

  useEffect(() => {
    if (unavailable || (!spread && !ticker)) return;
    let live = true;
    setLoading(true);
    setError(null);
    setPayload(null);
    setHover(null);
    const params = spread
      ? new URLSearchParams({ formula: spread.formula, timeframe: settings.timeframe })
      : new URLSearchParams({
          ticker,
          timeframe: settings.timeframe,
          market: viewModel && !viewModel.id.startsWith("custom:") ? viewModel.id : "",
        });
    if (!spread && viewModel?.sourceKind === "ice") params.set("strip", settings.strip || "front");
    const url = `/api/ohlc?${params}`;
    fetchOhlc(url)
      .then((body) => {
        if (!live) return;
        setPayload(body);
      })
      .catch((e: Error) => {
        if (!live) return;
        setPayload(null);
        setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [unavailable, spread, ticker, settings.timeframe, settings.strip, viewModel?.id, viewModel?.sourceKind, retry]);

  const curveKey = settings.view === "curve" ? (viewModel?.curveId ?? settings.marketId) : null;
  useEffect(() => {
    if (!curveKey || unavailable) return;
    let live = true;
    setCurveError(null);
    fetchCurve(curveKey)
      .then((body) => {
        if (live) setCurve(body);
      })
      .catch((e: Error) => {
        if (!live) return;
        setCurve(null);
        setCurveError(e.message);
      });
    return () => {
      live = false;
    };
  }, [curveKey, unavailable]);

  const name = unavailable?.name ?? spread?.name ?? viewModel?.name ?? settings.marketId;
  const contract = settings.seriesMode === "contract" ? viewModel?.contractLabel : settings.seriesMode === "continuous" ? "continuous" : null;
  const age = payload?.quoteTimeUnix ? formatAge(props.now / 1000 - payload.quoteTimeUnix) : payload?.ageSeconds != null ? formatAge(payload.ageSeconds) : null;
  const stale = Boolean(quote?.stale || payload?.stale);
  const price = stale ? null : quote?.last ?? payload?.lastPrice ?? null;
  const decimals = quote?.decimals ?? viewModel?.decimals ?? 2;

  return (
    <section
      className={`pane ${props.active ? "active" : ""}`}
      onMouseDown={props.onActivate}
      data-pane={settings.marketId}
    >
      {!props.solo && (
      <header className="pane-head">
        <strong>{name}</strong>
        {contract && <span className="pane-contract">{contract}</span>}
        <span className="pane-tf">{settings.timeframe}</span>
        <span className={`pane-px ${quote && (quote.change ?? 0) < 0 ? "down" : ""} ${quote && (quote.change ?? 0) > 0 ? "up" : ""}`}>
          {price == null ? "n/a" : formatPrice(price, decimals)}
        </span>
        <span className="pane-age">
          {payload ? `${payload.source} · ${age ?? "n/a"}` : loading ? "loading…" : ""}
          {payload?.lastBarUnix ? ` · bar ${formatLondon(payload.lastBarUnix, "date")}` : ""}
        </span>
      </header>
      )}
      {!props.solo && viewModel?.exactness && <p className="pane-meta">{viewModel.exactness}{viewModel.licence ? ` · ${viewModel.licence}` : ""}</p>}
      {!props.solo && (stale || quote?.error || error) && (
        <p className="pane-note warn">
          {quote?.error || error || payload?.staleReason || `No fresh quote. Last updated ${quote?.lastUpdatedLabel ?? ""}.`}
        </p>
      )}
      {!props.solo && viewModel?.proxyNote && settings.view === "chart" && <p className="pane-note">{viewModel.proxyNote}</p>}
      <div className="pane-body">
        {unavailable && (
          <div className="error-state pane-error">
            <h2>{unavailable.name} is not charted</h2>
            {unavailable.ric && <p className="mono">{unavailable.ric}</p>}
            <p>{unavailable.reason}</p>
          </div>
        )}
        {!unavailable && settings.view === "curve" && (
          curveError ? (
            <div className="error-state pane-error"><h2>Couldn't load the curve</h2><p>{curveError}</p></div>
          ) : curve ? (
            <div className="pane-curve"><CurveView data={curve} /></div>
          ) : (
            <div className="chart-skeleton">Loading curve…</div>
          )
        )}
        {!unavailable && settings.view === "chart" && error && (
          <div className="error-state pane-error">
            <h2>Couldn't load {name}</h2>
            <p>{error}</p>
            <p>No price has been substituted.</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button>
          </div>
        )}
        {!unavailable && settings.view === "chart" && !error && payload && (
          <PriceChart
            payload={payload}
            chartType={settings.chartType}
            logScale={settings.logScale}
            show={settings.show}
            drawings={drawings}
            tool={props.active ? props.tool : "cursor"}
            compare={props.active ? props.compare : []}
            selectedId={props.selectedId}
            onDrawingsChange={commitDrawings}
            onSelect={props.onSelect}
            onHover={setHover}
            onStatus={props.onStatus}
            syncTime={props.syncTime}
            syncRange={props.syncRange}
            onSyncTime={props.active ? props.onSyncTime : undefined}
            onSyncRange={props.onSyncRange}
          />
        )}
        {!unavailable && settings.view === "chart" && !payload && !error && <div className="chart-skeleton">Loading chart…</div>}
        {loading && <div className="loading-bar" />}
      </div>
    </section>
  );
}

export const ChartPane = forwardRef(ChartPaneInner);
