import type { CurvePoint, CurveSpread } from "@/lib/types";

export function pointIsEmpty(p: Pick<CurvePoint, "price" | "week" | "monthAgo">): boolean {
  return p.price == null && p.week == null && p.monthAgo == null;
}

/** Drop empty months at either end. Internal gaps stay, so the line can break. */
export function trimCurve<T extends Pick<CurvePoint, "price" | "week" | "monthAgo">>(points: T[]): T[] {
  let i = 0;
  let j = points.length;
  while (i < j && pointIsEmpty(points[i])) i++;
  while (j > i && pointIsEmpty(points[j - 1])) j--;
  return points.slice(i, j);
}

/**
 * M1 is the first plotted contract, Mk is the k-th plotted contract
 * (listed months only — wheat's M2 is the next listed month, not the next calendar month).
 * A missing price makes the spread n/a. Gaps are not skipped, so M6 is never a later month in disguise.
 */
export function curveSpreads(points: Pick<CurvePoint, "contract" | "price">[]): CurveSpread[] {
  const out: CurveSpread[] = [];
  for (const k of [2, 6, 12]) {
    const a = points[0];
    const b = points[k - 1];
    if (!a || !b) {
      out.push({
        label: `M1–M${k}`,
        from: a?.contract ?? null,
        to: b?.contract ?? null,
        value: null,
        structure: null,
        reason: `No M${k} contract in this curve`,
      });
      continue;
    }
    if (a.price == null || b.price == null) {
      out.push({
        label: `M1–M${k}`,
        from: a.contract,
        to: b.contract,
        value: null,
        structure: null,
        reason: "No public quote on one side",
      });
      continue;
    }
    const value = Math.round((a.price - b.price) * 10_000) / 10_000;
    out.push({
      label: `M1–M${k}`,
      from: a.contract,
      to: b.contract,
      value,
      structure: Math.abs(value) < 1e-9 ? "flat" : value > 0 ? "backwardation" : "contango",
      reason: null,
    });
  }
  return out;
}

/** Last bar at or before `targetSec`, or null if it is older than `maxGapSec`. */
export function closeOnOrBefore(
  bars: { time: number; close: number }[],
  targetSec: number,
  maxGapSec: number,
): { close: number; time: number } | null {
  let best: { time: number; close: number } | null = null;
  for (const b of bars) {
    if (b.time <= targetSec && Number.isFinite(b.close)) best = b;
    else if (b.time > targetSec) break;
  }
  if (!best) return null;
  if (targetSec - best.time > maxGapSec) return null;
  return { close: best.close, time: best.time };
}
