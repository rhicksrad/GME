import { getWorkerOrigin } from '../config';
import type { ConnectionState, Trade } from '../types';

export interface Quote {
  c: number; // current price
  d: number; // change
  dp: number; // percent change
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number; // epoch seconds
}

export interface Candle {
  t: number; // epoch seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface CandleResponse {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  s: 'ok' | 'no_data';
  t: number[];
  v: number[];
}

export interface LiveConnection {
  onTrade(handler: (trade: Trade) => void): () => void;
  onPing(handler: () => void): () => void;
  onStatus(handler: (state: ConnectionState) => void): () => void;
  close(): void;
}

function createWsUrl(): string {
  const origin = getWorkerOrigin();
  const target = origin || window.location.origin;
  const url = new URL('/ws', target);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export async function fetchQuote(symbol: string, signal?: AbortSignal): Promise<Quote> {
  const url = new URL('/finnhub/quote', getWorkerOrigin() || window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('nocache', '1');
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Quote request failed (${response.status})`);
    throw Object.assign(error, { status: response.status });
  }
  return (await response.json()) as Quote;
}

export async function fetchCandles(
  symbol: string,
  from: number,
  to: number,
  resolution: '1',
  signal?: AbortSignal,
): Promise<Candle[]> {
  const url = new URL('/finnhub/stock/candle', getWorkerOrigin() || window.location.origin);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('resolution', resolution);
  url.searchParams.set('from', Math.floor(from / 1000).toString());
  url.searchParams.set('to', Math.floor(to / 1000).toString());
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    const error = new Error(`Candle request failed (${response.status})`);
    throw Object.assign(error, { status: response.status });
  }
  const payload = (await response.json()) as CandleResponse;
  if (payload.s !== 'ok') {
    return [];
  }
  const candles: Candle[] = payload.t.map((t, index) => ({
    t,
    o: payload.o[index],
    h: payload.h[index],
    l: payload.l[index],
    c: payload.c[index],
    v: payload.v[index],
  }));
  return candles;
}

class WorkerLiveConnection implements LiveConnection {
  private ws: WebSocket | undefined;

  private readonly tradeHandlers = new Set<(trade: Trade) => void>();

  private readonly pingHandlers = new Set<() => void>();

  private readonly statusHandlers = new Set<(state: ConnectionState) => void>();

  private attempt = 0;

  private closed = false;

  private readonly heartbeatMs: number;

  private heartbeatTimer: number | undefined;

  private readonly symbol: string;

  constructor(symbol: string, heartbeatMs = 15000) {
    this.symbol = symbol;
    this.heartbeatMs = heartbeatMs;
    this.open();
  }

  onTrade(handler: (trade: Trade) => void): () => void {
    this.tradeHandlers.add(handler);
    return () => this.tradeHandlers.delete(handler);
  }

  onPing(handler: () => void): () => void {
    this.pingHandlers.add(handler);
    return () => this.pingHandlers.delete(handler);
  }

  onStatus(handler: (state: ConnectionState) => void): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  close(): void {
    this.closed = true;
    this.clearHeartbeat();
    this.ws?.close();
  }

  private emitStatus(state: ConnectionState) {
    this.statusHandlers.forEach((handler) => handler(state));
  }

  private emitPing() {
    this.pingHandlers.forEach((handler) => handler());
  }

  private emitTrade(trade: Trade) {
    this.tradeHandlers.forEach((handler) => handler(trade));
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer != null) {
      window.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private scheduleHeartbeat() {
    this.clearHeartbeat();
    if (this.heartbeatMs <= 0) {
      return;
    }
    this.heartbeatTimer = window.setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // ignore send failures – reconnect logic handles it.
        }
        this.scheduleHeartbeat();
      }
    }, this.heartbeatMs);
  }

  private open() {
    if (this.closed) {
      return;
    }
    this.emitStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const url = createWsUrl();
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.attempt = 0;
      this.emitStatus('connected');
      this.scheduleHeartbeat();
      const frame = JSON.stringify({ type: 'subscribe', symbol: this.symbol });
      this.ws?.send(frame);
    });

    const handleClose = () => {
      this.clearHeartbeat();
      if (this.closed) {
        this.emitStatus('closed');
        return;
      }
      this.emitStatus('reconnecting');
      this.reconnect();
    };

    this.ws.addEventListener('close', handleClose);
    this.ws.addEventListener('error', handleClose);

    this.ws.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        if (payload.type === 'ping') {
          this.emitPing();
          return;
        }
        if (payload.type === 'trade' && Array.isArray(payload.data)) {
          for (const item of payload.data) {
            if (item && typeof item.p === 'number' && typeof item.v === 'number' && typeof item.t === 'number') {
              this.emitTrade({
                price: item.p,
                volume: item.v,
                timestamp: item.t,
                symbol: item.s ?? this.symbol,
              });
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    });
  }

  private reconnect() {
    if (this.closed) {
      return;
    }
    this.attempt += 1;
    const base = Math.min(1000 * 2 ** (this.attempt - 1), 30000);
    const jitter = base * 0.3 * Math.random();
    window.setTimeout(() => this.open(), base + jitter);
  }
}

export function connectLive(symbol: string): LiveConnection {
  return new WorkerLiveConnection(symbol);
}

