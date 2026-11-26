import "server-only";
import { readStoredBars, writeStoredBars } from "@/lib/barStore";
import { curveSpreads, trimCurve } from "@/lib/curveMath";
import { DataError } from "@/lib/errors";
import type { Bar, CurveResponse } from "@/lib/types";

/**
 * Euronext commodity futures. Free to view for personal analysis, not for redistribution.
 * Live contracts only: expired months return an empty settlement table.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface EnxContract {
  md: string;
  label: string;
  delivery: number;
  settlement: number | null;
}

export async function loadEuronextContinuous(symbol: "EBM" | "EMA"): Promise<{ bars: Bar[]; rolls: string[] }> {
  const contracts = await loadEuronextContracts(symbol);
  const histories: { contract: EnxContract; bars: Bar[] }[] = [];
  for (const contract of contracts) {
    const bars = await loadEuronextHistory(symbol, contract.md);
    if (bars.length) histories.push({ contract, bars });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  if (!histories.length) throw new DataError(`Euronext returned no ${symbol} settlements`, symbol);
  const byTime = new Map<number, { md: string; bar: Bar }>();
  const ordered = [...histories].sort((a, b) => a.contract.delivery - b.contract.delivery);
  for (const { contract, bars } of ordered) {
    for (const bar of bars) {
      if (contract.delivery <= bar.time) continue;
      if (!byTime.has(bar.time)) byTime.set(bar.time, { md: contract.md, bar });
    }
  }
  const rows = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  const rolls: string[] = [];
  let prev = "";
  for (const [, row] of rows) {
    if (prev && row.md !== prev) rolls.push(`${ymd(row.bar.time)}: rolled from ${prev} to ${row.md}`);
    prev = row.md;
  }
  return { bars: rows.map(([, row]) => row.bar), rolls };
}

export async function loadEuronextCurve(symbol: "EBM" | "EMA", name: string): Promise<CurveResponse> {
  const contracts = await loadEuronextContracts(symbol);
  const points = contracts.map((c) => ({
    ticker: c.md,
    contract: c.label,
    month: c.md,
    price: c.settlement,
    priceTimeUnix: c.settlement == null ? null : Math.floor(Date.now() / 1000),
    week: null,
    weekTimeUnix: null,
    monthAgo: null,
    monthAgoTimeUnix: null,
  }));
  return {
    id: symbol === "EBM" ? "matif-wheat" : "matif-corn",
    name,
    units: "EUR/t",
    decimals: 2,
    source: "Euronext",
    delayNote: "Euronext settlement. Free to view for personal analysis, not for redistribution.",
    fetchedAt: new Date().toISOString(),
    note: "Live Euronext contracts only. Expired months are absent. Week and month changes are not fetched.",
    points: trimCurve(points),
    gaps: points.filter((p) => p.price == null).map((p) => `${p.contract}: no settlement`),
    spreads: curveSpreads(points),
  };
}

async function loadEuronextContracts(symbol: "EBM" | "EMA"): Promise<EnxContract[]> {
  const html = await enx(`https://live.euronext.com/en/ajax/getPricesFutures/commodities-futures/${symbol}/DPAR`, `https://live.euronext.com/en/product/commodities-futures/${symbol}-DPAR`);
  const contracts: EnxContract[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const md = /md=(\d{2}-\d{2}-\d{4})/.exec(row[1]);
    if (!md) continue;
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
    const label = cells[0] || md[1];
    const settlement = num(cells[10]) ?? num(cells[3]);
    contracts.push({ md: md[1], label, delivery: parseMd(md[1]), settlement });
  }
  if (!contracts.length) throw new DataError(`Euronext listed no ${symbol} contracts`, symbol);
  return contracts;
}

async function loadEuronextHistory(symbol: "EBM" | "EMA", md: string): Promise<Bar[]> {
  const key = `enx:${symbol}:${md}`;
  const cached = await readStoredBars(key);
  const fresh = cached.length > 0 && Date.now() / 1000 - cached[cached.length - 1].time < 3 * 86_400;
  if (fresh) return cached;
  const url = `https://live.euronext.com/en/ajax/settlements/getHistoricalPricePopup/${symbol}-DPAR?fOrO=F&md=${md}&cOrP=&sp=&startdate=2010-01-01&enddate=${new Date().toISOString().slice(0, 10)}&adjusted=N&nbSession=6000`;
  const html = await enx(url, `https://live.euronext.com/en/product/commodities-futures/${symbol}-DPAR`);
  const bars: Bar[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(html))) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
    if (cells.length < 5) continue;
    const time = parseDmy(cells[0]);
    const open = num(cells[1]);
    const high = num(cells[2]);
    const low = num(cells[3]);
    const close = num(cells[4]);
    if (time == null || close == null || open == null || high == null || low == null) continue;
    bars.push({ time, open, high, low, close, volume: num(cells[5]) ?? 0 });
  }
  bars.sort((a, b) => a.time - b.time);
  if (bars.length) await writeStoredBars(key, bars);
  return bars.length ? bars : cached;
}

async function enx(url: string, referer: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new DataError(`Euronext HTTP ${res.status}`, url);
  return res.text();
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function num(value: string | undefined): number | null {
  if (!value || value === "-") return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDmy(value: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}

function parseMd(md: string): number {
  const [dd, mm, yyyy] = md.split("-");
  return Date.parse(`${yyyy}-${mm}-${dd}T00:00:00Z`) / 1000;
}

function ymd(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}
