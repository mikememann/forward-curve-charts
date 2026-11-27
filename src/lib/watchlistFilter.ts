/** Case-insensitive substring match across name, ticker, and group. Empty query matches everything. */
export function watchlistMatches(query: string, fields: Array<string | null | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => (field ?? "").toLowerCase().includes(needle));
}
