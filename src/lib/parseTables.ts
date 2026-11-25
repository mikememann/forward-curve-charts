import { bar, parseDay } from "@/lib/aggregate";
import type { Bar } from "@/lib/types";

export function parseFredCsv(csv: string): Bar[] {
  const out: Bar[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    const time = parseDay((date ?? "").trim());
    if (time == null || raw == null) continue;
    const text = raw.trim();
    const value = Number(text);
    if (text === "" || text === "." || !Number.isFinite(value)) continue;
    out.push(bar(time, value));
  }
  return out;
}

export function parseBoeCsv(csv: string): Bar[] {
  const out: Bar[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (!date || !raw) continue;
    const time = Date.parse(`${date} 12:00:00 UTC`);
    const value = Number(raw);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    out.push(bar(time / 1000, value));
  }
  return out;
}

export function parseBundesbankCsv(csv: string): Bar[] {
  const out: Bar[] = [];
  for (const line of csv.split(/\r?\n/)) {
    const match = /^(\d{4}-\d{2}-\d{2});([^;]*)/.exec(line);
    if (!match) continue;
    const time = parseDay(match[1]);
    const raw = match[2].trim().replace(",", ".");
    const value = Number(raw);
    if (time == null || raw === "." || raw === "" || !Number.isFinite(value)) continue;
    out.push(bar(time, value));
  }
  return out;
}
