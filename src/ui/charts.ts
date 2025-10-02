import uPlot from 'uplot';

import type { MinuteBar } from '../types';

function toSeconds(timestamp: number): number {
  return Math.floor(timestamp / 1000);
}

function buildPriceData(bars: MinuteBar[]): uPlot.AlignedData {
  const x: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  for (const bar of bars) {
    x.push(toSeconds(bar.t));
    open.push(bar.o);
    high.push(bar.h);
    low.push(bar.l);
    close.push(bar.c);
  }
  return [x, open, high, low, close];
}

function buildVolumeData(bars: MinuteBar[]): uPlot.AlignedData {
  const x: number[] = [];
  const volume: number[] = [];
  for (const bar of bars) {
    x.push(toSeconds(bar.t));
    volume.push(bar.v);
  }
  return [x, volume];
}

function drawCandles(u: uPlot) {
  const data = u.data as unknown as number[][];
  if (data.length < 5) {
    return;
  }
  const times = data[0];
  const opens = data[1];
  const highs = data[2];
  const lows = data[3];
  const closes = data[4];
  const ctx = u.ctx;
  ctx.save();
  const width = Math.max(1, Math.floor(u.bbox.width / Math.max(times.length, 1) * 0.6));
  for (let i = 0; i < times.length; i += 1) {
    const x = Math.round(u.valToPos(times[i], 'x', true));
    const highY = u.valToPos(highs[i], 'y', true);
    const lowY = u.valToPos(lows[i], 'y', true);
    const openY = u.valToPos(opens[i], 'y', true);
    const closeY = u.valToPos(closes[i], 'y', true);
    const bullish = closes[i] >= opens[i];
    ctx.strokeStyle = bullish ? '#22c55e' : '#f97316';
    ctx.fillStyle = bullish ? 'rgba(34,197,94,0.25)' : 'rgba(248,113,113,0.25)';
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
    const bodyY = Math.min(openY, closeY);
    ctx.fillRect(x - width / 2, bodyY, width, bodyHeight);
    ctx.strokeRect(x - width / 2, bodyY, width, bodyHeight);
  }
  ctx.restore();
}

function drawVolumes(u: uPlot) {
  const data = u.data as unknown as number[][];
  if (data.length < 2) {
    return;
  }
  const times = data[0];
  const volumes = data[1];
  const ctx = u.ctx;
  ctx.save();
  const width = Math.max(1, Math.floor(u.bbox.width / Math.max(times.length, 1) * 0.8));
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  for (let i = 0; i < times.length; i += 1) {
    const x = Math.round(u.valToPos(times[i], 'x', true));
    const baseY = u.valToPos(0, 'y', true);
    const valueY = u.valToPos(volumes[i], 'y', true);
    const height = baseY - valueY;
    ctx.fillRect(x - width / 2, valueY, width, height);
  }
  ctx.restore();
}

interface ResizeSubscription {
  disconnect(): void;
}

function createResizeObserver(chart: uPlot, element: HTMLElement): ResizeSubscription {
  let frame: number | null = null;
  let lastWidth = -1;
  let lastHeight = -1;

  const applySize = () => {
    frame = null;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    if (width === lastWidth && height === lastHeight) {
      return;
    }
    lastWidth = width;
    lastHeight = height;
    chart.setSize({ width, height });
  };

  const observer = new ResizeObserver(() => {
    if (frame != null) {
      window.cancelAnimationFrame(frame);
    }
    frame = window.requestAnimationFrame(applySize);
  });
  observer.observe(element);

  return {
    disconnect() {
      if (frame != null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      observer.disconnect();
    },
  };
}

export interface PriceChartHandle {
  update(bars: MinuteBar[]): void;
  destroy(): void;
}

export function createPriceChart(container: HTMLElement): PriceChartHandle {
  const chart = new uPlot(
    {
      width: container.clientWidth,
      height: container.clientHeight,
      axes: [
        { stroke: '#94a3b8', grid: { stroke: 'rgba(148, 163, 184, 0.15)' } },
        { stroke: '#94a3b8', grid: { stroke: 'rgba(148, 163, 184, 0.15)' } },
      ],
      scales: {
        x: { time: true },
      },
      series: [
        {},
        { show: false },
        { show: false },
        { show: false },
        { show: true, stroke: 'transparent', paths: () => null },
      ],
      hooks: {
        draw: [drawCandles],
      },
    },
    buildPriceData([]),
    container,
  );
  const observer = createResizeObserver(chart, container);
  return {
    update(bars: MinuteBar[]) {
      chart.setData(buildPriceData(bars));
    },
    destroy() {
      observer.disconnect();
      chart.destroy();
    },
  };
}

export interface VolumeChartHandle {
  update(bars: MinuteBar[]): void;
  destroy(): void;
}

export function createVolumeChart(container: HTMLElement): VolumeChartHandle {
  const chart = new uPlot(
    {
      width: container.clientWidth,
      height: container.clientHeight,
      axes: [
        { stroke: '#94a3b8', grid: { stroke: 'rgba(148, 163, 184, 0.1)' } },
        { stroke: '#94a3b8', grid: { stroke: 'rgba(148, 163, 184, 0.1)' } },
      ],
      scales: {
        x: { time: true },
      },
      series: [{}, { show: true, stroke: 'transparent', paths: () => null }],
      hooks: {
        draw: [drawVolumes],
      },
    },
    buildVolumeData([]),
    container,
  );
  const observer = createResizeObserver(chart, container);
  return {
    update(bars: MinuteBar[]) {
      chart.setData(buildVolumeData(bars));
    },
    destroy() {
      observer.disconnect();
      chart.destroy();
    },
  };
}
