// src/data/ohlc.ts
export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export class Bars {
  private t: number[] = [];
  private o: number[] = [];
  private h: number[] = [];
  private l: number[] = [];
  private c: number[] = [];
  private v: number[] = [];
  private cap = 390; // ~1 trading day of 1-min bars

  setCap(n: number) { this.cap = Math.max(1, n | 0); }

  push(b: Bar) {
    this.t.push(b.t); this.o.push(b.o); this.h.push(b.h);
    this.l.push(b.l); this.c.push(b.c); this.v.push(b.v);
    if (this.t.length > this.cap) {
      this.t.shift(); this.o.shift(); this.h.shift();
      this.l.shift(); this.c.shift(); this.v.shift();
    }
  }

  upsertFromTrade(tsMs: number, price: number, size: number) {
    const minute = Math.floor(tsMs / 60000) * 60000;
    const len = this.t.length;
    if (len && this.t[len - 1] === minute) {
      // update last
      this.h[len - 1] = Math.max(this.h[len - 1], price);
      this.l[len - 1] = Math.min(this.l[len - 1], price);
      this.c[len - 1] = price;
      this.v[len - 1] += size;
      return;
    }
    // new bar
    this.push({ t: minute, o: price, h: price, l: price, c: price, v: size });
  }

  applyBackfill(b: Bar) {
    // avoid duplicates when candles + trades overlap
    const idx = this.t.indexOf(b.t);
    if (idx === -1) this.push(b);
  }

  arrays() {
    return { t: this.t, o: this.o, h: this.h, l: this.l, c: this.c, v: this.v };
  }
}
