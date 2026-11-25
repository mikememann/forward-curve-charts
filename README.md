# Chart Desk

Interactive charts for Mike Mendelsohn’s IG watchlist (and his analyst’s scripts). Prices come from Yahoo Finance’s public chart endpoint. There is no IG API, no API key, and nothing is rescaled into IG points.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). One command after install.

```bash
npm test          # contract roll, indicators, 22:00 FX close, curve spreads
npm run build     # production build
npm start         # serve the production build
```

## Deploy to Vercel

The app is a Next.js App Router project. The only optional variable is `AGSI_API_KEY` (a free GIE key). Leave it unset and EU gas storage stays off.

1. Import this repository in Vercel. Framework preset: **Next.js**. Root directory: the repo root.
2. Deploy. `src/app/api/*` runs as Node serverless functions (`maxDuration` 60 on the data routes).

Yahoo is called from the server, because the browser cannot call it directly (CORS). Responses are cached in memory for a short time (about 45 seconds for intraday, 5 minutes for daily).

## Add a market

Edit **`src/config/markets.ts`** and append one object to the `markets` array. That is the only file. The sidebar, chart, and `/api/markets` all read it.

An equity:

```ts
{ id: "shel", name: "Shell", group: "Equities/Indices", units: "p", assetClass: "equity", decimals: 2, ticker: "SHEL.L", pence: true },
```

A futures market. Leave `ticker` unset. `contract` is the roll rule; `continuous` is the optional back-adjusted Yahoo `=F` series, offered as a toggle and never the default for these:

```ts
{
  id: "brent",
  name: "Brent",
  group: "Energy",
  units: "USD/bbl",
  assetClass: "future",
  decimals: 2,
  contract: { root: "BZ", venue: "NYM", months: "FGHJKMNQUVXZ", expiryMonthOffset: -2, expiryDay: 15 },
  continuous: "BZ=F",
  curve: { count: 18, note: "Say here what Yahoo does not cover." },
}
```

Month codes are `F G H J K M N Q U V X Z` (Jan–Dec). The chart default is the first listed month whose roll date is still ahead. Brent rolls off on the 15th of the month two months before delivery, which is why 25 Nov 2026 resolves to **Feb 2027 (`BZG27.NYM`)** and 20 Dec 2026 resolves to **Mar 2027**. Wheat (`ZW`, months `HKNUZ`, rolls on the 14th of the delivery month) is **Dec 2026** until 14 Dec. Corn and cocoa set `minDaysToExpiry: 25` so the thin December contract is not the chart default; the forward curve still lists it. `npm test` locks these dates.

`curve` on the same object adds a forward curve. WTI and Henry Hub are reference curves only (`extraCurves` in the same file); they are not on the watchlist.

The sidebar search adds a Yahoo symbol for this browser only (`localStorage`). It does not change the config file.

## What the chart does

- Candles, line, or OHLC. Timeframes **15m, 1h, 1D, 1W**. Scroll to zoom, drag to pan. Crosshair OHLC is in the strip above the chart.
- Volume when Yahoo has any. Log or linear scale.
- **SMA 20 / 50 / 200** (simple, not EMA). On 15m and 1h the **200-day SMA** is also a horizontal line. Bollinger Bands **(20, 2)** use a population standard deviation. **RSI(14)**, slow stochastic **(14, 3, 3)**, **ATR(14)**, **MACD(12, 26, 9)**. Ichimoku and RSI/stoch divergence markers are toggles.
- Drawings, stored per symbol in `localStorage`: horizontal levels, trendlines (extended right), Fibonacci (0% on the second click; **Auto Fib** uses the same swing rule as the analyst’s chart script), Andrews pitchfork from three clicks or **Auto fork**, one or two anchored VWAPs (needs volume). **Trade** draws entry, stop, T1, T2 with R/R from the midpoint of the entry, and a stop distance in ATRs. **Context** draws the levels with no long/short label.
- **Compare** overlays up to three watchlist symbols, each rebased to 0% at the start of the loaded window (dashed line is the charted symbol).

## Data rules

| Rule | Behaviour |
|---|---|
| Futures contracts | The chart opens on the resolved month and prints the contract name (`Feb 2027`, `BZG27.NYM`). **Continuous** switches to the Yahoo `=F` series and says it is back-adjusted. |
| Proxies | An amber banner stays on screen. GBP/USD is spot, not the Dec-26 forward and not ×10,000. Gold `GC=F` is COMEX continuous, not a spot fix. Cocoa is NY USD/t, not London GBP/t. Sugar is No.11 USc/lb, not London No.5. |
| FX day change | Versus the **22:00 Europe/London** print (close of the 21:00–22:00 hour), not Yahoo’s official daily close. If that bar is missing, the change is `n/a`. |
| TTF | If the last bar is more than one London business day behind, the price is **n/a** and the last-updated date is shown. History can still be charted, labelled as history. |
| LSE stocks | BP and Tesco stay in pence (`p` / `GBp`). They are not divided by 100. FTSE 100 is index points. |
| Failures | A failed fetch is an error state. No number is invented to fill a gap. Forward-curve months Yahoo does not quote are gaps; the line is not bridged. |
| Delay | Every chart shows **Yahoo Finance**, the delay note (futures are typically 10–30 minutes), the last bar in UK time, and the age of the quote timestamp. |
| Units | Yahoo’s native units. Not IG points. |

## IG Markets

IG is an optional read-only source for Mike's spread-betting account. The server calls only `/session`, `/watchlists`, `/markets` and `/prices`. Paths such as `/positions`, `/workingorders` and `/confirms` throw before a request is sent. Credentials never go to the browser.

Set these on the server (Vercel project env):

| Variable | Required | Purpose |
|---|---|---|
| `IG_API_KEY` | yes | `X-IG-API-KEY` |
| `IG_USERNAME` | yes | session `identifier` |
| `IG_PASSWORD` | yes | session password |
| `IG_ACC_TYPE` | no | `LIVE` (default) or `DEMO`. Demo uses `https://demo-api.ig.com/gateway/deal` |

Without those three, every chart stays on its free feed and the IG watchlist row says the credentials are missing.

Historical bars are cached. When `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set (Vercel KV or Upstash), the cache is stored there. Otherwise it is a file under `IG_CACHE_DIR` or the temp directory. The client asks only for the missing tail, in chunks of 100 points. The chart shows the remaining weekly allowance (10,000 points). Under 500 remaining, the chart uses the free feed.

IG prices are displayed as **IG price (IG points)**. They are not a rescaled copy of the Yahoo or exchange series, and the two are not joined into one line. Forward curves stay on the free contract chain. PRs #2 and #3 were not merged when this was branched, so there is no multi-chart grid and no ICE feed here. The free leg of the chain is the existing Yahoo or FRED series. UK feed wheat has no IG epic.

The visible chart does not preload every market. Auto mode fetches one short window: 64×15m, 120×1h or 120×1d points. Opening all 15 MM markets on the default daily chart is 15 × 120 = 1,800 points. Loading every market at the caps (300 daily plus 200 hourly) would be 15 × 500 = 7,500 points, so that is not the default.

| Market | Epic | 15m / 1h / short 1d | Weekly and long 1d |
|---|---|---|---|
| Brent | `CC.D.LCO.USS.IP` | IG, then free | Free |
| EU TTF | `EN.D.ICETTF.Month3.IP` | IG, then free | Free |
| GBP/USD | `CF.D.GBPUSD.DEC.IP` | IG, then free | Free |
| GBP/EUR | `CS.D.GBPEUR.TODAY.IP` | IG, then free | Free |
| GBP/ZAR | `CS.D.GBPZAR.TODAY.IP` | IG, then free | Free |
| Spot gold | `CS.D.USCGC.TODAY.IP` | IG, then free | Free |
| London cocoa | `CC.D.LCC.USS.IP` | IG, then free | Free |
| Chicago wheat | `CO.D.W.Month1.IP` | IG, then free | Free |
| London sugar No.5 | `CC.D.LSU.USS.IP` | IG, then free | Free |
| Corn | `CC.D.C.USS.IP` | IG, then free | Free |
| FTSE 100 | `IX.D.FTSE.DAILY.IP` | IG, then free | Free |
| NVIDIA | `UC.D.NVDA.DAILY.IP` | IG, then free | Free |
| BP | `KA.D.BP.DAILY.IP` | IG, then free | Free |
| Tesco | `KA.D.TSCO.DAILY.IP` | IG, then free | Free |
| Vertex | `UD.D.VRTX.DAILY.IP` | IG, then free | Free |
| Robusta | `CC.D.LKD.USS.IP` (DFB). Jan-27 is `CO.D.LKD.Month3.IP` | IG, then the IMF series | IMF series |
| UK feed wheat | none | Free only. An IG search found nothing | Free only |
| LSEG macro, FRED, BoE and the rest | none | Unchanged | Unchanged |

`/api/ohlc` accepts `source=ig` or `source=free`. Omitting it follows the chain.

## LSEG Workspace layout

The sidebar’s **LSEG ·** groups are the markets from Mike’s old Workspace layout that have a verified free feed, exact or a labelled stand-in. The same market can sit in an IG group and an LSEG group (one quote, two rows). Configuration is `src/config/lseg.ts`, still driven by the market list: each row names its source, series id, licence, and whether it is exact, near-exact, or a proxy.

Rows that are view-only, proprietary, or unclear are listed in the same groups as **unavailable**, with the reason. Nothing is invented for them. Euronext wheat is one of those: Yahoo’s `EBM=F` is Micro Bitcoin Euro, not wheat, and it is not used.

| Source | What it feeds | Licence |
|---|---|---|
| Yahoo Finance | Futures, FX, equities, GSCI, NBP, palm oil, CBOT urea | Free to view, personal use, no redistribution |
| FRED | EIA Brent spot, IMF monthly oils, policy rates, US yields, PPI | Public domain |
| Bank of England IADB | Bank Rate, 5y and 10y gilt par yields | Free reuse with attribution |
| Deutsche Bundesbank BBSIS | German 1y / 5y / 10y curve yields | Free reuse with attribution |
| CFTC public reporting | Managed-money net for sugar, soybeans, cocoa, corn, SRW wheat | Public domain |
| World Bank Pink Sheet | Coconut oil, urea, DAP. The monthly xlsx link is scraped from the commodity-markets page because the URL changes | CC BY 4.0 |
| Energy-Charts | German day-ahead power | CC BY 4.0 |
| Elexon | UK APX half-hourly market index, last eight weeks stitched together | Free reuse with attribution |
| IMF PortWatch | Daily ship transits through the Strait of Hormuz | Free with attribution |
| GIE AGSI+ | EU gas storage percent full | Free with attribution, **off unless `AGSI_API_KEY` is set** |

Watch-outs that are labelled on the chart, not papered over:

- Yahoo Brent months run about one month ahead of ICE near expiry.
- The TTF forward curve is partial: Yahoo only lists about 3–6 months.
- `NBP=F` has no contract name. The level is about 30 **USD/MMBtu**, not pence per therm.
- `CPO=F` is the CME USD calendar future, not Bursa Malaysia in MYR/t, and it has no intraday bars. `UFV=F` is CBOT urea with no contract name; it is not the World Bank USD/t urea series.
- `^SPGSAG` and `^SPGSEN` have no daily history. Daily and weekly charts are refused.
- Stooq is not used.

### Custom spreads

A formula of two or more market ids, with spaces around the operators: `brent - wti`, `us-10y - us-1y`, `( brent - wti ) / brent`. Saved in this browser. `S)WHprem` and `S)GasSpread` stay unavailable until the formula is added there. The API is the same OHLC route:

```bash
curl "http://localhost:3000/api/ohlc?formula=brent%20-%20wti&timeframe=1d"
```

Points exist only where every leg has a bar. Division by zero is dropped.

## API

All routes are JSON unless `format=csv`. No authentication. `Cache-Control` is short. Times in the JSON bars are Unix seconds (UTC). CSV times are ISO-8601 UTC. Indicator `null` means “not enough history”, not zero.

### `GET /api/markets`

Resolved watchlist: current contract ticker, continuous ticker, units, proxy note, curve id.

### `GET /api/quotes` and `GET /api/quotes?extra=SHEL.L,AAPL`

Sidebar quotes. `extra` is optional comma-separated Yahoo symbols (max 12). FX rows use `changeBasis: "22:00 UK"`. A stale TTF row has `stale: true`, `last: null`, and `lastUpdatedLabel`. A failed symbol has `error` set and `last: null`.

### `GET /api/ohlc?ticker=BZG27.NYM&timeframe=1h&bars=400&market=brent`

`timeframe` is `15m`, `1h`, `1d`, or `1w`. `bars` limits how many rows are returned (indicators are computed on the full downloaded history first, then sliced). `market` is optional; pass a watchlist id so the payload includes units, the proxy note, and the contract label.

Each bar has `open, high, low, close, volume, sma20, sma50, sma200, bbMid, bbUpper, bbLower, rsi14, stochK, stochD, atr14, macd, macdSignal, macdHist`, plus unshifted Ichimoku `tenkan, kijun, spanA, spanB` (plot the spans 26 bars ahead). The root field `sma200Daily` is the 200-**day** average. On an intraday response, `sma200` is the 200-bar average of that timeframe, which is a different number.

OHLC is Yahoo’s unadjusted quote, matching `auto_adjust=False`.

```bash
curl "http://localhost:3000/api/ohlc?ticker=BZG27.NYM&timeframe=1h&market=brent"
```

### `GET /api/ohlc?ticker=GBPUSD=X&timeframe=1d&format=csv`

Same data as CSV. Lines starting with `#` are metadata (`sma200_daily`, source, delay, warnings). Pandas: `pd.read_csv(url, comment="#")`.

### `GET /api/curve?market=brent`

`market` is `brent`, `ttf`, `gold`, `wheat`, `corn`, `cocoa`, `sugar`, `wti`, or `hh`.

Each point is one listed contract: `price` is the latest daily close if that bar is under six days old, otherwise null. `week` / `monthAgo` are the daily closes on or before 7 and 30 days ago, and they are null if the nearest bar is too far from that date. `priceTimeUnix` is the daily bar, not the time the page loaded. `gaps` lists months with no fresh quote. `spreads` is M1–M2, M1–M6, and M1–M12, where M1 is the first plotted contract and Mk is the k-th plotted contract. A missing price makes that spread `n/a` — a gap is not skipped and then called M6.

### `GET /api/search?q=tesco`

Yahoo symbol search for the sidebar. Equities, ETFs, futures, indices, and FX only.

### Errors

`400` bad query, `404` unknown curve, `502` Yahoo failed. Body: `{ "error": "..." }`. The chart shows that string and does not keep a made-up price.
