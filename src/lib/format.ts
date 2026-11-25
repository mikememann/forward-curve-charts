export function formatPrice(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatChange(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return sign + formatPrice(n, decimals);
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function previousFromChange(price: number, changePct: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(changePct)) return null;
  const denom = 1 + changePct / 100;
  if (!Number.isFinite(denom) || denom === 0) return null;
  return price / denom;
}
