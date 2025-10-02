import 'uplot/dist/uPlot.min.css';

import { MinuteOhlcAggregator } from './data/ohlc';
import {
  connectLive as connectWorker,
  fetchCandles as fetchWorkerCandles,
  fetchQuote as fetchWorkerQuote,
} from './data/workerClient';
import { fetchChain, type OptRow, type OptionsResponse } from './data/optionsClient';
import { createBaselineStore, getExpiryKey, toOccSymbol } from './options/chain';
import {
  aggregateByExpiry,
  aggregateByMoneyness,
  detectSweepHeuristic,
  flagIVSpike,
  flagUnusualVolume,
  type SweepSignal,
} from './options/signals';
import { summarizeSignals } from './signals';
import { createPriceChart, createVolumeChart } from './ui/charts';
import { createOptionsPanel, type UnusualContractRow } from './ui/optionsPanel';
import { createAlertsTicker } from './ui/alerts';
import { createStatus } from './ui/status';
import type { Candle, LiveConnection, Quote } from './data/workerClient';
import type { MinuteBar, Trade } from './types';
import {
  connectLive as connectSimulator,
  fetchCandles as fetchSimulatorCandles,
  fetchQuote as fetchSimulatorQuote,
} from './sim/simulator';
import { getWorkerOrigin } from './config';
import { loadState, saveState } from './persist';

interface OptionsSnapshotState {
  rows: OptRow[];
  meta: OptionsResponse['meta'];
  spot: number | null;
}

const params = new URLSearchParams(window.location.search);
const persisted = loadState();
let symbol = (params.get('symbol') ?? persisted?.symbol ?? 'GME').toUpperCase();
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

title.className = 'header-title';

const controls = document.createElement('div');
controls.className = 'header-controls';

const symbolForm = document.createElement('form');
symbolForm.className = 'symbol-form';
const symbolLabel = document.createElement('label');
symbolLabel.textContent = 'Symbol';
symbolLabel.htmlFor = 'symbol-input';
const symbolInput = document.createElement('input');
symbolInput.id = 'symbol-input';
symbolInput.type = 'text';
symbolInput.value = symbol;
symbolInput.maxLength = 6;
symbolInput.autocomplete = 'off';
const symbolHint = document.createElement('small');
symbolHint.className = 'small';
symbolHint.textContent = 'Press Enter to load';
symbolForm.append(symbolLabel, symbolInput, symbolHint);
controls.append(symbolForm);

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

header.append(title, controls, metrics);
app.append(header);

const statusUi = createStatus();
statusUi.banner.hidden = true;
app.append(statusUi.banner);

const main = document.createElement('main');
main.className = 'dashboard';

const pricePanel = createPanel('Price action');
pricePanel.classList.add('panel-price');
const priceChartContainer = document.createElement('div');
priceChartContainer.className = 'chart-wrapper';
pricePanel.append(priceChartContainer);

const volumePanel = createPanel('Volume');
volumePanel.classList.add('panel-volume');
const volumeChartContainer = document.createElement('div');
volumeChartContainer.className = 'chart-wrapper';
volumePanel.append(volumeChartContainer);

const signalPanel = createPanel('Signals & flags');
signalPanel.classList.add('panel-signals');
const signalsList = document.createElement('dl');
signalsList.className = 'signals-list';

const vwapItem = createSignal(signalsList, 'VWAP');
const highItem = createSignal(signalsList, 'High');
const lowItem = createSignal(signalsList, 'Low');
const changeItem = createSignal(signalsList, '1m change');
const spikeItem = createSignal(signalsList, 'Spike');
signalPanel.append(signalsList);

const optionsPanel = createOptionsPanel();
optionsPanel.element.classList.add('panel-options');

const alertsTicker = createAlertsTicker();
alertsTicker.element.classList.add('alerts-block');
signalPanel.append(alertsTicker.element);

main.append(pricePanel, volumePanel, optionsPanel.element, signalPanel);
app.append(main);
app.append(statusUi.element);

const priceChart = createPriceChart(priceChartContainer);
const volumeChart = createVolumeChart(volumeChartContainer);

let aggregator = new MinuteOhlcAggregator(390);
let mode: 'worker' | 'demo' = 'worker';
let connection: LiveConnection | null = null;
let quoteTimer: number | undefined;
let candleTimer: number | undefined;
let optionsTimer: number | undefined;
let healthTimer: number | undefined;
let retryCount = 0;
let lastDataAt = Date.now();
let pendingFrame = false;
let lastSpot: number | null = persisted?.options?.chain?.spot ?? null;
let baselineStore = createBaselineStore(persisted?.options?.baselines);
let lastChain: OptionsSnapshotState | null = persisted?.options?.chain
  ? {
      rows: persisted.options.chain.rows,
      meta: ((persisted.options.chain.meta ?? {}) as OptionsResponse['meta']) ?? { source: 'unknown' },
      spot: persisted.options.chain.spot ?? null,
    }
  : null;
const alertHistory = new Map<string, number>();
let optionsInFlight = false;

statusUi.setMode('live');
statusUi.setConnection('connecting');
statusUi.setBanner(null);
statusUi.setWorkerOrigin(formatWorkerOrigin());
statusUi.setOptionsStatus('—');
statusUi.setOptionsUpdated(lastChain?.rows.at(0)?.ts ?? null);
statusUi.retryButton.addEventListener('click', () => {
  retryCount = 0;
  statusUi.setRetries(retryCount);
  if (mode === 'worker') {
    void refreshQuote();
    void refreshCandles(true);
    void refreshOptions(true);
  }
});
statusUi.setRetries(retryCount);

if (lastChain) {
  hydrateOptionsPanel(lastChain);
}

symbolForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const next = symbolInput.value.trim().toUpperCase();
  if (!next || next === symbol) {
    return;
  }
  changeSymbol(next);
});

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
  aggregator = new MinuteOhlcAggregator(390);
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
  optionsTimer = window.setInterval(() => {
    void refreshOptions();
  }, 45000);
  await refreshOptions(true);
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
  aggregator = new MinuteOhlcAggregator(390);
  aggregator.seed(candles);
  applyQuote(quote);
  scheduleUpdate();
  connectStream(connectSimulator(symbol));
  if (optionsTimer == null) {
    optionsTimer = window.setInterval(() => {
      void refreshOptions();
    }, 60000);
  }
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

async function refreshOptions(suppressAlerts = false) {
  if (optionsInFlight) {
    return;
  }
  optionsInFlight = true;
  try {
    const response = await fetchChain(symbol);
    if (response.rows.length === 0) {
      const provider = response.meta?.source ? response.meta.source.toUpperCase() : 'OFFLINE';
      optionsPanel.setSource({
        provider,
        delayed: Boolean(response.meta?.delayed),
        error: response.meta?.error,
        updatedAt: lastChain?.rows.at(0)?.ts ?? null,
      });
      statusUi.setOptionsStatus(provider, Boolean(response.meta?.delayed));
      optionsInFlight = false;
      return;
    }
    const spot = determineSpot();
    lastSpot = spot;
    const snapshot: OptionsSnapshotState = {
      rows: response.rows,
      meta: response.meta,
      spot,
    };
    renderOptionsSnapshot(snapshot, { suppressAlerts });
    lastChain = snapshot;
    statusUi.setOptionsStatus(response.meta.source?.toUpperCase?.() ?? '—', Boolean(response.meta.delayed));
    const updatedAt = response.rows[0]?.ts ?? Date.now();
    statusUi.setOptionsUpdated(updatedAt);
    optionsPanel.setSource({
      provider: response.meta.source?.toUpperCase?.() ?? '—',
      delayed: Boolean(response.meta.delayed),
      error: response.meta.error,
      updatedAt,
    });
    saveState({
      symbol,
      options: {
        chain: {
          symbol,
          rows: response.rows,
          meta: response.meta,
          spot,
          updatedAt: Date.now(),
        },
        baselines: baselineStore.toJSON(),
      },
    });
  } catch (error) {
    console.warn('Options fetch failed', error);
  } finally {
    optionsInFlight = false;
  }
}

function renderOptionsSnapshot(snapshot: OptionsSnapshotState, opts?: { suppressAlerts?: boolean }) {
  const { rows, spot } = snapshot;
  const suppressAlerts = Boolean(opts?.suppressAlerts);
  const prevMap = new Map<string, OptRow>();
  lastChain?.rows.forEach((row) => prevMap.set(toOccSymbol(symbol, row), row));
  const sweepEvents = detectSweepHeuristic(rows);
  const sweepIndex = new Set<string>();
  sweepEvents.forEach((event) => {
    const identifier = `${event.exp}|${event.type}`;
    event.strikes.forEach((strike) => sweepIndex.add(`${identifier}|${strike}`));
    if (!suppressAlerts) {
      emitSweepAlert(event);
    }
  });

  const unusual: UnusualContractRow[] = [];
  rows.forEach((row) => {
    const occ = toOccSymbol(symbol, row);
    const baseline = baselineStore.getVolumeAverage(occ);
    const ivStats = baselineStore.getIvStats(getExpiryKey(row));
    const volFlag = flagUnusualVolume(row, baseline);
    const ivFlag = flagIVSpike(row, ivStats);
    const sweepFlag = sweepIndex.has(`${row.exp}|${row.type}|${row.strike}`);
    const previous = prevMap.get(occ);
    const deltaOi =
      previous && previous.openInterest != null && row.openInterest != null
        ? row.openInterest - previous.openInterest
        : undefined;
    const flags: string[] = [];
    if (volFlag) {
      flags.push('Vol >3×');
      if (!suppressAlerts) {
        emitAlert(`vol:${occ}`, 'UnusualVol', `${row.type} ${row.exp} ${row.strike.toFixed(2)}`, `Vol ${formatNumber(row.volume)}`);
      }
    }
    if (ivFlag) {
      flags.push('IV spike');
      const ivLabel = row.iv != null ? `${(row.iv * 100).toFixed(1)}%` : '—';
      if (!suppressAlerts) {
        emitAlert(`iv:${occ}`, 'IVSpike', `${row.type} ${row.exp} ${row.strike.toFixed(2)}`, `IV ${ivLabel}`);
      }
    }
    if (sweepFlag) {
      flags.push('Sweep');
    }
    if (deltaOi != null && Math.abs(deltaOi) >= determineOiThreshold(previous?.openInterest)) {
      flags.push('OI Δ');
    }
    baselineStore.recordVolume(occ, row.ts, row.volume ?? 0);
    baselineStore.recordIv(getExpiryKey(row), row.ts, row.iv ?? 0);
    if (flags.length > 0) {
      unusual.push({ row, contractId: occ, flags, deltaOpenInterest: deltaOi });
    }
  });

  const matrix = aggregateByMoneyness(rows, spot ?? determineSpot());
  const totals = aggregateByExpiry(rows);
  optionsPanel.renderHeatmap(matrix);
  optionsPanel.renderTotals(totals);
  optionsPanel.renderUnusual(unusual.sort((a, b) => (b.row.volume ?? 0) - (a.row.volume ?? 0)));
}

function hydrateOptionsPanel(snapshot: OptionsSnapshotState) {
  const meta = snapshot.meta;
  optionsPanel.setSource({
    provider: meta.source?.toUpperCase?.() ?? '—',
    delayed: Boolean(meta.delayed),
    error: meta.error,
    updatedAt: snapshot.rows[0]?.ts ?? null,
  });
  statusUi.setOptionsStatus(meta.source?.toUpperCase?.() ?? '—', Boolean(meta.delayed));
  statusUi.setOptionsUpdated(snapshot.rows[0]?.ts ?? null);
  renderOptionsSnapshot(snapshot, { suppressAlerts: true });
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
      lastSpot = latest.c;
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
  if (optionsTimer != null) {
    window.clearInterval(optionsTimer);
    optionsTimer = undefined;
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
  lastSpot = quote.c;
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

function formatNumber(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return value.toFixed(0);
}

function emitAlert(key: string, type: 'IVSpike' | 'UnusualVol', summary: string, detail?: string) {
  const ts = Date.now();
  const last = alertHistory.get(key);
  if (last && ts - last < 120_000) {
    return;
  }
  alertHistory.set(key, ts);
  alertsTicker.push({ ts, type, summary, detail });
}

function emitSweepAlert(event: SweepSignal) {
  const key = `sweep:${symbol}:${event.exp}:${event.type}:${event.strikes[0]}:${event.strikes.at(-1)}`;
  const last = alertHistory.get(key);
  if (last && event.ts - last < 120_000) {
    return;
  }
  alertHistory.set(key, event.ts);
  const detail = `Strikes ${event.strikes.join(' → ')} | Vol ${formatNumber(event.totalVolume)}`;
  alertsTicker.push({
    ts: event.ts,
    type: 'Sweep',
    summary: `${event.type} ${event.exp} sweep (${event.direction})`,
    detail,
  });
}

function determineSpot(): number {
  if (lastSpot != null) {
    return lastSpot;
  }
  const bars = aggregator.getBars();
  const latest = bars.at(-1);
  return latest?.c ?? 0;
}

function determineOiThreshold(previous: number | undefined | null): number {
  if (previous == null) {
    return 1;
  }
  return Math.max(1, Math.abs(previous) * 0.1);
}

function changeSymbol(next: string) {
  stopTimers();
  connection?.close();
  connection = null;
  symbol = next;
  symbolInput.value = symbol;
  subtitleLine.textContent = `${symbol} realtime dashboard`;
  alertsTicker.reset();
  lastChain = null;
  lastSpot = null;
  baselineStore = createBaselineStore();
  aggregator = new MinuteOhlcAggregator(390);
  priceChart.update([]);
  volumeChart.update([]);
  retryCount = 0;
  statusUi.setRetries(0);
  statusUi.setLastUpdated(null);
  statusUi.setOptionsStatus('—');
  statusUi.setOptionsUpdated(null);
  optionsPanel.renderHeatmap([]);
  optionsPanel.renderTotals([]);
  optionsPanel.renderUnusual([]);
  const url = new URL(window.location.href);
  url.searchParams.set('symbol', symbol);
  window.history.replaceState(null, '', url.toString());
  alertHistory.clear();
  saveState({ symbol });
  void bootstrap();
}

function formatWorkerOrigin(): string {
  const origin = getWorkerOrigin();
  if (!origin) {
    return window.location.origin;
  }
  try {
    const base = new URL(origin, window.location.origin);
    const path = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '');
    return `${base.host}${path}`;
  } catch {
    return origin;
  }
}
