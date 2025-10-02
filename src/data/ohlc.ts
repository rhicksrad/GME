import type { MinuteBar, Trade } from '../types';

const MINUTE = 60_000;

function minuteStart(timestamp: number): number {
  return Math.floor(timestamp / MINUTE) * MINUTE;
}

export class MinuteOhlcAggregator {
  private readonly limit: number;

  private bars: MinuteBar[] = [];

  constructor(limit = 390) {
    this.limit = limit;
  }

  seed(seedBars: MinuteBar[]): void {
    const sorted = [...seedBars]
      .map((bar) => ({
        ...bar,
        t: minuteStart(bar.t),
      }))
      .sort((a, b) => a.t - b.t);
    this.bars = sorted.slice(-this.limit);
  }

  ingestTrade(trade: Trade): MinuteBar {
    const timestamp = typeof trade.timestamp === 'number' ? trade.timestamp : Date.now();
    const bucket = minuteStart(timestamp);
    const existing = this.bars.at(-1);
    if (existing && existing.t === bucket) {
      const close = trade.price;
      existing.c = close;
      existing.h = Math.max(existing.h, close);
      existing.l = Math.min(existing.l, close);
      existing.v += trade.volume;
      return existing;
    }

    const newBar: MinuteBar = {
      t: bucket,
      o: trade.price,
      h: trade.price,
      l: trade.price,
      c: trade.price,
      v: trade.volume,
    };
    this.bars.push(newBar);
    if (this.bars.length > this.limit) {
      this.bars = this.bars.slice(-this.limit);
    }
    return newBar;
  }

  applySnapshot(snapshot: MinuteBar[]): void {
    if (snapshot.length === 0) {
      return;
    }
    const normalized = snapshot
      .map((bar) => ({ ...bar, t: minuteStart(bar.t) }))
      .sort((a, b) => a.t - b.t);
    const latest = this.bars.at(-1);
    if (!latest) {
      this.bars = normalized.slice(-this.limit);
      return;
    }
    const merged = [...this.bars];
    for (const bar of normalized) {
      const index = merged.findIndex((existing) => existing.t === bar.t);
      if (index >= 0) {
        merged[index] = { ...merged[index], ...bar };
      } else {
        merged.push(bar);
      }
    }
    this.bars = merged
      .sort((a, b) => a.t - b.t)
      .slice(-this.limit);
  }

  touchPrice(price: number, timestamp: number): void {
    const bucket = minuteStart(timestamp);
    const latest = this.bars.at(-1);
    if (!latest || latest.t < bucket) {
      const bar: MinuteBar = {
        t: bucket,
        o: price,
        h: price,
        l: price,
        c: price,
        v: 0,
      };
      this.bars.push(bar);
      if (this.bars.length > this.limit) {
        this.bars = this.bars.slice(-this.limit);
      }
      return;
    }
    latest.c = price;
    latest.h = Math.max(latest.h, price);
    latest.l = Math.min(latest.l, price);
  }

  getBars(): MinuteBar[] {
    return [...this.bars];
  }
}
