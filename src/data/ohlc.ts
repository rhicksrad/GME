import { MAX_BARS, replaceOrAppendBar, minuteKey } from '../lib/series';

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export class Bars {
  public t: number[] = [];
  public o: number[] = [];
  public h: number[] = [];
  public l: number[] = [];
  public c: number[] = [];
  public v: number[] = [];
  private cap = MAX_BARS;

  setCap(n: number) {
    this.cap = Math.max(1, n | 0);
  }

  /** Backfill candles: replace-if-same-t else append, then clamp */
  applyBackfill(b: Bar) {
    replaceOrAppendBar(this.t, this.o, this.h, this.l, this.c, this.v, b, this.cap);
  }

  /** Live trades → roll into current minute bar */
  upsertTrade(tsMs: number, price: number, size = 0) {
    const t = minuteKey(tsMs);
    const n = this.t.length;
    if (n && this.t[n - 1] === t) {
      // mutate last
      this.h[n - 1] = Math.max(this.h[n - 1], price);
      this.l[n - 1] = Math.min(this.l[n - 1], price);
      this.c[n - 1] = price;
      this.v[n - 1] += size;
      return;
    }
    replaceOrAppendBar(
      this.t,
      this.o,
      this.h,
      this.l,
      this.c,
      this.v,
      { t, o: price, h: price, l: price, c: price, v: size },
      this.cap,
    );
  }

  arrays() {
    return { t: this.t, o: this.o, h: this.h, l: this.l, c: this.c, v: this.v };
  }

  values(): Bar[] {
    const result: Bar[] = [];
    for (let i = 0; i < this.t.length; i += 1) {
      result.push({
        t: this.t[i],
        o: this.o[i],
        h: this.h[i],
        l: this.l[i],
        c: this.c[i],
        v: this.v[i],
      });
    }
    return result;
  }
}
