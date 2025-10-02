import 'uplot/dist/uPlot.min.css';

import { createDataCache, accumulateVolume } from './data/cache';
import { createFinnhubClient } from './data/finnhub';
import { createPolygonPoller } from './data/polygon';
import { loadDemoData, startDemoOptionsFeed, startDemoPriceFeed } from './data/simulator';
import { analyzeOptions } from './signals';
import type { ActivityFlag, MinuteBar, OptionSnapshot, PriceTick } from './types';
import type { ConnectionState } from './types';
import { createCandleChart, createVolumeChart } from './ui/charts';
import { el, formatCurrency, formatNumber, formatPercent, formatTimestamp } from './ui/dom';

type BannerState = 'hidden' | 'demo' | 'error';

const finnhubToken = import.meta.env.VITE_FINNHUB_TOKEN as string | undefined;
const polygonKey = import.meta.env.VITE_POLYGON_KEY as string | undefined;
const baseUrl = import.meta.env.BASE_URL ?? '/';
const demoMode = !finnhubToken || !polygonKey;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}
const root = app;

const cache = createDataCache();
let lastPrice: number | undefined;
let bannerState: BannerState = 'hidden';
let flagsLog: ActivityFlag[] = [];
const seenFlagKeys = new Set<string>();
let lastStatus: ConnectionState = demoMode ? 'connected' : 'connecting';
let polygonStatus: 'idle' | 'running' | 'error' = 'idle';

const topBar = el('div', { className: 'top-bar' });
const topMeta = el('div', { className: 'metrics' });
const statusWrap = el('div', { className: 'status' });
const statusIndicator = el('span', { className: `status-indicator${demoMode ? ' demo' : ''}` });
const statusLabel = el('span', { text: demoMode ? 'Demo mode' : 'Connecting…' });
statusWrap.append(statusIndicator, statusLabel);

const priceValue = el('strong', { className: 'spot-price', text: '$0.00' });
const changeValue = el('span', { className: 'small', text: 'Δ 0.00 (0.00%)' });
const volumeValue = el('span', { className: 'small', text: 'Vol 0' });

topMeta.append(priceValue, changeValue, volumeValue);
topBar.append(topMeta, statusWrap);

const banner = el('div', { className: 'banner', text: '' });
if (demoMode) {
  banner.textContent = 'Keys missing. Demo runs with simulated data.';
  bannerState = 'demo';
  root.append(banner);
}

root.append(topBar);

const dashboard = el('div', { className: 'dashboard' });

const leftPanel = el('div', { className: 'panel' });
const priceHeader = el('div', { className: 'panel-header' });
priceHeader.append(el('span', { className: 'panel-title', text: 'GME Price' }));
leftPanel.append(priceHeader);

const priceChartContainer = el('div', { className: 'chart-container' });
const volumeChartContainer = el('div', { className: 'chart-container' });
leftPanel.append(priceChartContainer, volumeChartContainer);

const rightPanel = el('div', { className: 'panel' });
const optionsHeader = el('div', { className: 'panel-header' });
optionsHeader.append(el('span', { className: 'panel-title', text: 'Options Heatmap' }));
const optionsSubtitle = el('span', { className: 'small', text: 'Volume-weighted buckets for near expiries' });
optionsHeader.append(optionsSubtitle);
const heatmapGrid = el('div', { className: 'heatmap-grid' });
rightPanel.append(optionsHeader, heatmapGrid);

const flagsStrip = el('div', { className: 'flags-strip' });

leftPanel.style.gridArea = 'left';
rightPanel.style.gridArea = 'right';
flagsStrip.style.gridArea = 'bottom';

dashboard.append(leftPanel, rightPanel, flagsStrip);
root.append(dashboard);

const candleChart = createCandleChart(priceChartContainer);
const volumeChart = createVolumeChart(volumeChartContainer);

function setBanner(state: BannerState, message?: string) {
  if (state === 'hidden') {
    if (bannerState !== 'hidden' && banner.parentElement) {
      banner.remove();
    }
    bannerState = 'hidden';
    return;
  }
  if (!banner.parentElement) {
    root.insertBefore(banner, topBar.nextSibling);
  }
  banner.textContent = message ?? (state === 'demo' ? 'Keys missing. Demo runs with simulated data.' : '');
  bannerState = state;
}

function updateStatus(state: ConnectionState) {
  lastStatus = state;
  if (demoMode) {
    statusLabel.textContent = 'Demo mode';
    statusIndicator.classList.add('demo');
    return;
  }
  statusIndicator.classList.toggle('demo', false);
  if (state === 'connected') {
    statusIndicator.style.backgroundColor = '#22c55e';
    statusLabel.textContent = polygonStatus === 'error' ? 'Live · degraded' : 'Live';
  } else if (state === 'reconnecting') {
    statusIndicator.style.backgroundColor = '#facc15';
    statusLabel.textContent = 'Reconnecting…';
  } else {
    statusIndicator.style.backgroundColor = '#f97316';
    statusLabel.textContent = 'Offline';
  }
}

function updatePolygonStatus(state: 'running' | 'error') {
  polygonStatus = state;
  if (state === 'error' && !demoMode) {
    setBanner('error', 'Polygon API unavailable. Retrying…');
    statusIndicator.style.backgroundColor = '#f97316';
    statusLabel.textContent = 'Live · degraded';
  } else if (!demoMode) {
    if (bannerState === 'error') {
      setBanner('hidden');
    }
    if (lastStatus === 'connected') {
      statusIndicator.style.backgroundColor = '#22c55e';
      statusLabel.textContent = 'Live';
    }
  }
}

function updatePriceMetrics() {
  if (lastPrice == null) {
    return;
  }
  priceValue.textContent = formatCurrency(lastPrice);
  const bars = cache.minuteBars.toArray();
  if (bars.length >= 2) {
    const prev = bars[bars.length - 2];
    const latest = bars[bars.length - 1];
    const change = latest.close - prev.close;
    const pct = prev.close !== 0 ? change / prev.close : 0;
    changeValue.textContent = `Δ ${change >= 0 ? '+' : ''}${change.toFixed(2)} (${formatPercent(pct)})`;
    changeValue.style.color = change >= 0 ? '#34d399' : '#f87171';
  }
  const volume = accumulateVolume(bars);
  volumeValue.textContent = `Vol ${formatNumber(volume, { maximumFractionDigits: 0 })}`;
}

function updateFlags(newFlags: ActivityFlag[]) {
  const fresh = newFlags.filter((flag) => {
    const key = `${flag.type}:${flag.contract.occ}:${flag.message}`;
    if (seenFlagKeys.has(key)) {
      return false;
    }
    seenFlagKeys.add(key);
    return true;
  });
  if (fresh.length === 0 && flagsLog.length === 0) {
    flagsStrip.replaceChildren();
    return;
  }
  if (fresh.length > 0) {
    flagsLog = [...flagsLog, ...fresh].slice(-12);
  }
  flagsStrip.replaceChildren();
  for (const flag of flagsLog) {
    const item = el('div', { className: 'flag-item' });
    item.textContent = `${formatTimestamp(flag.ts)} ${flag.type} ${formatContractLabel(flag)}`;
    flagsStrip.append(item);
  }
}

function formatContractLabel(flag: ActivityFlag): string {
  const strike = flag.contract.strike.toFixed(2);
  const leg = flag.contract.type === 'call' ? 'C' : 'P';
  return `${flag.contract.exp} ${strike}${leg}`;
}

function handleMinuteBar(bar: MinuteBar) {
  cache.minuteBars.push(bar);
  candleChart.update(cache.minuteBars.toArray());
  volumeChart.update(cache.minuteBars.toArray());
  lastPrice = bar.close;
  updatePriceMetrics();
}

function handleTick(tick: PriceTick) {
  cache.ticks.push(tick);
  lastPrice = tick.lastPrice;
  updatePriceMetrics();
}

function renderHeatmap(snapshot: OptionSnapshot) {
  const analytics = analyzeOptions(snapshot, cache.optionSnapshots.toArray());
  cache.optionSnapshots.push(snapshot);
  heatmapGrid.replaceChildren();
  const maxVolume = Math.max(
    ...analytics.expiries.flatMap((expiry) =>
      expiry.buckets.map((bucket) => bucket.callVolume + bucket.putVolume)
    ),
    1
  );

  for (const expiry of analytics.expiries) {
    const block = el('div', { className: 'heatmap-block' });
    block.append(el('strong', { text: expiry.expiry }));
    for (const bucket of expiry.buckets) {
      const total = bucket.callVolume + bucket.putVolume;
      if (total <= 0) {
        continue;
      }
      const bucketRow = el('div', { className: 'heatmap-metric' });
      const intensity = Math.min(1, total / maxVolume);
      bucketRow.style.background = `linear-gradient(90deg, rgba(56, 189, 248, ${0.15 + intensity * 0.5}), transparent)`;
      const calls = formatNumber(bucket.callVolume, { maximumFractionDigits: 0 });
      const puts = formatNumber(bucket.putVolume, { maximumFractionDigits: 0 });
      bucketRow.textContent = `${bucket.bucket}: C ${calls} · P ${puts}`;
      const tooltipDetails = bucket.contracts
        .slice(0, 4)
        .map(
          (contract) =>
            `${contract.strike}${contract.type === 'call' ? 'C' : 'P'} | mid ${contract.mid ?? contract.last ?? 'n/a'} | vol ${
              contract.volume ?? 0
            } | OI ${contract.openInterest ?? 'n/a'}`
        )
        .join('\n');
      bucketRow.title = tooltipDetails;
      block.append(bucketRow);
    }
    heatmapGrid.append(block);
  }

  updateFlags(analytics.flags);
}

function handleOptionSnapshot(snapshot: OptionSnapshot) {
  polygonStatus = 'running';
  updatePolygonStatus('running');
  if (bannerState === 'error' && !demoMode) {
    setBanner('hidden');
  }
  renderHeatmap(snapshot);
}

async function boot() {
  if (demoMode) {
    try {
      const demo = await loadDemoData(baseUrl);
      startDemoPriceFeed({
        ticks: demo.ticks,
        minuteBars: demo.minuteBars,
        onTick: handleTick,
        onMinuteBar: handleMinuteBar
      });
      startDemoOptionsFeed({
        snapshots: demo.optionSnapshots,
        onSnapshot: (snapshot) => renderHeatmap(snapshot)
      });
      updateStatus('connected');
    } catch (error) {
      console.error('Demo data failed', error);
      setBanner('error', 'Demo data missing. Check public/demo assets.');
    }
    return;
  }

  const finnhub = createFinnhubClient({
    token: finnhubToken!,
    symbol: 'GME',
    onTick: handleTick,
    onMinuteBar: handleMinuteBar,
    onStatus: updateStatus,
    onError: (message) => console.warn(message)
  });

  const polygon = createPolygonPoller({
    apiKey: polygonKey!,
    onSnapshot: handleOptionSnapshot,
    onError: () => updatePolygonStatus('error'),
    resolveSpotPrice: () => lastPrice ?? cache.minuteBars.latest()?.close
  });

  updateStatus('connecting');
  finnhub.start();
  polygon.start();
  updatePolygonStatus('running');

  window.addEventListener('beforeunload', () => {
    finnhub.stop();
    polygon.stop();
  });
}

boot();
