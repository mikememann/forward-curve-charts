import { bad, json, TICKER_RE } from "@/lib/http";
import { loadQuotes } from "@/lib/quotes";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const extraRaw = req.nextUrl.searchParams.get("extra") ?? "";
  const extra = extraRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.some((t) => !TICKER_RE.test(t))) return bad("extra tickers must be Yahoo symbols");
  const quotes = await loadQuotes(extra.slice(0, 12));
  return json({ source: "Yahoo Finance", fetchedAt: new Date().toISOString(), quotes });
}
