import "server-only";
import * as xlsx from "xlsx";
import { readStoredBars, readStoredJson, writeStoredBars, writeStoredJson } from "@/lib/barStore";
import { loadIceCocoaCot, loadIceSugarCot, loadTtfCot } from "@/lib/cot";
import { DataError } from "@/lib/errors";
import { loadExternal } from "@/lib/sources";
import { LARGE_GAP, stepMonthly } from "@/lib/splice";
import type { Bar, SeriesMark, SpliceInfo } from "@/lib/types";
import { yahooDaily } from "@/lib/yahoo";
import { unzip } from "@/lib/zip";

export interface LoadedExtra {
  bars: Bar[];
  label: string;
  warnings: string[];
  infoNote: string;
  splice: SpliceInfo | null;
  shortName: string;
}

export async function loadExtra(id: string): Promise<LoadedExtra> {
  switch (id) {
    case "urea-me": return loadUreaMe();
    case "ahdb-mop": return loadAhdbMop();
    case "cot-ttf": return plain("TTF investment-fund net", "contracts", await loadTtfCot(), "ICE Endex MiFID COT, TFM, investment funds long minus short. Only the last four Fridays are published free, so each new week is stored from here on. Position is in MWh.");
    case "cot-sugar": return plain("White sugar managed-money net", "contracts", await loadIceSugarCot(), "ICE Futures Europe white sugar futures. Managed money long minus short. Futures only, not futures and options. Free to view, not for redistribution.");
    case "cot-cocoa": return plain("London cocoa managed-money net", "contracts", await loadIceCocoaCot(), "ICE Futures Europe London cocoa futures. Managed money long minus short. Futures only. Free to view, not for redistribution.");
    case "oecd-ea": return oecd("EA20", "Eurozone OECD business confidence", "Proxy for the HCOB Eurozone manufacturing PMI. This is the OECD business confidence indicator, amplitude adjusted, around 100. It is not a PMI.");
    case "oecd-gb": return oecd("GBR", "UK OECD business confidence", "Proxy for the S&P Global UK manufacturing PMI. This is the OECD business confidence indicator, amplitude adjusted, around 100. It is not a PMI.");
    case "ism": return loadIsm();
    case "boe-1y": return loadGilt();
    default: throw new DataError(`Unknown series ${id}`, id);
  }
}

async function loadUreaMe(): Promise<LoadedExtra> {
  const [wb, yahoo] = await Promise.all([
    loadExternal({ source: "worldbank", seriesId: "Urea", name: "Urea" }, "1d"),
    yahooDaily("UME=F", Date.parse("2017-06-01T00:00:00Z") / 1000),
  ]);
  const ume = yahoo.bars.filter((bar) => bar.close > 0);
  const first = ume[0]?.time ?? 0;
  const last = ume.at(-1)?.time ?? 0;
  const before = stepMonthly(wb.bars.filter((bar) => bar.time < first), first);
  const after = stepMonthly(wb.bars.filter((bar) => bar.time > last));
  const map = new Map<number, Bar>();
  for (const bar of [...before, ...ume, ...after]) map.set(bar.time, bar);
  const bars = [...map.values()].sort((a, b) => a.time - b.time);
  const nextWb = wb.bars.find((bar) => bar.time > last);
  const gap = nextWb && ume.length && ume.at(-1)!.close !== 0 ? (nextWb.close - ume.at(-1)!.close) / ume.at(-1)!.close : null;
  const marks: SeriesMark[] = [
    { time: Date.parse("2022-03-01T12:00:00Z") / 1000, label: "WB origin", kind: "break" },
  ];
  if (last) marks.push({ time: last, label: "UME ends", kind: "splice" });
  const warnings = gap != null && Math.abs(gap) > LARGE_GAP
    ? [`The gap where UME stops and the World Bank month resumes is ${(gap * 100).toFixed(1)}%. Neither series is rescaled.`]
    : [];
  const info = [
    "USD per tonne.",
    "World Bank Pink Sheet monthly urea is FOB Black Sea before March 2022 and FOB Middle East from March 2022. That break is marked.",
    `CBOT UME (Yahoo UME=F) prints the daily Middle East price from ${ymd(first)} to ${ymd(last)}. No new UME prices after that, so the World Bank month takes over.`,
    gap == null ? "" : `At the handoff the last UME close is ${ume.at(-1)!.close.toFixed(1)} and the next World Bank month is ${nextWb?.close.toFixed(1)}. Gap ${(gap * 100).toFixed(1)}%. Not level-adjusted.`,
    "A 10-short-ton urea contract (MFV) started in October 2026 and is not this series.",
  ].filter(Boolean).join(" ");
  return {
    bars,
    label: "World Bank monthly, CBOT UME daily to Jul 2026, then World Bank",
    warnings,
    infoNote: info,
    shortName: "Urea FOB Middle East",
    splice: { time: last || null, gap, monthlyClose: nextWb?.close ?? null, recentClose: ume.at(-1)?.close ?? null, states: null, nativeLast: ume.at(-1)?.close ?? null, nativeUnit: "USD/t", usdLast: bars.at(-1)?.close ?? null, legend: "UME daily until it stops, then World Bank monthly", marks },
  };
}

async function loadAhdbMop(): Promise<LoadedExtra> {
  const key = "ahdb:mop:v1";
  const cached = await readStoredBars(key);
  if (cached.length && Date.now() / 1000 - cached[cached.length - 1].time < 20 * 86_400) {
    return plain("AHDB GB potash", "GBP/t", cached, ahdbNote(cached));
  }
  const res = await fetch("https://projectblue.blob.core.windows.net/media/Default/Market%20Intelligence/GBFertiliserPriceSeries.xlsx", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MMCharts/1.0)" },
    cache: "no-store",
  });
  if (!res.ok) throw new DataError(`AHDB workbook HTTP ${res.status}`, "MOP");
  const book = xlsx.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
  const historic = book.Sheets["Historic Data"];
  const monthly = book.Sheets["Monthly GB fertiliser prices "];
  if (!historic || !monthly) throw new DataError("AHDB workbook is missing the potash sheets", "MOP");
  const bars = [...ahdbHistoric(historic), ...ahdbMonthly(monthly)];
  const map = new Map<number, Bar>();
  for (const bar of bars) map.set(bar.time, bar);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  if (!merged.length) throw new DataError("AHDB potash sheet had no numbers", "MOP");
  await writeStoredBars(key, merged);
  return plain("AHDB GB potash", "GBP/t", merged, ahdbNote(merged));
}

function ahdbHistoric(sheet: xlsx.WorkSheet): Bar[] {
  const rows = xlsx.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, raw: false });
  const bars: Bar[] = [];
  for (const row of rows.slice(3)) {
    const time = parseUs(String(row?.[0] ?? ""));
    const raw = String(row?.[5] ?? "").trim();
    const price = rangeMid(raw);
    if (time == null || price == null) continue;
    bars.push(flat(time, price));
  }
  return bars;
}

function ahdbMonthly(sheet: xlsx.WorkSheet): Bar[] {
  const rows = xlsx.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, raw: false });
  const header = rows.findIndex((row) => (row ?? []).some((cell) => String(cell ?? "").includes("Muriate of Potash")));
  if (header < 0) return [];
  const col = (rows[header] ?? []).findIndex((cell) => String(cell ?? "").includes("Muriate of Potash"));
  const bars: Bar[] = [];
  for (const row of rows.slice(header + 1)) {
    const time = parseMonYy(String(row?.[1] ?? ""));
    const price = Number(String(row?.[col] ?? "").replace(/[^0-9.]/g, ""));
    if (time == null || !Number.isFinite(price) || price === 0) continue;
    bars.push(flat(time, price));
  }
  return bars;
}

async function oecd(ref: "EA20" | "GBR", name: string, note: string): Promise<LoadedExtra> {
  const key = `oecd:bci:${ref}:v1`;
  const cached = await readStoredBars(key);
  if (cached.length > 24) return plain(name, "index", cached, note);
  const url = `https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/${ref}.M.BCICP...AA...H?format=csv`;
  let text = "";
  let last = "OECD request failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "MMCharts/1.0", Accept: "text/csv" }, cache: "no-store" });
    if (res.ok) {
      text = await res.text();
      break;
    }
    last = `OECD HTTP ${res.status}`;
    await new Promise((resolve) => setTimeout(resolve, 700 * 2 ** attempt));
  }
  if (!text) throw new DataError(last, ref);
  const lines = text.split(/\r?\n/);
  const head = lines[0]?.split(",") ?? [];
  const period = head.indexOf("TIME_PERIOD");
  const value = head.indexOf("OBS_VALUE");
  const bars: Bar[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const time = Date.parse(`${cells[period]}-01T12:00:00Z`);
    const close = Number(cells[value]);
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    bars.push(flat(time / 1000, close));
  }
  bars.sort((a, b) => a.time - b.time);
  if (!bars.length) throw new DataError(`OECD returned no business confidence for ${ref}`, ref);
  await writeStoredBars(key, bars);
  return plain(name, "index", bars, note);
}

async function loadIsm(): Promise<LoadedExtra> {
  const key = "ism:mfg:v1";
  const cached = await readStoredBars(key);
  if (cached.length > 24 && Date.now() / 1000 - cached[cached.length - 1].time < 40 * 86_400) {
    return plain("ISM manufacturing PMI (unverified)", "index", cached, ismNote());
  }
  const res = await fetch("https://www.mfgcalcs.com/data/manufacturing-pmi/mfg-calcs-manufacturing-pmi.csv", {
    headers: { "User-Agent": "MMCharts/1.0", Accept: "text/csv" },
    cache: "no-store",
  });
  if (!res.ok) throw new DataError(`ISM transcription HTTP ${res.status}`, "ISM");
  const bars: Bar[] = [];
  for (const line of (await res.text()).split(/\r?\n/).slice(1)) {
    const [month, pmi] = line.split(",");
    const time = Date.parse(`${month}-01T12:00:00Z`);
    const close = Number(pmi);
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    bars.push(flat(time / 1000, close));
  }
  if (!bars.length) throw new DataError("The ISM transcription had no months", "ISM");
  await writeStoredBars(key, bars);
  return plain("ISM manufacturing PMI (unverified)", "index", bars, ismNote());
}

async function loadGilt(): Promise<LoadedExtra> {
  const key = "boe:gilt1y:v1";
  const cached = await readStoredBars(key);
  const meta = await readStoredJson(`${key}:meta`);
  const savedAt = meta && typeof meta === "object" && typeof (meta as { savedAt?: unknown }).savedAt === "number" ? (meta as { savedAt: number }).savedAt : 0;
  if (cached.length > 1000 && Date.now() / 1000 - savedAt < 3 * 86_400) {
    return plain("UK 1y fitted spot", "%", cached, giltNote());
  }
  const bars = cached.length > 1000 ? [...cached] : await giltArchive();
  const latest = await giltZip("https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/latest-yield-curve-data.zip");
  const map = new Map<number, Bar>();
  for (const bar of [...bars, ...latest]) map.set(bar.time, bar);
  const merged = [...map.values()].sort((a, b) => a.time - b.time);
  if (!merged.length) throw new DataError("BoE nominal curve had no 1.0y observations", "1y");
  await writeStoredBars(key, merged);
  await writeStoredJson(`${key}:meta`, { savedAt: Math.floor(Date.now() / 1000) });
  return plain("UK 1y fitted spot", "%", merged, giltNote());
}

async function giltArchive(): Promise<Bar[]> {
  return giltZip("https://www.bankofengland.co.uk/-/media/boe/files/statistics/yield-curves/glcnominalddata.zip");
}

async function giltZip(url: string): Promise<Bar[]> {
  const res = await fetch(url, { headers: { "User-Agent": "MMCharts/1.0" }, cache: "no-store" });
  if (!res.ok) throw new DataError(`BoE yield curve HTTP ${res.status}`, url);
  const files = unzip(Buffer.from(await res.arrayBuffer()));
  const bars: Bar[] = [];
  for (const [name, buf] of files) {
    if (!/nominal/i.test(name) || !name.endsWith(".xlsx")) continue;
    bars.push(...giltSheet(buf));
  }
  return bars;
}

function giltSheet(buf: Buffer): Bar[] {
  const book = xlsx.read(buf, { type: "buffer" });
  const sheet = book.Sheets["4. spot curve"];
  if (!sheet) return [];
  const rows = xlsx.utils.sheet_to_json<(string | null)[]>(sheet, { header: 1, raw: false });
  const maturity = rows.findIndex((row) => (row ?? []).some((cell) => String(cell ?? "").trim() === "1.0"));
  if (maturity < 0) return [];
  const col = (rows[maturity] ?? []).findIndex((cell) => String(cell ?? "").trim() === "1.0");
  const bars: Bar[] = [];
  for (const row of rows.slice(maturity + 1)) {
    const time = parseBoeDate(String(row?.[0] ?? ""));
    const close = Number(row?.[col]);
    if (time == null || !Number.isFinite(close)) continue;
    bars.push(flat(time, close));
  }
  return bars;
}

function plain(label: string, unit: string, bars: Bar[], infoNote: string): LoadedExtra {
  return {
    bars,
    label,
    warnings: [],
    infoNote,
    shortName: label,
    splice: null,
  };
}

function ahdbNote(bars: Bar[]): string {
  return `AHDB GB fertiliser price for muriate of potash, GBP per tonne. A range in the historic sheet is the midpoint. Monthly figures replace the range from 2017. First stored month ${ymd(bars[0]?.time ?? 0)}. This is not a futures price.`;
}

function ismNote(): string {
  return "UNVERIFIED third-party transcription of the ISM manufacturing PMI from mfgcalcs.com. ISM's own series is copyrighted and is not downloaded here. Do not treat a print as the official ISM release.";
}

function giltNote(): string {
  return "Bank of England fitted nominal spot curve, 1.0 year, percent. This is a zero-coupon fitted yield, not a benchmark bill yield. The parsed archive is cached.";
}

function flat(time: number, close: number): Bar {
  return { time, open: close, high: close, low: close, close, volume: 0 };
}

function rangeMid(raw: string): number | null {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (m) return (Number(m[1]) + Number(m[2])) / 2;
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseUs(value: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = 2000 + Number(m[3]);
  const t = Date.parse(`${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}T12:00:00Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}

function parseMonYy(value: string): number | null {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  const t = Date.parse(`${2000 + Number(m[2])}-${String(month + 1).padStart(2, "0")}-01T12:00:00Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}

const BOE_MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function parseBoeDate(value: string): number | null {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})$/.exec(value.trim());
  if (!m || !BOE_MONTHS[m[2]]) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const t = Date.parse(`${year}-${String(BOE_MONTHS[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}

function ymd(unix: number): string {
  if (!unix) return "n/a";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}
