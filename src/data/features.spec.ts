import { describe, expect, it } from 'vitest';

import { deriveFeatureState, expandCandlesToMinutes } from './features';
import type { Candle } from './workerClient';

describe('deriveFeatureState', () => {
  it('prefers 1-minute candles when available', () => {
    const state = deriveFeatureState({
      quote: { ok: true, status: 200 },
      minuteCandles: { ok: true, status: 200 },
      fiveMinuteCandles: { ok: true, status: 200 },
      options: { ok: true, status: 200 },
    });
    expect(state.candles).toBe('1');
    expect(state.options).toBe(true);
    expect(state.limited).toBe(false);
  });

  it('falls back to 5-minute candles and marks limited', () => {
    const state = deriveFeatureState({
      quote: { ok: true, status: 200 },
      minuteCandles: { ok: false, status: 403 },
      fiveMinuteCandles: { ok: true, status: 200 },
      options: { ok: true, status: 200 },
    });
    expect(state.candles).toBe('5');
    expect(state.limited).toBe(true);
  });

  it('disables options when unavailable', () => {
    const state = deriveFeatureState({
      quote: { ok: true, status: 200 },
      minuteCandles: { ok: true, status: 200 },
      options: { ok: false, status: 403 },
    });
    expect(state.options).toBe(false);
    expect(state.limited).toBe(true);
  });
});

describe('expandCandlesToMinutes', () => {
  it('returns 1-minute bars unchanged', () => {
    const candles: Candle[] = [
      { t: 1700000000, o: 10, h: 12, l: 9, c: 11, v: 100 },
    ];
    const bars = expandCandlesToMinutes(candles, '1');
    expect(bars).toHaveLength(1);
    expect(bars[0]).toEqual({ t: 1700000000 * 1000, o: 10, h: 12, l: 9, c: 11, v: 100 });
  });

  it('upsamples 5-minute bars into 1-minute slices', () => {
    const candles: Candle[] = [
      { t: 1700000000, o: 20, h: 22, l: 19, c: 21, v: 500 },
    ];
    const bars = expandCandlesToMinutes(candles, '5');
    expect(bars).toHaveLength(5);
    expect(bars[0].t).toBe(1700000000 * 1000);
    expect(bars[4].t).toBe(1700000000 * 1000 + 4 * 60_000);
    expect(bars[0].o).toBe(20);
    expect(bars[1].o).toBe(21);
    expect(bars.every((bar) => bar.c === 21)).toBe(true);
    const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
    expect(totalVolume).toBeCloseTo(500);
  });
});
