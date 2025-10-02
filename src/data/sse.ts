// src/data/sse.ts
type GlobalWithSSE = typeof globalThis & {
  __GME_SSE?: EventSource | null;
};

const globalWithSSE = globalThis as GlobalWithSSE;

let singleton: EventSource | null = globalWithSSE.__GME_SSE ?? null;

export function connectSSE(origin = ""): EventSource {
  if (singleton) return singleton;

  const base = origin || (typeof location !== "undefined" ? location.origin : "");
  const es = new EventSource(new URL("/sse/alerts", base).toString(), { withCredentials: false });
  globalWithSSE.__GME_SSE = es;

  // Hot-reload cleanup to avoid duplicate streams during dev
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      es.close();
      globalWithSSE.__GME_SSE = null;
      singleton = null;
    });
  }

  singleton = es;
  return es;
}
