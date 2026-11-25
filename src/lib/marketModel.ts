import { extraCurves, markets, type ExtraCurve, type Market } from "@/config/markets";
import { resolveContract, type ContractInfo } from "@/lib/contracts";

export interface CurveDef {
  id: string;
  name: string;
  units: string;
  decimals: number;
  note: string;
  count: number;
  spec: NonNullable<Market["contract"]>;
  marketId: string | null;
}

export interface MarketView {
  id: string;
  name: string;
  group: Market["group"] | "Custom";
  units: string;
  assetClass: Market["assetClass"] | "equity";
  /** Ticker the chart opens on. */
  ticker: string;
  contractTicker: string | null;
  contractLabel: string | null;
  contract: ContractInfo | null;
  continuous: string | null;
  preferContinuous: boolean;
  proxyNote: string | null;
  pence: boolean;
  fxClose22: boolean;
  hideStale: boolean;
  decimals: number;
  curveId: string | null;
}

export function allCurves(): CurveDef[] {
  const fromMarkets: CurveDef[] = [];
  for (const m of markets) {
    if (!m.curve) continue;
    const spec = m.curve.spec ?? m.contract;
    if (!spec) continue;
    fromMarkets.push({
      id: m.id,
      name: m.name,
      units: m.units,
      decimals: m.decimals ?? 2,
      note: m.curve.note,
      count: m.curve.count ?? 12,
      spec,
      marketId: m.id,
    });
  }
  const extras: CurveDef[] = extraCurves.map((c: ExtraCurve) => ({
    id: c.id,
    name: c.name,
    units: c.units,
    decimals: c.decimals,
    note: c.note,
    count: c.count ?? 12,
    spec: c.spec,
    marketId: null,
  }));
  return [...fromMarkets, ...extras];
}

export function presentMarket(m: Market, now = new Date()): MarketView {
  let contract: ContractInfo | null = null;
  if (m.contract) contract = resolveContract(m.contract, now);
  const prefer = Boolean(m.preferContinuous && m.continuous);
  const ticker = prefer ? m.continuous! : contract?.ticker ?? m.ticker ?? "";
  return {
    id: m.id,
    name: m.name,
    group: m.group,
    units: m.units,
    assetClass: m.assetClass,
    ticker,
    contractTicker: contract?.ticker ?? null,
    contractLabel: contract?.label ?? null,
    contract,
    continuous: m.continuous ?? null,
    preferContinuous: prefer,
    proxyNote: m.proxyNote ?? null,
    pence: Boolean(m.pence),
    fxClose22: Boolean(m.fxClose22),
    hideStale: Boolean(m.hideStale),
    decimals: m.decimals ?? 2,
    curveId: m.curve ? m.id : null,
  };
}

export function presentMarkets(now = new Date()): MarketView[] {
  return markets.map((m) => presentMarket(m, now));
}

export function findMarket(id: string, now = new Date()): MarketView | null {
  const m = markets.find((x) => x.id === id);
  return m ? presentMarket(m, now) : null;
}

export function findMarketByTicker(ticker: string, now = new Date()): MarketView | null {
  const upper = ticker.toUpperCase();
  for (const m of markets) {
    const view = presentMarket(m, now);
    if (
      view.ticker.toUpperCase() === upper ||
      view.contractTicker?.toUpperCase() === upper ||
      view.continuous?.toUpperCase() === upper ||
      m.ticker?.toUpperCase() === upper
    ) {
      return view;
    }
  }
  return null;
}

export function findCurve(id: string): CurveDef | null {
  return allCurves().find((c) => c.id === id) ?? null;
}

export function delayNoteFor(assetClass: string | null, fxClose22 = false): string {
  if (fxClose22) {
    return "FX day % is versus the 22:00 UK close, not Yahoo's official daily close. Bars are Yahoo timestamps.";
  }
  if (assetClass === "future") {
    return "Futures quotes are typically delayed 10–30 minutes.";
  }
  return "Quote time is the Yahoo Finance timestamp.";
}
