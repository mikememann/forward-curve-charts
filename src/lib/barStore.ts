import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { barsFromCache, decodeKv } from "@/lib/igParse";
import type { Bar } from "@/lib/types";

/**
 * Upstash / Vercel KV, or a file when those env vars are absent.
 * Values are stored with the Redis SET command so a JSON array body is not
 * treated as a pipeline and is not quoted twice.
 */

function kv(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

export async function readStoredJson(key: string): Promise<unknown | null> {
  const store = kv();
  if (store) {
    const res = await fetch(`${store.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${store.token}` },
    });
    if (!res.ok) return null;
    return decodeKv(await res.json());
  }
  try {
    return decodeKv(await readFile(fileFor(key), "utf8"));
  } catch {
    return null;
  }
}

export async function writeStoredJson(key: string, value: unknown): Promise<void> {
  const payload = JSON.stringify(value);
  const store = kv();
  if (store) {
    await fetch(store.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${store.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", key, payload]),
    });
    return;
  }
  const file = fileFor(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, payload);
}

export async function readStoredBars(key: string): Promise<Bar[]> {
  return barsFromCache(await readStoredJson(key)) ?? [];
}

export async function writeStoredBars(key: string, bars: Bar[]): Promise<void> {
  await writeStoredJson(key, bars);
}

export async function readStoredText(key: string): Promise<string | null> {
  const value = await readStoredJson(key);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export async function writeStoredText(key: string, value: string): Promise<void> {
  await writeStoredJson(key, value);
}

function fileFor(key: string): string {
  const dir = process.env.IG_CACHE_DIR || path.join(os.tmpdir(), "mm-charts-ig");
  return path.join(dir, `${key.replace(/[^a-zA-Z0-9._-]+/g, "_")}.json`);
}
