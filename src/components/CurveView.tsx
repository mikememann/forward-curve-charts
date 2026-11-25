"use client";

import { formatLondon } from "@/lib/time";
import { formatPrice } from "@/lib/format";
import type { CurvePoint, CurveResponse } from "@/lib/types";
import { useMemo, useState } from "react";

export function CurveView({ data }: { data: CurveResponse }) {
  const [hover, setHover] = useState<number | null>(null);
  const model = useMemo(() => layout(data.points), [data.points]);
  const priced = data.points.some((p) => p.price != null);

  return (
    <div className="curve" data-ready={priced ? "curve" : "empty"}>
      <div className="curve-head">
        <div>
          <h2>{data.name} forward curve</h2>
          <p className="source-line">
            {data.source} · {data.delayNote} Fetched {formatLondon(Date.parse(data.fetchedAt) / 1000)}.
          </p>
        </div>
        <div className="spreads">
          {data.spreads.map((s) => (
            <div key={s.label} className={`spread ${s.structure ?? "na"}`}>
              <span className="spread-k">{s.label}</span>
              <strong>{s.value == null ? "n/a" : formatPrice(s.value, data.decimals)}</strong>
              <span>{s.value == null ? s.reason : `${s.structure} · ${s.from} − ${s.to}`}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="note">{data.note}</p>
      {!priced ? (
        <div className="error-state">
          <h3>No public curve</h3>
          <p>Yahoo returned no fresh daily closes for these contracts. Nothing has been filled in.</p>
        </div>
      ) : (
        <div className="curve-plot">
          <svg viewBox={`0 0 ${model.w} ${model.h}`} role="img" aria-label={`${data.name} forward curve`}>
            {model.yticks.map((t) => (
              <g key={t.value}>
                <line x1={model.pad.l} x2={model.w - model.pad.r} y1={t.y} y2={t.y} stroke="#2a2f3a" />
                <text x={model.pad.l - 8} y={t.y + 4} textAnchor="end" fill="#93a0b0" fontSize="11">
                  {formatPrice(t.value, data.decimals)}
                </text>
              </g>
            ))}
            <path d={model.monthPath} fill="none" stroke="#78909c" strokeWidth="1.4" strokeDasharray="2 3" />
            <path d={model.weekPath} fill="none" stroke="#42a5f5" strokeWidth="1.6" strokeDasharray="5 4" />
            <path d={model.nowPath} fill="none" stroke="#ffb300" strokeWidth="2.2" />
            {model.slots.map((s, i) => (
              <g key={s.point.ticker} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={s.x - s.w / 2} y={model.pad.t} width={s.w} height={model.innerH} fill={hover === i ? "rgba(255,255,255,0.04)" : "transparent"} />
                {s.point.price == null && <text x={s.x} y={model.pad.t + 14} textAnchor="middle" fill="#8d6e63" fontSize="10">no quote</text>}
                {s.monthY != null && <circle cx={s.x} cy={s.monthY} r="2.5" fill="#78909c" />}
                {s.weekY != null && <circle cx={s.x} cy={s.weekY} r="3" fill="#42a5f5" />}
                {s.nowY != null && <circle cx={s.x} cy={s.nowY} r="4" fill="#ffb300" stroke="#1b1404" strokeWidth="1" />}
                {s.nowY != null && (
                  <text
                    x={s.x}
                    y={Math.max(model.pad.t + 12, s.nowY - 8)}
                    textAnchor={i === 0 ? "start" : i === model.slots.length - 1 ? "end" : "middle"}
                    fill="#ffe082"
                    fontSize="10"
                  >
                    {formatPrice(s.point.price, data.decimals)}
                  </text>
                )}
                <text x={s.x} y={model.h - 28} textAnchor="end" fill="#d7dde6" fontSize="11" transform={`rotate(-40 ${s.x} ${model.h - 28})`}>
                  {shortContract(s.point.contract)}
                </text>
              </g>
            ))}
          </svg>
          <p className="source-line curve-times">{curveTimes(data.points)}</p>
          <div className="curve-legend">
            <span><i className="swatch now" /> Latest daily close</span>
            <span><i className="swatch week" /> About 1 week earlier</span>
            <span><i className="swatch month" /> About 1 month earlier</span>
            <span>Gaps are missing Yahoo quotes, not interpolated.</span>
          </div>
          {hover != null && data.points[hover] && <HoverCard point={data.points[hover]} decimals={data.decimals} units={data.units} />}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contract</th>
              <th>Ticker</th>
              <th>Price ({data.units})</th>
              <th>Price bar</th>
              <th>1 week</th>
              <th>1 week bar</th>
              <th>1 month</th>
              <th>1 month bar</th>
            </tr>
          </thead>
          <tbody>
            {data.points.map((p) => (
              <tr key={p.ticker} className={p.price == null ? "gap" : ""}>
                <td>{p.contract}</td>
                <td className="mono">{p.ticker}</td>
                <td>{p.price == null ? "no public quote" : formatPrice(p.price, data.decimals)}</td>
                <td>{stamp(p.priceTimeUnix)}</td>
                <td>{p.week == null ? "—" : formatPrice(p.week, data.decimals)}</td>
                <td>{stamp(p.weekTimeUnix)}</td>
                <td>{p.monthAgo == null ? "—" : formatPrice(p.monthAgo, data.decimals)}</td>
                <td>{stamp(p.monthAgoTimeUnix)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.gaps.length > 0 && (
        <details className="gaps">
          <summary>{data.gaps.length} contract month{data.gaps.length === 1 ? "" : "s"} with no fresh public quote</summary>
          <ul>
            {data.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function HoverCard({ point, decimals, units }: { point: CurvePoint; decimals: number; units: string }) {
  return (
    <div className="hover-card">
      <strong>{point.contract}</strong>
      <span className="mono">{point.ticker}</span>
      <span>Now {point.price == null ? "no quote" : `${formatPrice(point.price, decimals)} ${units}`} · {stamp(point.priceTimeUnix)}</span>
      <span>1w {point.week == null ? "—" : formatPrice(point.week, decimals)} · {stamp(point.weekTimeUnix)}</span>
      <span>1m {point.monthAgo == null ? "—" : formatPrice(point.monthAgo, decimals)} · {stamp(point.monthAgoTimeUnix)}</span>
    </div>
  );
}

function stamp(unix: number | null): string {
  if (unix == null) return "—";
  return formatLondon(unix, "date");
}

function curveTimes(points: CurvePoint[]): string {
  const now = points.find((p) => p.priceTimeUnix);
  const week = points.find((p) => p.weekTimeUnix);
  const month = points.find((p) => p.monthAgoTimeUnix);
  return `Bar dates — latest ${stamp(now?.priceTimeUnix ?? null)}, about 1 week ${stamp(week?.weekTimeUnix ?? null)}, about 1 month ${stamp(month?.monthAgoTimeUnix ?? null)}. Every contract’s own bar date is in the table.`;
}

function shortContract(label: string): string {
  const [mon, year] = label.split(" ");
  return `${mon} ${year?.slice(2) ?? ""}`;
}

function layout(points: CurvePoint[]) {
  const w = 980;
  const h = 360;
  const pad = { l: 68, r: 16, t: 28, b: 72 };
  const vals = points.flatMap((p) => [p.price, p.week, p.monthAgo].filter((n): n is number => n != null));
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  const span = max - min || 1;
  const y0 = min - span * 0.12;
  const y1 = max + span * 0.16;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = Math.max(points.length, 1);
  const xAt = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * innerH;
  const path = (key: "price" | "week" | "monthAgo") => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = p[key];
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const yticks = Array.from({ length: 5 }, (_, i) => {
    const value = y0 + ((y1 - y0) * i) / 4;
    return { value, y: yAt(value) };
  });
  const slots = points.map((point, i) => ({
    point,
    x: xAt(i),
    w: innerW / n,
    nowY: point.price == null ? null : yAt(point.price),
    weekY: point.week == null ? null : yAt(point.week),
    monthY: point.monthAgo == null ? null : yAt(point.monthAgo),
  }));
  return { w, h, pad, innerH, yticks, slots, nowPath: path("price"), weekPath: path("week"), monthPath: path("monthAgo") };
}
