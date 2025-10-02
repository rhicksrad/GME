import type { OptionContractSnapshot, OptionSnapshot } from '../types';

interface PolygonPollerOptions {
  apiKey: string;
  intervalMs?: number;
  throttleMs?: number;
  onSnapshot: (snapshot: OptionSnapshot) => void;
  onError?: (message: string) => void;
  resolveSpotPrice: () => number | undefined;
}

const BASE_URL = 'https://api.polygon.io';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseContract(raw: unknown): OptionContractSnapshot | null {
  const container = asRecord(raw);
  if (!container) {
    return null;
  }

  const details = asRecord(container.details) ?? container;
  const lastQuote = asRecord(container.lastQuote) ?? asRecord(container.quote) ?? {};
  const day = asRecord(container.day) ?? asRecord(container.todaysAgg) ?? {};
  const greeks = asRecord(container.greeks) ?? {};
  const openInterest = asRecord(container.openInterest) ?? {};
  const ticker = (details.ticker ?? details.symbol ?? container.ticker) as string | undefined;
  const expiration = (details.expirationDate ?? details.expiration ?? container.expiration) as string | undefined;
  const strike = Number(details.strikePrice ?? container.strike ?? container.strikePrice);
  if (!ticker || Number.isNaN(strike) || !expiration) {
    return null;
  }

  const typeDescriptor = (details.contractType ?? details.type ?? (ticker?.slice(-1) ?? '')) as string;
  const type: 'call' | 'put' = typeDescriptor.toLowerCase() === 'c' ? 'call' : 'put';

  const bid = typeof lastQuote.bid === 'number' ? lastQuote.bid : Number(lastQuote.p ?? lastQuote.bidPrice ?? lastQuote.bid ?? lastQuote.b);
  const ask = typeof lastQuote.ask === 'number' ? lastQuote.ask : Number(lastQuote.a ?? lastQuote.askPrice ?? lastQuote.ask ?? lastQuote.ask ?? 0);
  const mid = typeof lastQuote.mid === 'number' ? lastQuote.mid : bid && ask ? (bid + ask) / 2 : undefined;
  const lastTrade = asRecord(container.lastTrade) ?? asRecord(container.last) ?? {};

  return {
    ts: Number(lastTrade.timestamp ?? lastQuote.timestamp ?? container.updated ?? Date.now()),
    occ: ticker,
    type,
    strike,
    exp: expiration,
    bid: Number.isFinite(bid) ? bid : undefined,
    ask: Number.isFinite(ask) ? ask : undefined,
    mid: Number.isFinite(mid) ? mid : undefined,
    last: typeof lastTrade.price === 'number' ? lastTrade.price : Number(lastTrade.p ?? raw.price ?? mid ?? bid ?? ask ?? 0),
    volume: typeof day.volume === 'number' ? day.volume : Number(day.volume ?? raw.volume ?? 0),
    avg30Volume: typeof day.volumeAverage === 'number' ? day.volumeAverage : Number(day.volumeAverage ?? raw.avgVolume ?? raw.avg_vol ?? undefined),
    openInterest:
      typeof openInterest.value === 'number'
        ? openInterest.value
        : Number(openInterest.value ?? openInterest.oi ?? raw.openInterest ?? raw.open_interest ?? undefined),
    previousOpenInterest: typeof openInterest.prevDay === 'number' ? openInterest.prevDay : undefined,
    iv:
      typeof greeks.impliedVolatility === 'number'
        ? greeks.impliedVolatility
        : Number(container.impliedVolatility ?? container.iv ?? undefined),
    iv30Median: typeof container.iv30Median === 'number' ? (container.iv30Median as number) : undefined,
    iv30Stdev: typeof container.iv30Stdev === 'number' ? (container.iv30Stdev as number) : undefined,
    lastTradePrice: typeof lastTrade.price === 'number' ? lastTrade.price : undefined,
    lastTradeSize: typeof lastTrade.size === 'number' ? lastTrade.size : undefined,
    lastTradeTs: typeof lastTrade.timestamp === 'number' ? lastTrade.timestamp : undefined
  };
}

async function fetchChainSnapshot(apiKey: string): Promise<OptionSnapshot | null> {
  try {
    const url = new URL('/v3/snapshot/options/GME', BASE_URL);
    url.searchParams.set('limit', '250');
    url.searchParams.set('apiKey', apiKey);

    const response = await fetch(url.toString());
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const waitSeconds = Number(retryAfter);
        if (!Number.isNaN(waitSeconds)) {
          await sleep(waitSeconds * 1000);
        }
      }
      return null;
    }

    if (!response.ok) {
      console.warn('Polygon snapshot error', response.status);
      return null;
    }

    const payload: unknown = await response.json();
    const root = asRecord(payload) ?? {};
    const container =
      asRecord(root.data) ??
      asRecord(root.results) ??
      root;
    const optionsSource =
      (Array.isArray(container.options) ? container.options : undefined) ??
      (Array.isArray(container.data) ? container.data : undefined) ??
      (Array.isArray(container.results) ? container.results : undefined) ??
      [];
    const optionsArray: unknown[] = optionsSource;
    const underlying = asRecord(container.underlying) ?? asRecord(container.underlyingAsset) ?? {};
    const spot = Number(
      underlying.lastTrade?.price ??
        underlying.last?.price ??
        underlying.lastQuote?.mid ??
        underlying.price ??
        container.underlyingPrice ??
        container.lastUnderlyingPrice
    );

    const contracts: OptionContractSnapshot[] = [];
    for (const raw of optionsArray) {
      const parsed = parseContract(raw);
      if (parsed) {
        contracts.push(parsed);
      }
    }

    if (contracts.length === 0) {
      return null;
    }

    return {
      ts: Date.now(),
      spot: Number.isFinite(spot) ? spot : contracts[0]?.last ?? contracts[0]?.mid ?? 0,
      contracts
    };
  } catch (error) {
    console.error('Polygon snapshot fetch failed', error);
    return null;
  }
}

export function createPolygonPoller({
  apiKey,
  intervalMs = 30_000,
  throttleMs = 2_000,
  onSnapshot,
  onError,
  resolveSpotPrice
}: PolygonPollerOptions) {
  let running = false;
  let nextAllowed = 0;
  let timer: number | undefined;

  const schedule = (delay: number) => {
    if (timer) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(tick, delay);
  };

  const tick = async () => {
    if (!running) {
      return;
    }
    const now = Date.now();
    const wait = Math.max(0, nextAllowed - now);
    if (wait > 0) {
      await sleep(wait);
    }
    nextAllowed = Date.now() + throttleMs;
    const snapshot = await fetchChainSnapshot(apiKey);
    if (snapshot) {
      if (!Number.isFinite(snapshot.spot)) {
        const spot = resolveSpotPrice();
        if (spot) {
          snapshot.spot = spot;
        }
      }
      onSnapshot(snapshot);
      schedule(intervalMs);
    } else {
      onError?.('Polygon snapshot unavailable, retrying with backoff');
      schedule(Math.min(intervalMs * 2, 90_000));
    }
  };

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      schedule(0);
    },
    stop() {
      running = false;
      if (timer) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    }
  };
}
