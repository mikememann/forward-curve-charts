import "server-only";
import { readStoredJson, writeStoredJson } from "@/lib/barStore";
import { DataError } from "@/lib/errors";
import { averageStates, parseEuroPrice, type WeekPoint } from "@/lib/splice";

/**
 * EU agri-food oilseed prices. The route intermittently returns 500, so each
 * chunk is retried. Old weeks are cached; a later call only refreshes the tail.
 * https://api.tech.ec.europa.eu/agrifood/api/oilseeds/prices
 */

const API = "https://api.tech.ec.europa.eu/agrifood/api/oilseeds/prices";
const DAY = 86_400_000;

interface RawRow {
  memberStateCode?: string;
  beginDate?: string;
  price?: string;
  product?: string;
  market?: string;
}

interface CachedWeek {
  time: number;
  close: number;
  states: string[];
}

export async function loadEuWeekly(product: string, states: string[]): Promise<WeekPoint[]> {
  const key = `eu:oil:v1:${product}:${[...states].sort().join(",")}`;
  const cached = readWeeks(await readStoredJson(key));
  const now = Date.now();
  const newest = cached.at(-1)?.time ?? 0;
  const fresh = cached.length > 0 && now / 1000 - newest < 21 * 86400 && newest > 0;
  if (fresh) return cached;
  const from = cached.length ? new Date((newest - 21 * 86400) * 1000) : new Date(Date.UTC(2021, 0, 1));
  const fetched = await fetchProduct(product, states, from, new Date());
  const byTime = new Map<number, WeekPoint>();
  for (const week of cached) byTime.set(week.time, week);
  const freshWeeks = averageStates(fetched);
  for (const week of freshWeeks) byTime.set(week.time, week);
  const weeks = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (weeks.length) await writeStoredJson(key, { savedAt: Math.floor(now / 1000), weeks });
  if (!weeks.length) throw new DataError(`EU Commission returned no ${product} prices`, product);
  return weeks;
}

async function fetchProduct(product: string, states: string[], from: Date, to: Date): Promise<{ state: string; time: number; price: number }[]> {
  const wanted = new Set(states);
  const out: { state: string; time: number; price: number }[] = [];
  for (const chunk of chunks(from, to, 120)) {
    const rows = await loadRawChunk(chunk.begin, chunk.end);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const grouped = new Map<string, RawRow[]>();
    for (const row of rows) {
      if (row.product !== product || !row.memberStateCode || !wanted.has(row.memberStateCode) || !row.beginDate) continue;
      const time = parseDmY(row.beginDate);
      if (time == null) continue;
      const id = `${row.memberStateCode}|${time}`;
      const list = grouped.get(id) ?? [];
      list.push(row);
      grouped.set(id, list);
    }
    for (const [id, list] of grouped) {
      const price = statePrice(list);
      if (price == null) continue;
      const [state, time] = id.split("|");
      out.push({ state, time: Number(time), price });
    }
  }
  return out;
}

function statePrice(rows: RawRow[]): number | null {
  const national = rows.filter((row) => /national average/i.test(row.market ?? "") || /^(average|national)$/i.test(row.market ?? ""));
  const use = national.length ? national : rows;
  const prices = use.map((row) => parseEuroPrice(row.price ?? "")).filter((n): n is number => n != null);
  if (!prices.length) return null;
  return prices.reduce((sum, n) => sum + n, 0) / prices.length;
}

async function loadRawChunk(begin: Date, end: Date): Promise<RawRow[]> {
  const key = `eu:oil:raw:v1:${stamp(begin)}:${stamp(end)}`;
  const cached = await readStoredJson(key);
  if (Array.isArray(cached)) return cached as RawRow[];
  const rows = await getChunk(begin, end);
  await writeStoredJson(key, rows);
  return rows;
}

async function getChunk(begin: Date, end: Date): Promise<RawRow[]> {
  const url = `${API}?beginDate=${stamp(begin)}&endDate=${stamp(end)}`;
  let last = "EU oilseeds request failed";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; MMCharts/1.0)" },
        cache: "no-store",
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("EU oilseeds returned no list");
      return body as RawRow[];
    } catch (e) {
      last = e instanceof Error ? e.message : last;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw new DataError(`EU oilseeds did not answer (${last}) for ${stamp(begin)} to ${stamp(end)}`, url);
}

function chunks(from: Date, to: Date, days: number): { begin: Date; end: Date }[] {
  const out: { begin: Date; end: Date }[] = [];
  let cursor = from.getTime();
  const stop = to.getTime();
  while (cursor <= stop) {
    const end = Math.min(stop, cursor + days * DAY);
    out.push({ begin: new Date(cursor), end: new Date(end) });
    cursor = end + DAY;
  }
  return out;
}

function stamp(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

function parseDmY(value: string): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const time = Date.parse(`${match[3]}-${match[2]}-${match[1]}T12:00:00Z`);
  return Number.isFinite(time) ? time / 1000 : null;
}

function readWeeks(input: unknown): WeekPoint[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const weeks = (input as { weeks?: unknown }).weeks;
  if (!Array.isArray(weeks)) return [];
  const out: WeekPoint[] = [];
  for (const row of weeks) {
    if (!row || typeof row !== "object") continue;
    const item = row as Partial<CachedWeek>;
    if (typeof item.time !== "number" || typeof item.close !== "number" || !Array.isArray(item.states)) continue;
    out.push({ time: item.time, close: item.close, states: item.states.filter((s): s is string => typeof s === "string") });
  }
  return out.sort((a, b) => a.time - b.time);
}
