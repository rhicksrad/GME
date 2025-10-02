// src/ui/charts_uplot.ts
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

let u: uPlot | null = null;
const MAX_BARS = 390;
let pending = false;

export function mountUplot(host: HTMLElement) {
  if (u) return u;

  const opts: uPlot.Options = {
    width: host.clientWidth || 600,
    height: 320,
    series: [{}, { label: "GME" }],
    scales: { x: { time: true }, y: { auto: true } },
    axes: [{}, {}]
  };

  host.innerHTML = ""; // single mount
  u = new uPlot(opts, [[], []], host);

  // HMR cleanup
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (import.meta?.hot) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    import.meta.hot.dispose(() => { try { u?.destroy(); } finally { u = null; } });
  }
  return u;
}

export function updateUplot(ts: number[], close: number[]) {
  if (!u) return;
  if (ts.length > MAX_BARS) {
    ts = ts.slice(-MAX_BARS);
    close = close.slice(-MAX_BARS);
  }
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    u!.setData([ts, close], false);
    pending = false;
  });
}
