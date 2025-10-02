export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export class Bars {
  private map = new Map<number, Bar>(); // keyed by minute epoch ms
  private order: number[] = [];
  private cap = 390;

  setCap(n: number) { this.cap = Math.max(1, n|0); }

  applyBackfill(b: Bar) {
    if (!this.map.has(b.t)) this.insert(b);
  }

  upsertTrade(tsMs: number, price: number, size = 0) {
    const minute = Math.floor(tsMs / 60000) * 60000;
    const existing = this.map.get(minute);
    if (existing) {
      existing.h = Math.max(existing.h, price);
      existing.l = Math.min(existing.l, price);
      existing.c = price;
      existing.v += size;
    } else {
      this.insert({ t: minute, o: price, h: price, l: price, c: price, v: size });
    }
  }

  private insert(b: Bar) {
    this.map.set(b.t, { ...b });
    // keep order sorted but cheap: append then sort occasionally
    this.order.push(b.t);
    if (this.order.length > 1 && this.order[this.order.length - 2] > b.t) {
      this.order.sort((a, z) => a - z);
    }
    // enforce cap
    while (this.order.length > this.cap) {
      const oldest = this.order.shift()!;
      this.map.delete(oldest);
    }
  }

  arrays() {
    const t: number[] = [];
    const c: number[] = [];
    for (const ts of this.order) {
      const b = this.map.get(ts)!;
      t.push(b.t); c.push(b.c);
    }
    return { t, c };
  }

  values(): Bar[] {
    return this.order.map((ts) => ({ ...this.map.get(ts)! }));
  }
}
