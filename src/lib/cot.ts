import "server-only";
import { readStoredBars, readStoredJson, writeStoredBars, writeStoredJson } from "@/lib/barStore";
import { DataError } from "@/lib/errors";
import { parseIceCot, parseTtfCot } from "@/lib/cotParse";
import type { Bar } from "@/lib/types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SUGAR = "ICE White Sugar Futures - ICE Futures Europe";
const COCOA = "ICE Cocoa Futures - ICE Futures Europe";

export async function loadIceSugarCot(): Promise<Bar[]> {
  return loadIceMarketCot("cot:ice:sugar:v1", SUGAR);
}

export async function loadIceCocoaCot(): Promise<Bar[]> {
  return loadIceMarketCot("cot:ice:cocoa:v1", COCOA);
}

async function loadIceMarketCot(key: string, market: string): Promise<Bar[]> {
  const cached = await readStoredBars(key);
  const years = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const have = new Set(cached.map((bar) => new Date(bar.time * 1000).getUTCFullYear()));
  const missing = years.filter((year) => year === 2026 || !have.has(year));
  const bars = [...cached];
  const deadline = Date.now() + 25_000;
  for (const year of missing) {
    if (Date.now() > deadline && bars.length) break;
    const url = year >= 2026
      ? "https://www.ice.com/publicdocs/cot_report/automated/COTHist2026.csv"
      : `https://www.ice.com/publicdocs/futures/COTHist${year}.csv`;
    try {
      const csv = await iceText(url);
      bars.push(...parseIceCot(csv, market));
    } catch (e) {
      if (!bars.length && year === 2026) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const merged = dedupe(bars);
  if (merged.length) await writeStoredBars(key, merged);
  if (!merged.length) throw new DataError(`ICE COT had no rows for ${market}`, market);
  return merged;
}

/** Fetch the free four-week window and merge it into the stored history. */
export async function refreshTtfCot(): Promise<Bar[]> {
  const key = "cot:ttf:tfm:v1";
  const cached = await readStoredBars(key);
  const fridays = recentFridays(new Date(), 8);
  const seen = new Set(cached.map((bar) => new Date(bar.time * 1000).toISOString().slice(0, 10)));
  const added: Bar[] = [];
  for (const day of fridays) {
    const stamp = day.toISOString().slice(0, 10).replace(/-/g, "");
    if ([...seen].some((d) => d.replace(/-/g, "") === stamp)) continue;
    const url = `https://www.ice.com/marketdata/publicdocs/mifid/commitment_of_traders/NDEX_FUT_${stamp}.csv`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, cache: "no-store" });
    if (res.status === 404) continue;
    if (!res.ok) continue;
    added.push(...parseTtfCot(await res.text()));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const merged = dedupe([...cached, ...added]);
  if (merged.length) await writeStoredBars(key, merged);
  await writeStoredJson(`${key}:meta`, { savedAt: Math.floor(Date.now() / 1000), weeks: merged.length });
  return merged;
}

export async function loadTtfCot(): Promise<Bar[]> {
  const bars = await refreshTtfCot();
  if (!bars.length) throw new DataError("ICE Endex has not published a readable TTF COT file in the free window", "TFM");
  return bars;
}

export async function ttfCotStatus(): Promise<{ weeks: number }> {
  const meta = await readStoredJson("cot:ttf:tfm:v1:meta");
  const weeks = meta && typeof meta === "object" && "weeks" in meta && typeof (meta as { weeks: unknown }).weeks === "number"
    ? (meta as { weeks: number }).weeks
    : 0;
  return { weeks };
}

async function iceText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/csv,*/*" }, cache: "no-store" });
  if (!res.ok) throw new DataError(`ICE COT HTTP ${res.status}`, url);
  return res.text();
}

function recentFridays(now: Date, count: number): Date[] {
  const out: Date[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (out.length < count) {
    if (cursor.getUTCDay() === 5) out.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out.reverse();
}

function dedupe(bars: Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const bar of bars) map.set(bar.time, bar);
  return [...map.values()].sort((a, b) => a.time - b.time);
}
