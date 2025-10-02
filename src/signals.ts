import type { MinuteBar, SignalSummary, SpikeSignal } from './types';

export function computeVWAP(bars: MinuteBar[]): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const bar of bars) {
    const typical = (bar.h + bar.l + bar.c) / 3;
    numerator += typical * bar.v;
    denominator += bar.v;
  }
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

export function computeOneMinuteChange(bars: MinuteBar[]): number | null {
  if (bars.length < 2) {
    return null;
  }
  const latest = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  return latest.c - prev.c;
}

export function computeHighLow(bars: MinuteBar[]): { high: number | null; low: number | null } {
  if (bars.length === 0) {
    return { high: null, low: null };
  }
  let high = -Infinity;
  let low = Infinity;
  for (const bar of bars) {
    high = Math.max(high, bar.h);
    low = Math.min(low, bar.l);
  }
  return { high, low };
}

export function detectSpike(
  bars: MinuteBar[],
  windowMinutes = 60,
  threshold = 3,
): SpikeSignal | undefined {
  if (bars.length === 0) {
    return undefined;
  }
  const window = bars.slice(-windowMinutes);
  if (window.length < 2) {
    return undefined;
  }
  const closes = window.map((bar) => bar.c);
  const mean = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  const variance =
    closes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(closes.length - 1, 1);
  const stddev = Math.sqrt(variance);
  if (stddev === 0) {
    return undefined;
  }
  const latest = window[window.length - 1];
  const delta = latest.c - mean;
  if (Math.abs(delta) >= threshold * stddev) {
    return {
      start: window[0].t,
      end: latest.t,
      magnitude: delta / stddev,
    };
  }
  return undefined;
}

export function summarizeSignals(bars: MinuteBar[]): SignalSummary {
  const vwap = computeVWAP(bars);
  const { high, low } = computeHighLow(bars);
  const change = computeOneMinuteChange(bars);
  const spike = detectSpike(bars);
  return {
    vwap,
    high,
    low,
    oneMinuteChange: change,
    spike,
  };
}
