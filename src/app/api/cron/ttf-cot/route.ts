import { refreshTtfCot } from "@/lib/cot";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Friday evening. Stores each newly published ICE Endex TTF COT week. Older files 404. */
export async function GET() {
  const bars = await refreshTtfCot();
  return json({ ok: true, weeks: bars.length, latest: bars.at(-1)?.time ?? null });
}
