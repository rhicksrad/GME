interface Env {
  FINNHUB_KEY?: string;
  POLYGON_KEY?: string;
}

interface OptRow {
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

const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*,content-type',
  'access-control-allow-methods': 'GET,OPTIONS',
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith('/finnhub/quote')) {
        return handleFinnhub(request, env, '/quote');
      }
      if (path.startsWith('/finnhub/stock/candle')) {
        return handleFinnhub(request, env, '/stock/candle');
      }
      if (path === '/poly/options/chain') {
        return handlePolygonOptions(url, env);
      }
      if (path === '/yahoo/options') {
        return handleYahooOptions(url);
      }
      if (path === '/ws') {
        return handleWebsocket(request, env, ctx);
      }
      if (path === '/sse/alerts') {
        return handleSseAlerts();
      }
      return json({ error: 'Not found' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unhandled error';
      return json({ error: message }, 500);
    }
  },
};

async function handleFinnhub(request: Request, env: Env, resource: string): Promise<Response> {
  if (!env.FINNHUB_KEY) {
    return json({ error: 'FINNHUB_KEY unavailable' }, 501);
  }
  const url = new URL(`https://finnhub.io/api/v1${resource}`);
  const requestUrl = new URL(request.url);
  requestUrl.searchParams.forEach((value, key) => {
    if (key !== 'token') {
      url.searchParams.set(key, value);
    }
  });
  url.searchParams.set('token', env.FINNHUB_KEY);
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  return passthroughJson(response);
}

async function handlePolygonOptions(url: URL, env: Env): Promise<Response> {
  const symbol = url.searchParams.get('underlying');
  if (!symbol) {
    return json({ rows: [], meta: { source: 'polygon', error: 'Missing underlying' } }, 400);
  }
  if (!env.POLYGON_KEY) {
    return json({ rows: [], meta: { source: 'polygon', error: 'Polygon key unavailable' } }, 501);
  }
  const upstream = new URL(`https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(symbol)}`);
  upstream.searchParams.set('limit', '1000');
  upstream.searchParams.set('include_greeks', 'false');
  const response = await fetch(upstream.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${env.POLYGON_KEY}`,
    },
  });
  if (response.status === 429) {
    return json({ rows: [], meta: { source: 'polygon', error: 'Rate limited', status: 429 } }, 429);
  }
  if (!response.ok) {
    return json({ rows: [], meta: { source: 'polygon', error: `Polygon error ${response.status}` } }, response.status);
  }
  const payload = (await response.json()) as { results?: PolygonResult[] };
  const ts = Date.now();
  const rows = (payload.results ?? []).flatMap((result) => normalizePolygon(result, ts)).filter((row): row is OptRow => Boolean(row));
  return json({ rows, meta: { source: 'polygon', updatedAt: ts } });
}

async function handleYahooOptions(url: URL): Promise<Response> {
  const symbol = url.searchParams.get('symbol');
  if (!symbol) {
    return json({ rows: [], meta: { source: 'yahoo', error: 'Missing symbol', delayed: true } }, 400);
  }
  const upstream = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`);
  const response = await fetch(upstream.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GME-Radar/1.0',
    },
    cf: {
      cacheTtl: 45,
      cacheEverything: true,
    },
  });
  if (!response.ok) {
    return json({ rows: [], meta: { source: 'yahoo', error: `Yahoo error ${response.status}`, delayed: true } }, response.status);
  }
  const data = (await response.json()) as YahooResponse;
  const ts = Date.now();
  const rows = extractYahooRows(data, ts);
  return json({ rows, meta: { source: 'yahoo', delayed: true, updatedAt: ts } });
}

function handleWebsocket(request: Request, env: Env, ctx: ExecutionContext): Response {
  if (!env.FINNHUB_KEY) {
    return json({ error: 'FINNHUB_KEY unavailable' }, 501);
  }
  const { 0: client, 1: server } = new WebSocketPair();
  const upstreamUrl = new URL('wss://ws.finnhub.io');
  upstreamUrl.searchParams.set('token', env.FINNHUB_KEY);
  const upstream = new WebSocket(upstreamUrl.toString());

  server.accept();

  upstream.addEventListener('message', (event) => {
    try {
      server.send(event.data);
    } catch {
      // ignored
    }
  });
  upstream.addEventListener('close', () => server.close());
  upstream.addEventListener('error', () => server.close());

  server.addEventListener('message', (event) => {
    try {
      upstream.send(event.data);
    } catch {
      // ignored
    }
  });
  server.addEventListener('close', () => upstream.close());
  server.addEventListener('error', () => upstream.close());

  ctx.waitUntil(
    (async () => {
      try {
        await new Promise((resolve) => {
          upstream.addEventListener('close', resolve, { once: true });
        });
      } finally {
        upstream.close();
      }
    })(),
  );

  return new Response(null, { status: 101, webSocket: client });
}

function handleSseAlerts(): Response {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: unknown) => {
        const frame = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };
      controller.enqueue(encoder.encode(':ok\n\n'));
      send({ type: 'heartbeat', ts: Date.now() });
      interval = setInterval(() => {
        send({ type: 'heartbeat', ts: Date.now() });
      }, 15000);
    },
    cancel() {
      if (interval !== undefined) {
        clearInterval(interval);
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    },
  });
}

function normalizePolygon(result: PolygonResult, fallbackTs: number): OptRow | null {
  const exp = (result.details?.expiration_date ?? '').slice(0, 10);
  if (!exp) {
    return null;
  }
  const strike = Number(result.details?.strike_price ?? result.strike_price ?? 0);
  if (!Number.isFinite(strike)) {
    return null;
  }
  const type: 'C' | 'P' = result.details?.contract_type?.toUpperCase() === 'PUT' ? 'P' : 'C';
  const bid = result.last_quote?.bid ?? undefined;
  const ask = result.last_quote?.ask ?? undefined;
  const last = result.last_trade?.price ?? undefined;
  const volume = result.day?.volume ?? result.volume ?? undefined;
  const openInterest = result.open_interest ?? result.open_interest_change ?? undefined;
  const iv = result.implied_volatility ?? result.greeks?.implied_volatility ?? undefined;
  const ts = normalizeTimestamp(result.updated, fallbackTs);
  return {
    ts,
    exp,
    type,
    strike,
    bid,
    ask,
    last,
    volume,
    openInterest,
    iv,
  };
}

function extractYahooRows(response: YahooResponse, ts: number): OptRow[] {
  const result = response.optionChain?.result?.[0];
  if (!result) {
    return [];
  }
  const rows: OptRow[] = [];
  const options = result.options ?? [];
  options.forEach((option) => {
    const exp = option.expirationDate ? new Date(option.expirationDate * 1000).toISOString().slice(0, 10) : undefined;
    if (!exp) {
      return;
    }
    for (const call of option.calls ?? []) {
      rows.push(normalizeYahooContract(call, exp, 'C', ts));
    }
    for (const put of option.puts ?? []) {
      rows.push(normalizeYahooContract(put, exp, 'P', ts));
    }
  });
  return rows.filter((row) => row.strike > 0);
}

function normalizeYahooContract(contract: YahooContract, exp: string, type: 'C' | 'P', ts: number): OptRow {
  const strike = Number(contract.strike ?? 0);
  const bid = numberOrUndefined(contract.bid);
  const ask = numberOrUndefined(contract.ask);
  const last = numberOrUndefined(contract.lastPrice);
  const volume = numberOrUndefined(contract.volume);
  const openInterest = numberOrUndefined(contract.openInterest);
  const iv = numberOrUndefined(contract.impliedVolatility);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : undefined;
  return {
    ts,
    exp,
    type,
    strike,
    bid,
    ask,
    last,
    mid,
    volume,
    openInterest,
    iv,
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value !== 'number') {
    return undefined;
  }
  return Number.isFinite(value) ? value : undefined;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

async function passthroughJson(response: Response): Promise<Response> {
  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: JSON_HEADERS,
  });
}

interface PolygonResult {
  updated?: number | string;
  strike_price?: number;
  volume?: number;
  open_interest?: number;
  open_interest_change?: number;
  implied_volatility?: number;
  day?: { volume?: number };
  last_quote?: { bid?: number; ask?: number };
  last_trade?: { price?: number };
  greeks?: { implied_volatility?: number };
  details?: {
    expiration_date?: string;
    contract_type?: string;
    strike_price?: number;
  };
}

interface YahooResponse {
  optionChain?: {
    result?: Array<{
      options?: Array<{
        expirationDate?: number;
        calls?: YahooContract[];
        puts?: YahooContract[];
      }>;
    }>;
  };
}

interface YahooContract {
  strike?: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
}
