"use client";

import { GROUPS } from "@/config/markets";
import { formatChange, formatPct, formatPrice } from "@/lib/format";
import { formatAge } from "@/lib/time";
import type { Quote } from "@/lib/types";
import type { MarketView } from "@/lib/marketModel";
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
}

export function Watchlist(props: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ symbol: string; name: string; type: string; exchange: string }[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  const groups = [...GROUPS, "Custom"] as const;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">MM</span>
        <div>
          <strong>Chart Desk</strong>
          <em>Mendelsohn</em>
        </div>
      </div>
      <div className="wl-scroll">
        {groups.map((group) => {
          const rows = group === "Custom"
            ? props.custom.map((c) => ({ id: `custom:${c.ticker}`, name: c.name, sub: c.ticker, removable: c.ticker }))
            : props.markets.filter((m) => m.group === group).map((m) => {
                const quote = props.quotes[m.id];
                const sub = quote?.contractLabel || (m.preferContinuous ? m.ticker : m.contractLabel ?? m.ticker);
                return { id: m.id, name: m.name, sub, removable: null as string | null };
              });
          if (!rows.length) return null;
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
                      {quote?.proxy && <i className="proxy">proxy</i>}
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
            </section>
          );
        })}
      </div>
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
