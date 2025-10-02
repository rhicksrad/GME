# GME Radar

GME Radar is a lightweight single-page dashboard that visualises GameStop’s live quote stream and intraday tape using nothing more than Vite, TypeScript, and uPlot. The app runs entirely on static hosting and talks to a Cloudflare Worker proxy that injects the Finnhub token server-side, so the bundle never exposes credentials.

## Features

- **Live Finnhub proxy** – REST polling for quotes and minute candles plus a resilient WebSocket feed, all routed through `/finnhub/*` and `/ws`.
- **Automatic demo mode** – When the worker is unavailable the UI falls back to bundled samples replayed at 2× speed, keeping the charts populated.
- **Intraday analytics** – Rolling VWAP, 1‑minute change, high/low range, and standard-deviation spike flags.
- **Responsive charts** – uPlot candlesticks and volume histograms with adaptive resizing and animation throttling.
- **GitHub Pages ready** – No build-time secrets, deterministic pnpm workflow, and a Pages deployment that works out of the box.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 9.12.1 (automatically installed in CI)

### Install dependencies

```bash
pnpm install
```

### Run the dev server

The site assumes the Cloudflare Worker is reachable at the same origin. During local development set `VITE_WORKER_ORIGIN` to the worker URL (for example `http://localhost:8787`). If the worker is offline the UI drops into demo playback automatically.

```bash
VITE_WORKER_ORIGIN=http://localhost:8787 pnpm dev
```

Navigate to <http://localhost:5173>. Supply `?symbol=GME` (default) to view a different symbol once the proxy supports it.

### Environment check

```bash
VITE_WORKER_ORIGIN=http://localhost:8787 pnpm dev-check
```

The script reports whether `/finnhub/quote` is reachable and confirms the bundled demo assets, so you know if the browser will start in live or demo mode.

### Type checking, linting, and tests

```bash
pnpm typecheck
pnpm lint
pnpm test
# or run everything
pnpm check
```

### Production build and preview

```bash
pnpm build
pnpm preview
```

## Data flow

1. **Primary path** – `src/data/workerClient.ts` targets the Worker REST and WebSocket endpoints. Quotes poll every 3 s with `nocache=1`, minute candles refresh every 20 s, and the WS client performs exponential backoff with jitter.
2. **Aggregation** – `src/data/ohlc.ts` rolls all trades into 1‑minute OHLC bars (last 390 minutes) to power the charts and analytics.
3. **Signals** – `src/signals.ts` computes VWAP, 1‑minute change, daily high/low, and a 60-minute sigma spike indicator.
4. **UI** – `src/ui/charts.ts` renders uPlot candlesticks and volume columns while `src/ui/status.ts` manages the status footer and banner.
5. **Fallback** – `src/sim/simulator.ts` replays `public/demo/*.json` at 2× speed whenever both REST and WS fail for more than 10 s.

## Cloudflare Worker proxy

All network calls originate from the browser to:

- `GET /finnhub/quote?symbol=SYM&nocache=1`
- `GET /finnhub/stock/candle?symbol=SYM&resolution=1&from=…&to=…`
- `WS /ws` sending `{ "type": "subscribe", "symbol": "SYM" }`

The Worker injects the Finnhub token and handles upstream rate limits. No Finnhub keys live in this repository or the static bundle.

## Demo mode

If the Worker responds with 5xx/429 errors or is unreachable the app swaps to the simulator. A “DEMO” badge and banner explain the state, while the simulator continues to stream quote and trade activity so charts remain useful in CI, offline development, and GitHub Pages.

## Deployment

The GitHub Actions workflow under `.github/workflows/pages.yml` installs pnpm 9.12.1, builds with Node 20, uploads the `dist` artifact, and deploys to GitHub Pages without requiring any secrets. The Vite base path adjusts automatically based on `GITHUB_REPOSITORY`.

## Known limits & next steps

- Only one symbol is supported per page; extend the worker if more tickers are needed.
- Spike detection is a basic sigma check—consider augmenting with volume and volatility context.
- The simulator ships with a short sample session; add more sessions for richer demos.
- Accessibility is monitored manually; future iterations should add automated a11y tests.

## License

This project inherits the repository licence.
