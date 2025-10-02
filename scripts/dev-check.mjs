#!/usr/bin/env node
/* eslint-env node */

const origin = process.env.VITE_WORKER_ORIGIN?.trim() || 'http://localhost:8787';

async function check() {
  console.log('GME Radar environment check');
  console.log(`Worker origin: ${origin}`);
  const restUrl = new URL('/finnhub/quote?symbol=GME&nocache=1', origin).toString();
  let restStatus = 'unknown';
  try {
    const response = await fetch(restUrl, { method: 'GET', headers: { Accept: 'application/json' } });
    restStatus = response.ok ? `ok (${response.status})` : `error (${response.status})`;
  } catch (error) {
    restStatus = `unreachable (${(error && error.message) || 'error'})`;
  }
  console.log(`REST /finnhub/quote: ${restStatus}`);

  const wsUrl = new URL('/ws', origin.replace(/^http/i, 'ws'));
  console.log(`WS endpoint: ${wsUrl.toString()} (connectivity check requires browser)`);

  const demoFiles = ['public/demo/quote.json', 'public/demo/candles.json', 'public/demo/trades.jsonl'];
  const missing = demoFiles.filter((file) => {
    try {
      fs.accessSync(file);
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length === 0) {
    console.log('Demo assets: available');
  } else {
    console.log(`Demo assets missing: ${missing.join(', ')}`);
  }

  if (!restStatus.startsWith('ok')) {
    console.log('Live worker unavailable – UI will start in demo mode.');
  }
}

import fs from 'node:fs';

await check();
