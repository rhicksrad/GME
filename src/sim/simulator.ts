import type { LiveConnection, Quote } from '../data/workerClient';
import type { MinuteBar, Trade, ConnectionState } from '../types';

interface DemoTrade {
  t: number;
  p: number;
  v: number;
}

interface DemoPayload {
  quote: Quote;
  candles: MinuteBar[];
  trades: DemoTrade[];
}

const SPEED_MULTIPLIER = 2;
const PING_INTERVAL = 15000;

let demoPromise: Promise<DemoPayload> | undefined;

function asset(path: string): string {
  const base = (import.meta.env.BASE_URL ?? '/') as string;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\//, '')}`;
}

async function loadDemo(): Promise<DemoPayload> {
  if (!demoPromise) {
    demoPromise = (async () => {
      const [quoteRes, candlesRes, tradesRes] = await Promise.all([
        fetch(asset('demo/quote.json')),
        fetch(asset('demo/candles.json')),
        fetch(asset('demo/trades.jsonl')),
      ]);
      if (!quoteRes.ok || !candlesRes.ok || !tradesRes.ok) {
        throw new Error('Demo assets missing');
      }
      const quote = (await quoteRes.json()) as Quote;
      const candleRaw = (await candlesRes.json()) as {
        t: number[];
        o: number[];
        h: number[];
        l: number[];
        c: number[];
        v: number[];
      };
      const candles: MinuteBar[] = candleRaw.t.map((ts, index) => ({
        t: ts * 1000,
        o: candleRaw.o[index],
        h: candleRaw.h[index],
        l: candleRaw.l[index],
        c: candleRaw.c[index],
        v: candleRaw.v[index],
      }));
      const tradesText = await tradesRes.text();
      const trades: DemoTrade[] = tradesText
        .trim()
        .split(/\n+/)
        .map((line) => JSON.parse(line) as DemoTrade)
        .map((trade) => ({ ...trade }));
      return { quote, candles, trades };
    })();
  }
  return demoPromise;
}

class SimulatorConnection implements LiveConnection {
  private readonly tradeHandlers = new Set<(trade: Trade) => void>();

  private readonly pingHandlers = new Set<() => void>();

  private readonly statusHandlers = new Set<(state: ConnectionState) => void>();

  private pointer = 0;

  private closeRequested = false;

  private playbackTimer: number | undefined;

  private pingTimer: number | undefined;

  constructor(private readonly payloadPromise: Promise<DemoPayload>) {
    this.emitStatus('connecting');
    void this.start();
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
    this.closeRequested = true;
    if (this.playbackTimer != null) {
      window.clearTimeout(this.playbackTimer);
    }
    if (this.pingTimer != null) {
      window.clearTimeout(this.pingTimer);
    }
    this.emitStatus('closed');
  }

  private async start() {
    const payload = await this.payloadPromise;
    if (this.closeRequested) {
      return;
    }
    this.emitStatus('connected');
    this.loop(payload.trades);
    this.schedulePing();
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

  private schedulePing() {
    if (this.closeRequested) {
      return;
    }
    this.pingTimer = window.setTimeout(() => {
      this.emitPing();
      this.schedulePing();
    }, PING_INTERVAL);
  }

  private loop(trades: DemoTrade[]) {
    if (this.closeRequested || trades.length === 0) {
      return;
    }
    const current = trades[this.pointer % trades.length];
    const next = trades[(this.pointer + 1) % trades.length];
    const trade: Trade = {
      price: current.p,
      volume: current.v,
      timestamp: Date.now(),
      symbol: 'GME',
    };
    this.emitTrade(trade);
    this.pointer += 1;
    const delta = Math.max((next.t - current.t) / SPEED_MULTIPLIER, 250);
    this.playbackTimer = window.setTimeout(() => this.loop(trades), delta);
  }
}

export async function fetchQuote(_symbol?: string): Promise<Quote> {
  void _symbol;
  const demo = await loadDemo();
  return demo.quote;
}

export async function fetchCandles(_symbol?: string): Promise<MinuteBar[]> {
  void _symbol;
  const demo = await loadDemo();
  return demo.candles;
}

export function connectLive(_symbol?: string): LiveConnection {
  void _symbol;
  return new SimulatorConnection(loadDemo());
}
