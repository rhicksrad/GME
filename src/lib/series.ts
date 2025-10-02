export const MAX_BARS = 390;

/**
 * If the last timestamp equals `t`, replace that bar.
 * Otherwise append a new bar. Always clamp to MAX_BARS.
 */
export function replaceOrAppendBar(
  tArr: number[],
  oArr: number[],
  hArr: number[],
  lArr: number[],
  cArr: number[],
  vArr: number[],
  bar: { t: number; o: number; h: number; l: number; c: number; v: number },
  cap = MAX_BARS,
) {
  const n = tArr.length;
  if (n > 0 && tArr[n - 1] === bar.t) {
    // replace last bar (NBA fix pattern)
    oArr[n - 1] = oArr[n - 1] ?? bar.o;
    hArr[n - 1] = Math.max(hArr[n - 1], bar.h);
    lArr[n - 1] = Math.min(lArr[n - 1], bar.l);
    cArr[n - 1] = bar.c;
    vArr[n - 1] = (vArr[n - 1] || 0) + (bar.v || 0);
  } else {
    tArr.push(bar.t);
    oArr.push(bar.o);
    hArr.push(bar.h);
    lArr.push(bar.l);
    cArr.push(bar.c);
    vArr.push(bar.v);
  }
  clampAll([tArr, oArr, hArr, lArr, cArr, vArr], cap);
}

export function clampAll(series: number[][], cap = MAX_BARS) {
  if (series[0].length <= cap) return;
  const start = series[0].length - cap;
  for (const arr of series) {
    arr.splice(0, start); // NBA page used splice for in-place clamp
  }
}

/** Minute key used everywhere to dedup */
export function minuteKey(tsMs: number): number {
  return Math.floor(tsMs / 60000) * 60000;
}
