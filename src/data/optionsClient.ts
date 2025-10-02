import { features, wurl } from '../config';
import type { EndpointStatus } from './features';

export interface OptRow {
  ts: number;
  exp: string;
  type: 'C' | 'P';
  strike: number;
  bid?: number;
  ask?: number;
  last?: number;
  mid?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
}

export interface OptionsMeta {
  source: 'polygon' | 'yahoo' | 'demo' | 'unknown';
  delayed?: boolean;
  error?: string;
  status?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface OptionsResponse {
  rows: OptRow[];
  meta: OptionsMeta;
}

interface RequestResult {
  ok: boolean;
  status: number;
  payload?: OptionsResponse;
  error?: string;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE = 500;

export async function fetchChain(symbol: string): Promise<OptionsResponse> {
  const polyResult = await requestChain(`/poly/options/chain?underlying=${encodeURIComponent(symbol)}`);
  if (polyResult.ok && polyResult.payload) {
    const meta: OptionsMeta = {
      ...(polyResult.payload.meta ?? {}),
      source: 'polygon',
    };
    return { rows: polyResult.payload.rows, meta };
  }

  if (polyResult.status !== 501 && polyResult.status !== 0 && polyResult.status < 500 && polyResult.status !== 429) {
    // Non-retriable error, but still attempt fallback to keep demo behaviour consistent.
  }

  const yahooResult = await requestChain(`/yahoo/options?symbol=${encodeURIComponent(symbol)}`);
  if (yahooResult.ok && yahooResult.payload) {
    const meta: OptionsMeta = {
      ...(yahooResult.payload.meta ?? {}),
      source: 'yahoo',
      delayed: true,
    };
    return { rows: yahooResult.payload.rows, meta };
  }

  if (features.demoOptionsFallback) {
    const demo = await loadDemoOptions(symbol);
    if (demo) {
      return demo;
    }
  }

  const error = yahooResult.error ?? polyResult.error ?? 'Options data unavailable';
  return {
    rows: [],
    meta: {
      source: yahooResult.ok ? 'yahoo' : polyResult.ok ? 'polygon' : 'unknown',
      delayed: yahooResult.ok ? true : undefined,
      error,
      status: yahooResult.status || polyResult.status,
    },
  };
}

export async function fetchDailyOI(): Promise<OptionsResponse> {
  // Placeholder: worker endpoint can supply dedicated daily OI snapshots in the future.
  return { rows: [], meta: { source: 'unknown' } };
}

async function requestChain(path: string): Promise<RequestResult> {
  const url = wurl(path);
  let lastError: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const payload = await parsePayload(response);
        return { ok: true, status: response.status, payload };
      }
      if (response.status === 429 || response.status >= 500) {
        const delay = withJitter(RETRY_BASE * 2 ** attempt);
        await sleep(delay);
        continue;
      }
      const message = `Request failed (${response.status})`;
      return { ok: false, status: response.status, error: message };
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Network error';
      const delay = withJitter(RETRY_BASE * 2 ** attempt);
      await sleep(delay);
    }
  }
  return { ok: false, status: 0, error: lastError ?? 'Request failed' };
}

let demoOptionsPromise: Promise<OptionsResponse | null> | null = null;

export async function probeOptionsAvailability(symbol: string): Promise<EndpointStatus> {
  const url = wurl(`/poly/options/chain?underlying=${encodeURIComponent(symbol)}`);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        // ignore cancel failures – this is a best-effort probe.
      }
    }
    if (response.status === 403 || response.status === 401 || response.status === 404) {
      return { ok: false, status: response.status };
    }
    if (response.status === 429) {
      return { ok: true, status: response.status };
    }
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function asset(path: string): string {
  const base = (import.meta.env.BASE_URL ?? '/') as string;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}${path.replace(/^\//, '')}`;
}

async function loadDemoOptions(symbol: string): Promise<OptionsResponse | null> {
  if (symbol.toUpperCase() !== 'GME') {
    return null;
  }
  if (!demoOptionsPromise) {
    demoOptionsPromise = (async () => {
      try {
        const response = await fetch(asset('demo/options.json'), {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          return null;
        }
        const payload = (await response.json()) as {
          rows?: OptRow[];
          meta?: OptionsMeta;
        };
        const rows = Array.isArray(payload.rows)
          ? payload.rows.map(normalizeRow).filter(Boolean) as OptRow[]
          : [];
        if (rows.length === 0) {
          return null;
        }
        const meta: OptionsMeta = {
          source: 'demo',
          ...payload.meta,
          delayed: payload.meta?.delayed ?? true,
        };
        return { rows, meta };
      } catch {
        return null;
      }
    })();
  }
  return demoOptionsPromise;
}

async function parsePayload(response: Response): Promise<OptionsResponse> {
  try {
    const json = (await response.json()) as Partial<OptionsResponse> & { rows?: OptRow[]; meta?: OptionsMeta };
    const rows = Array.isArray(json.rows) ? json.rows.map(normalizeRow).filter(Boolean) as OptRow[] : [];
    const meta: OptionsMeta = {
      source: json.meta?.source as OptionsMeta['source'] ?? 'unknown',
      ...json.meta,
    };
    return { rows, meta };
  } catch {
    return {
      rows: [],
      meta: { source: 'unknown', error: 'Invalid payload' },
    };
  }
}

function normalizeRow(input: OptRow | undefined): OptRow | undefined {
  if (!input) {
    return undefined;
  }
  const type = input.type === 'P' ? 'P' : 'C';
  const ts = typeof input.ts === 'number' ? input.ts : Date.now();
  const strike = Number.isFinite(input.strike) ? Number(input.strike) : NaN;
  if (!Number.isFinite(strike)) {
    return undefined;
  }
  const bid = sanitizeNumber(input.bid);
  const ask = sanitizeNumber(input.ask);
  const mid = sanitizeNumber(input.mid) ?? computeMid(bid, ask, sanitizeNumber(input.last));
  return {
    ts,
    exp: input.exp,
    type,
    strike,
    bid,
    ask,
    last: sanitizeNumber(input.last),
    mid,
    volume: sanitizeNumber(input.volume),
    openInterest: sanitizeNumber(input.openInterest),
    iv: sanitizeNumber(input.iv),
  };
}

function sanitizeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  return Number.isFinite(value) ? value : undefined;
}

function computeMid(bid?: number, ask?: number, last?: number): number | undefined {
  if (bid != null && ask != null) {
    return (bid + ask) / 2;
  }
  if (last != null) {
    return last;
  }
  return bid ?? ask ?? undefined;
}

function withJitter(base: number): number {
  const jitter = Math.random() * base * 0.25;
  return Math.min(30_000, base + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
