import { autoSwing, newId, zigzag, type Drawing, type Point } from "@/lib/drawings";
import type { EnrichedBar } from "@/lib/types";

export function autoFibDrawing(bars: EnrichedBar[], direction: "long" | "short" | "context"): Drawing | null {
  const swing = autoSwing(bars, direction);
  if (!swing) return null;
  const hi = bars[swing.highIndex];
  const lo = bars[swing.lowIndex];
  const down = swing.highIndex < swing.lowIndex;
  const a = down ? { time: hi.time, price: hi.high } : { time: lo.time, price: lo.low };
  const b = down ? { time: lo.time, price: lo.low } : { time: hi.time, price: hi.high };
  return { id: newId(), type: "fib", a, b };
}

export function autoForkDrawing(bars: EnrichedBar[], daily: boolean): Drawing | null {
  const pct = daily ? 0.05 : 0.012;
  const piv = zigzag(bars, pct).filter((p) => p.index < bars.length - 2);
  if (piv.length < 3) return null;
  const last = piv.slice(-3);
  const toPt = (p: (typeof last)[number]): Point => ({ time: bars[p.index].time, price: p.price });
  return { id: newId(), type: "pitchfork", a: toPt(last[0]), b: toPt(last[1]), c: toPt(last[2]) };
}
