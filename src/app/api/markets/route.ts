import { unavailableSeries } from "@/config/lseg";
import { json } from "@/lib/http";
import { allCurves, presentMarkets } from "@/lib/marketModel";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  return json({
    asOf: now.toISOString(),
    markets: presentMarkets(now).map((m) => ({
      id: m.id,
      name: m.name,
      group: m.group,
      units: m.units,
      ticker: m.ticker,
      contract: m.contractLabel,
      contractTicker: m.contractTicker,
      continuous: m.continuous,
      proxyNote: m.proxyNote,
      infoNote: m.infoNote,
      exactness: m.exactness,
      licence: m.licence,
      attribution: m.attribution,
      source: m.sourceKind,
      pence: m.pence,
      fxDayChange: m.fxClose22 ? "22:00 Europe/London" : "previous close",
      curve: m.curveId,
      alsoIn: m.alsoIn,
    })),
    unavailable: unavailableSeries,
    curves: allCurves().map((c) => ({ id: c.id, name: c.name, units: c.units })),
    spreads: "GET /api/ohlc?formula=brent%20-%20wti&timeframe=1d  (spaces around + - * /)",
  });
}
