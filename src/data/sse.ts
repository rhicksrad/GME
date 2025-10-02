// src/data/sse.ts
let singleton: EventSource | null = (globalThis as any).__GME_SSE || null;

export function connectSSE(origin = ""): EventSource {
  if (singleton) return singleton;
  const base = origin || (typeof location !== "undefined" ? location.origin : "");
  const es = new EventSource(new URL("/sse/alerts", base).toString(), { withCredentials: false });
  (globalThis as any).__GME_SSE = es;

  // Hot-reload cleanup to avoid duplicate streams during dev
  // (Vite HMR calls dispose on module replacement)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (import.meta?.hot) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    import.meta.hot.dispose(() => {
      try { es.close(); } catch {}
      (globalThis as any).__GME_SSE = null;
      singleton = null;
    });
  }
  singleton = es;
  return es;
}
