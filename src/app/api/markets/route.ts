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
      pence: m.pence,
      fxDayChange: m.fxClose22 ? "22:00 Europe/London" : "previous close",
      curve: m.curveId,
    })),
    curves: allCurves().map((c) => ({ id: c.id, name: c.name, units: c.units })),
  });
}
