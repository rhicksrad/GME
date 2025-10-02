// src/data/poll.ts
type TickFn = () => void;

type IntervalHandle = ReturnType<typeof setInterval>;

type GlobalWithIntervals = typeof globalThis & {
  __GME_INTERVALS__?: Map<string, IntervalHandle>;
};

const globalWithIntervals = globalThis as GlobalWithIntervals;

function getIntervalStore(): Map<string, IntervalHandle> {
  if (!globalWithIntervals.__GME_INTERVALS__) {
    globalWithIntervals.__GME_INTERVALS__ = new Map();
  }
  return globalWithIntervals.__GME_INTERVALS__;
}

export function ensureInterval(key: string, ms: number, fn: TickFn): IntervalHandle {
  const store = getIntervalStore();
  const existing = store.get(key);
  if (existing) return existing;

  const id = setInterval(fn, ms);
  store.set(key, id);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      const handle = store.get(key);
      if (handle) {
        clearInterval(handle);
        store.delete(key);
      }
    });
  }

  return id;
}
