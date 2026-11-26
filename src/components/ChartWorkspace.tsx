"use client";

import { unavailableSeries } from "@/config/lseg";
import { autoFibDrawing, autoForkDrawing } from "@/components/autoDraw";
import { CurveView } from "@/components/CurveView";
import type { CompareSeries } from "@/components/PriceChart";
import { DEFAULT_TOGGLES, TOOL_HINT, type ChartType, type IndicatorToggles, type SeriesMode, type Tool } from "@/components/uiTypes";
import { Watchlist, type CustomSymbol } from "@/components/Watchlist";
import { ChartPane, type PaneHandle, type PaneSnapshot } from "@/components/ChartPane";
import { allCurves, presentMarkets, type MarketView } from "@/lib/marketModel";
import { fetchCurve } from "@/lib/clientCache";
import { decodeLayout, encodeLayout, setLayoutCount, singleLayout, type DeskLayout, type LayoutCount, type PaneSettings } from "@/lib/layout";
import { newId, riskReward, type Drawing, type TradeDrawing } from "@/lib/drawings";
import { formatChange, formatPct, formatPrice } from "@/lib/format";
import { formatAge, formatLondon } from "@/lib/time";
import type { CurveResponse, EnrichedBar, OhlcResponse, Quote, Timeframe } from "@/lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const COMPARE_COLORS = ["#ff8a65", "#4fc3f7", "#ce93d8"];
const TFS: Timeframe[] = ["15m", "1h", "1d", "1w"];

type Prefs = {
  marketId?: string;
  timeframe?: Timeframe;
  chartType?: ChartType;
  logScale?: boolean;
  show?: Partial<IndicatorToggles>;
};

export function ChartWorkspace() {
  const curves = useMemo(() => allCurves(), []);
  const [hydrated, setHydrated] = useState(false);
  const [desk, setDesk] = useState<DeskLayout>(() => singleLayout());
  const [narrow, setNarrow] = useState(false);
  const [snap, setSnap] = useState<PaneSnapshot | null>(null);
  const paneRefs = useRef<(PaneHandle | null)[]>([]);
  const activeRef = useRef(0);
  const [tool, setTool] = useState<Tool>("cursor");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [custom, setCustom] = useState<CustomSymbol[]>([]);
  const [spreads, setSpreads] = useState<{ id: string; name: string; formula: string }[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compare, setCompare] = useState<CompareSeries[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [rangeSync, setRangeSync] = useState<{ from: number; to: number; source: number } | null>(null);
  const [timeSync, setTimeSync] = useState<{ time: number | null; source: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [armClear, setArmClear] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const listed = useMemo(() => (hydrated ? presentMarkets() : []), [hydrated]);
  const layoutShown: LayoutCount = narrow ? 1 : desk.layout;
  const active = Math.min(desk.active, Math.max(0, desk.panes.length - 1));
  activeRef.current = active;
  const pane = desk.panes[active] ?? desk.panes[0];
  const marketId = pane.marketId;
  const timeframe = pane.timeframe;
  const chartType = pane.chartType;
  const logScale = pane.logScale;
  const show = pane.show;
  const seriesMode = pane.seriesMode;
  const view = pane.view;

  const updateActive = useCallback((patch: Partial<PaneSettings> | ((p: PaneSettings) => Partial<PaneSettings>), linkMarket = false) => {
    setDesk((d) => {
      const index = Math.min(d.active, d.panes.length - 1);
      return {
        ...d,
        panes: d.panes.map((p, i) => {
          const hit = i === index || (linkMarket && d.linkSymbol && i < d.layout);
          if (!hit) return p;
          const extra = typeof patch === "function" ? patch(p) : patch;
          if (linkMarket && i !== index) {
            return {
              ...p,
              marketId: extra.marketId ?? p.marketId,
              seriesMode: extra.seriesMode ?? p.seriesMode,
            };
          }
          return { ...p, ...extra, show: extra.show ? { ...extra.show } : p.show };
        }),
      };
    });
  }, []);

  const setTimeframe = (tf: Timeframe) => updateActive({ timeframe: tf });
  const setChartType = (t: ChartType) => updateActive({ chartType: t });
  const setLogScale = (next: boolean | ((v: boolean) => boolean)) => updateActive((p) => ({ logScale: typeof next === "function" ? next(p.logScale) : next }));
  const setShow = (next: IndicatorToggles | ((s: IndicatorToggles) => IndicatorToggles)) => updateActive((p) => ({ show: typeof next === "function" ? next(p.show) : next }));
  const setSeriesMode = (mode: SeriesMode) => updateActive({ seriesMode: mode });
  const setView = (next: "chart" | "curve") => updateActive({ view: next });

  useEffect(() => {
    const prefs = readJson<Prefs>("mm-charts:prefs:v1");
    const savedLayout = readJson<DeskLayout>("mm-charts:layout:v1");
    const savedCustom = readJson<CustomSymbol[]>("mm-charts:custom:v1") ?? [];
    setCustom(savedCustom);
    setSpreads(readJson<{ id: string; name: string; formula: string }[]>("mm-charts:spreads:v1") ?? []);
    const url = new URLSearchParams(window.location.search);
    const fromUrl = decodeLayout(window.location.search);
    const strip = url.get("strip");
    if (fromUrl) {
      if (strip && fromUrl.panes[fromUrl.active]) fromUrl.panes[fromUrl.active].strip = strip;
      setDesk(fromUrl);
    } else if (savedLayout && savedLayout.panes?.length && savedLayout.panes.every((p) => p && p.marketId && p.show)) {
      setDesk({ ...savedLayout, panes: savedLayout.panes.map((p) => ({ ...p, strip: p.strip || "front", source: p.source || "auto" })) });
    } else {
      const tf = url.get("tf");
      const id = url.get("m") || prefs?.marketId || "brent";
      const base = singleLayout(id, tf === "15m" || tf === "1h" || tf === "1d" || tf === "1w" ? tf : prefs?.timeframe || "1h");
      const picked = presentMarkets().find((m) => m.id === id);
      if (picked?.sourceKind === "ice") base.panes[0].chartType = "line";
      else if (prefs?.chartType) base.panes[0].chartType = prefs.chartType;
      if (prefs?.logScale) base.panes[0].logScale = true;
      if (prefs?.show) base.panes[0].show = { ...DEFAULT_TOGGLES, ...prefs.show };
      if (url.get("view") === "curve") base.panes[0].view = "curve";
      if (picked?.preferContinuous) base.panes[0].seriesMode = "continuous";
      if (strip) base.panes[0].strip = strip;
      setDesk(base);
    }
    setHydrated(true);
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("mm-charts:layout:v1", JSON.stringify(desk));
    localStorage.setItem("mm-charts:prefs:v1", JSON.stringify({ marketId, timeframe, chartType, logScale, show }));
    localStorage.setItem("mm-charts:custom:v1", JSON.stringify(custom));
    localStorage.setItem("mm-charts:spreads:v1", JSON.stringify(spreads));
    window.history.replaceState(null, "", `?${encodeLayout(desk)}`);
  }, [hydrated, desk, marketId, timeframe, chartType, logScale, show, custom, spreads]);

  const viewModel = useMemo(() => {
    return listed.find((m) => m.id === marketId) ?? customView(custom.find((c) => `custom:${c.ticker}` === marketId));
  }, [listed, marketId, custom]);

  const [curvePick, setCurvePick] = useState<string | null>(null);
  const [bigCurve, setBigCurve] = useState<CurveResponse | null>(null);
  const [bigCurveError, setBigCurveError] = useState<string | null>(null);
  const curveId = curvePick ?? viewModel?.curveId ?? "brent";
  const ticker = viewModel ? (seriesMode === "continuous" && viewModel.continuous ? viewModel.continuous : viewModel.contractTicker ?? viewModel.ticker) : "";
  const payload = snap?.payload ?? null;
  const chartError = snap?.error ?? null;
  const hover = snap?.hover ?? null;
  const drawings = snap?.drawings ?? [];
  const curveLoading = view === "curve" && layoutShown === 1 && !bigCurve && !bigCurveError;

  const changeDrawings = useCallback((next: Drawing[]) => {
    paneRefs.current[activeRef.current]?.setDrawings(next);
  }, []);

  useEffect(() => {
    if (!hydrated || view !== "curve" || layoutShown !== 1) return;
    let live = true;
    setBigCurveError(null);
    fetchCurve(curveId)
      .then((body) => {
        if (live) setBigCurve(body);
      })
      .catch((e: Error) => {
        if (live) setBigCurveError(e.message);
      });
    return () => {
      live = false;
    };
  }, [hydrated, view, layoutShown, curveId]);

  useEffect(() => {
    if (!hydrated) return;
    let stop = false;
    const extras = custom.map((c) => c.ticker).join(",");
    async function load() {
      try {
        const res = await fetch(`/api/quotes${extras ? `?extra=${encodeURIComponent(extras)}` : ""}`);
        const body = (await res.json()) as { quotes?: Quote[] };
        if (stop || !body.quotes) return;
        const map: Record<string, Quote> = {};
        for (const q of body.quotes) map[q.id] = q;
        setQuotes(map);
      } catch {
        /* leave the previous quotes; rows show an error only when the API returns one */
      }
    }
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [hydrated, custom]);

  useEffect(() => {
    if (!hydrated || !compareIds.length) {
      setCompare([]);
      return;
    }
    const ctrl = new AbortController();
    Promise.all(
      compareIds.map(async (id, i) => {
        const m = listed.find((x) => x.id === id);
        const sym = m?.ticker ?? id.replace(/^custom:/, "");
        const res = await fetch(`/api/ohlc?ticker=${encodeURIComponent(sym)}&timeframe=${timeframe}&bars=400`, { signal: ctrl.signal });
        const body = (await res.json()) as OhlcResponse;
        if (!res.ok) throw new Error(body.error || sym);
        return { ticker: sym, color: COMPARE_COLORS[i % COMPARE_COLORS.length], bars: body.bars.map((b) => ({ time: b.time, close: b.close })) };
      }),
    )
      .then((rows) => setCompare(rows))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setStatus(e.message);
      });
    return () => ctrl.abort();
  }, [hydrated, compareIds, timeframe, listed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        setTool("cursor");
        setStatus(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        changeDrawings(drawings.filter((d) => d.id !== selectedId));
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, drawings, changeDrawings]);

  function selectMarket(id: string) {
    setNavOpen(false);
    const m = listed.find((x) => x.id === id);
    setCurvePick(null);
    updateActive((p) => ({
      marketId: id,
      seriesMode: m?.preferContinuous ? "continuous" : "contract",
      timeframe: m?.intradayOnly && (p.timeframe === "1d" || p.timeframe === "1w") ? "1h" : p.timeframe,
      view: p.view === "curve" && m && !m.curveId ? "chart" : p.view,
      strip: "front",
      source: "auto",
      chartType: m?.sourceKind === "ice" && m.igEpic ? p.chartType : m?.sourceKind === "ice" ? "line" : p.chartType,
    }), true);
  }

  const spread = spreads.find((s) => s.id === marketId) ?? null;
  const unavailable = unavailableSeries.find((u) => u.id === marketId) ?? null;

  const quote = viewModel ? quotes[viewModel.id] : undefined;
  const bar = hover ?? payload?.bars[payload.bars.length - 1] ?? null;
  const decimals = quote?.decimals ?? (payload?.pence ? 2 : 2);
  const shownTicker = spread?.formula || ticker;
  const showingThis = !unavailable && payload != null && (
    (payload.marketId != null && payload.marketId === (spread?.id ?? viewModel?.id))
    || payload.ticker === shownTicker
  );
  const monthLabel = showingThis && payload?.contractLabel
    ? payload.contractLabel
    : seriesMode === "contract" ? viewModel?.contractLabel : null;
  const headerPrice = unavailable ? null : quote?.stale || payload?.stale ? null : quote?.last ?? (showingThis ? payload?.lastPrice ?? null : null);
  const trade = drawings.find((d): d is TradeDrawing => d.type === "trade");

  return (
    <div className="app" data-ready={payload && !chartError ? "chart" : "no"}>
      <div className={`sidebar-wrap ${navOpen ? "mobile-open" : ""}`}>
        <Watchlist
          markets={listed}
          quotes={quotes}
          selectedId={marketId}
          now={now}
          custom={custom}
          onSelect={selectMarket}
          onAdd={(sym) => {
            setCustom((prev) => (prev.some((p) => p.ticker === sym.ticker) ? prev : [...prev, sym]));
            selectMarket(`custom:${sym.ticker}`);
            setView("chart");
            setNavOpen(false);
          }}
          onRemove={(sym) => {
            setCustom((prev) => prev.filter((p) => p.ticker !== sym));
            if (marketId === `custom:${sym}`) selectMarket("brent");
          }}
          unavailable={unavailableSeries}
          spreads={spreads}
          onAddSpread={(s) => {
            const id = `spread-${Math.random().toString(36).slice(2, 8)}`;
            setSpreads((prev) => [...prev, { id, name: s.name, formula: s.formula }]);
            selectMarket(id);
            setView("chart");
            setNavOpen(false);
          }}
          onRemoveSpread={(id) => {
            setSpreads((prev) => prev.filter((s) => s.id !== id));
            if (marketId === id) selectMarket("brent");
          }}
        />
      </div>
      {navOpen && <button className="backdrop" aria-label="Close markets" onClick={() => setNavOpen(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="nav-btn" onClick={() => setNavOpen(true)} type="button">Markets</button>
          <div className="title-block">
            <h1>
              {unavailable?.name ?? spread?.name ?? viewModel?.name ?? "Chart"}
              {monthLabel ? <span> · {monthLabel}</span> : null}
              {seriesMode === "continuous" ? <span> · continuous</span> : null}
            </h1>
            <p className="ticker-line">
              <span className="mono">{ticker}</span>
              {showingThis && payload?.units ? ` · ${payload.units}` : viewModel?.units ? ` · ${viewModel.units}` : ""}
              {viewModel?.pence ? " · pence, not pounds" : ""}
            </p>
          </div>
          <div className={`price-block ${quote && (quote.change ?? 0) < 0 ? "down" : ""} ${quote && (quote.change ?? 0) > 0 ? "up" : ""}`}>
            <strong>{headerPrice == null ? "n/a" : formatPrice(headerPrice, quote?.decimals ?? decimals)}</strong>
            <span>
              {quote?.stale || payload?.stale
                ? `last updated ${quote?.lastUpdatedLabel ?? (payload?.lastBarUnix ? formatLondon(payload.lastBarUnix, "date") : "")}`
                : quote
                  ? `${formatChange(quote.change, quote.decimals)}  ${formatPct(quote.changePct)}`
                  : ""}
            </span>
            <em>{quote?.changeBasis === "22:00 UK" ? "vs 22:00 UK" : quote?.changeBasis === "previous close" ? "vs previous close" : ""}</em>
          </div>
        </header>

        <div className="toolbar">
          <div className="seg">
            {TFS.map((tf) => (
              <button key={tf} className={timeframe === tf ? "on" : ""} onClick={() => { setTimeframe(tf); setView("chart"); }} type="button">{tf}</button>
            ))}
          </div>
          <div className="seg">
            {(["candle", "line", "ohlc"] as ChartType[]).map((t) => (
              <button key={t} className={chartType === t ? "on" : ""} onClick={() => setChartType(t)} type="button">{t === "ohlc" ? "OHLC" : t === "candle" ? "Candle" : "Line"}</button>
            ))}
          </div>
          <button className={`toggle ${logScale ? "on" : ""}`} type="button" onClick={() => setLogScale((v) => !v)}>Log</button>
          {viewModel?.igEpic && (
            <div className="seg" aria-label="Data source">
              <button className={(pane.source || "auto") === "auto" ? "on" : ""} type="button" onClick={() => updateActive({ source: "auto" })}>Auto</button>
              <button className={pane.source === "free" ? "on" : ""} type="button" title="The free feed for this market. Not converted into IG points." onClick={() => updateActive({ source: "free" })}>Free</button>
              <button className={pane.source === "ig" ? "on" : ""} type="button" title="IG spread-bet points, true OHLC. Read-only." onClick={() => updateActive({ source: "ig" })}>IG</button>
            </div>
          )}
          {payload?.iceContracts && payload.iceContracts.length > 0 && showingThis && (
            <label className="compare">
              Contract
              <select value={pane.strip || payload.iceStrip || "front"} onChange={(e) => { updateActive({ strip: e.target.value, view: "chart" }); }}>
                <option value="front">Front</option>
                {payload.iceContracts.map((c) => (
                  <option key={c.marketId} value={c.strip}>{c.label}{c.nearExpiry ? " · expiring" : ""}</option>
                ))}
              </select>
            </label>
          )}
          {viewModel?.ice?.compareMarketId && (
            <button
              className={`toggle ${compareIds.includes(viewModel.ice.compareMarketId) ? "on" : ""}`}
              type="button"
              title="Yahoo true OHLC, rebased to the start of the window. Different contract and units."
              onClick={() => {
                const id = viewModel.ice?.compareMarketId;
                if (!id) return;
                setCompareIds((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= 3 ? xs : [...xs, id]);
                setView("chart");
              }}
            >{viewModel.ice.compareLabel ?? "Compare OHLC"}</button>
          )}
          {viewModel?.continuous && viewModel.contractTicker && (
            <div className="seg">
              <button className={seriesMode === "contract" ? "on" : ""} type="button" onClick={() => setSeriesMode("contract")}>{viewModel.contractLabel}</button>
              <button className={seriesMode === "continuous" ? "on" : ""} type="button" onClick={() => setSeriesMode("continuous")}>Continuous</button>
            </div>
          )}
          <div className="menu">
            <button type="button" className={menu ? "on" : ""} onClick={() => setMenu((v) => !v)}>Indicators</button>
            {menu && (
              <div className="menu-pop" onMouseLeave={() => setMenu(false)}>
                {(
                  [
                    ["sma20", "SMA 20"],
                    ["sma50", "SMA 50"],
                    ["sma200", "SMA 200 (this timeframe)"],
                    ["sma200day", "200-day SMA on intraday"],
                    ["bb", "Bollinger (20, 2)"],
                    ["rsi", "RSI 14"],
                    ["stoch", "Slow stochastic 14, 3, 3"],
                    ["macd", "MACD 12, 26, 9"],
                    ["ichimoku", "Ichimoku"],
                    ["divergence", "RSI / stoch divergence"],
                  ] as [keyof IndicatorToggles, string][]
                ).map(([key, label]) => (
                  <label key={key}>
                    <input type="checkbox" checked={show[key]} onChange={() => setShow((s) => ({ ...s, [key]: !s[key] }))} />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="seg tools">
            {(["cursor", "hline", "trend", "fib", "pitchfork", "avwap", "erase"] as Tool[]).map((t) => (
              <button key={t} className={tool === t ? "on" : ""} type="button" title={TOOL_HINT[t]} onClick={() => { setTool(t); setView("chart"); setStatus(TOOL_HINT[t]); }}>{toolLabel(t)}</button>
            ))}
          </div>
          <button type="button" onClick={() => {
            if (!payload) return;
            const dir = trade?.direction ?? "context";
            const fib = autoFibDrawing(payload.bars, dir);
            setStatus(fib ? `Auto Fib from the latest ${dir} swing.` : "No swing in this window. Place a Fib manually.");
            if (fib) changeDrawings([...drawings, fib]);
          }}>Auto Fib</button>
          <button type="button" onClick={() => {
            if (!payload) return;
            const daily = timeframe === "1d" || timeframe === "1w";
            const fork = autoForkDrawing(payload.bars, daily);
            setStatus(fork ? "Pitchfork from the last three pivots." : "No clear pivots. Click three points.");
            if (fork) changeDrawings([...drawings, fork]);
          }}>Auto fork</button>
          <button type="button" onClick={() => {
            if (!trade) changeDrawings([...drawings, { id: newId(), type: "trade", direction: "context", entryLow: null, entryHigh: null, stop: null, t1: null, t2: null }]);
            setView("chart");
          }}>Trade</button>
          <button type="button" className={armClear ? "danger" : ""} onClick={() => {
            if (!armClear) { setArmClear(true); return; }
            changeDrawings([]);
            setArmClear(false);
          }}>{armClear ? "Confirm clear" : "Clear"}</button>
          <label className="compare">
            Compare
            <select value="" onChange={(e) => {
              const id = e.target.value;
              if (!id || compareIds.includes(id) || compareIds.length >= 3) return;
              setCompareIds((xs) => [...xs, id]);
            }}>
              <option value="">Add overlay…</option>
              {listed.filter((m) => m.id !== marketId).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          {compareIds.map((id) => (
            <button key={id} type="button" className="chip" onClick={() => setCompareIds((xs) => xs.filter((x) => x !== id))}>
              {listed.find((m) => m.id === id)?.name ?? id} ×
            </button>
          ))}
          <div className="seg" aria-label="Layout">
            {([1, 2, 4, 6] as LayoutCount[]).map((n) => (
              <button key={n} className={desk.layout === n ? "on" : ""} type="button" title={n === 1 ? "One chart" : `${n} charts`} onClick={() => setDesk((d) => setLayoutCount(d, n))}>{n}</button>
            ))}
          </div>
          <button className={`toggle ${desk.syncCrosshair ? "on" : ""}`} type="button" title="Sync the crosshair time across panes" onClick={() => setDesk((d) => ({ ...d, syncCrosshair: !d.syncCrosshair }))}>Sync crosshair</button>
          <button className={`toggle ${desk.syncTime ? "on" : ""}`} type="button" title="Pan and zoom every pane together" onClick={() => setDesk((d) => ({ ...d, syncTime: !d.syncTime }))}>Sync time</button>
          <button className={`toggle ${desk.linkSymbol ? "on" : ""}`} type="button" title="The next symbol applies to every pane" onClick={() => setDesk((d) => ({ ...d, linkSymbol: !d.linkSymbol }))}>Link symbol</button>
          <div className="seg view-switch">
            <button className={view === "chart" ? "on" : ""} type="button" onClick={() => setView("chart")}>Chart</button>
            <button className={view === "curve" ? "on" : ""} type="button" onClick={() => setView("curve")}>Curve</button>
          </div>
        </div>

        {(layoutShown > 1 || view === "chart") && (
          <>
            {layoutShown === 1 && <div className="banners">
              {viewModel?.exactness && (
                <p className="source-line">
                  {viewModel.exactness}
                  {viewModel.ric ? ` · ${viewModel.ric}` : ""}
                  {viewModel.licence ? ` · ${viewModel.licence}` : ""}
                  {viewModel.attribution ? ` · ${viewModel.attribution}` : ""}
                </p>
              )}
              {(payload?.infoNote || viewModel?.infoNote) && <p className="banner">{showingThis && payload?.infoNote ? payload.infoNote : viewModel?.infoNote}</p>}
              {viewModel?.proxyNote && <p className="banner warn"><b>Proxy.</b> {viewModel.proxyNote}</p>}
              {showingThis && payload?.proxyNote && payload.proxyNote !== viewModel?.proxyNote && <p className="banner warn"><b>Stand-in.</b> {payload.proxyNote}</p>}
              {showingThis && payload?.warnings.map((w) => <p key={w} className="banner warn">{w}</p>)}
              {spread && payload?.infoNote && <p className="banner">{payload.infoNote}</p>}
              {seriesMode === "continuous" && <p className="banner warn"><b>Back-adjusted continuous {ticker}.</b> Yahoo splices the rolls, so levels and percentage changes will not match the specific contract.</p>}
              {viewModel?.pence && <p className="banner">Quoted in pence (p), not pounds.</p>}
              {(quote?.stale || payload?.stale) && <p className="banner warn"><b>No fresh quote.</b> {payload?.staleReason || `Last updated ${quote?.lastUpdatedLabel}. The last figure is not a current price.`}</p>}
              {showingThis && payload?.priceSource && (
                <p className="source-line">
                  Live source: {payload.priceSource === "ig" ? "IG price (IG points)" : payload.source}
                  {payload.igAllowance ? ` · allowance ${payload.igAllowance.remaining.toLocaleString("en-GB")} / ${payload.igAllowance.total.toLocaleString("en-GB")}` : ""}
                </p>
              )}
              {payload?.warnings?.map((w) => <p key={w} className="banner warn">{w}</p>)}
              {payload && (
                <p className="source-line">
                  {payload.source} · {payload.delayNote} Times are UK (Europe/London). Last bar {payload.lastBarUnix ? formatLondon(payload.lastBarUnix) : "n/a"}
                  {" · "}quote {formatAge(payload.quoteTimeUnix ? now / 1000 - payload.quoteTimeUnix : payload.ageSeconds)}
                  {payload.instrumentName ? ` · ${payload.instrumentName}` : ""}
                  {payload.currency ? ` · ${payload.currency}` : ""}
                </p>
              )}
              {status && <p className="source-line hint">{status}</p>}
            </div>}
            {layoutShown === 1 && showingThis && bar && (
              <div className="legend-strip">
                <span>O {fmt(bar.open, decimals)}</span>
                <span>H {fmt(bar.high, decimals)}</span>
                <span>L {fmt(bar.low, decimals)}</span>
                <span>C {fmt(bar.close, decimals)}</span>
                <span style={{ color: "#ffb300" }}>SMA20 {fmt(bar.sma20, decimals)}</span>
                <span style={{ color: "#42a5f5" }}>SMA50 {fmt(bar.sma50, decimals)}</span>
                <span style={{ color: "#ab47bc" }}>SMA200 {fmt(bar.sma200, decimals)}</span>
                {payload?.sma200Daily != null && (timeframe === "15m" || timeframe === "1h") && <span style={{ color: "#ab47bc" }}>200-day {fmt(payload.sma200Daily, decimals)}</span>}
                <span style={{ color: "#90a4ae" }}>BB {fmt(bar.bbLower, decimals)} / {fmt(bar.bbUpper, decimals)}</span>
                <span style={{ color: "#ce93d8" }}>RSI {bar.rsi14 == null ? "n/a" : bar.rsi14.toFixed(1)}</span>
                <span style={{ color: "#4fc3f7" }}>Stoch {bar.stochK == null ? "n/a" : `${bar.stochK.toFixed(0)}/${bar.stochD?.toFixed(0)}`}</span>
                <span>ATR {fmt(bar.atr14, decimals)}</span>
                {show.macd && <span>MACD {fmt(bar.macd, decimals)}</span>}
              </div>
            )}
            <div className={`stage ${layoutShown > 1 ? "multi" : ""}`}>
              <div className={`chart-grid n${layoutShown}`}>
                {(narrow ? [desk.active] : Array.from({ length: Math.min(desk.layout, desk.panes.length) }, (_, i) => i)).map((index) => (
                  <ChartPane
                    key={index}
                    ref={(handle) => { paneRefs.current[index] = handle; }}
                    settings={desk.panes[index]}
                    solo={layoutShown === 1}
                    active={index === desk.active}
                    tool={tool}
                    compare={compare}
                    listed={listed}
                    quotes={quotes}
                    spreads={spreads}
                    now={now}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onStatus={setStatus}
                    syncTime={desk.syncCrosshair && timeSync && timeSync.source !== index ? timeSync.time : null}
                    syncRange={desk.syncTime && rangeSync && rangeSync.source !== index ? { from: rangeSync.from, to: rangeSync.to } : null}
                    onActivate={() => setDesk((d) => (d.active === index ? d : { ...d, active: index }))}
                    onSyncTime={(time) => {
                      setTimeSync((prev) => {
                        if (!desk.syncCrosshair) return prev;
                        if (prev && prev.source === index && prev.time === time) return prev;
                        return { time, source: index };
                      });
                    }}
                    onSyncRange={(range) => {
                      setRangeSync((prev) => {
                        if (!desk.syncTime) return prev;
                        if (prev && prev.source === index && Math.abs(prev.from - range.from) < 1 && Math.abs(prev.to - range.to) < 1) return prev;
                        return { ...range, source: index };
                      });
                    }}
                    onSnapshot={(next) => {
                      if (activeRef.current === index) setSnap(next);
                    }}
                  />
                ))}
              </div>
              {layoutShown === 1 && view === "chart" && (
              <Inspector
                bar={bar}
                payload={payload}
                decimals={decimals}
                drawings={drawings}
                selectedId={selectedId}
                trade={trade}
                compare={compare}
                onDrawingsChange={changeDrawings}
                onSelect={setSelectedId}
              />
              )}
            </div>
          </>
        )}

        {layoutShown === 1 && view === "curve" && (
          <div className="curve-stage">
            <div className="curve-switch">
              {curves.map((c) => (
                <button key={c.id} className={curveId === c.id ? "on" : ""} type="button" onClick={() => setCurvePick(c.id)}>{c.name}</button>
              ))}
            </div>
            {curveLoading && <div className="loading-bar" />}
            {bigCurveError && (
              <div className="error-state">
                <h2>Couldn't load the {curveId} curve</h2>
                <p>{bigCurveError}</p>
              </div>
            )}
            {bigCurve && bigCurve.id === curveId && <CurveView data={bigCurve} />}
          </div>
        )}
        <footer className="foot">
          {showingThis && payload?.source === "ICE"
            ? "ICE charting data is delayed, free to view for personal use, and not for redistribution. Not IG, not advice."
            : "Public Yahoo Finance data, delayed. Not IG, not a point conversion, not advice."}
        </footer>
      </main>
    </div>
  );
}

function Inspector(props: {
  bar: EnrichedBar | null;
  payload: OhlcResponse | null;
  decimals: number;
  drawings: Drawing[];
  selectedId: string | null;
  trade: TradeDrawing | undefined;
  compare: CompareSeries[];
  onDrawingsChange: (next: Drawing[]) => void;
  onSelect: (id: string | null) => void;
}) {
  const t = props.trade;
  const rr = t ? riskReward(t) : null;
  const atr = props.bar?.atr14 ?? null;
  function patch(partial: Partial<TradeDrawing>) {
    if (!t) return;
    props.onDrawingsChange(props.drawings.map((d) => (d.id === t.id ? { ...t, ...partial } : d)));
  }
  return (
    <aside className="inspector">
      <h3>Readout</h3>
      {props.bar ? (
        <dl>
          <dt>ATR(14)</dt><dd>{fmt(atr, props.decimals)}</dd>
          {props.payload?.sma200Daily != null && <><dt>200-day SMA</dt><dd>{fmt(props.payload.sma200Daily, props.decimals)}</dd></>}
          <dt>RSI(14)</dt><dd>{props.bar.rsi14 == null ? "n/a" : props.bar.rsi14.toFixed(1)}</dd>
          <dt>Stoch %K / %D</dt><dd>{props.bar.stochK == null ? "n/a" : `${props.bar.stochK.toFixed(1)} / ${props.bar.stochD?.toFixed(1)}`}</dd>
        </dl>
      ) : <p className="muted">Waiting for bars.</p>}

      <h3>Trade</h3>
      {!t && <p className="muted">Use Trade to mark entry, stop, T1 and T2. Context draws the levels with no long/short label.</p>}
      {t && (
        <div className="trade-form">
          <label>Direction
            <select value={t.direction} onChange={(e) => patch({ direction: e.target.value as TradeDrawing["direction"] })}>
              <option value="long">Long</option>
              <option value="short">Short</option>
              <option value="context">Context</option>
            </select>
          </label>
          <Num label="Entry low" value={t.entryLow} onChange={(entryLow) => patch({ entryLow })} />
          <Num label="Entry high" value={t.entryHigh} onChange={(entryHigh) => patch({ entryHigh })} />
          <Num label="Stop" value={t.stop} onChange={(stop) => patch({ stop })} />
          <Num label="T1" value={t.t1} onChange={(t1) => patch({ t1 })} />
          <Num label="T2" value={t.t2} onChange={(t2) => patch({ t2 })} />
          {rr && (
            <p className="rr">
              Risk {fmt(rr.risk, props.decimals)} from {fmt(rr.mid, props.decimals)}
              {rr.rr1 != null ? ` · R/R T1 ${rr.rr1.toFixed(2)}` : ""}
              {rr.rr2 != null ? ` · T2 ${rr.rr2.toFixed(2)}` : ""}
              {atr ? ` · stop ${ (rr.risk / atr).toFixed(2) }× ATR` : ""}
            </p>
          )}
          <p className="badge-note">{t.direction === "context" ? "Context — levels only, no long/short label." : t.direction === "long" ? "Long idea" : "Short idea"}</p>
        </div>
      )}

      <h3>Drawings</h3>
      {!props.drawings.length && <p className="muted">Stored in this browser, per symbol.</p>}
      <ul className="drawing-list">
        {props.drawings.map((d) => (
          <li key={d.id} className={d.id === props.selectedId ? "on" : ""}>
            <button type="button" onClick={() => props.onSelect(d.id)}>{drawingLabel(d)}</button>
            <button type="button" onClick={() => props.onDrawingsChange(props.drawings.filter((x) => x.id !== d.id))}>×</button>
          </li>
        ))}
      </ul>
      {props.compare.length > 0 && <p className="muted">Compare lines are rebased to 0% at the first bar of the loaded window. The dashed line is this symbol.</p>}
    </aside>
  );
}

function Num({ label, value, onChange }: { label: string; value: number | null; onChange: (n: number | null) => void }) {
  return (
    <label>{label}
      <input
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          if (!raw) onChange(null);
          else {
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }
        }}
      />
    </label>
  );
}

function drawingLabel(d: Drawing): string {
  if (d.type === "hline") return `Level ${d.price}`;
  if (d.type === "trend") return "Trendline";
  if (d.type === "fib") return "Fibonacci";
  if (d.type === "pitchfork") return "Pitchfork";
  if (d.type === "avwap") return `VWAP ${d.slot}`;
  if (d.type === "trade") return d.direction === "context" ? "Context levels" : `${d.direction} idea`;
  return "Drawing";
}

function toolLabel(t: Tool): string {
  if (t === "cursor") return "Pointer";
  if (t === "hline") return "H-line";
  if (t === "trend") return "Trend";
  if (t === "fib") return "Fib";
  if (t === "pitchfork") return "Fork";
  if (t === "avwap") return "VWAP";
  return "Erase";
}

function fmt(n: number | null | undefined, decimals: number): string {
  return formatPrice(n, decimals);
}

function customView(c: CustomSymbol | undefined): MarketView | null {
  if (!c) return null;
  return {
    id: `custom:${c.ticker}`,
    name: c.name,
    group: "Custom",
    units: "",
    assetClass: "equity",
    ticker: c.ticker,
    contractTicker: null,
    contractLabel: null,
    contract: null,
    continuous: null,
    preferContinuous: false,
    proxyNote: null,
    pence: false,
    fxClose22: false,
    hideStale: false,
    decimals: 2,
    curveId: null,
    alsoIn: null,
    sourceKind: "yahoo",
    seriesId: null,
    licence: null,
    attribution: null,
    exactness: null,
    ric: null,
    infoNote: null,
    dailyOnly: false,
    intradayOnly: false,
    nativeFrequency: null,
    requiresEnv: null,
    delayNote: null,
    igEpic: null,
    igEpicAlt: null,
    sourceChain: null,
    ice: null,
    iceFallback: null,
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
