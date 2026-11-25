import {
  fibLevels,
  indexForTime,
  pitchforkLines,
  timeForIndex,
  type Drawing,
  type Point,
  type TradeDrawing,
} from "@/lib/drawings";

export interface XY {
  x: number;
  y: number;
}

export interface AvwapPath {
  id: string;
  slot: 1 | 2;
  pts: { time: number; value: number }[];
}

export interface CloudSeg {
  time: number;
  a: number | null;
  b: number | null;
}

export interface DrawScene {
  width: number;
  height: number;
  times: number[];
  xOfTime: (time: number) => number | null;
  yOfPrice: (price: number) => number | null;
  drawings: Drawing[];
  selectedId: string | null;
  draft: Point[];
  cursor: Point | null;
  tool: string;
  avwap: AvwapPath[];
  bb: { time: number; upper: number; lower: number }[] | null;
  cloud: CloudSeg[] | null;
  divergences: { kind: "bull" | "bear"; time1: number; time2: number; price1: number; price2: number; label: string }[];
  decimals: number;
}

const FIB = "#80deea";
const FORK = "#f48fb1";
const TREND = "#eceff1";
const HLINE = "#b0bec5";
const VWAP = "#ff7043";
const ENTRY = "#ffd54f";
const STOP = "#ff1744";
const TGT = "#00e676";
const UP = "#26a69a";
const DN = "#ef5350";

export function renderScene(ctx: CanvasRenderingContext2D, scene: DrawScene): void {
  const { width, height } = scene;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  if (scene.bb && scene.bb.length > 1) fillBand(ctx, scene, scene.bb.map((p) => ({ time: p.time, a: p.upper, b: p.lower })), "rgba(144,164,174,0.10)");
  if (scene.cloud) fillCloud(ctx, scene, scene.cloud);

  for (const d of scene.divergences) {
    const a = pt(scene, d.time1, d.price1);
    const b = pt(scene, d.time2, d.price2);
    if (!a || !b) continue;
    stroke(ctx, [a, b], d.kind === "bear" ? DN : UP, 2);
    tag(ctx, b.x, b.y - 12, d.label, d.kind === "bear" ? DN : UP, "#fff");
  }

  for (const path of scene.avwap) {
    const xy = path.pts.map((p) => pt(scene, p.time, p.value)).filter((p): p is XY => p != null);
    stroke(ctx, xy, VWAP, 2, [4, 3]);
  }

  for (const d of scene.drawings) drawOne(ctx, scene, d, d.id === scene.selectedId);

  if (scene.cursor && scene.draft.length && (scene.tool === "trend" || scene.tool === "fib" || scene.tool === "pitchfork")) {
    const ghost = previewDrawing(scene);
    if (ghost) drawOne(ctx, scene, ghost, false);
  }
  ctx.restore();
}

function previewDrawing(scene: DrawScene): Drawing | null {
  const c = scene.cursor;
  if (!c) return null;
  const pts = scene.draft;
  if (scene.tool === "trend" && pts.length === 1) return { id: "draft", type: "trend", a: pts[0], b: c };
  if (scene.tool === "fib" && pts.length === 1) return { id: "draft", type: "fib", a: pts[0], b: c };
  if (scene.tool === "pitchfork" && pts.length === 1) return { id: "draft", type: "trend", a: pts[0], b: c };
  if (scene.tool === "pitchfork" && pts.length === 2) return { id: "draft", type: "pitchfork", a: pts[0], b: pts[1], c };
  return null;
}

function drawOne(ctx: CanvasRenderingContext2D, scene: DrawScene, d: Drawing, selected: boolean): void {
  const lw = selected ? 2.4 : 1.4;
  if (d.type === "hline") {
    const y = scene.yOfPrice(d.price);
    if (y == null) return;
    stroke(ctx, [{ x: 0, y }, { x: scene.width, y }], HLINE, lw, [5, 4]);
    tag(ctx, 8, y - 14, fmt(d.price, scene.decimals), HLINE, "#111");
    return;
  }
  if (d.type === "trend") {
    const line = ray(scene, d.a, d.b);
    if (line.length) stroke(ctx, line, TREND, lw);
    return;
  }
  if (d.type === "fib") {
    const levels = fibLevels(d.a.price, d.b.price);
    const x1 = scene.xOfTime(Math.min(d.a.time, d.b.time));
    const x2 = scene.width;
    const xa = scene.xOfTime(d.a.time);
    const xb = scene.xOfTime(d.b.time);
    const ya = scene.yOfPrice(d.a.price);
    const yb = scene.yOfPrice(d.b.price);
    if (xa != null && xb != null && ya != null && yb != null) stroke(ctx, [{ x: xa, y: ya }, { x: xb, y: yb }], FIB, 1, [2, 3]);
    for (const level of levels) {
      const y = scene.yOfPrice(level.price);
      if (y == null || x1 == null) continue;
      stroke(ctx, [{ x: x1, y }, { x: x2, y }], FIB, level.ratio === 0 || level.ratio === 1 ? 1.3 : 1, [2, 3]);
      tag(ctx, Math.min(scene.width - 92, (x2 + (x1 ?? 0)) / 2), y - 14, `${(level.ratio * 100).toFixed(1)}%  ${fmt(level.price, scene.decimals)}`, FIB, "#062126");
    }
    return;
  }
  if (d.type === "pitchfork") {
    const fork = forkOf(scene, d.a, d.b, d.c);
    if (!fork) return;
    stroke(ctx, fork.median, FORK, lw);
    stroke(ctx, fork.upper, FORK, 1.2, [6, 3]);
    stroke(ctx, fork.lower, FORK, 1.2, [6, 3]);
    const pb = pt(scene, d.b.time, d.b.price);
    const pc = pt(scene, d.c.time, d.c.price);
    if (pb && pc) stroke(ctx, [pb, pc], FORK, 1, [2, 2]);
    for (const [label, p] of [["P1", d.a], ["P2", d.b], ["P3", d.c]] as const) {
      const xy = pt(scene, p.time, p.price);
      if (!xy) continue;
      ctx.fillStyle = FORK;
      ctx.beginPath();
      ctx.arc(xy.x, xy.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      tag(ctx, xy.x + 6, xy.y - 16, label, FORK, "#2a1020");
    }
    return;
  }
  if (d.type === "trade") drawTrade(ctx, scene, d, lw);
}

function drawTrade(ctx: CanvasRenderingContext2D, scene: DrawScene, d: TradeDrawing, lw: number): void {
  if (d.entryLow != null && d.entryHigh != null) {
    const y1 = scene.yOfPrice(Math.min(d.entryLow, d.entryHigh));
    const y2 = scene.yOfPrice(Math.max(d.entryLow, d.entryHigh));
    if (y1 != null && y2 != null) {
      ctx.fillStyle = "rgba(255,213,79,0.16)";
      ctx.fillRect(0, Math.min(y1, y2), scene.width, Math.abs(y2 - y1) || 1);
      hline(ctx, scene, d.entryLow, ENTRY, lw);
      hline(ctx, scene, d.entryHigh, ENTRY, lw);
      const mid = (d.entryLow + d.entryHigh) / 2;
      const y = scene.yOfPrice(mid);
      if (y != null) tag(ctx, 8, y - 14, `ENTRY ${fmt(d.entryLow, scene.decimals)}–${fmt(d.entryHigh, scene.decimals)}`, ENTRY, "#2a2208");
    }
  }
  if (d.stop != null) {
    hline(ctx, scene, d.stop, STOP, lw + 0.4);
    const y = scene.yOfPrice(d.stop);
    if (y != null) tag(ctx, scene.width - 120, y - 14, `STOP ${fmt(d.stop, scene.decimals)}`, STOP, "#fff");
  }
  if (d.t1 != null) {
    hline(ctx, scene, d.t1, TGT, lw);
    const y = scene.yOfPrice(d.t1);
    if (y != null) tag(ctx, scene.width - 110, y - 14, `T1 ${fmt(d.t1, scene.decimals)}`, TGT, "#062216");
  }
  if (d.t2 != null) {
    hline(ctx, scene, d.t2, TGT, lw, [6, 3]);
    const y = scene.yOfPrice(d.t2);
    if (y != null) tag(ctx, scene.width - 110, y - 14, `T2 ${fmt(d.t2, scene.decimals)}`, TGT, "#062216");
  }
}

function hline(ctx: CanvasRenderingContext2D, scene: DrawScene, price: number, color: string, lw: number, dash?: number[]): void {
  const y = scene.yOfPrice(price);
  if (y == null) return;
  stroke(ctx, [{ x: 0, y }, { x: scene.width, y }], color, lw, dash);
}

function forkOf(scene: DrawScene, a: Point, b: Point, c: Point) {
  const times = scene.times;
  if (times.length < 2) return null;
  const ai = indexForTime(times, a.time);
  const bi = indexForTime(times, b.time);
  const ci = indexForTime(times, c.time);
  const extend = times.length - 1 + 12;
  const lines = pitchforkLines({ i: ai, price: a.price }, { i: bi, price: b.price }, { i: ci, price: c.price }, extend);
  if (!lines) return null;
  const map = (pts: { i: number; price: number }[]) =>
    pts
      .map((p) => pt(scene, timeForIndex(times, p.i), p.price))
      .filter((p): p is XY => p != null);
  return { median: map(lines.median), upper: map(lines.upper), lower: map(lines.lower) };
}

function ray(scene: DrawScene, a: Point, b: Point): XY[] {
  const times = scene.times;
  if (times.length < 2) {
    const pa = pt(scene, a.time, a.price);
    const pb = pt(scene, b.time, b.price);
    return pa && pb ? [pa, pb] : [];
  }
  const ai = indexForTime(times, a.time);
  const bi = indexForTime(times, b.time);
  if (Math.abs(bi - ai) < 1e-6) {
    const pa = pt(scene, a.time, a.price);
    const pb = pt(scene, b.time, b.price);
    return pa && pb ? [pa, pb] : [];
  }
  const slope = (b.price - a.price) / (bi - ai);
  const end = Math.max(times.length - 1 + 8, ai, bi);
  const start = Math.min(ai, bi);
  const p1 = pt(scene, timeForIndex(times, start), a.price + slope * (start - ai));
  const p2 = pt(scene, timeForIndex(times, end), a.price + slope * (end - ai));
  return p1 && p2 ? [p1, p2] : [];
}

function fillBand(
  ctx: CanvasRenderingContext2D,
  scene: DrawScene,
  rows: { time: number; a: number | null; b: number | null }[],
  color: string,
): void {
  ctx.beginPath();
  let started = false;
  for (const row of rows) {
    if (row.a == null) continue;
    const x = scene.xOfTime(row.time);
    const y = scene.yOfPrice(row.a);
    if (x == null || y == null) continue;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else ctx.lineTo(x, y);
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.b == null) continue;
    const x = scene.xOfTime(row.time);
    const y = scene.yOfPrice(row.b);
    if (x == null || y == null) continue;
    ctx.lineTo(x, y);
  }
  if (!started) return;
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function fillCloud(ctx: CanvasRenderingContext2D, scene: DrawScene, cloud: CloudSeg[]): void {
  for (let i = 0; i < cloud.length - 1; i++) {
    const p = cloud[i];
    const n = cloud[i + 1];
    if (p.a == null || p.b == null || n.a == null || n.b == null) continue;
    const x1 = scene.xOfTime(p.time);
    const x2 = scene.xOfTime(n.time);
    const ya1 = scene.yOfPrice(p.a);
    const yb1 = scene.yOfPrice(p.b);
    const ya2 = scene.yOfPrice(n.a);
    const yb2 = scene.yOfPrice(n.b);
    if (x1 == null || x2 == null || ya1 == null || yb1 == null || ya2 == null || yb2 == null) continue;
    ctx.fillStyle = p.a >= p.b ? "rgba(38,166,154,0.14)" : "rgba(239,83,80,0.14)";
    ctx.beginPath();
    ctx.moveTo(x1, ya1);
    ctx.lineTo(x2, ya2);
    ctx.lineTo(x2, yb2);
    ctx.lineTo(x1, yb1);
    ctx.closePath();
    ctx.fill();
  }
}

function pt(scene: DrawScene, time: number, price: number): XY | null {
  const x = scene.xOfTime(time);
  const y = scene.yOfPrice(price);
  if (x == null || y == null) return null;
  return { x, y };
}

function stroke(ctx: CanvasRenderingContext2D, pts: XY[], color: string, width: number, dash?: number[]): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash ?? []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string, maxWidth = 4000): void {
  ctx.save();
  ctx.font = "11px ui-monospace, monospace";
  const w = ctx.measureText(text).width + 8;
  const left = Math.max(2, Math.min(x, maxWidth - w - 2));
  const top = Math.max(2, y);
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.92;
  ctx.fillRect(left, top, w, 15);
  ctx.globalAlpha = 1;
  ctx.fillStyle = fg;
  ctx.fillText(text, left + 4, top + 11);
  ctx.restore();
}

function fmt(n: number, decimals: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: Math.min(decimals, 2), maximumFractionDigits: decimals });
}

export function hitTest(scene: DrawScene, x: number, y: number): string | null {
  const best = { id: null as string | null, d: Infinity };
  const consider = (id: string, dist: number) => {
    if (dist <= 8 && dist < best.d) {
      best.id = id;
      best.d = dist;
    }
  };
  for (const d of scene.drawings) {
    if (d.type === "hline") {
      const yy = scene.yOfPrice(d.price);
      if (yy != null) consider(d.id, Math.abs(y - yy));
    } else if (d.type === "trend") {
      const line = ray(scene, d.a, d.b);
      if (line.length === 2) consider(d.id, distToSeg(x, y, line[0].x, line[0].y, line[1].x, line[1].y));
    } else if (d.type === "fib") {
      for (const level of fibLevels(d.a.price, d.b.price)) {
        const yy = scene.yOfPrice(level.price);
        if (yy != null) consider(d.id, Math.abs(y - yy));
      }
    } else if (d.type === "pitchfork") {
      const fork = forkOf(scene, d.a, d.b, d.c);
      if (!fork) continue;
      for (const line of [fork.median, fork.upper, fork.lower]) {
        for (let i = 1; i < line.length; i++) consider(d.id, distToSeg(x, y, line[i - 1].x, line[i - 1].y, line[i].x, line[i].y));
      }
    } else if (d.type === "trade") {
      for (const price of [d.entryLow, d.entryHigh, d.stop, d.t1, d.t2]) {
        if (price == null) continue;
        const yy = scene.yOfPrice(price);
        if (yy != null) consider(d.id, Math.abs(y - yy));
      }
    }
  }
  for (const path of scene.avwap) {
    const xy = path.pts.map((p) => pt(scene, p.time, p.value)).filter((p): p is XY => p != null);
    for (let i = 1; i < xy.length; i++) consider(path.id, distToSeg(x, y, xy[i - 1].x, xy[i - 1].y, xy[i].x, xy[i].y));
  }
  return best.id;
}

function distToSeg(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  let t = ((x - x1) * dx + (y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
