import type { ContractSpec } from "@/config/markets";

const MONTH_CODES = "FGHJKMNQUVXZ";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ContractInfo {
  ticker: string;
  label: string;
  monthCode: string;
  year: number;
  /** 0-11 */
  month: number;
  /** YYYY-MM */
  monthKey: string;
  /** YYYY-MM-DD, the date this contract stops being the chart default. */
  expiry: string;
}

export function formatTicker(root: string, monthCode: string, year: number, venue: string): string {
  const yy = String(year % 100).padStart(2, "0");
  return `${root}${monthCode}${yy}.${venue}`;
}

export function expiryYmd(year: number, month0: number, spec: Pick<ContractSpec, "expiryMonthOffset" | "expiryDay">): string {
  const dt = new Date(Date.UTC(year, month0 + spec.expiryMonthOffset, spec.expiryDay));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Listed contracts from `start` (inclusive of that month) in calendar order.
 * Only months in `spec.months` are emitted. `count` is how many to return.
 */
export function enumerateContracts(spec: ContractSpec, start: Date, count: number): ContractInfo[] {
  const out: ContractInfo[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  let guard = 0;
  while (out.length < count && guard < 360) {
    guard++;
    const code = MONTH_CODES[m];
    if (spec.months.includes(code)) {
      const expiry = expiryYmd(y, m, spec);
      out.push({
        ticker: formatTicker(spec.root, code, y, spec.venue),
        label: `${MONTH_NAMES[m]} ${y}`,
        monthCode: code,
        year: y,
        month: m,
        monthKey: `${y}-${String(m + 1).padStart(2, "0")}`,
        expiry,
      });
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/**
 * Chart default: the front listed month that has not reached its roll date,
 * after `minDaysToExpiry` is applied.
 */
export function resolveContract(spec: ContractSpec, now = new Date()): ContractInfo {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const all = enumerateContracts(spec, start, 40);
  const minDays = spec.minDaysToExpiry ?? 0;
  const alive = all.filter((c) => daysBetween(today, c.expiry) >= minDays);
  const chosen = alive[0];
  if (!chosen) {
    throw new Error(`No live contract for ${spec.root}.${spec.venue} on ${today}`);
  }
  return chosen;
}

/** Curve list: every listed month from the previous calendar month, no roll filter. */
export function curveContractList(spec: ContractSpec, count: number, now = new Date()): ContractInfo[] {
  const bare: ContractSpec = { ...spec, minDaysToExpiry: 0 };
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return enumerateContracts(bare, start, count);
}
