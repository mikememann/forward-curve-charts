import { igConfigured, loadMmWatchlist } from "@/lib/ig";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!igConfigured()) {
    return json({ available: false, reason: "IG credentials are not set on the server." });
  }
  try {
    const watchlist = await loadMmWatchlist();
    return json({ available: true, ...watchlist });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't load the IG watchlist";
    return json({ available: false, reason: message });
  }
}
