import "server-only";
import * as xlsx from "xlsx";
import type { Market, SourceKind } from "@/config/markets";
import { bar, bucket, fitFrequency, parseDay, parseMonthCode } from "@/lib/aggregate";
import { readStoredBars, readStoredText, writeStoredBars, writeStoredText } from "@/lib/barStore";
import { parseBoeCsv, parseBundesbankCsv, parseFredCsv } from "@/lib/parseTables";
import { DataError } from "@/lib/errors";
import type { Bar, Timeframe } from "@/lib/types";

export interface LoadedSeries {
  bars: Bar[];
  sourceLabel: string;
  currency: string | null;
  instrumentName: string | null;
  warnings: string[];
  quoteTime: number | null;
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; MMCharts/1.0)", Accept: "*/*" };
const cache = new Map<string, { exp: number; bars: Bar[]; instrumentName: string | null }>();

async function cached(key: string, ttlMs: number, load: () => Promise<{ bars: Bar[]; instrumentName: string | null }>): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return { bars: hit.bars, instrumentName: hit.instrumentName };
  const value = await load();
  cache.set(key, { exp: Date.now() + ttlMs, ...value });
  return value;
}

async function text(url: string, headers?: Record<string, string>): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new DataError(`HTTP ${res.status} from ${new URL(url).host}`, url);
    return await res.text();
  } catch (e) {
    if (e instanceof DataError) throw e;
    throw new DataError(e instanceof Error ? e.message : "request failed", url);
  } finally {
    clearTimeout(timer);
  }
}

export async function loadExternal(market: Pick<Market, "source" | "seriesId" | "ticker" | "name" | "nativeFrequency" | "requiresEnv">, requested: Timeframe): Promise<LoadedSeries> {
  const source = market.source ?? "yahoo";
  if (source === "yahoo") throw new DataError("Yahoo series are loaded separately", market.ticker ?? "");
  if (market.requiresEnv && !process.env[market.requiresEnv]) {
    throw new DataError(
      `${market.name} is turned off. Set ${market.requiresEnv} (a free GIE AGSI+ key) to load it. No storage figure is shown without that key.`,
      market.seriesId ?? "",
    );
  }
  const native = market.nativeFrequency ?? "1d";
  const raw = await loadNative(source, market.seriesId ?? "", market.name);
  const fitted = fitFrequency(raw.bars, native, requested);
  return {
    bars: fitted.bars,
    sourceLabel: labelFor(source),
    currency: null,
    instrumentName: raw.instrumentName,
    warnings: fitted.warning ? [fitted.warning] : [],
    quoteTime: fitted.bars.at(-1)?.time ?? null,
  };
}

function labelFor(source: SourceKind): string {
  switch (source) {
    case "fred": return "FRED";
    case "boe": return "Bank of England";
    case "bundesbank": return "Deutsche Bundesbank";
    case "cftc": return "CFTC";
    case "worldbank": return "World Bank Pink Sheet";
    case "energycharts": return "Energy-Charts";
    case "elexon": return "Elexon";
    case "portwatch": return "IMF PortWatch";
    case "agsi": return "GIE AGSI+";
    default: return source;
  }
}

async function loadNative(source: SourceKind, seriesId: string, name: string): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  switch (source) {
    case "fred": return cached(`fred:${seriesId}`, 30 * 60_000, () => loadFred(seriesId));
    case "boe": return cached(`boe:${seriesId}`, 30 * 60_000, () => loadBoe(seriesId));
    case "bundesbank": return cached(`bbk:${seriesId}`, 30 * 60_000, () => loadBundesbank(seriesId));
    case "cftc": return cached(`cftc:${seriesId}`, 30 * 60_000, () => loadCftc(seriesId));
    case "worldbank": return cached(`wb:${seriesId}`, 6 * 60 * 60_000, () => loadWorldBank(seriesId));
    case "energycharts": return cached("energycharts:DE-LU", 10 * 60_000, loadEnergyCharts);
    case "elexon": return cached("elexon:APXMIDP", 10 * 60_000, loadElexon);
    case "portwatch": return cached("portwatch:hormuz", 30 * 60_000, loadHormuz);
    case "agsi": return cached("agsi:eu", 30 * 60_000, loadAgsi);
    default: throw new DataError(`No adapter for ${name}`, seriesId);
  }
}

async function loadFred(id: string): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  // A browser User-Agent makes fredgraph.csv hang. Use a plain client name.
  const csv = await text(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, { "User-Agent": "MMCharts/1.0" });
  const bars = parseFredCsv(csv);
  if (!bars.length) throw new DataError(`FRED returned no observations for ${id}`, id);
  return { bars, instrumentName: id };
}

async function loadBoe(code: string): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const url = `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&SeriesCodes=${encodeURIComponent(code)}&UsingCodes=Y&CSVF=TN&Datefrom=01/Jan/1998&Dateto=now`;
  const bars = parseBoeCsv(await text(url));
  if (!bars.length) throw new DataError(`Bank of England returned no observations for ${code}`, code);
  return { bars, instrumentName: code };
}

async function loadBundesbank(tenor: string): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const key = `D.I.ZST.ZI.EUR.S1311.B.A604.${tenor}.R.A.A._Z._Z.A`;
  const url = `https://api.statistiken.bundesbank.de/rest/data/BBSIS/${key}?format=csv`;
  const bars = parseBundesbankCsv(await text(url));
  if (!bars.length) throw new DataError(`Bundesbank returned no observations for ${tenor}`, tenor);
  return { bars, instrumentName: `BBSIS ${tenor}` };
}

async function loadCftc(code: string): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const url = `https://publicreporting.cftc.gov/resource/72hh-3qpy.json?cftc_contract_market_code=${encodeURIComponent(code)}&$select=report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all,contract_market_name&$order=report_date_as_yyyy_mm_dd&$limit=2000`;
  const body = JSON.parse(await text(url)) as { report_date_as_yyyy_mm_dd?: string; m_money_positions_long_all?: string; m_money_positions_short_all?: string; contract_market_name?: string }[];
  if (!Array.isArray(body)) throw new DataError(`CFTC returned no rows for ${code}`, code);
  const bars: Bar[] = [];
  let instrumentName: string | null = null;
  for (const row of body) {
    const time = parseDay((row.report_date_as_yyyy_mm_dd ?? "").slice(0, 10));
    const long = Number(row.m_money_positions_long_all);
    const short = Number(row.m_money_positions_short_all);
    if (time == null || !Number.isFinite(long) || !Number.isFinite(short)) continue;
    if (row.contract_market_name) instrumentName = row.contract_market_name;
    bars.push(bar(time, long - short));
  }
  if (!bars.length) throw new DataError(`CFTC returned no managed-money positions for ${code}`, code);
  return { bars, instrumentName };
}

const WB_PAGE = "https://www.worldbank.org/en/research/commodity-markets";

async function loadWorldBank(column: string): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const html = await text(WB_PAGE);
  const link = html.match(/https:\/\/thedocs\.worldbank\.org\/[^"'\\\s>]+CMO-Historical-Data-Monthly\.xlsx/);
  if (!link) throw new DataError("The World Bank commodity-markets page had no monthly xlsx link", column);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  let buf: ArrayBuffer;
  try {
    const res = await fetch(link[0], { headers: UA, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new DataError(`World Bank file HTTP ${res.status}`, column);
    buf = await res.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
  const book = xlsx.read(new Uint8Array(buf), { type: "array" });
  const sheet = book.Sheets["Monthly Prices"];
  if (!sheet) throw new DataError("World Bank workbook has no Monthly Prices sheet", column);
  const rows = xlsx.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, raw: false });
  const header = rows[4] ?? [];
  const units = rows[5] ?? [];
  const col = header.findIndex((cell) => {
    const name = String(cell ?? "").trim();
    return name === column || name.startsWith(`${column} `) || name.startsWith(`${column}*`);
  });
  if (col < 0) throw new DataError(`World Bank Pink Sheet has no '${column}' column in this file`, column);
  const bars: Bar[] = [];
  for (const row of rows.slice(6)) {
    const time = parseMonthCode(String(row?.[0] ?? ""));
    const raw = String(row?.[col] ?? "").trim();
    const value = Number(raw.replace(/,/g, ""));
    if (time == null || raw === "" || raw === "…" || !Number.isFinite(value)) continue;
    bars.push(bar(time, value));
  }
  if (!bars.length) throw new DataError(`World Bank column '${column}' had no numbers`, column);
  return { bars, instrumentName: `${column} ${String(units[col] ?? "").trim()}`.trim() };
}

async function loadEnergyCharts(): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const end = new Date();
  const start = new Date(end.getTime() - 120 * 86_400_000);
  const url = `https://api.energy-charts.info/price?bzn=DE-LU&start=${start.toISOString()}&end=${end.toISOString()}`;
  const body = JSON.parse(await text(url)) as { unix_seconds?: number[]; price?: (number | null)[]; unit?: string };
  const bars: Bar[] = [];
  const times = body.unix_seconds ?? [];
  const prices = body.price ?? [];
  for (let i = 0; i < times.length; i++) {
    const value = prices[i];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    bars.push(bar(times[i], value));
  }
  if (!bars.length) throw new DataError("Energy-Charts returned no day-ahead prices", "DE-LU");
  return { bars, instrumentName: body.unit ?? "EUR/MWh" };
}

async function loadElexon(): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const bars: Bar[] = [];
  const today = new Date();
  const windows: { from: string; to: string }[] = [];
  for (let i = 0; i < 8; i++) {
    const to = new Date(today.getTime() - i * 7 * 86_400_000);
    const from = new Date(to.getTime() - 6 * 86_400_000);
    windows.push({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  }
  const chunks = await Promise.all(windows.map(async (w) => {
    const url = `https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index?from=${w.from}&to=${w.to}`;
    const body = JSON.parse(await text(url)) as { data?: { startTime?: string; dataProvider?: string; price?: number }[] };
    return body.data ?? [];
  }));
  const seen = new Set<string>();
  for (const row of chunks.flat()) {
    if (row.dataProvider !== "APXMIDP" || !row.startTime || typeof row.price !== "number") continue;
    const time = Date.parse(row.startTime) / 1000;
    if (!Number.isFinite(time) || seen.has(String(time))) continue;
    seen.add(String(time));
    bars.push(bar(time, row.price));
  }
  bars.sort((a, b) => a.time - b.time);
  if (!bars.length) throw new DataError("Elexon returned no APX market-index prices", "APXMIDP");
  return { bars, instrumentName: "APXMIDP" };
}

async function loadHormuz(): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const bars: Bar[] = [];
  for (let offset = 0; offset < 4000; offset += 2000) {
    const url = `https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query?where=${encodeURIComponent("portname='Strait of Hormuz'")}&outFields=date,n_total,n_tanker&returnGeometry=false&orderByFields=date&resultRecordCount=2000&resultOffset=${offset}&f=json`;
    const body = JSON.parse(await text(url)) as { features?: { attributes?: { date?: string; n_total?: number } }[]; exceededTransferLimit?: boolean };
    const features = body.features ?? [];
    for (const feature of features) {
      const time = parseDay(feature.attributes?.date ?? "");
      const total = feature.attributes?.n_total;
      if (time == null || typeof total !== "number" || !Number.isFinite(total)) continue;
      bars.push(bar(time, total));
    }
    if (!body.exceededTransferLimit || features.length === 0) break;
  }
  if (!bars.length) throw new DataError("IMF PortWatch returned no Hormuz transits", "Hormuz");
  return { bars, instrumentName: "Strait of Hormuz total transits" };
}

async function loadAgsi(): Promise<{ bars: Bar[]; instrumentName: string | null }> {
  const key = process.env.AGSI_API_KEY ?? "";
  const from = new Date(Date.now() - 10 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const url = `https://agsi.gie.eu/api?type=eu&from=${from}&size=4000`;
  const body = JSON.parse(await text(url, { "x-key": key })) as { data?: { gasDayStart?: string; full?: string }[]; message?: string };
  if (!Array.isArray(body.data)) throw new DataError(body.message || "AGSI+ returned no EU storage series", "eu");
  const bars: Bar[] = [];
  for (const row of body.data) {
    const time = parseDay(row.gasDayStart ?? "");
    const value = Number(row.full);
    if (time == null || !Number.isFinite(value)) continue;
    bars.push(bar(time, value));
  }
  bars.sort((a, b) => a.time - b.time);
  if (!bars.length) throw new DataError("AGSI+ returned no fullness observations", "eu");
  return { bars, instrumentName: "EU gas storage percent full" };
}

/** Day-ahead auction, aggregated to a daily bar. A year at a time, cached. */
export async function loadEnergyDaily(): Promise<Bar[]> {
  const key = "hist:energy:de-lu:1d";
  const cached = await readStoredBars(key);
  const now = Date.now() / 1000;
  const spansTenYears = cached.length > 1 && now - cached[0].time > 8 * 365 * 86400;
  const tailFresh = cached.length > 0 && now - cached[cached.length - 1].time < 2 * 86400;
  if (spansTenYears && tailFresh) return cached;
  const end = new Date();
  const windows: { from: Date; to: Date }[] = [];
  for (let i = 0; i < 40; i++) {
    const to = new Date(end.getTime() - i * 90 * 86400000);
    const from = new Date(to.getTime() - 90 * 86400000);
    windows.push({ from, to });
  }
  const all: Bar[] = [];
  const deadline = Date.now() + 40_000;
  let misses = 0;
  for (const w of windows) {
    if (Date.now() > deadline) break;
    const url = `https://api.energy-charts.info/price?bzn=DE-LU&start=${w.from.toISOString()}&end=${w.to.toISOString()}`;
    try {
      const body = JSON.parse(await text(url)) as { unix_seconds?: number[]; price?: (number | null)[] };
      const times = body.unix_seconds ?? [];
      const prices = body.price ?? [];
      const raw: Bar[] = [];
      for (let j = 0; j < times.length; j++) {
        const value = prices[j];
        if (typeof value === "number" && Number.isFinite(value)) raw.push(bar(times[j], value));
      }
      const daily = bucket(raw, "1d");
      if (!daily.length) misses += 1;
      else misses = 0;
      all.push(...daily);
    } catch {
      misses += 1;
    }
    if (misses >= 3) break;
  }
  const daily = bucket([...cached, ...all], "1d");
  if (daily.length) await writeStoredBars(key, daily);
  if (!daily.length) throw new DataError("Energy-Charts returned no day-ahead prices", "DE-LU");
  return daily;
}

/**
 * Elexon only returns about a week per call. Walk back up to 10 years, a few
 * weeks at a time, and keep the daily bars. A short request continues where
 * the previous one stopped.
 */
export async function loadElexonDaily(): Promise<Bar[]> {
  const key = "hist:elexon:apx:1d";
  const doneKey = "hist:elexon:apx:1d:done";
  const cached = await readStoredBars(key);
  const done = await readStoredText(doneKey);
  const nowMs = Date.now();
  const now = nowMs / 1000;
  const tailFresh = cached.length > 0 && now - cached[cached.length - 1].time < 2 * 86400;
  if (tailFresh && done === "1") return cached;

  const week = 7 * 86400000;
  const oldest = nowMs - 10 * 365.25 * 86400000;
  const windows: { from: string; to: string; fromSec: number }[] = [];
  for (let end = nowMs; end > oldest; end -= week) {
    const fromSec = Math.floor((end - 6 * 86400000) / 1000);
    const covered = cached.some((b) => b.time >= fromSec && b.time < fromSec + 7 * 86400);
    const recent = nowMs - end < 21 * 86400000;
    if (covered && !recent) continue;
    windows.push({
      from: new Date(end - 6 * 86400000).toISOString().slice(0, 10),
      to: new Date(end).toISOString().slice(0, 10),
      fromSec,
    });
  }
  const deadline = nowMs + (done === "1" ? 8_000 : 28_000);
  const found: Bar[] = [];
  let finished = true;
  for (let i = 0; i < windows.length; i += 8) {
    if (Date.now() > deadline) {
      finished = false;
      break;
    }
    const slice = windows.slice(i, i + 8);
    const chunks = await Promise.all(slice.map((w) => elexonWindow(w.from, w.to)));
    for (const rows of chunks) found.push(...rows);
  }
  const daily = bucket([...cached, ...found], "1d");
  if (daily.length) await writeStoredBars(key, daily);
  if (finished) await writeStoredText(doneKey, "1");
  if (!daily.length) throw new DataError("Elexon returned no APX market-index prices", "APXMIDP");
  return daily;
}

async function elexonWindow(from: string, to: string): Promise<Bar[]> {
  const url = `https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index?from=${from}&to=${to}`;
  try {
    const body = JSON.parse(await text(url)) as { data?: { startTime?: string; dataProvider?: string; price?: number }[] };
    const raw: Bar[] = [];
    for (const row of body.data ?? []) {
      if (row.dataProvider !== "APXMIDP" || !row.startTime || typeof row.price !== "number") continue;
      const time = Date.parse(row.startTime) / 1000;
      if (Number.isFinite(time)) raw.push(bar(time, row.price));
    }
    return bucket(raw, "1d");
  } catch {
    return [];
  }
}
