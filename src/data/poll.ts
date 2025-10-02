// src/data/poll.ts
type TickFn = () => void;

export function ensureInterval(key: string, ms: number, fn: TickFn) {
  const g = globalThis as any;
  if (g[key]) return g[key] as number;
  const id = setInterval(fn, ms) as unknown as number;
  g[key] = id;

  // HMR cleanup
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (import.meta?.hot) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    import.meta.hot.dispose(() => clearInterval(g[key]));
  }
  return id;
}
