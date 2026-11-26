import "server-only";
import { readStoredBars, writeStoredBars } from "@/lib/barStore";
import { igCall } from "@/lib/igAllow";
import { extraPageNumbers, mergeBars, pageQuery, parseIgPrices, priceQuery, type IgAllowance, type IgPageData, type IgPricesBody } from "@/lib/igParse";
import type { Bar, Timeframe } from "@/lib/types";

/**
 * Read-only IG REST session.
 * Credentials stay in IG_API_KEY, IG_USERNAME and IG_PASSWORD.
 * IG_ACC_TYPE=DEMO uses the demo host. Anything else is the live host.
 * The account is a spread-betting account. This module never places a trade.
 */

const LIVE = "https://api.ig.com/gateway/deal";
const DEMO = "https://demo-api.ig.com/gateway/deal";
export const MM_WATCHLIST_ID = "6bbb7b9a-3290-4e30-8907-a710fffc2034";

const RESOLUTION: Record<"15m" | "1h" | "1d", string> = {
  "15m": "MINUTE_15",
  "1h": "HOUR",
  "1d": "DAY",
};

const CHUNK = 100;

// Session and the weekly allowance live in this process only. They are not read from KV.
// A KV payload for either one would go through sessionFromCache / allowanceFromCache,
// which accept a JSON string or an already-parsed object and reject anything else.
let session: { cst: string; token: string } | null = null;
let allowance: IgAllowance | null = null;

export function igConfigured(): boolean {
  return Boolean(process.env.IG_API_KEY && process.env.IG_USERNAME && process.env.IG_PASSWORD);
}

export function currentAllowance(): IgAllowance | null {
  return allowance;
}

function host(): string {
  return process.env.IG_ACC_TYPE === "DEMO" ? DEMO : LIVE;
}

function igFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = typeof input === "string" ? input : input instanceof URL ? `${input.pathname}${input.search}` : input.url;
  return fetch(`${host()}${path}`, init);
}

async function login(): Promise<void> {
  const res = await igCall("POST", "/session", igFetch, {
    headers: {
      "X-IG-API-KEY": process.env.IG_API_KEY ?? "",
      VERSION: "2",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      identifier: process.env.IG_USERNAME ?? "",
      password: process.env.IG_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error(`IG login failed (${res.status}). Check the server credentials.`);
  const cst = res.headers.get("CST");
  const token = res.headers.get("X-SECURITY-TOKEN");
  if (!cst || !token) throw new Error("IG login did not return CST and X-SECURITY-TOKEN.");
  session = { cst, token };
}

async function authed(path: string, version: string, retry = true): Promise<Response> {
  if (!session) await login();
  const current = session;
  if (!current) throw new Error("IG session was not created.");
  const res = await igCall("GET", path, igFetch, {
    headers: {
      "X-IG-API-KEY": process.env.IG_API_KEY ?? "",
      CST: current.cst,
      "X-SECURITY-TOKEN": current.token,
      VERSION: version,
      Accept: "application/json",
    },
  });
  if (res.status === 401 && retry) {
    session = null;
    await login();
    return authed(path, version, false);
  }
  return res;
}

function storeKey(epic: string, resolution: string): string {
  return `ig:${epic}:${resolution}`;
}

async function readBars(key: string): Promise<Bar[]> {
  return readStoredBars(key);
}

async function writeBars(key: string, bars: Bar[]): Promise<void> {
  await writeStoredBars(key, bars);
}

export async function loadIgBars(epic: string, timeframe: "15m" | "1h" | "1d", want: number): Promise<{ bars: Bar[]; allowance: IgAllowance | null }> {
  const resolution = RESOLUTION[timeframe];
  const key = storeKey(epic, resolution);
  let bars = await readBars(key);
  if (!Array.isArray(bars)) bars = [];
  const period = timeframe === "15m" ? 900 : timeframe === "1h" ? 3600 : 86_400;
  const newest = bars.at(-1)?.time ?? 0;
  const fresh = newest > Math.floor(Date.now() / 1000) - period * 2;
  if (bars.length >= want && fresh) {
    return { bars: bars.slice(-want), allowance };
  }
  let guard = 0;
  while (bars.length < want && guard < 4) {
    const ask = Math.min(CHUNK, Math.max(want, 20));
    const got = await fetchPriceWindow(epic, resolution, ask);
    if (got.allowance) allowance = got.allowance;
    const before = bars.length;
    bars = mergeBars(bars, got.bars);
    if (got.bars.length === 0 || bars.length === before) break;
    guard += 1;
    if (got.bars.length >= ask) break;
  }
  await writeBars(key, bars);
  return { bars: bars.slice(-want), allowance };
}

async function fetchPriceWindow(epic: string, resolution: string, max: number): Promise<{ bars: Bar[]; allowance: IgAllowance | null }> {
  const first = await readPricePage(epic, priceQuery(resolution, max));
  let bars = first.bars;
  let pageAllowance = first.allowance;
  const pageSize = first.page?.pageSize && first.page.pageSize > 0 ? first.page.pageSize : 20;
  for (const pageNumber of extraPageNumbers(first.page)) {
    const next = await readPricePage(epic, pageQuery(resolution, max, pageNumber, pageSize));
    if (next.allowance) pageAllowance = next.allowance;
    bars = mergeBars(bars, next.bars);
  }
  return { bars, allowance: pageAllowance };
}

async function readPricePage(epic: string, params: URLSearchParams): Promise<{ bars: Bar[]; allowance: IgAllowance | null; page: IgPageData | undefined }> {
  const res = await authed(`/prices/${encodeURIComponent(epic)}?${params}`, "3");
  if (!res.ok) throw new Error(`IG prices failed (${res.status}) for ${epic}.`);
  const body = (await res.json()) as IgPricesBody;
  const parsed = parseIgPrices(body);
  return { bars: parsed.bars, allowance: parsed.allowance, page: body.metadata?.pageData };
}

export interface IgWatchlistMarket {
  epic: string;
  name: string;
  expiry: string | null;
  bid: number | null;
  offer: number | null;
}

export async function loadMmWatchlist(): Promise<{ id: string; name: string; markets: IgWatchlistMarket[] }> {
  const listed = await authed("/watchlists", "1");
  if (!listed.ok) throw new Error(`IG watchlists failed (${listed.status}).`);
  const body = (await listed.json()) as { watchlists?: { id?: string; name?: string }[] };
  const match = (body.watchlists ?? []).find((row) => row.name === "MM");
  const id = match?.id || MM_WATCHLIST_ID;
  const detail = await authed(`/watchlists/${id}`, "1");
  if (!detail.ok) throw new Error(`IG watchlist ${id} failed (${detail.status}).`);
  const raw = (await detail.json()) as {
    markets?: { epic?: string; instrumentName?: string; expiry?: string; bid?: number; offer?: number }[];
  };
  return {
    id,
    name: match?.name || "MM",
    markets: (raw.markets ?? [])
      .filter((row) => row.epic)
      .map((row) => ({
        epic: row.epic as string,
        name: row.instrumentName || row.epic || "",
        expiry: row.expiry ?? null,
        bid: typeof row.bid === "number" ? row.bid : null,
        offer: typeof row.offer === "number" ? row.offer : null,
      })),
  };
}

export function resolutionFor(timeframe: Timeframe): string | null {
  if (timeframe === "15m" || timeframe === "1h" || timeframe === "1d") return RESOLUTION[timeframe];
  return null;
}
