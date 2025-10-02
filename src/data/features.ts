import type { Candle, CandleResolution } from './workerClient';
import type { MinuteBar } from '../types';

export interface EndpointStatus {
  ok: boolean;
  status?: number;
}

export interface FeatureState {
  quote: boolean;
  candles: CandleResolution | null;
  options: boolean;
  limited: boolean;
}

function isLimited(quote: boolean, candles: CandleResolution | null, options: boolean): boolean {
  return !quote || candles !== '1' || !options;
}

export function deriveFeatureState(input: {
  quote: EndpointStatus;
  minuteCandles: EndpointStatus;
  fiveMinuteCandles?: EndpointStatus;
  options?: EndpointStatus;
}): FeatureState {
  const quoteAvailable = input.quote.ok;
  const candleResolution: CandleResolution | null = input.minuteCandles.ok
    ? '1'
    : input.fiveMinuteCandles?.ok
    ? '5'
    : null;
  const optionsAvailable = input.options?.ok ?? true;
  return {
    quote: quoteAvailable,
    candles: candleResolution,
    options: optionsAvailable,
    limited: isLimited(quoteAvailable, candleResolution, optionsAvailable),
  };
}

export function updateLimited(state: FeatureState): FeatureState {
  return {
    ...state,
    limited: isLimited(state.quote, state.candles, state.options),
  };
}

export function ensureMilliseconds(value: number): number {
  return value > 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1000);
}

export function expandCandlesToMinutes(candles: Candle[], resolution: CandleResolution): MinuteBar[] {
  if (resolution === '1') {
    return candles.map((bar) => ({
      t: ensureMilliseconds(bar.t),
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      v: bar.v,
    }));
  }

  const minutesPerBar = 5;
  const result: MinuteBar[] = [];
  for (const candle of candles) {
    const start = ensureMilliseconds(candle.t);
    const volumePerMinute = candle.v / minutesPerBar;
    for (let i = 0; i < minutesPerBar; i += 1) {
      result.push({
        t: start + i * 60_000,
        o: i === 0 ? candle.o : candle.c,
        h: candle.h,
        l: candle.l,
        c: candle.c,
        v: volumePerMinute,
      });
    }
  }
  return result;
}
