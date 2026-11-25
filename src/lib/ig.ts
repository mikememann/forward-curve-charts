import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { igCall } from "@/lib/igAllow";
import { mergeBars, parseIgPrices, type IgAllowance } from "@/lib/igParse";
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
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvToken) {
    const res = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { result?: string | null };
    if (!body.result) return [];
    try {
      return JSON.parse(body.result) as Bar[];
    } catch {
      return [];
    }
  }
  try {
    const raw = await readFile(fileFor(key), "utf8");
    return JSON.parse(raw) as Bar[];
  } catch {
    return [];
  }
}

async function writeBars(key: string, bars: Bar[]): Promise<void> {
  const payload = JSON.stringify(bars);
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (kvUrl && kvToken) {
    await fetch(`${kvUrl}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return;
  }
  const file = fileFor(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, payload);
}

function fileFor(key: string): string {
  const dir = process.env.IG_CACHE_DIR || path.join(os.tmpdir(), "mm-charts-ig");
  return path.join(dir, `${key.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`);
}

export async function loadIgBars(epic: string, timeframe: "15m" | "1h" | "1d", want: number): Promise<{ bars: Bar[]; allowance: IgAllowance | null }> {
  const resolution = RESOLUTION[timeframe];
  const key = storeKey(epic, resolution);
  let bars = await readBars(key);
  const period = timeframe === "15m" ? 900 : timeframe === "1h" ? 3600 : 86_400;
  const newest = bars.at(-1)?.time ?? 0;
  const fresh = newest > Math.floor(Date.now() / 1000) - period * 2;
  if (bars.length >= want && fresh) {
    return { bars: bars.slice(-want), allowance };
  }
  let guard = 0;
  let fetchedTail = false;
  while (bars.length < want && guard < 4) {
    const ask = Math.min(CHUNK, Math.max(20, want - bars.length + 5));
    const params = new URLSearchParams({ resolution, max: String(ask) });
    if (fetchedTail && bars[0]) {
      params.set("to", new Date((bars[0].time - 1) * 1000).toISOString().replace(/\.\d{3}Z$/, ""));
    }
    fetchedTail = true;
    const res = await authed(`/prices/${encodeURIComponent(epic)}?${params}`, "3");
    if (!res.ok) throw new Error(`IG prices failed (${res.status}) for ${epic}.`);
    const parsed = parseIgPrices((await res.json()) as Parameters<typeof parseIgPrices>[0]);
    if (parsed.allowance) allowance = parsed.allowance;
    const before = bars.length;
    bars = mergeBars(bars, parsed.bars);
    if (parsed.bars.length === 0 || bars.length === before || parsed.bars.length < ask) break;
    guard += 1;
  }
  await writeBars(key, bars);
  return { bars: bars.slice(-want), allowance };
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
