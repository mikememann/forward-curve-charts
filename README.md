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

The app is a Next.js App Router project. No environment variables.

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
