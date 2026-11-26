import { loadCurve } from "@/lib/curve";
import { loadIceCurve } from "@/lib/ice";
import { bad, json } from "@/lib/http";
import { findCurve, findMarket } from "@/lib/marketModel";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("market")?.trim() ?? "";
  if (!id) return bad("market is required (brent, wti, ttf, hh, gold, wheat, corn, cocoa, sugar)");
  const def = findCurve(id);
  if (!def) return bad(`No forward curve configured for "${id}"`, 404);
  try {
    if (def.ice) {
      const market = def.marketId ? findMarket(def.marketId) : null;
      if (!market?.ice) return bad(`No ICE product configured for "${id}"`, 404);
      const curve = await loadIceCurve({
        id: def.id,
        name: def.name,
        units: def.units,
        decimals: def.decimals,
        note: def.note,
        product: market.ice,
      });
      return json(curve);
    }
    const curve = await loadCurve(def);
    return json(curve);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't load the curve";
    return json({ error: message, id }, 502);
  }
}
