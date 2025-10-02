import 'uplot/dist/uPlot.min.css';

import { MinuteOhlcAggregator } from './data/minuteAggregator';
import {
  connectLive as connectWorker,
  fetchCandles as fetchWorkerCandles,
  fetchQuote as fetchWorkerQuote,
  type CandleResolution,
} from './data/workerClient';
import { fetchChain, probeOptionsAvailability, type OptRow, type OptionsResponse } from './data/optionsClient';
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
import type { LiveConnection, Quote } from './data/workerClient';
import type { MinuteBar, Trade } from './types';
import {
  connectLive as connectSimulator,
  fetchCandles as fetchSimulatorCandles,
  fetchQuote as fetchSimulatorQuote,
} from './sim/simulator';
import { WORKER_ORIGIN } from './config';
import { loadState, saveState } from './persist';
import {
  deriveFeatureState,
  ensureMilliseconds,
  expandCandlesToMinutes,
  updateLimited,
  type EndpointStatus,
  type FeatureState,
} from './data/features';

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
const limitedBadge = document.createElement('span');
titleLine.textContent = 'GME Radar';
subtitleLine.textContent = `${symbol} realtime dashboard`;
limitedBadge.className = 'badge limited';
limitedBadge.textContent = 'Limited (free tier)';
limitedBadge.hidden = true;
title.append(titleLine, subtitleLine, limitedBadge);

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
let featureState: FeatureState = { quote: true, candles: '1', options: true, limited: false };
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
let bootGeneration = 0;
let optionsDisabledReason: string | null = null;
let quoteBackoffUntil = 0;
let candleBackoffUntil = 0;
let optionsBackoffUntil = 0;

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
    if (featureState.candles) {
      void refreshCandles(true);
    }
    if (featureState.options) {
      void refreshOptions(true);
    }
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
  const generation = ++bootGeneration;
  try {
    await loadWorker(generation);
  } catch (error) {
    console.warn('Worker unavailable, switching to demo', error);
    if (generation !== bootGeneration) {
      return;
    }
    await enterDemo('Worker unavailable', generation);
  }
}

async function loadWorker(generation: number) {
  mode = 'worker';
  statusUi.setMode('live');
  statusUi.setBanner(null);
  statusUi.setConnection('connecting');
  quoteBackoffUntil = 0;
  candleBackoffUntil = 0;
  optionsBackoffUntil = 0;
  const now = Date.now();
  const from = now - 390 * 60_000;

  const quotePromise = fetchWorkerQuote(symbol);
  let seedBars: MinuteBar[] = [];
  let minuteStatus: EndpointStatus = { ok: false, status: 0 };
  let fiveStatus: EndpointStatus = { ok: false, status: 0 };

  try {
    const minuteCandles = await fetchWorkerCandles(symbol, from, now, '1');
    seedBars = expandCandlesToMinutes(minuteCandles, '1');
    minuteStatus = { ok: true, status: 200 };
  } catch (error) {
    minuteStatus = extractStatus(error);
  }

  if (!minuteStatus.ok) {
    try {
      const fiveMinuteCandles = await fetchWorkerCandles(symbol, from, now, '5');
      seedBars = expandCandlesToMinutes(fiveMinuteCandles, '5');
      fiveStatus = { ok: true, status: 200 };
    } catch (error) {
      fiveStatus = extractStatus(error);
    }
  }

  const quote = await quotePromise;
  if (generation !== bootGeneration) {
    return;
  }

  const optionsStatus = await probeOptionsAvailability(symbol);
  const derivedState = deriveFeatureState({
    quote: { ok: true, status: 200 },
    minuteCandles: minuteStatus,
    fiveMinuteCandles: fiveStatus,
    options: optionsStatus,
  });
  optionsDisabledReason = optionsStatus.ok ? null : describeOptionsStatus(optionsStatus.status);

  aggregator = new MinuteOhlcAggregator(390);
  if (seedBars.length > 0) {
    aggregator.seed(seedBars);
  } else {
    aggregator.seed([]);
  }
  applyQuote(quote);
  scheduleUpdate();

  if (generation !== bootGeneration) {
    return;
  }

  statusUi.setConnection('connected');
  connectStream(connectWorker(symbol));
  if (generation !== bootGeneration) {
    return;
  }

  if (quoteTimer != null) {
    window.clearInterval(quoteTimer);
  }
  quoteTimer = window.setInterval(() => {
    void refreshQuote();
  }, 3000);

  applyFeatureState(derivedState, { optionsReason: optionsDisabledReason });
  if (generation !== bootGeneration) {
    return;
  }

  if (featureState.options) {
    await refreshOptions(true);
  } else {
    statusUi.setOptionsStatus('DISABLED');
    statusUi.setOptionsUpdated(null);
  }
  if (generation !== bootGeneration) {
    return;
  }
  startHealthCheck();
}

async function enterDemo(reason: string, generation = bootGeneration) {
  if (generation !== bootGeneration) {
    return;
  }
  mode = 'demo';
  statusUi.setMode('demo');
  statusUi.setBanner(`Demo mode: ${reason}`, 'info');
  statusUi.setConnection('connected');
  applyFeatureState({ quote: true, candles: '1', options: true, limited: false });
  stopTimers();
  connection?.close();
  connection = null;
  const [quote, candles] = await Promise.all([fetchSimulatorQuote(symbol), fetchSimulatorCandles(symbol)]);
  if (generation !== bootGeneration) {
    return;
  }
  aggregator = new MinuteOhlcAggregator(390);
  aggregator.seed(candles);
  applyQuote(quote);
  scheduleUpdate();
  if (generation !== bootGeneration) {
    return;
  }
  connectStream(connectSimulator(symbol));
  if (generation !== bootGeneration) {
    return;
  }
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
  if (Date.now() < quoteBackoffUntil) {
    return;
  }
  try {
    const quote = await fetchWorkerQuote(symbol);
    applyQuote(quote);
    lastDataAt = Date.now();
    scheduleUpdate();
    retryCount = 0;
    statusUi.setRetries(retryCount);
    statusUi.setBanner(null);
    quoteBackoffUntil = 0;
  } catch (error) {
    retryCount += 1;
    statusUi.setRetries(retryCount);
    const status = (error as { status?: number }).status;
    if (status === 429) {
      statusUi.setBanner('Quote rate limited – retrying…', 'error');
      quoteBackoffUntil = Date.now() + 5000;
    } else if (status === 403) {
      statusUi.setBanner('Quotes unavailable (403) – retrying later…', 'error');
      quoteBackoffUntil = Date.now() + 60000;
    } else if (status && status >= 500) {
      statusUi.setBanner('Worker error – retrying…', 'error');
      quoteBackoffUntil = Date.now() + 15000;
    } else {
      quoteBackoffUntil = Date.now() + 10000;
    }
  }
}

async function refreshCandles(force = false) {
  if (mode !== 'worker' || !featureState.candles) {
    return;
  }
  if (Date.now() < candleBackoffUntil) {
    return;
  }
  try {
    const bars = await fetchCandlesSnapshot(featureState.candles);
    aggregator.applySnapshot(bars);
    if (force) {
      scheduleUpdate();
    }
    candleBackoffUntil = 0;
  } catch (error) {
    retryCount += 1;
    statusUi.setRetries(retryCount);
    const status = (error as { status?: number }).status;
    if (status === 403 || status === 401 || status === 404) {
      if (featureState.candles === '1') {
        const fallbackState = updateLimited({ ...featureState, candles: '5' as CandleResolution });
        applyFeatureState(fallbackState, { optionsReason: optionsDisabledReason });
        candleBackoffUntil = Date.now() + 60000;
        try {
          const fallbackBars = await fetchCandlesSnapshot('5');
          aggregator.applySnapshot(fallbackBars);
          scheduleUpdate();
          candleBackoffUntil = 0;
        } catch {
          // Keep fallback state; retry on the next interval.
        }
      } else {
        const disabledState = updateLimited({ ...featureState, candles: null });
        applyFeatureState(disabledState, { optionsReason: optionsDisabledReason });
        candleBackoffUntil = Date.now() + 120000;
      }
      return;
    }
    if (status === 429) {
      candleBackoffUntil = Date.now() + 60000;
    } else if (status && status >= 500) {
      candleBackoffUntil = Date.now() + 45000;
    } else {
      candleBackoffUntil = Date.now() + 20000;
    }
  }
}

async function refreshOptions(suppressAlerts = false) {
  if (!featureState.options || optionsInFlight) {
    return;
  }
  if (Date.now() < optionsBackoffUntil) {
    return;
  }
  optionsInFlight = true;
  try {
    const response = await fetchChain(symbol);
    const status = typeof response.meta?.status === 'number' ? response.meta.status : undefined;
    if (status === 403 || status === 401 || status === 404) {
      optionsDisabledReason = describeOptionsStatus(status);
      const disabledState = updateLimited({ ...featureState, options: false });
      applyFeatureState(disabledState, { optionsReason: optionsDisabledReason });
      return;
    }
    if (status === 429) {
      optionsBackoffUntil = Date.now() + 120000;
    }
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
    optionsBackoffUntil = 0;
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
    optionsBackoffUntil = Date.now() + 60000;
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

async function fetchCandlesSnapshot(resolution: CandleResolution): Promise<MinuteBar[]> {
  const now = Date.now();
  const candles = await fetchWorkerCandles(symbol, now - 390 * 60_000, now, resolution);
  return expandCandlesToMinutes(candles, resolution);
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

function applyFeatureState(next: FeatureState, opts?: { optionsReason?: string | null }) {
  const prev = featureState;
  const normalized = updateLimited(next);
  featureState = normalized;

  if (normalized.limited) {
    limitedBadge.hidden = false;
    limitedBadge.textContent = limitedLabel(normalized);
  } else {
    limitedBadge.hidden = true;
  }

  if (!normalized.options) {
    optionsDisabledReason = opts?.optionsReason ?? optionsDisabledReason ?? 'Options disabled (premium only)';
    optionsPanel.setDisabled(true, optionsDisabledReason);
    statusUi.setOptionsStatus('DISABLED');
    statusUi.setOptionsUpdated(null);
    if (optionsTimer != null) {
      window.clearInterval(optionsTimer);
      optionsTimer = undefined;
    }
  } else {
    optionsDisabledReason = null;
    optionsPanel.setDisabled(false);
    if (!prev.options) {
      statusUi.setOptionsStatus('—');
      statusUi.setOptionsUpdated(null);
    }
    if (mode === 'worker') {
      if (optionsTimer != null) {
        window.clearInterval(optionsTimer);
      }
      optionsTimer = window.setInterval(() => {
        void refreshOptions();
      }, 60000);
    }
  }

  if (!normalized.candles) {
    if (candleTimer != null) {
      window.clearInterval(candleTimer);
      candleTimer = undefined;
    }
  } else if (mode === 'worker') {
    const interval = normalized.candles === '1' ? 30000 : 60000;
    if (candleTimer != null) {
      window.clearInterval(candleTimer);
    }
    candleTimer = window.setInterval(() => {
      void refreshCandles();
    }, interval);
  }
}

function limitedLabel(state: FeatureState): string {
  if (!state.candles) {
    return 'Limited (quotes only)';
  }
  if (state.candles === '5' && !state.options) {
    return 'Limited (5m candles, no options)';
  }
  if (state.candles === '5') {
    return 'Limited (5m candles)';
  }
  if (!state.options) {
    return 'Limited (options disabled)';
  }
  return 'Limited (free tier)';
}

function describeOptionsStatus(status: number | undefined): string {
  if (status === 403 || status === 401) {
    return 'Options disabled (premium only)';
  }
  if (status === 404) {
    return 'Options endpoint unavailable';
  }
  if (status === 429) {
    return 'Options temporarily rate limited';
  }
  return 'Options data unavailable';
}

function extractStatus(error: unknown): EndpointStatus {
  const status = (error as { status?: number })?.status;
  return { ok: false, status: typeof status === 'number' ? status : 0 };
}

function changeSymbol(next: string) {
  stopTimers();
  connection?.close();
  connection = null;
  featureState = { quote: true, candles: '1', options: true, limited: false };
  optionsDisabledReason = null;
  limitedBadge.hidden = true;
  quoteBackoffUntil = 0;
  candleBackoffUntil = 0;
  optionsBackoffUntil = 0;
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
  statusUi.setBanner(null);
  optionsPanel.setDisabled(false);
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
  const origin = WORKER_ORIGIN;
  if (!origin) {
    return window.location.origin;
  }
  try {
    const url = new URL(origin);
    return url.host;
  } catch {
    return origin;
  }
}
