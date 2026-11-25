import { bad, json } from "@/lib/http";
import { yahooSearch } from "@/lib/yahoo";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1 || q.length > 40) return bad("q is required");
  try {
    const results = await yahooSearch(q);
    return json({ results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Search failed";
    return json({ error: message, results: [] }, 502);
  }
}
