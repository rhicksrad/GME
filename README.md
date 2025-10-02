# GME Radar

GME Radar is a lightweight GameStop activity dashboard that renders live price action and options flow with a focus on latency-sensitive updates. It is built on Vite, TypeScript, vanilla DOM utilities, and the [uPlot](https://github.com/leeoniya/uPlot) charting library so it can be deployed on GitHub Pages or served locally.

## Features

- **Live equities feed** via the Finnhub WebSocket (GME symbol).
- **Options chain snapshots** from Polygon with rate limiting and graceful retry handling.
- **Automatic demo mode** when API keys are absent, replaying bundled price and options samples so the UI always renders.
- **Price dashboard** with 1-minute candlesticks, running volume, and current spot/change badges.
- **Options heatmap** grouped by expiry and moneyness buckets with tooltips for contract detail.
- **Activity flags** including unusual volume, implied volatility spikes, sweep heuristics, and open-interest shifts.
- **Resilient networking** with exponential reconnect/backoff for Finnhub and throttled polling for Polygon.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 9+

### Install dependencies

```bash
pnpm install
```

### Configure environment

Copy `.env.example` to `.env.local` and populate the required keys:

```bash
cp .env.example .env.local
```

```ini
VITE_FINNHUB_TOKEN=your_finnhub_token
VITE_POLYGON_KEY=your_polygon_key
```

Both keys are required for live mode. Without them, the app automatically loads the simulated dataset under `public/demo` and displays a warning banner.

#### Obtaining keys

- **Finnhub** – Create an account at [Finnhub.io](https://finnhub.io/) and request a free API key. Real-time equity trades require an upgraded plan.
- **Polygon** – Register at [Polygon.io](https://polygon.io/), enable Options API access, and generate a REST key.

### Development workflow

Run the local dev server:

```bash
pnpm dev
```

Type checking and linting:

```bash
pnpm check
```

Run the Vitest unit tests:

```bash
pnpm test
```

Build the production bundle:

```bash
pnpm build
```

Preview the production bundle locally:

```bash
pnpm preview
```

Use the environment helper to confirm key detection:

```bash
pnpm dev-check
```

### Demo mode

When either API key is missing, the UI switches to demo mode, displays an orange banner, and streams the JSON payloads under `public/demo`. The simulator reproduces realistic price ticks, minute bars, and option flow bursts so charts and signals remain active. This mode is also used in CI so builds never fail due to missing secrets.

### Deployment

The project builds to `dist/` with a dynamic `base` inferred from the GitHub repository name, making it suitable for GitHub Pages. A workflow is included under `.github/workflows/pages.yml` that installs pnpm correctly, runs the build, and publishes the artifact without needing API secrets (demo mode kicks in automatically).

## Architecture overview

- `src/data/finnhub.ts` – Resilient WebSocket client with jittered exponential backoff and heartbeat pings.
- `src/data/polygon.ts` – Throttled REST poller with Retry-After support.
- `src/data/cache.ts` – Fixed-size ring buffers that store ticks, minute bars, and option snapshots.
- `src/data/simulator.ts` – Local playback utilities for the demo datasets.
- `src/signals.ts` – Pure analytics for moneyness bucketing and options flow heuristics.
- `src/ui/` – Lightweight DOM helpers and uPlot chart setup.

## Next steps

- Extend demo data with additional trading sessions.
- Persist preferred theme and layout options in local storage.
- Add websocket multiplexing for additional tickers or option trades when data is available.
- Surface more Greeks (delta, gamma) alongside bucket metrics.

## License

This project inherits the repository license.
