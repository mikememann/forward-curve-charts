import type { Bar } from "@/lib/types";

/** Managed-money net from an ICE Futures Europe COT history file. */
export function parseIceCot(csv: string, market: string): Bar[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.includes(","));
  const headerAt = lines.findIndex((line) => line.startsWith("Market_and_Exchange_Names"));
  if (headerAt < 0) return [];
  const header = splitCsv(lines[headerAt]);
  const name = header.indexOf("Market_and_Exchange_Names");
  const date = header.indexOf("As_of_Date_Form_MM/DD/YYYY");
  const long = header.indexOf("M_Money_Positions_Long_All");
  const short = header.indexOf("M_Money_Positions_Short_All");
  if (name < 0 || date < 0 || long < 0 || short < 0) return [];
  const bars: Bar[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitCsv(line);
    if (cells[name] !== market) continue;
    const time = parseUsDate(cells[date]);
    const net = Number(cells[long]) - Number(cells[short]);
    if (time == null || !Number.isFinite(net)) continue;
    bars.push({ time, open: net, high: net, low: net, close: net, volume: 0 });
  }
  bars.sort((a, b) => a.time - b.time);
  return dedupe(bars);
}

/** Investment-fund net for TFM from an ICE Endex MiFID COT file. Disclaimer lines are skipped. */
export function parseTtfCot(csv: string): Bar[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("Disclaimer") && !line.startsWith("The "));
  const headerAt = lines.findIndex((line) => line.includes("NOPS_Investment_Funds_Long_Total"));
  if (headerAt < 0) return [];
  const header = splitCsv(lines[headerAt]);
  const code = header.indexOf("Venue_Product_Code");
  const date = header.indexOf("Date_of_which_the_weekly_report_refers");
  const long = header.indexOf("NOPS_Investment_Funds_Long_Total");
  const short = header.indexOf("NOPS_Investment_Funds_Short_Total");
  if (code < 0 || date < 0 || long < 0 || short < 0) return [];
  const bars: Bar[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitCsv(line);
    if (cells[code] !== "TFM") continue;
    const time = Date.parse(`${cells[date]}T12:00:00Z`);
    const net = Number(cells[long]) - Number(cells[short]);
    if (!Number.isFinite(time) || !Number.isFinite(net)) continue;
    bars.push({ time: time / 1000, open: net, high: net, low: net, close: net, volume: 0 });
  }
  return dedupe(bars);
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  for (const ch of line) {
    if (ch === '"') quote = !quote;
    else if (ch === "," && !quote) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseUsDate(value: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const t = Date.parse(`${m[3]}-${m[1]}-${m[2]}T12:00:00Z`);
  return Number.isFinite(t) ? t / 1000 : null;
}

function dedupe(bars: Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const bar of bars) map.set(bar.time, bar);
  return [...map.values()].sort((a, b) => a.time - b.time);
}
