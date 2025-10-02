import 'uplot/dist/uPlot.min.css';

import { MinuteOhlcAggregator } from './data/ohlc';
import {
  connectLive as connectWorker,
  fetchCandles as fetchWorkerCandles,
  fetchQuote as fetchWorkerQuote,
} from './data/workerClient';
import { summarizeSignals } from './signals';
import { createPriceChart, createVolumeChart } from './ui/charts';
import { createStatus } from './ui/status';
import type { Candle, LiveConnection, Quote } from './data/workerClient';
import type { MinuteBar, Trade } from './types';
import {
  connectLive as connectSimulator,
  fetchCandles as fetchSimulatorCandles,
  fetchQuote as fetchSimulatorQuote,
} from './sim/simulator';

const params = new URLSearchParams(window.location.search);
const symbol = (params.get('symbol') ?? 'GME').toUpperCase();
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing app root');
}

const header = document.createElement('header');
const title = document.createElement('h1');
const titleLine = document.createElement('span');
const subtitleLine = document.createElement('span');
titleLine.textContent = 'GME Radar';
subtitleLine.textContent = `${symbol} realtime dashboard`;
title.append(titleLine, subtitleLine);

const metrics = document.createElement('div');
metrics.className = 'metrics';

const priceValue = document.createElement('strong');
priceValue.textContent = '$0.00';
const changeValue = document.createElement('small');
changeValue.textContent = 'Δ 0.00 (0.00%)';
const vwapValue = document.createElement('small');
vwapValue.textContent = 'VWAP —';
const rangeValue = document.createElement('small');
rangeValue.textContent = 'Hi/Lo —';

metrics.append(priceValue, changeValue, vwapValue, rangeValue);
header.append(title, metrics);
app.append(header);

const statusUi = createStatus();
statusUi.banner.hidden = true;
app.append(statusUi.banner);

const main = document.createElement('main');
const pricePanel = createPanel('Price action');
pricePanel.style.gridColumn = '1 / 2';
pricePanel.style.gridRow = '1 / 2';
const priceChartContainer = document.createElement('div');
priceChartContainer.className = 'chart-wrapper';
pricePanel.append(priceChartContainer);

const volumePanel = createPanel('Volume');
volumePanel.style.gridColumn = '1 / 2';
volumePanel.style.gridRow = '2 / 3';
const volumeChartContainer = document.createElement('div');
volumeChartContainer.className = 'chart-wrapper';
volumePanel.append(volumeChartContainer);

const signalPanel = createPanel('Signals & flags');
signalPanel.style.gridColumn = '2 / 3';
signalPanel.style.gridRow = '1 / 3';
const signalsList = document.createElement('dl');
signalsList.style.display = 'grid';
signalsList.style.gridTemplateColumns = 'auto 1fr';
signalsList.style.gap = '0.5rem 1.5rem';

const vwapItem = createSignal(signalsList, 'VWAP');
const highItem = createSignal(signalsList, 'High');
const lowItem = createSignal(signalsList, 'Low');
const changeItem = createSignal(signalsList, '1m change');
const spikeItem = createSignal(signalsList, 'Spike');

signalPanel.append(signalsList);

main.append(pricePanel, volumePanel, signalPanel);
app.append(main);
app.append(statusUi.element);

const priceChart = createPriceChart(priceChartContainer);
const volumeChart = createVolumeChart(volumeChartContainer);

const aggregator = new MinuteOhlcAggregator(390);

let mode: 'worker' | 'demo' = 'worker';
let connection: LiveConnection | null = null;
let quoteTimer: number | undefined;
let candleTimer: number | undefined;
let healthTimer: number | undefined;
let retryCount = 0;
let lastDataAt = Date.now();
let pendingFrame = false;

statusUi.setMode('live');
statusUi.setConnection('connecting');
statusUi.setBanner(null);
statusUi.retryButton.addEventListener('click', () => {
  retryCount = 0;
  statusUi.setRetries(retryCount);
  if (mode === 'worker') {
    void refreshQuote();
    void refreshCandles(true);
  }
});
statusUi.setRetries(retryCount);

void bootstrap();

async function bootstrap() {
  try {
    await loadWorker();
  } catch (error) {
    console.warn('Worker unavailable, switching to demo', error);
    await enterDemo('Worker unavailable');
  }
}

async function loadWorker() {
  mode = 'worker';
  statusUi.setMode('live');
  statusUi.setBanner(null);
  statusUi.setConnection('connecting');
  const now = Date.now();
  const [quote, candles] = await Promise.all([
    fetchWorkerQuote(symbol),
    fetchWorkerCandles(symbol, now - 390 * 60_000, now, '1'),
  ]);
  const bars = convertCandles(candles);
  aggregator.seed(bars);
  applyQuote(quote);
  scheduleUpdate();
  statusUi.setConnection('connected');
  connectStream(connectWorker(symbol));
  quoteTimer = window.setInterval(() => {
    void refreshQuote();
  }, 3000);
  candleTimer = window.setInterval(() => {
    void refreshCandles();
  }, 20000);
  startHealthCheck();
}

async function enterDemo(reason: string) {
  mode = 'demo';
  statusUi.setMode('demo');
  statusUi.setBanner(`Demo mode: ${reason}`, 'info');
  statusUi.setConnection('connected');
  stopTimers();
  connection?.close();
  connection = null;
  const [quote, candles] = await Promise.all([fetchSimulatorQuote(symbol), fetchSimulatorCandles(symbol)]);
  aggregator.seed(candles);
  applyQuote(quote);
  scheduleUpdate();
  connectStream(connectSimulator(symbol));
}

function connectStream(newConnection: LiveConnection) {
  connection?.close();
  connection = newConnection;
  connection.onStatus((state) => {
    if (mode === 'demo') {
      statusUi.setConnection('connected');
      return;
    }
    statusUi.setConnection(state);
    if (state === 'reconnecting') {
      statusUi.setBanner('Realtime feed reconnecting…', 'info');
    } else if (state === 'connected') {
      statusUi.setBanner(null);
    } else if (state === 'closed') {
      statusUi.setBanner('Realtime feed offline – waiting for retry…', 'error');
    }
  });
  connection.onPing(() => {
    lastDataAt = Date.now();
  });
  connection.onTrade((trade: Trade) => {
    lastDataAt = Date.now();
    aggregator.ingestTrade({ ...trade, timestamp: ensureMilliseconds(trade.timestamp) });
    scheduleUpdate();
  });
}

async function refreshQuote() {
  try {
    const quote = await fetchWorkerQuote(symbol);
    applyQuote(quote);
    lastDataAt = Date.now();
    scheduleUpdate();
    retryCount = 0;
    statusUi.setRetries(retryCount);
  } catch (error) {
    retryCount += 1;
    statusUi.setRetries(retryCount);
    const status = (error as { status?: number }).status;
    if (status && (status === 429 || status >= 500)) {
      statusUi.setBanner('Worker error – retrying…', 'error');
    }
  }
}

async function refreshCandles(force = false) {
  if (mode !== 'worker') {
    return;
  }
  try {
    const now = Date.now();
    const candles = await fetchWorkerCandles(symbol, now - 390 * 60_000, now, '1');
    aggregator.applySnapshot(convertCandles(candles));
    if (force) {
      scheduleUpdate();
    }
  } catch (error) {
    retryCount += 1;
    statusUi.setRetries(retryCount);
  }
}

function scheduleUpdate() {
  if (pendingFrame) {
    return;
  }
  pendingFrame = true;
  window.requestAnimationFrame(() => {
    pendingFrame = false;
    const bars = aggregator.getBars();
    priceChart.update(bars);
    volumeChart.update(bars);
    const summary = summarizeSignals(bars);
    const latest = bars.at(-1);
    if (latest) {
      priceValue.textContent = formatCurrency(latest.c);
      const prev = bars.at(-2);
      const change = prev ? latest.c - prev.c : 0;
      const percent = prev ? (change / prev.c) * 100 : 0;
      changeValue.textContent = `Δ ${formatSigned(change)} (${percent.toFixed(2)}%)`;
      changeValue.style.color = change >= 0 ? '#4ade80' : '#fca5a5';
      statusUi.setLastUpdated(latest.t);
      vwapValue.textContent = summary.vwap ? `VWAP ${formatCurrency(summary.vwap)}` : 'VWAP —';
    }
    rangeValue.textContent = formatRange(summary.high, summary.low);
    vwapItem.textContent = summary.vwap ? formatCurrency(summary.vwap) : '—';
    highItem.textContent = summary.high ? formatCurrency(summary.high) : '—';
    lowItem.textContent = summary.low ? formatCurrency(summary.low) : '—';
    const prev = bars.at(-2);
    changeItem.textContent = prev && bars.at(-1)
      ? formatSigned(bars.at(-1)!.c - prev.c)
      : '—';
    if (summary.spike) {
      spikeItem.textContent = `${summary.spike.magnitude >= 0 ? '▲' : '▼'} ${formatSigned(summary.spike.magnitude)} (σ)`;
    } else {
      spikeItem.textContent = 'None';
    }
    spikeItem.title = 'Spike detection based on 60-minute std dev';
  });
}

function startHealthCheck() {
  if (healthTimer != null) {
    window.clearInterval(healthTimer);
  }
  healthTimer = window.setInterval(() => {
    if (mode === 'worker' && Date.now() - lastDataAt > 10_000) {
      void enterDemo('Live data timeout');
    }
  }, 5000);
}

function stopTimers() {
  if (quoteTimer != null) {
    window.clearInterval(quoteTimer);
    quoteTimer = undefined;
  }
  if (candleTimer != null) {
    window.clearInterval(candleTimer);
    candleTimer = undefined;
  }
  if (healthTimer != null) {
    window.clearInterval(healthTimer);
    healthTimer = undefined;
  }
}

function convertCandles(candles: Candle[]): MinuteBar[] {
  return candles.map((bar) => ({
    t: ensureMilliseconds(bar.t),
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.v,
  }));
}

function ensureMilliseconds(value: number): number {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function applyQuote(quote: Quote) {
  aggregator.touchPrice(quote.c, ensureMilliseconds(quote.t));
  lastDataAt = Date.now();
}

function createPanel(title: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const heading = document.createElement('h2');
  heading.textContent = title;
  panel.append(heading);
  return panel;
}

function createSignal(list: HTMLDListElement, label: string): HTMLSpanElement {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  const value = document.createElement('span');
  value.textContent = '—';
  dd.append(value);
  list.append(dt, dd);
  return value;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatSigned(value: number): string {
  const fixed = value.toFixed(2);
  return value >= 0 ? `+${fixed}` : fixed;
}

function formatRange(high: number | null, low: number | null): string {
  if (high == null || low == null) {
    return 'Hi/Lo —';
  }
  return `Hi/Lo ${formatCurrency(high)} / ${formatCurrency(low)}`;
}
