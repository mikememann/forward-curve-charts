import { findMarket } from "@/lib/marketModel";
import { bad, json, TICKER_RE } from "@/lib/http";
import { isTimeframe, loadOhlc, ohlcToCsv } from "@/lib/ohlc";
import { YahooError } from "@/lib/yahoo";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  const timeframe = req.nextUrl.searchParams.get("timeframe") ?? "1d";
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  const marketId = req.nextUrl.searchParams.get("market");
  const barsRaw = req.nextUrl.searchParams.get("bars");
  if (!ticker || !TICKER_RE.test(ticker)) return bad("ticker is required (Yahoo symbol, e.g. BZG27.NYM or GBPUSD=X)");
  if (!isTimeframe(timeframe)) return bad("timeframe must be one of 15m, 1h, 1d, 1w");
  const bars = barsRaw == null ? undefined : Number(barsRaw);
  if (barsRaw != null && !Number.isFinite(bars)) return bad("bars must be a number");
  const market = marketId ? findMarket(marketId) : undefined;
  try {
    const payload = await loadOhlc({ ticker, timeframe, bars, market });
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
    const message = e instanceof YahooError ? e.message : "Couldn't load OHLC";
    return json({ error: message, ticker, timeframe }, 502);
  }
}
