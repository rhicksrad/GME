# GME Radar agent guide

## Scope

You are an AI agent maintaining a static site that consumes a Cloudflare Worker proxy for Finnhub. Never add trading.

## Golden rules

- Never expose or embed API keys in client code.
- All market calls go through the Worker:
  - REST: `/finnhub/...`
  - WS: `/ws` with Finnhub-style subscribe frames
- Build must succeed without secrets. When in doubt, default to demo mode.
- Never break Pages deploy by introducing required env at build time.

## Runtime configuration

- `VITE_WORKER_ORIGIN` optional; default is same origin. Use it only at runtime via `new URL(path, VITE_WORKER_ORIGIN || location.origin)`.
- Symbol comes from `?symbol=`. Default GME.

## Data contract

- `/finnhub/quote` returns Finnhub quote JSON with keys `c,d,dp,h,l,o,pc,t`.
- `/finnhub/stock/candle` returns arrays `c,h,l,o,s,t,v`.
- WS messages mirror Finnhub: `{ type: "trade", data: [{ p, s, t, v }] }` and pings.
- Aggregation produces minute OHLC with fields `{ t, o, h, l, c, v }` rolling 390 bars.

## Error handling

- For REST 429 or 5xx, exponential backoff with jitter. Do not throw.
- For WS close or error, reconnect with backoff and resubscribe. Keep a single socket.
- If both REST and WS unavailable for 10s, switch to demo mode and show “DEMO” badge.

## Testing checklist

- Live path: price updates within 2–5s, no duplicate bars, no memory leak on hot reload.
- Demo path: charts render with sample data when Worker is unreachable.
- Accessibility: focusable status controls, sufficient contrast.

## CI rules

- Use pnpm 9.12.1 and Node 20 with cache.
- Build output in `dist`. No secret-gated steps.
- Lint and typecheck must pass.

## Don’ts

- Don’t scrape vendor endpoints directly from the browser.
- Don’t hardcode worker hostnames; use relative URLs or `VITE_WORKER_ORIGIN`.
- Don’t block UI on network calls. Always render.

## Playbook

- If quotes appear stale, confirm `nocache=1` is appended for `/quote`.
- If WS floods, debounce UI updates to 15 Hz and aggregate trades to bars.
- If deploy fails with “pnpm not found”, verify action order exactly as in this doc.

_End of agents.md._
