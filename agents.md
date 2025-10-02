Title: GME Radar agent guide (Phase 4, GME-only)

Scope

Maintain a static site and a Cloudflare Worker that serve one symbol: GME.

No trading, no multi-symbol features, no compare views.

Golden rules

Never expose API keys in client code.

All market access goes through the Worker.

Pages builds must not depend on secrets or live providers.

Prefer stale-but-valid UI over blank screens.

Runtime architecture

Cron jobs push normalized data into KV and publish to LiveBus DO.

Browser connects to /sse/alerts and receives quote, bar, options, alert.

Backfill endpoints read from KV on page load for instant charts.

Data contracts

Quote: /finnhub/quote → {c,d,dp,h,l,o,pc,t}

Bars: array of { t, o, h, l, c, v } minute OHLC

Options normalized row: { ts, exp, type, strike, bid?, ask?, last?, mid?, volume?, openInterest?, iv? }

Alerts: { kind: "IVSpike" | "UnusualVol" | "SweepHeuristic", ts, details }

Ops playbook

If alerts stop:

Check cron logs

Hit /sse/alerts and confirm heartbeats

Inspect opt:GME:YYYY-MM-DD and q:GME:YYYY-MM-DD KV keys

If backfill is empty:

Hit /backfill/quotes?minutes=390&force=1 to synthesize from candles

If rate-limited:

Jobs back off with jitter and keep last-good snapshot

Rollback:

Disable SSE in src/config.ts and the site falls back to REST polling + simulator

CI rules

Use pnpm 9.12.1 and Node 20 with cache

No env-gated steps; builds must pass without secrets

Lint/typecheck must pass

Don’ts

Don’t add query params for other tickers

Don’t open direct provider connections from the browser

Don’t block UI waiting for network
