import { findMarket } from "@/lib/marketModel";
import { bad, json, TICKER_RE } from "@/lib/http";
import { isTimeframe, loadOhlc, ohlcToCsv } from "@/lib/ohlc";
import { DataError } from "@/lib/errors";
import { loadFormula } from "@/lib/formula";
import { YahooError } from "@/lib/yahoo";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  const formula = req.nextUrl.searchParams.get("formula")?.trim() ?? "";
  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "1d";
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  const marketId = req.nextUrl.searchParams.get("market");
  const sourceRaw = req.nextUrl.searchParams.get("source");
  const source = sourceRaw === "ig" || sourceRaw === "free" ? sourceRaw : "auto";
  const barsRaw = req.nextUrl.searchParams.get("bars");
  if (!isTimeframe(timeframe)) return bad("timeframe must be one of 15m, 1h, 1d, 1w");
  const bars = barsRaw == null ? undefined : Number(barsRaw);
  if (barsRaw != null && !Number.isFinite(bars)) return bad("bars must be a number");
  if (formula) {
    try {
      const payload = await loadFormula(formula, timeframe, bars);
      if (format === "csv") {
        return new Response(ohlcToCsv(payload), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Cache-Control": "public, max-age=20",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      return json(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't evaluate the formula";
      return json({ error: message, formula, timeframe }, 400);
    }
  }
  const market = marketId ? findMarket(marketId) : undefined;
  const yahooTicker = !market || market.sourceKind === "yahoo";
  if (yahooTicker && (!ticker || !TICKER_RE.test(ticker))) return bad("ticker is required (Yahoo symbol, e.g. BZG27.NYM or GBPUSD=X), or pass formula");
  if (!yahooTicker && !market) return bad("unknown market");
  try {
    const payload = await loadOhlc({ ticker, timeframe, bars, market, source });
    if (format === "csv") {
      return new Response(ohlcToCsv(payload), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `inline; filename="${ticker}-${timeframe}.csv"`,
          "Cache-Control": "public, max-age=20",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    return json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't load OHLC";
    return json({ error: message, ticker, timeframe }, 502);
  }
}
