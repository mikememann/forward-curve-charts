/**
 * Watchlist and forward curves.
 *
 * Add a market by appending one object to `markets`. The chart, sidebar,
 * and /api/markets pick it up from here — nothing else needs editing.
 *
 * Futures: set `contract` and leave `ticker` unset. The active month is
 * resolved by the expiry rule (see ContractSpec) so the default rolls
 * forward on its own. `continuous` is the optional Yahoo back-adjusted
 * series (the "=F" ticker); it is never the default for the contracts
 * below because those series jump at rolls.
 *
 * Prices are Yahoo's native units. Nothing is rescaled to IG points.
 */

export const GROUPS = ["Energy", "FX", "Metals", "Softs/Grains", "Equities/Indices"] as const;
export type MarketGroup = (typeof GROUPS)[number];
export type AssetClass = "future" | "fx" | "equity" | "index";

export interface ContractSpec {
  /** Yahoo root, e.g. "BZ", "ZW", "CC". */
  root: string;
  /** Yahoo venue suffix, e.g. "NYM", "CBT", "NYB", "CMX". */
  venue: string;
  /**
   * Delivery months this contract lists, as futures month codes
   * (F G H J K M N Q U V X Z = Jan … Dec).
   */
  months: string;
  /**
   * The contract stops being the default chart month on
   * `expiryDay` of (delivery month + expiryMonthOffset).
   * Brent uses -2: it leaves the board about two months before delivery.
   * 0 means it rolls inside the delivery month.
   */
  expiryMonthOffset: number;
  expiryDay: number;
  /**
   * Ignore a contract that expires sooner than this many days, so a
   * thin front month (December corn, December cocoa) is not the chart
   * default. The forward curve still lists it.
   */
  minDaysToExpiry?: number;
}

export interface CurveConfig {
  /** Shown under the curve. Say what is missing — do not paper over gaps. */
  note: string;
  /** How many listed months to request, starting at the front. */
  count?: number;
  /**
   * Contract list for the curve when it differs from `contract`
   * (TTF has no single chart contract). minDaysToExpiry is ignored:
   * the curve shows every listed month, including ones Yahoo skips.
   */
  spec?: ContractSpec;
}

export interface Market {
  id: string;
  name: string;
  group: MarketGroup;
  /** Display unit. Yahoo's quoting unit, not an IG point. */
  units: string;
  assetClass: AssetClass;
  /** Fixed Yahoo ticker. Omit when `contract` supplies the symbol. */
  ticker?: string;
  contract?: ContractSpec;
  /** Back-adjusted continuous Yahoo series, offered as a chart option. */
  continuous?: string;
  /** Open on the continuous series (gold spot proxy) rather than one month. */
  preferContinuous?: boolean;
  /** Shown as a permanent on-screen warning. */
  proxyNote?: string;
  /** LSE quotes: show "p" and do not divide by 100. */
  pence?: boolean;
  /** Day change versus the 22:00 Europe/London FX close. */
  fxClose22?: boolean;
  /**
   * If the last bar is more than one London business day behind,
   * the price is shown as n/a with the last-updated date.
   */
  hideStale?: boolean;
  decimals?: number;
  curve?: CurveConfig;
}

const ALL_MONTHS = "FGHJKMNQUVXZ";

export const markets: Market[] = [
  {
    id: "brent",
    name: "Brent",
    group: "Energy",
    units: "USD/bbl",
    assetClass: "future",
    decimals: 2,
    contract: { root: "BZ", venue: "NYM", months: ALL_MONTHS, expiryMonthOffset: -2, expiryDay: 15 },
    continuous: "BZ=F",
    curve: {
      count: 18,
      note: "ICE Brent via Yahoo tickers BZmyy.NYM (USD per barrel, not IG points). Months Yahoo does not return are gaps — the line is not filled in. A specific month can differ from BZ=F, which is back-adjusted.",
    },
  },
  {
    id: "ttf",
    name: "EU TTF",
    group: "Energy",
    units: "EUR/MWh",
    assetClass: "future",
    decimals: 3,
    ticker: "TTF=F",
    hideStale: true,
    curve: {
      count: 16,
      spec: { root: "TTF", venue: "NYM", months: ALL_MONTHS, expiryMonthOffset: 0, expiryDay: 1 },
      note: "Yahoo's free TTF month symbols are incomplete, and the ones that exist are labeled “Dutch TTF Natural Gas Calendar”, not a verified ICE Endex month settlement. Missing months are gaps. TTF=F is the chart series; if it has no fresh bar the price is n/a.",
    },
  },
  {
    id: "gbpusd",
    name: "GBP/USD",
    group: "FX",
    units: "USD",
    assetClass: "fx",
    decimals: 4,
    ticker: "GBPUSD=X",
    fxClose22: true,
    proxyNote:
      "Spot proxy for IG's GBP/USD Dec-26 forward. This is GBPUSD=X (spot), not the forward, and it is not scaled to IG's ×10,000 quote.",
  },
  {
    id: "gbpeur",
    name: "GBP/EUR",
    group: "FX",
    units: "EUR",
    assetClass: "fx",
    decimals: 4,
    ticker: "GBPEUR=X",
    fxClose22: true,
  },
  {
    id: "gbpzar",
    name: "GBP/ZAR",
    group: "FX",
    units: "ZAR",
    assetClass: "fx",
    decimals: 4,
    ticker: "GBPZAR=X",
    fxClose22: true,
  },
  {
    id: "gold",
    name: "Gold",
    group: "Metals",
    units: "USD/oz",
    assetClass: "future",
    decimals: 2,
    preferContinuous: true,
    continuous: "GC=F",
    contract: { root: "GC", venue: "CMX", months: ALL_MONTHS, expiryMonthOffset: 0, expiryDay: 20 },
    proxyNote:
      "COMEX gold futures as a proxy for spot gold. The default series GC=F is Yahoo's continuous contract; it is back-adjusted and is not a spot fix or a single delivery month. Switch to the specific contract for a month's actual price.",
    curve: {
      count: 16,
      note: "COMEX gold (GC) via Yahoo. Serial months often have no daily settlement on Yahoo; those points are gaps, not interpolated. Not a spot gold curve.",
    },
  },
  {
    id: "cocoa",
    name: "London Cocoa",
    group: "Softs/Grains",
    units: "USD/t",
    assetClass: "future",
    decimals: 0,
    contract: { root: "CC", venue: "NYB", months: "HKNUZ", expiryMonthOffset: 0, expiryDay: 15, minDaysToExpiry: 25 },
    continuous: "CC=F",
    proxyNote:
      "Proxy for London cocoa. This is NY ICE cocoa in USD per tonne, not London cocoa in GBP per tonne. Different exchange, currency, and contract.",
    curve: {
      count: 10,
      note: "NY cocoa (CC, USD/t) is the public stand-in for London cocoa (GBP/t). This is not the London curve. Months Yahoo does not return are gaps.",
    },
  },
  {
    id: "wheat",
    name: "Chicago Wheat",
    group: "Softs/Grains",
    units: "USc/bu",
    assetClass: "future",
    decimals: 2,
    contract: { root: "ZW", venue: "CBT", months: "HKNUZ", expiryMonthOffset: 0, expiryDay: 14 },
    continuous: "ZW=F",
    curve: {
      count: 10,
      note: "CBOT wheat (ZW) in US cents per bushel. Listed months are Mar, May, Jul, Sep, Dec. Not IG points.",
    },
  },
  {
    id: "sugar",
    name: "London Sugar No.5",
    group: "Softs/Grains",
    units: "USc/lb",
    assetClass: "future",
    decimals: 2,
    contract: { root: "SB", venue: "NYB", months: "HKNV", expiryMonthOffset: -1, expiryDay: 15 },
    continuous: "SB=F",
    proxyNote:
      "Proxy for London white sugar No.5. This is NY raw sugar No.11 in US cents per pound, not London No.5 in USD per tonne. Different contract and units.",
    curve: {
      count: 8,
      note: "NY sugar No.11 (SB, USc/lb), listed Mar, May, Jul, Oct. Proxy only — London No.5 (USD/t) is not this curve. Missing months are gaps.",
    },
  },
  {
    id: "corn",
    name: "Corn",
    group: "Softs/Grains",
    units: "USc/bu",
    assetClass: "future",
    decimals: 2,
    contract: { root: "ZC", venue: "CBT", months: "HKNUZ", expiryMonthOffset: 0, expiryDay: 14, minDaysToExpiry: 25 },
    continuous: "ZC=F",
    curve: {
      count: 10,
      note: "CBOT corn (ZC) in US cents per bushel. The chart defaults to the next liquid month (December is skipped once it is inside 25 days of expiry). The curve still includes December when Yahoo quotes it.",
    },
  },
  {
    id: "ftse",
    name: "FTSE 100",
    group: "Equities/Indices",
    units: "index",
    assetClass: "index",
    decimals: 2,
    ticker: "^FTSE",
  },
  {
    id: "nvda",
    name: "NVIDIA",
    group: "Equities/Indices",
    units: "USD",
    assetClass: "equity",
    decimals: 2,
    ticker: "NVDA",
  },
  {
    id: "bp",
    name: "BP",
    group: "Equities/Indices",
    units: "p",
    assetClass: "equity",
    decimals: 2,
    ticker: "BP.L",
    pence: true,
  },
  {
    id: "tesco",
    name: "Tesco",
    group: "Equities/Indices",
    units: "p",
    assetClass: "equity",
    decimals: 2,
    ticker: "TSCO.L",
    pence: true,
  },
  {
    id: "vrtx",
    name: "Vertex",
    group: "Equities/Indices",
    units: "USD",
    assetClass: "equity",
    decimals: 2,
    ticker: "VRTX",
  },
];

/**
 * Forward curves that are not on the IG watchlist. Watchlist futures carry
 * their curve on the market object above.
 */
export interface ExtraCurve {
  id: string;
  name: string;
  units: string;
  decimals: number;
  spec: ContractSpec;
  count?: number;
  note: string;
}

export const extraCurves: ExtraCurve[] = [
  {
    id: "wti",
    name: "WTI",
    units: "USD/bbl",
    decimals: 2,
    count: 18,
    spec: { root: "CL", venue: "NYM", months: ALL_MONTHS, expiryMonthOffset: 0, expiryDay: 20 },
    note: "NYMEX WTI (CL), USD per barrel. Reference curve only — not on the IG watchlist. Months Yahoo skips are gaps.",
  },
  {
    id: "hh",
    name: "Henry Hub",
    units: "USD/MMBtu",
    decimals: 3,
    count: 18,
    spec: { root: "NG", venue: "NYM", months: ALL_MONTHS, expiryMonthOffset: 0, expiryDay: 25 },
    note: "NYMEX Henry Hub natural gas (NG), USD per MMBtu. This is not EU TTF. Reference curve only. Months Yahoo skips are gaps.",
  },
];
