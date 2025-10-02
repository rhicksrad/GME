import { describe, expect, it } from 'vitest';

import { computeHighLow, computeOneMinuteChange, computeVWAP, detectSpike, summarizeSignals } from './signals';
import type { MinuteBar } from './types';

const sampleBars: MinuteBar[] = [
  { t: 0, o: 10, h: 11, l: 9.5, c: 10.5, v: 1000 },
  { t: 60_000, o: 10.5, h: 11.2, l: 10.2, c: 11, v: 1500 },
  { t: 120_000, o: 11, h: 11.5, l: 10.8, c: 11.4, v: 900 },
];

describe('signals', () => {
  it('computes VWAP', () => {
    const vwap = computeVWAP(sampleBars);
    expect(vwap).toBeGreaterThan(10.7);
    expect(vwap).toBeLessThan(10.9);
  });

  it('calculates one minute change', () => {
    expect(computeOneMinuteChange(sampleBars)).toBeCloseTo(0.4, 1);
  });

  it('returns high and low', () => {
    expect(computeHighLow(sampleBars)).toEqual({ high: 11.5, low: 9.5 });
  });

  it('detects spike when deviation large', () => {
    const bars: MinuteBar[] = [];
    for (let index = 0; index < 60; index += 1) {
      bars.push({ t: index * 60_000, o: 10, h: 10.2, l: 9.8, c: 10, v: 1000 });
    }
    bars.push({ t: 60 * 60_000, o: 10, h: 14, l: 10, c: 14, v: 1200 });
    const spike = detectSpike(bars);
    expect(spike).toBeDefined();
    expect(spike?.magnitude).toBeGreaterThan(3);
  });

  it('summarizes signals', () => {
    const summary = summarizeSignals(sampleBars);
    expect(summary.vwap).toBeTruthy();
    expect(summary.high).toBe(11.5);
    expect(summary.low).toBe(9.5);
    expect(summary.oneMinuteChange).toBeCloseTo(0.4, 1);
  });
});
