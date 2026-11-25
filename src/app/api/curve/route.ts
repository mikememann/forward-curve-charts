import { loadCurve } from "@/lib/curve";
import { bad, json } from "@/lib/http";
import { findCurve } from "@/lib/marketModel";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("market")?.trim() ?? "";
  if (!id) return bad("market is required (brent, wti, ttf, hh, gold, wheat, corn, cocoa, sugar)");
  const def = findCurve(id);
  if (!def) return bad(`No forward curve configured for "${id}"`, 404);
  try {
    const curve = await loadCurve(def);
    return json(curve);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't load the curve";
    return json({ error: message, id }, 502);
  }
}
