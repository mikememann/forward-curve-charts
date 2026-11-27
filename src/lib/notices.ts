export type NoticeTone = "info" | "warn";

export interface Notice {
  tone: NoticeTone;
  text: string;
}

export interface NoticeInput {
  infoNote?: string | null;
  proxyNote?: string | null;
  standInNote?: string | null;
  warnings?: readonly string[] | null;
  extraInfo?: string | null;
  continuousNote?: string | null;
  pence?: boolean;
  staleNote?: string | null;
}

const STORAGE_KEY = "mm-charts:notices:v1";
const MAX_PER_SYMBOL = 40;

export interface NoticeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Collapse whitespace so the same sentence is one notice. */
export function noticeKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function uniqueNotices(items: Array<Notice | null | undefined | false>): Notice[] {
  const seen = new Set<string>();
  const out: Notice[] = [];
  for (const item of items) {
    if (!item) continue;
    const text = noticeKey(item.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ tone: item.tone, text });
  }
  return out;
}

export function buildNotices(input: NoticeInput): Notice[] {
  const warnings = (input.warnings ?? []).map((text) => ({ tone: "warn" as const, text }));
  return uniqueNotices([
    input.infoNote ? { tone: "info", text: input.infoNote } : null,
    input.proxyNote ? { tone: "warn", text: `Proxy. ${input.proxyNote}` } : null,
    input.standInNote ? { tone: "warn", text: `Stand-in. ${input.standInNote}` } : null,
    ...warnings,
    input.extraInfo ? { tone: "info", text: input.extraInfo } : null,
    input.continuousNote ? { tone: "warn", text: input.continuousNote } : null,
    input.pence ? { tone: "info", text: "Quoted in pence (p), not pounds." } : null,
    input.staleNote ? { tone: "warn", text: input.staleNote } : null,
  ]);
}

type DismissMap = Record<string, string[]>;

function readMap(storage: NoticeStore): DismissMap {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DismissMap;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function readDismissed(symbol: string, storage: NoticeStore): Set<string> {
  const list = readMap(storage)[symbol];
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter((item) => typeof item === "string").map(noticeKey).filter(Boolean));
}

export function writeDismissed(symbol: string, texts: Iterable<string>, storage: NoticeStore): void {
  const map = readMap(storage);
  const next = [...new Set([...texts].map(noticeKey).filter(Boolean))].slice(-MAX_PER_SYMBOL);
  if (next.length) map[symbol] = next;
  else delete map[symbol];
  storage.setItem(STORAGE_KEY, JSON.stringify(map));
}
