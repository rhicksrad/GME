// src/main.ts
import { Bars } from "./data/ohlc";
import { connectSSE } from "./data/sse";
// If using Chart.js:
// import { mountPriceChart, updatePriceChart } from "./ui/charts";
// If using uPlot, comment the two lines above and use these instead:
import { mountUplot as mountPriceChart, updateUplot as updatePriceChart } from "./ui/charts_uplot";

const bars = new Bars();
bars.setCap(390);

function boot() {
  const host = document.getElementById("price-host")!;
  mountPriceChart(host);

  // Backfill once (optional): replace with your backfill call
  // backfillBars().then(arr => arr.forEach(b => bars.applyBackfill(b)));

  const es = connectSSE();

  es.addEventListener("message", (ev) => {
    // Generic EventSource handler: parse and route by 'type'
    try {
      const msg = JSON.parse((ev as MessageEvent).data);
      if (msg?.type === "bar") {
        const b = msg.payload as { t:number;o:number;h:number;l:number;c:number;v:number };
        bars.applyBackfill(b);
      } else if (msg?.type === "quote") {
        // optionally update header UI
      } else if (msg?.type === "trade") {
        // if you stream trades, aggregate into minute bar
        const d = msg.data?.[0];
        if (d && typeof d.p === "number" && typeof d.t === "number") {
          bars.upsertFromTrade(d.t, d.p, Number(d.v || 0));
        }
      }
      const arr = bars.arrays();
      updatePriceChart(arr.t, arr.c);
    } catch { /* ignore bad frames */ }
  });

  // HMR: close before replace
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (import.meta?.hot) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    import.meta.hot.dispose(() => { try { es.close(); } catch {} });
  }
}

boot();
