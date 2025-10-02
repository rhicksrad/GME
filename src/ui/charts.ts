import uPlot, { type AlignedData } from 'uplot';
import type { MinuteBar } from '../types';

export interface CandleChartController {
  update(bars: MinuteBar[]): void;
  destroy(): void;
}

function prepareCandleData(bars: MinuteBar[]): AlignedData {
  const times = new Float64Array(bars.length);
  const opens = new Float64Array(bars.length);
  const highs = new Float64Array(bars.length);
  const lows = new Float64Array(bars.length);
  const closes = new Float64Array(bars.length);

  bars.forEach((bar, index) => {
    times[index] = bar.ts / 1000;
    opens[index] = bar.open;
    highs[index] = bar.high;
    lows[index] = bar.low;
    closes[index] = bar.close;
  });

  return [times, opens, highs, lows, closes];
}

function drawCandles(): uPlot.Plugin {
  return {
    hooks: {
      draw: [
        (chart) => {
          const ctx = chart.ctx;
          const data = chart.data as AlignedData;
          const times = data[0];
          const opens = data[1];
          const highs = data[2];
          const lows = data[3];
          const closes = data[4];
          const defaultSpacing = times.length > 1
            ? Math.abs(chart.valToPos(times[1], 'x', true) - chart.valToPos(times[0], 'x', true))
            : 18;
          const width = Math.max(4, Math.min(24, defaultSpacing * 0.6));

          ctx.save();
          for (let i = 0; i < times.length; i += 1) {
            const open = opens[i];
            const high = highs[i];
            const low = lows[i];
            const close = closes[i];
            if (open == null || high == null || low == null || close == null) {
              continue;
            }
            const x = chart.valToPos(times[i], 'x', true);
            const openY = chart.valToPos(open, 'y', true);
            const closeY = chart.valToPos(close, 'y', true);
            const highY = chart.valToPos(high, 'y', true);
            const lowY = chart.valToPos(low, 'y', true);
            const candleColor = close >= open ? '#34d399' : '#f97316';

            ctx.strokeStyle = candleColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, highY);
            ctx.lineTo(x, lowY);
            ctx.stroke();

            const bodyTop = Math.min(openY, closeY);
            const bodyBottom = Math.max(openY, closeY);
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);
            ctx.fillStyle = candleColor;
            ctx.fillRect(x - width / 2, bodyTop, width, bodyHeight);
          }
          ctx.restore();
        }
      ]
    }
  };
}

export function createCandleChart(container: HTMLElement): CandleChartController {
  const chart = new uPlot(
    {
      width: container.clientWidth,
      height: 280,
      tzDate: (ts) => new Date(ts * 1000),
      series: [
        {},
        {
          label: 'Open',
          show: false
        },
        {
          label: 'High',
          show: false
        },
        {
          label: 'Low',
          show: false
        },
        {
          label: 'Close',
          points: { show: false },
          value: (_, value) => (value == null ? '' : `$${value.toFixed(2)}`)
        }
      ],
      axes: [
        {
          grid: { stroke: 'rgba(148, 163, 184, 0.25)' },
          label: 'Time'
        },
        {
          scale: 'y',
          grid: { stroke: 'rgba(148, 163, 184, 0.2)' },
          label: 'Price'
        }
      ],
      scales: {
        x: { time: true }
      },
      hooks: {
        init: [
          (u) => {
            const resizeObserver = new ResizeObserver(() => {
              u.setSize({ width: container.clientWidth, height: 280 });
            });
            resizeObserver.observe(container);
          }
        ]
      },
      plugins: [drawCandles()]
    },
    [new Float64Array(0), new Float64Array(0), new Float64Array(0), new Float64Array(0), new Float64Array(0)],
    container
  );

  return {
    update(bars: MinuteBar[]) {
      chart.setData(prepareCandleData(bars));
    },
    destroy() {
      chart.destroy();
    }
  };
}

export interface VolumeChartController {
  update(bars: MinuteBar[]): void;
  destroy(): void;
}

function prepareVolumeData(bars: MinuteBar[]): AlignedData {
  const times = new Float64Array(bars.length);
  const volumes = new Float64Array(bars.length);

  bars.forEach((bar, index) => {
    times[index] = bar.ts / 1000;
    volumes[index] = bar.volume;
  });

  return [times, volumes];
}

function drawVolumeBars(): uPlot.Plugin {
  return {
    hooks: {
      draw: [
        (chart) => {
          const data = chart.data as AlignedData;
          const xs = data[0];
          const ys = data[1];
          const ctx = chart.ctx;
          const defaultSpacing = xs.length > 1
            ? Math.abs(chart.valToPos(xs[1], 'x', true) - chart.valToPos(xs[0], 'x', true))
            : 18;
          const width = Math.max(4, Math.min(24, defaultSpacing * 0.6));
          const bottom = chart.bbox.top + chart.bbox.height;

          ctx.save();
          ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.strokeStyle = 'rgba(14, 165, 233, 0.9)';
          for (let i = 0; i < xs.length; i += 1) {
            const volume = ys[i];
            if (volume == null) {
              continue;
            }
            const x = chart.valToPos(xs[i], 'x', true);
            const y = chart.valToPos(volume, 'y', true);
            ctx.fillRect(x - width / 2, y, width, bottom - y);
            ctx.strokeRect(x - width / 2, y, width, bottom - y);
          }
          ctx.restore();
        }
      ]
    }
  };
}

export function createVolumeChart(container: HTMLElement): VolumeChartController {
  const chart = new uPlot(
    {
      width: container.clientWidth,
      height: 180,
      tzDate: (ts) => new Date(ts * 1000),
      series: [
        {},
        {
          label: 'Volume',
          value: (_, value) => (value == null ? '' : value.toLocaleString()),
          paths: () => null,
          points: { show: false }
        }
      ],
      axes: [
        { grid: { stroke: 'rgba(148, 163, 184, 0.15)' } },
        {
          scale: 'y',
          grid: { stroke: 'rgba(148, 163, 184, 0.15)' },
          label: 'Volume'
        }
      ],
      scales: {
        x: { time: true }
      },
      hooks: {
        init: [
          (u) => {
            const resizeObserver = new ResizeObserver(() => {
              u.setSize({ width: container.clientWidth, height: 180 });
            });
            resizeObserver.observe(container);
          }
        ]
      },
      plugins: [drawVolumeBars()]
    },
    [new Float64Array(0), new Float64Array(0)],
    container
  );

  return {
    update(bars: MinuteBar[]) {
      chart.setData(prepareVolumeData(bars));
    },
    destroy() {
      chart.destroy();
    }
  };
}
