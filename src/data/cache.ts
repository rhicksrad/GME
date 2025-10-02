import type { MinuteBar, OptionSnapshot, PriceTick } from '../types';

export class RingBuffer<T> {
  private buffer: T[];
  private index = 0;
  private filled = false;

  constructor(private readonly capacity: number) {
    this.buffer = new Array<T>(capacity);
  }

  push(value: T): void {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.capacity;
    if (this.index === 0) {
      this.filled = true;
    }
  }

  toArray(): T[] {
    if (!this.filled) {
      return this.buffer.slice(0, this.index);
    }

    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }

  latest(): T | undefined {
    if (!this.filled && this.index === 0) {
      return undefined;
    }

    const idx = this.filled ? (this.index + this.capacity - 1) % this.capacity : this.index - 1;
    return this.buffer[idx];
  }

  size(): number {
    return this.filled ? this.capacity : this.index;
  }
}

export interface DataCache {
  ticks: RingBuffer<PriceTick>;
  minuteBars: RingBuffer<MinuteBar>;
  optionSnapshots: RingBuffer<OptionSnapshot>;
}

export function createDataCache(): DataCache {
  return {
    ticks: new RingBuffer<PriceTick>(500),
    minuteBars: new RingBuffer<MinuteBar>(390),
    optionSnapshots: new RingBuffer<OptionSnapshot>(120)
  };
}

export function accumulateVolume(bars: MinuteBar[]): number {
  return bars.reduce((sum, bar) => sum + bar.volume, 0);
}
