import { extraCurves, markets, type Exactness, type ExtraCurve, type IceFallback, type IceProduct, type Market, type NativeFrequency, type SourceKind } from "@/config/markets";
import type { SourceChain } from "@/lib/types";
import { lsegMarkets } from "@/config/lseg";
import { resolveContract, type ContractInfo } from "@/lib/contracts";

export function catalog(): Market[] {
  return [...markets, ...lsegMarkets];
}

export interface CurveDef {
  id: string;
  name: string;
  units: string;
  decimals: number;
  note: string;
  count: number;
  spec: NonNullable<Market["contract"]> | null;
  /** ICE charting curve. `spec` is null and loadCurve is not used. */
  ice: boolean;
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
  alsoIn: Market["alsoIn"] | null;
  sourceKind: SourceKind;
  seriesId: string | null;
  licence: string | null;
  attribution: string | null;
  exactness: Exactness | null;
  ric: string | null;
  infoNote: string | null;
  dailyOnly: boolean;
  intradayOnly: boolean;
  nativeFrequency: NativeFrequency | null;
  requiresEnv: string | null;
  delayNote: string | null;
  igEpic: string | null;
  igEpicAlt: string | null;
  sourceChain: SourceChain | null;
  ice: IceProduct | null;
  iceFallback: IceFallback | null;
}

export function allCurves(): CurveDef[] {
  const fromMarkets: CurveDef[] = [];
  for (const m of catalog()) {
    if (!m.curve) continue;
    if (m.source === "ice" && m.ice) {
      fromMarkets.push({
        id: m.id,
        name: m.name,
        units: m.units,
        decimals: m.decimals ?? 2,
        note: m.curve.note,
        count: m.curve.count ?? 12,
        spec: null,
        ice: true,
        marketId: m.id,
      });
      continue;
    }
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
      ice: false,
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
    ice: false,
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
    alsoIn: m.alsoIn ?? null,
    sourceKind: m.source ?? "yahoo",
    seriesId: m.seriesId ?? null,
    licence: m.licence ?? null,
    attribution: m.attribution ?? null,
    exactness: m.exactness ?? null,
    ric: m.ric ?? null,
    infoNote: m.infoNote ?? null,
    dailyOnly: Boolean(m.dailyOnly),
    intradayOnly: Boolean(m.intradayOnly),
    nativeFrequency: m.nativeFrequency ?? null,
    requiresEnv: m.requiresEnv ?? null,
    delayNote: m.delayNote ?? null,
    igEpic: m.igEpic ?? null,
    igEpicAlt: m.igEpicAlt ?? null,
    sourceChain: m.sourceChain ?? null,
    ice: m.ice ?? null,
    iceFallback: m.iceFallback ?? null,
  };
}

export function presentMarkets(now = new Date()): MarketView[] {
  return catalog().map((m) => presentMarket(m, now));
}

export function findMarket(id: string, now = new Date()): MarketView | null {
  const m = catalog().find((x) => x.id === id);
  return m ? presentMarket(m, now) : null;
}

export function findMarketByTicker(ticker: string, now = new Date()): MarketView | null {
  const upper = ticker.toUpperCase();
  for (const m of catalog()) {
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
