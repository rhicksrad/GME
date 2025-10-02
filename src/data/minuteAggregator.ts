import type { MinuteBar, Trade } from '../types';
import { Bars, type Bar } from './ohlc';
import { minuteKey } from '../lib/series';

function normalizeBar(bar: MinuteBar): Bar {
  return {
    t: minuteKey(bar.t),
    o: bar.o,
    h: bar.h,
    l: bar.l,
    c: bar.c,
    v: bar.v,
  };
}

export class MinuteOhlcAggregator {
  private readonly limit: number;
  private store: Bars;

  constructor(limit = 390) {
    this.limit = limit;
    this.store = new Bars();
    this.store.setCap(limit);
  }

  private reset() {
    this.store = new Bars();
    this.store.setCap(this.limit);
  }

  seed(seedBars: MinuteBar[]): void {
    this.reset();
    const normalized = [...seedBars]
      .map(normalizeBar)
      .sort((a, b) => a.t - b.t);
    for (const bar of normalized) {
      this.store.applyBackfill(bar);
    }
  }

  ingestTrade(trade: Trade): MinuteBar {
    const timestamp = typeof trade.timestamp === 'number' ? trade.timestamp : Date.now();
    this.store.upsertTrade(timestamp, trade.price, trade.volume);
    return this.getBar(minuteKey(timestamp));
  }

  applySnapshot(snapshot: MinuteBar[]): void {
    if (snapshot.length === 0) {
      return;
    }
    this.reset();
    const normalized = [...snapshot]
      .map(normalizeBar)
      .sort((a, b) => a.t - b.t);
    for (const bar of normalized) {
      this.store.applyBackfill(bar);
    }
  }

  touchPrice(price: number, timestamp: number): void {
    const ts = typeof timestamp === 'number' ? timestamp : Date.now();
    this.store.upsertTrade(ts, price, 0);
  }

  getBars(): MinuteBar[] {
    return this.store.values().map((bar) => ({ ...bar }));
  }

  getArrays() {
    return this.store.arrays();
  }

  private getBar(minute: number): MinuteBar {
    const bars = this.store.values();
    const found = bars.find((bar) => bar.t === minute);
    if (found) {
      return { ...found };
    }
    return { t: minute, o: 0, h: 0, l: 0, c: 0, v: 0 };
  }
}
