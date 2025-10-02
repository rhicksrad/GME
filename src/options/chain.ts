import type { OptRow } from '../data/optionsClient';

export type MoneynessBucket = 'deepITM' | 'itm' | 'atm' | 'otm' | 'deepOTM';

interface BaselineSample {
  date: string;
  value: number;
}

interface VolumeBaselineEntry {
  samples: BaselineSample[];
  average: number;
  updatedAt: number;
}

interface IvBaselineEntry {
  samples: BaselineSample[];
  median: number;
  mean: number;
  stdDev: number;
  updatedAt: number;
}

export interface BaselineSnapshot {
  volume: Record<string, VolumeBaselineEntry>;
  iv: Record<string, IvBaselineEntry>;
}

export interface IvStats {
  median: number;
  mean: number;
  stdDev: number;
}

export interface BaselineStore {
  recordVolume(occ: string, timestamp: number, volume: number): number | null;
  recordIv(key: string, timestamp: number, iv: number): IvStats | null;
  getVolumeAverage(occ: string): number | null;
  getIvStats(key: string): IvStats | null;
  toJSON(): BaselineSnapshot;
}

const MAX_SAMPLES = 30;

export const MONEYNESS_ORDER: MoneynessBucket[] = ['deepITM', 'itm', 'atm', 'otm', 'deepOTM'];

export function createBaselineStore(snapshot?: BaselineSnapshot): BaselineStore {
  const volumeMap = new Map<string, VolumeBaselineEntry>();
  const ivMap = new Map<string, IvBaselineEntry>();

  if (snapshot) {
    Object.entries(snapshot.volume ?? {}).forEach(([occ, entry]) => {
      if (entry && Array.isArray(entry.samples)) {
        volumeMap.set(occ, {
          samples: entry.samples.slice(-MAX_SAMPLES),
          average: entry.average ?? average(entry.samples.map((sample) => sample.value)),
          updatedAt: entry.updatedAt ?? Date.now(),
        });
      }
    });
    Object.entries(snapshot.iv ?? {}).forEach(([key, entry]) => {
      if (entry && Array.isArray(entry.samples)) {
        const stats = computeStats(entry.samples.map((sample) => sample.value));
        ivMap.set(key, {
          samples: entry.samples.slice(-MAX_SAMPLES),
          median: entry.median ?? stats.median,
          mean: entry.mean ?? stats.mean,
          stdDev: entry.stdDev ?? stats.stdDev,
          updatedAt: entry.updatedAt ?? Date.now(),
        });
      }
    });
  }

  function recordVolume(occ: string, timestamp: number, volume: number): number | null {
    if (!Number.isFinite(volume) || volume <= 0) {
      return getVolumeAverage(occ);
    }
    const entry = volumeMap.get(occ) ?? { samples: [], average: 0, updatedAt: 0 };
    upsertSample(entry.samples, timestamp, volume);
    entry.average = average(entry.samples.map((sample) => sample.value));
    entry.updatedAt = Date.now();
    volumeMap.set(occ, entry);
    return entry.average || null;
  }

  function recordIv(key: string, timestamp: number, iv: number): IvStats | null {
    if (!Number.isFinite(iv) || iv <= 0) {
      return getIvStats(key);
    }
    const entry = ivMap.get(key) ?? { samples: [], median: 0, mean: 0, stdDev: 0, updatedAt: 0 };
    upsertSample(entry.samples, timestamp, iv);
    const stats = computeStats(entry.samples.map((sample) => sample.value));
    entry.median = stats.median;
    entry.mean = stats.mean;
    entry.stdDev = stats.stdDev;
    entry.updatedAt = Date.now();
    ivMap.set(key, entry);
    return stats;
  }

  function getVolumeAverage(occ: string): number | null {
    return volumeMap.get(occ)?.average ?? null;
  }

  function getIvStats(key: string): IvStats | null {
    const entry = ivMap.get(key);
    if (!entry) {
      return null;
    }
    return { median: entry.median, mean: entry.mean, stdDev: entry.stdDev };
  }

  function toJSON(): BaselineSnapshot {
    const volume: Record<string, VolumeBaselineEntry> = {};
    const iv: Record<string, IvBaselineEntry> = {};
    volumeMap.forEach((entry, key) => {
      volume[key] = {
        samples: entry.samples.slice(-MAX_SAMPLES),
        average: entry.average,
        updatedAt: entry.updatedAt,
      };
    });
    ivMap.forEach((entry, key) => {
      iv[key] = {
        samples: entry.samples.slice(-MAX_SAMPLES),
        median: entry.median,
        mean: entry.mean,
        stdDev: entry.stdDev,
        updatedAt: entry.updatedAt,
      };
    });
    return { volume, iv };
  }

  return { recordVolume, recordIv, getVolumeAverage, getIvStats, toJSON };
}

export function toOccSymbol(underlying: string, row: OptRow): string {
  const base = underlying.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const [year, month, day] = row.exp.split('-');
  const yy = (year ?? '').slice(-2).padStart(2, '0');
  const mm = (month ?? '').padStart(2, '0');
  const dd = (day ?? '').padStart(2, '0');
  const strike = Math.round(row.strike * 1000)
    .toString()
    .padStart(8, '0');
  return `${base}${yy}${mm}${dd}${row.type}${strike}`;
}

export function getExpiryKey(row: OptRow): string {
  return `${row.exp}|${row.type}`;
}

export function classifyMoneyness(row: OptRow, spot: number): MoneynessBucket {
  if (!Number.isFinite(spot) || spot <= 0) {
    return 'atm';
  }
  const diff = row.type === 'C' ? (row.strike - spot) / spot : (spot - row.strike) / spot;
  if (row.type === 'C') {
    if (diff <= -0.2) {
      return 'deepITM';
    }
    if (diff <= -0.05) {
      return 'itm';
    }
    if (Math.abs(diff) < 0.05) {
      return 'atm';
    }
    if (diff < 0.2) {
      return 'otm';
    }
    return 'deepOTM';
  }
  if (diff >= 0.2) {
    return 'deepITM';
  }
  if (diff >= 0.05) {
    return 'itm';
  }
  if (Math.abs(diff) < 0.05) {
    return 'atm';
  }
  if (diff > -0.2) {
    return 'otm';
  }
  return 'deepOTM';
}

export function listExpiries(rows: OptRow[]): string[] {
  const expiries = new Set<string>();
  rows.forEach((row) => expiries.add(row.exp));
  return Array.from(expiries).sort();
}

function upsertSample(samples: BaselineSample[], timestamp: number, value: number) {
  const date = toDateKey(timestamp);
  const index = samples.findIndex((sample) => sample.date === date);
  if (index >= 0) {
    samples[index] = { date, value };
  } else {
    samples.push({ date, value });
  }
  samples.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  while (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
}

function toDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toISOString().slice(0, 10);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function computeStats(values: number[]): IvStats {
  if (values.length === 0) {
    return { median: 0, mean: 0, stdDev: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const mean = average(values);
  const variance =
    values.length > 1
      ? values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  const stdDev = Math.sqrt(variance);
  return { median, mean, stdDev };
}
