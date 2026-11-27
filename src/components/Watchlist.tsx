"use client";

import { GROUPS, type UnavailableSeries } from "@/config/markets";
import { formatChange, formatPct, formatPrice } from "@/lib/format";
import { formatAge } from "@/lib/time";
import type { Quote } from "@/lib/types";
import type { MarketView } from "@/lib/marketModel";
import { watchlistMatches } from "@/lib/watchlistFilter";
import { useEffect, useState } from "react";

export interface CustomSymbol {
  ticker: string;
  name: string;
}

interface Props {
  markets: MarketView[];
  quotes: Record<string, Quote>;
  selectedId: string;
  now: number;
  custom: CustomSymbol[];
  onSelect: (id: string) => void;
  onAdd: (symbol: CustomSymbol) => void;
  onRemove: (ticker: string) => void;
  unavailable: UnavailableSeries[];
  spreads: { id: string; name: string; formula: string }[];
  onAddSpread: (spread: { name: string; formula: string }) => void;
  onRemoveSpread: (id: string) => void;
}

export function Watchlist(props: Props) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<{ symbol: string; name: string; type: string; exchange: string }[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [igNote, setIgNote] = useState<string | null>(null);
  const [igRows, setIgRows] = useState<{ id: string; name: string; sub: string; bid: number | null; offer: number | null }[]>([]);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const res = await fetch("/api/ig/watchlist");
        const body = (await res.json()) as {
          available?: boolean;
          reason?: string;
          markets?: { epic: string; name: string; expiry: string | null; bid: number | null; offer: number | null }[];
        };
        if (stop) return;
        if (!body.available) {
          setIgNote(body.reason ?? "IG is not configured.");
          setIgRows([]);
          return;
        }
        setIgNote(null);
        setIgRows((body.markets ?? []).map((row) => {
          const known = props.markets.find((m) => m.igEpic === row.epic || m.igEpicAlt === row.epic);
          return {
            id: known?.id ?? row.epic,
            name: known?.name ?? row.name,
            sub: row.expiry ? `${row.epic} · ${row.expiry}` : row.epic,
            bid: row.bid,
            offer: row.offer,
          };
        }));
      } catch {
        if (!stop) setIgNote("IG watchlist could not be loaded.");
      }
    }
    void load();
    const timer = setInterval(load, 5 * 60_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [props.markets]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        const body = (await res.json()) as { results?: typeof hits; error?: string };
        if (!res.ok) {
          setSearchError(body.error || "Search failed");
          setHits([]);
          return;
        }
        setSearchError(null);
        setHits(body.results ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setSearchError("Search failed");
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const [spreadName, setSpreadName] = useState("");
  const [spreadFormula, setSpreadFormula] = useState("");
  const groups = [...GROUPS, "Custom"] as const;
  const filtering = filter.trim().length > 0;
  const igShown = igRows.filter((row) => watchlistMatches(filter, [row.name, row.sub, row.id, "IG"]));
  const groupBlocks = groups.map((group) => {
    const rows = group === "Custom"
      ? props.custom
          .filter((c) => watchlistMatches(filter, [c.name, c.ticker, group]))
          .map((c) => ({ id: `custom:${c.ticker}`, name: c.name, sub: c.ticker, removable: c.ticker, exactness: null as string | null }))
      : props.markets.filter((m) => (m.group === group || m.alsoIn === group) && watchlistMatches(filter, [m.name, m.ticker, m.continuous, m.contractTicker, m.contractLabel, m.ric, group])).map((m) => {
          const quote = props.quotes[m.id];
          const sub = quote?.contractLabel || (m.preferContinuous ? m.ticker : m.contractLabel ?? m.ticker);
          return { id: m.id, name: m.name, sub, removable: null as string | null, exactness: m.exactness };
        });
    const missing = props.unavailable.filter((u) => u.group === group && watchlistMatches(filter, [u.name, u.ric, u.group]));
    if (!rows.length && !missing.length) return null;
    return { group, rows, missing };
  }).filter((block) => block != null);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">MM</span>
        <div>
          <strong>Chart Desk</strong>
          <em>Mendelsohn</em>
        </div>
      </div>
      <div className="wl-filter">
        <input
          value={filter}
          placeholder="Filter markets"
          aria-label="Filter markets"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setFilter("");
              e.currentTarget.blur();
            }
          }}
          autoComplete="off"
        />
        {filter && (
          <button type="button" className="wl-filter-x" aria-label="Clear filter" onClick={() => setFilter("")}>×</button>
        )}
      </div>
      <div className="wl-scroll">
        {(!filtering || igShown.length > 0) && (
        <section>
          <h3>IG · MM</h3>
          {!filtering && igNote && <p className="wl-sub" style={{ padding: "6px 12px" }}>{igNote}</p>}
          {igShown.map((row) => (
            <button key={row.sub} className={`wl-row ${props.selectedId === row.id ? "active" : ""}`} type="button" onClick={() => { if (!row.id.includes(".")) props.onSelect(row.id); }}>
              <span className="wl-name"><span>{row.name}</span><i className="flag exact">IG</i></span>
              <span className="wl-sub">{row.sub}</span>
              <span className="wl-px">{row.bid == null ? "n/a" : formatPrice(row.bid, 1)}</span>
              <span className="wl-chg">{row.offer == null ? "" : formatPrice(row.offer, 1)}</span>
            </button>
          ))}
        </section>
        )}
        {groupBlocks.map(({ group, rows, missing }) => {
          return (
            <section key={group}>
              <h3>{group}</h3>
              {rows.map((row) => {
                const quote = props.quotes[row.id];
                const active = props.selectedId === row.id;
                const up = (quote?.change ?? 0) > 0;
                const down = (quote?.change ?? 0) < 0;
                const age = quote?.asOfUnix != null ? formatAge(props.now / 1000 - quote.asOfUnix) : null;
                return (
                  <button key={row.id} className={`wl-row ${active ? "active" : ""}`} onClick={() => props.onSelect(row.id)}>
                    <span className="wl-name">
                      <span>{row.name}</span>
                      {row.exactness && <i className={`flag ${row.exactness === "near-exact" ? "near" : row.exactness}`}>{row.exactness}</i>}
                      {quote?.proxy && !row.exactness && <i className="proxy">proxy</i>}
                      {quote?.stale && <i className="stale">stale</i>}
                    </span>
                    <span className="wl-sub">{row.sub}{quote?.units ? ` · ${quote.units}` : ""}</span>
                    <span className="wl-px">
                      {quote?.error ? "—" : quote?.stale || quote?.last == null ? "n/a" : formatPrice(quote.last, quote.decimals)}
                    </span>
                    <span className={`wl-chg ${up ? "up" : ""} ${down ? "down" : ""}`}>
                      {quote?.error ? "error" : quote?.stale ? `last ${quote.lastUpdatedLabel ?? ""}` : quote ? `${formatChange(quote.change, quote.decimals)}  ${formatPct(quote.changePct)}` : "…"}
                    </span>
                    <span className="wl-age">
                      {quote?.error ? quote.error : quote?.stale ? "not a current price" : quote?.changeBasis === "22:00 UK" ? `vs 22:00 UK · ${age ?? ""}` : age ?? ""}
                    </span>
                    {row.removable && (
                      <span
                        className="wl-x"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onRemove(row.removable!);
                        }}
                      >
                        remove
                      </span>
                    )}
                  </button>
                );
              })}
              {missing.map((row) => (
                <button key={row.id} className={`wl-row unavailable ${props.selectedId === row.id ? "active" : ""}`} onClick={() => props.onSelect(row.id)}>
                  <span className="wl-name"><span>{row.name}</span><i className="stale">unavailable</i></span>
                  <span className="wl-sub">{row.ric ?? "no free feed"}</span>
                  <span className="wl-px">—</span>
                  <span className="wl-age">{row.reason}</span>
                </button>
              ))}
            </section>
          );
        })}
        {filtering && igShown.length === 0 && groupBlocks.length === 0 && <p className="wl-empty">No markets match.</p>}
      </div>
      <section className="spread-box">
        <h3>Custom spreads</h3>
        <p className="spread-help">Spaces around + − * /. Example: brent - wti. WHprem and GasSpread stay blank until you add the formula.</p>
        {props.spreads.map((s) => (
          <button key={s.id} className={`wl-row ${props.selectedId === s.id ? "active" : ""}`} onClick={() => props.onSelect(s.id)} type="button">
            <span className="wl-name">{s.name}</span>
            <span className="wl-sub">{s.formula}</span>
            <span className="wl-x" role="button" onClick={(e) => { e.stopPropagation(); props.onRemoveSpread(s.id); }}>remove</span>
          </button>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!spreadFormula.trim()) return;
            props.onAddSpread({ name: spreadName.trim() || spreadFormula.trim(), formula: spreadFormula.trim() });
            setSpreadName("");
            setSpreadFormula("");
          }}
        >
          <input value={spreadName} placeholder="Name" onChange={(e) => setSpreadName(e.target.value)} />
          <input value={spreadFormula} placeholder="brent - wti" onChange={(e) => setSpreadFormula(e.target.value)} />
          <button type="submit">Add spread</button>
        </form>
      </section>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (hits[0]) props.onAdd({ ticker: hits[0].symbol, name: hits[0].name });
          setQ("");
        }}
      >
        <label htmlFor="add-symbol">Add symbol</label>
        <input
          id="add-symbol"
          value={q}
          placeholder="Search Yahoo symbol"
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {searchError && <p className="search-error">{searchError}</p>}
        {hits.length > 0 && (
          <ul>
            {hits.map((h) => (
              <li key={h.symbol}>
                <button
                  type="button"
                  onClick={() => {
                    props.onAdd({ ticker: h.symbol, name: h.name });
                    setQ("");
                    setHits([]);
                  }}
                >
                  <b>{h.symbol}</b>
                  <span>{h.name}</span>
                  <em>{h.exchange}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </aside>
  );
}
