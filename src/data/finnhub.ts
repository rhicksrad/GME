import type { ConnectionState, MinuteBar, PriceTick } from '../types';

interface FinnhubClientOptions {
  token: string;
  symbol?: string;
  onTick: (tick: PriceTick) => void;
  onMinuteBar: (bar: MinuteBar) => void;
  onStatus?: (state: ConnectionState) => void;
  onError?: (error: string) => void;
}

const BASE_URL = 'wss://ws.finnhub.io';
const HEARTBEAT_MS = 20_000;
const INACTIVITY_MS = 30_000;

function withJitter(delay: number): number {
  const jitter = delay * 0.2;
  return delay - jitter + Math.random() * jitter * 2;
}

export function createFinnhubClient({
  token,
  symbol = 'GME',
  onTick,
  onMinuteBar,
  onStatus,
  onError
}: FinnhubClientOptions) {
  let ws: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let heartbeatTimer: number | undefined;
  let inactivityTimer: number | undefined;
  let attempt = 0;
  let active = false;
  let lastMessageAt = Date.now();

  const updateStatus = (state: ConnectionState) => {
    onStatus?.(state);
  };

  const cleanupTimers = () => {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    if (inactivityTimer) {
      window.clearInterval(inactivityTimer);
      inactivityTimer = undefined;
    }
  };

  const closeSocket = () => {
    if (ws) {
      ws.removeEventListener('open', handleOpen);
      ws.removeEventListener('message', handleMessage);
      ws.removeEventListener('close', handleClose);
      ws.removeEventListener('error', handleError);
      ws.close();
      ws = null;
    }
  };

  const scheduleReconnect = () => {
    cleanupTimers();
    closeSocket();
    if (!active) {
      return;
    }
    attempt += 1;
    const baseDelay = Math.min(30_000, 1000 * 2 ** (attempt - 1));
    const delay = withJitter(baseDelay);
    updateStatus('reconnecting');
    reconnectTimer = window.setTimeout(connect, delay);
  };

  const sendSubscribe = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const messages = [
      { type: 'subscribe', symbol },
      { type: 'subscribe', symbol: `${symbol}`, resolution: '1' }
    ];
    for (const message of messages) {
      ws.send(JSON.stringify(message));
    }
  };

  const handleOpen = () => {
    attempt = 0;
    updateStatus('connected');
    sendSubscribe();
    heartbeatTimer = window.setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_MS);
    inactivityTimer = window.setInterval(() => {
      if (Date.now() - lastMessageAt > INACTIVITY_MS) {
        scheduleReconnect();
      }
    }, 5_000);
  };

  const parseTrade = (payload: unknown): void => {
    if (!Array.isArray(payload)) {
      return;
    }
    for (const trade of payload) {
      if (
        typeof trade !== 'object' ||
        trade === null ||
        typeof (trade as { p?: unknown }).p !== 'number' ||
        typeof (trade as { t?: unknown }).t !== 'number'
      ) {
        continue;
      }
      const typedTrade = trade as { p: number; t: number; v?: unknown; vw?: unknown };
      const tick: PriceTick = {
        ts: typedTrade.t,
        lastPrice: typedTrade.p,
        lastSize: typeof typedTrade.v === 'number' ? typedTrade.v : 0,
        volume: typeof typedTrade.v === 'number' ? typedTrade.v : undefined,
        vwap: typeof typedTrade.vw === 'number' ? typedTrade.vw : undefined
      };
      onTick(tick);
    }
  };

  const parseCandle = (payload: unknown): void => {
    if (typeof payload !== 'object' || payload === null) {
      return;
    }
    const typed = payload as {
      t?: unknown;
      o?: unknown;
      h?: unknown;
      l?: unknown;
      c?: unknown;
      v?: unknown;
      vw?: unknown;
    };
    if (typeof typed.t !== 'number') {
      return;
    }
    const bar: MinuteBar = {
      ts: typed.t,
      open: Number(typed.o ?? typed.c ?? 0),
      high: Number(typed.h ?? typed.c ?? 0),
      low: Number(typed.l ?? typed.c ?? 0),
      close: Number(typed.c ?? typed.o ?? 0),
      volume: Number(typed.v ?? 0),
      vwap: typeof typed.vw === 'number' ? typed.vw : undefined
    };
    onMinuteBar(bar);
  };

  const handleMessage = (event: MessageEvent<string>) => {
    lastMessageAt = Date.now();
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'trade') {
        parseTrade(payload.data);
      } else if (payload.type === 'candle') {
        parseCandle(payload.data);
      }
    } catch (error) {
      onError?.(`Finnhub message parse error: ${(error as Error).message}`);
    }
  };

  const handleClose = () => {
    updateStatus('disconnected');
    scheduleReconnect();
  };

  const handleError = (event: Event) => {
    onError?.('Finnhub WebSocket error');
    if ((event as ErrorEvent).message) {
      onError?.((event as ErrorEvent).message);
    }
  };

  const connect = () => {
    if (!active) {
      return;
    }
    cleanupTimers();
    closeSocket();
    updateStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    ws = new WebSocket(`${BASE_URL}?token=${token}`);
    ws.addEventListener('open', handleOpen);
    ws.addEventListener('message', handleMessage);
    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', handleError);
  };

  return {
    start() {
      if (active) {
        return;
      }
      active = true;
      connect();
    },
    stop() {
      active = false;
      cleanupTimers();
      closeSocket();
      updateStatus('disconnected');
    }
  };
}
