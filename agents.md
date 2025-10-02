Title: GME Radar agent guide (Phase 3)

What you’re maintaining

A static site that pulls live equities via a Cloudflare Worker proxy and builds options analytics without exposing secrets.

Providers:

Equities: /finnhub/* REST and /ws
Options primary: /poly/options/chain (server-injected key)
Options fallback: /yahoo/options (delayed)

Golden rules

Never embed API keys in browser code.
All HTTP calls go through the Worker; builds must succeed with zero secrets.
If any upstream is down/429, back off and keep UI rendering; prefer stale>blank.

Runtime config

VITE_WORKER_ORIGIN optional. Default to same origin.
Symbol comes from ?symbol=; default GME.

Data contracts

Quote: /finnhub/quote → {c,d,dp,h,l,o,pc,t}
Candles: /finnhub/stock/candle → arrays {c,h,l,o,s,t,v}
Options chain normalized row:

{ ts, exp, type, strike, bid?, ask?, last?, mid?, volume?, openInterest?, iv? }

Aggregations:

Expiry totals: calls/puts volume, OI
Moneyness matrix: deep ITM/ITM/ATM/OTM/deep OTM vs spot
Alerts emitted with payload and source contract IDs

Error handling playbook

REST 429/5xx: exponential backoff with jitter, cap 30s
Polygon 501/no key: switch to Yahoo fallback
If both options sources fail: switch to demo data and show “DELAYED/DEMO” badge

CI rules

pnpm 9.12.1; Node 20; cache pnpm
No env required at build; never gate build on provider availability
Lint/typecheck must pass

Common pitfalls

Missing nocache=1 on /finnhub/quote yields stale quotes
Multiple WS connections after hot-reload; ensure cleanup
Large JSON inlined by bundler; keep demo data in public/

Verification checklist

Heatmap updates at most every 30–60s; alerts roll in without jank
Refresh keeps last known symbol and baselines
Worker returns CORS-enabled JSON for both providers

End agents.md.
