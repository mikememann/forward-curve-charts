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

export const GROUPS = [
  "Energy",
  "FX",
  "Metals",
  "Softs/Grains",
  "Equities/Indices",
  "LSEG · Main",
  "LSEG · Cocoa",
  "LSEG · CFTC",
  "LSEG · Macro",
  "LSEG · Bonds",
  "LSEG · Shipping",
  "LSEG · REGO",
] as const;
export type MarketGroup = (typeof GROUPS)[number];
export type AssetClass = "future" | "fx" | "equity" | "index" | "macro";
export type SourceKind =
  | "yahoo"
  | "fred"
  | "boe"
  | "bundesbank"
  | "cftc"
  | "worldbank"
  | "energycharts"
  | "elexon"
  | "portwatch"
  | "agsi"
  | "ice";

/**
 * ICE charting data is free to view for personal use.
 * It is not licensed for redistribution.
 */
export const ICE_LICENCE = "ICE: free to view, personal use, not for redistribution";
export type Exactness = "exact" | "near-exact" | "proxy";
export type NativeFrequency = "15m" | "30m" | "1h" | "1d" | "1w" | "1mo";

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

/** Charting product/hub ids from the ICE product-guide spec. The spec id is not the charting product id. */
export interface IceProduct {
  specId: number;
  productId: number;
  hubId: number;
  /** On-screen label, including the unit. */
  label: string;
  /** Yahoo market shown as an optional true-OHLC comparison. Different contract and units. */
  compareMarketId?: string;
  compareLabel?: string;
}

/** Previous stand-in, used only when the ICE charting request fails. */
export type IceFallback =
  | { kind: "yahoo"; contract: ContractSpec; units: string; note: string }
  | { kind: "fred"; seriesId: string; nativeFrequency: NativeFrequency; units: string; note: string };

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
  /** Where the bars come from. Defaults to Yahoo. */
  source?: SourceKind;
  /** Adapter series id (FRED id, BoE code, CFTC code, World Bank column, …). */
  seriesId?: string;
  licence?: string;
  attribution?: string;
  exactness?: Exactness;
  /** LSEG RIC, when this row comes from the Workspace layout. */
  ric?: string;
  /** Factual note that is not a proxy warning (month mapping, missing history). */
  infoNote?: string;
  /** Yahoo publishes no intraday bars. Finer timeframes fall back to daily with a warning. */
  dailyOnly?: boolean;
  /** Yahoo publishes no daily history. Daily and weekly requests are refused. */
  intradayOnly?: boolean;
  /** Also list this market under an LSEG panel, in addition to `group`. */
  alsoIn?: MarketGroup;
  /** Observation step of the source. */
  nativeFrequency?: NativeFrequency;
  /** Server env var required before this series is fetched. Off when unset. */
  requiresEnv?: string;
  delayNote?: string;
  /** ICE charting product. `source` must be "ice". */
  ice?: IceProduct;
  /** Labelled stand-in when the ICE request fails. UK wheat has none. */
  iceFallback?: IceFallback;
}

export interface UnavailableSeries {
  id: string;
  name: string;
  group: MarketGroup;
  ric?: string;
  /** Shown on the row and in the panel. No series is fetched. */
  reason: string;
  licence?: string;
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
      note: "NYMEX Brent Last Day Financial (BZ) via Yahoo, USD/bbl, not IG points. Yahoo's month code runs about one month ahead of ICE near expiry (ICE Jan-27 still trades into late November while Yahoo is already on Feb-27). Months Yahoo does not return are gaps. Not the same levels as back-adjusted BZ=F.",
    },
    alsoIn: "LSEG · Main",
    exactness: "near-exact",
    ric: "LCOc1",
    infoNote:
      "Yahoo's BZ month runs about one month ahead of ICE near expiry. This is NYMEX Brent Last Day Financial, which cash-settles to ICE Brent, not the ICE screen month itself.",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
      note: "Partial curve. Yahoo only lists about the next 3–6 TTF months (further codes such as TTFQ27 return nothing), and the names say “Dutch TTF Natural Gas Calendar”, not a verified ICE Endex settlement. Missing months are gaps. TTF=F is the chart series; a stale bar is shown as n/a.",
    },
    alsoIn: "LSEG · Main",
    exactness: "near-exact",
    ric: "TRNLTTFMc1",
    infoNote: "Near-exact CME stand-in for ICE Endex TTF. The free curve is only the first few months, not the full strip.",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    alsoIn: "LSEG · Macro",
    exactness: "exact",
    ric: "GBP=",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    alsoIn: "LSEG · Macro",
    exactness: "exact",
    ric: "GBPEUR=",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    alsoIn: "LSEG · Bonds",
    exactness: "exact",
    ric: "GBPZAR=",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    alsoIn: "LSEG · Main",
    exactness: "proxy",
    ric: "XAU=",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
    proxyNote:
      "COMEX gold futures as a proxy for spot gold. The default series GC=F is Yahoo's continuous contract; it is back-adjusted and is not a spot fix or a single delivery month. XAUUSD=X is not on Yahoo. Switch to the specific contract for a month's actual price.",
    curve: {
      count: 16,
      note: "COMEX gold (GC) via Yahoo. Serial months often have no daily settlement on Yahoo; those points are gaps, not interpolated. Not a spot gold curve.",
    },
  },
  {
    id: "cocoa",
    name: "London Cocoa",
    group: "Softs/Grains",
    units: "GBP/t",
    assetClass: "future",
    decimals: 0,
    ticker: "ICE:C",
    source: "ice",
    ice: {
      specId: 37089076,
      productId: 15246,
      hubId: 17450,
      label: "ICE London Cocoa, delayed, close-based, GBP/t",
      compareMarketId: "us-cocoa",
      compareLabel: "NY cocoa OHLC",
    },
    iceFallback: {
      kind: "yahoo",
      contract: { root: "CC", venue: "NYB", months: "HKNUZ", expiryMonthOffset: 0, expiryDay: 15, minDaysToExpiry: 25 },
      units: "USD/t",
      note: "ICE London cocoa did not load. This is the old stand-in: NY ICE cocoa in USD per tonne, not London cocoa in GBP per tonne. It has not been converted with GBPUSD.",
    },
    exactness: "exact",
    ric: "LCCc1",
    licence: ICE_LICENCE,
    attribution: "ICE Futures Europe",
    alsoIn: "LSEG · Cocoa",
    delayNote: "Delayed. Close-only.",
    infoNote: "ICE London Cocoa, delayed, close-based, GBP/t. Front skips a contract whose delivery month starts within 14 days, so Dec 2026 is not the default. NY cocoa (CC, USD/t) is an optional true-OHLC comparison, not this price, and it is not multiplied by GBPUSD. The ICE charting endpoints are undocumented and may change.",
    curve: {
      note: "ICE London cocoa (GBP/t), delayed lasts, including a month the chart has rolled off. Months the list does not return are absent. Not the NY cocoa curve. These endpoints are undocumented and may change.",
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
    alsoIn: "LSEG · Main",
    exactness: "exact",
    ric: "Wc1",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
    curve: {
      count: 10,
      note: "CBOT wheat (ZW) in US cents per bushel. Listed months are Mar, May, Jul, Sep, Dec. Not IG points.",
    },
  },
  {
    id: "sugar",
    name: "London Sugar No.5",
    group: "Softs/Grains",
    units: "USD/t",
    assetClass: "future",
    decimals: 1,
    ticker: "ICE:W",
    source: "ice",
    ice: {
      specId: 37089080,
      productId: 15249,
      hubId: 17453,
      label: "ICE White Sugar, delayed, close-based, USD/t",
      compareMarketId: "sugar-11",
      compareLabel: "No.11 OHLC",
    },
    iceFallback: {
      kind: "yahoo",
      contract: { root: "SB", venue: "NYB", months: "HKNV", expiryMonthOffset: -1, expiryDay: 15 },
      units: "USc/lb",
      note: "ICE white sugar did not load. This is the old stand-in: NY raw sugar No.11 in US cents per pound, not London No.5 in USD per tonne.",
    },
    exactness: "exact",
    ric: "LSUc1",
    licence: ICE_LICENCE,
    attribution: "ICE Futures Europe",
    alsoIn: "LSEG · Main",
    delayNote: "Delayed. Close-only.",
    infoNote: "ICE White Sugar, delayed, close-based, USD/t. ICE quotes white sugar in US dollars per tonne, not pounds. No.11 (SB) is an optional true-OHLC comparison. The ICE charting endpoints are undocumented and may change.",
    curve: {
      note: "ICE white sugar No.5 (USD/t), delayed lasts. Months the charting list does not return are absent. Not NY sugar No.11.",
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
    alsoIn: "LSEG · Main",
    exactness: "exact",
    ric: "Cc1",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    alsoIn: "LSEG · Macro",
    exactness: "exact",
    ric: ".FTSE",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    alsoIn: "LSEG · Cocoa",
    exactness: "exact",
    ric: "BP.L",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    alsoIn: "LSEG · Cocoa",
    exactness: "exact",
    ric: "TSCO.L",
    licence: "Yahoo terms: free to view, personal use, no redistribution",
    attribution: "Yahoo Finance",
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
    id: "hh",
    name: "Henry Hub",
    units: "USD/MMBtu",
    decimals: 3,
    count: 18,
    spec: { root: "NG", venue: "NYM", months: ALL_MONTHS, expiryMonthOffset: 0, expiryDay: 25 },
    note: "NYMEX Henry Hub natural gas (NG), USD per MMBtu. This is not EU TTF. Reference curve only. Months Yahoo skips are gaps.",
  },
];
