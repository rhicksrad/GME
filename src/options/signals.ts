import type { OptRow } from '../data/optionsClient';
import { classifyMoneyness, MONEYNESS_ORDER, type MoneynessBucket } from './chain';

export interface ExpiryTotals {
  exp: string;
  callVolume: number;
  putVolume: number;
  callOpenInterest: number;
  putOpenInterest: number;
}

export interface MoneynessCell {
  volume: number;
  openInterest: number;
  rows: OptRow[];
}

export interface MoneynessRow {
  exp: string;
  buckets: Record<MoneynessBucket, MoneynessCell>;
}

export interface IvBaselineStats {
  median: number;
  mean: number;
  stdDev: number;
}

export interface SweepSignal {
  ts: number;
  exp: string;
  type: 'C' | 'P';
  strikes: number[];
  direction: 'up' | 'down';
  totalVolume: number;
}

export function aggregateByExpiry(rows: OptRow[]): ExpiryTotals[] {
  const map = new Map<string, { calls: MoneynessCell; puts: MoneynessCell }>();
  rows.forEach((row) => {
    const entry = map.get(row.exp) ?? {
      calls: { volume: 0, openInterest: 0, rows: [] },
      puts: { volume: 0, openInterest: 0, rows: [] },
    };
    const target = row.type === 'C' ? entry.calls : entry.puts;
    target.volume += row.volume ?? 0;
    target.openInterest += row.openInterest ?? 0;
    target.rows.push(row);
    map.set(row.exp, entry);
  });
  return Array.from(map.entries())
    .map(([exp, { calls, puts }]) => ({
      exp,
      callVolume: calls.volume,
      putVolume: puts.volume,
      callOpenInterest: calls.openInterest,
      putOpenInterest: puts.openInterest,
    }))
    .sort((a, b) => (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
}

export function aggregateByMoneyness(rows: OptRow[], spot: number): MoneynessRow[] {
  const map = new Map<string, Record<MoneynessBucket, MoneynessCell>>();
  rows.forEach((row) => {
    const buckets = map.get(row.exp) ?? createEmptyBuckets();
    const bucket = classifyMoneyness(row, spot);
    const cell = buckets[bucket];
    cell.volume += row.volume ?? 0;
    cell.openInterest += row.openInterest ?? 0;
    cell.rows.push(row);
    map.set(row.exp, buckets);
  });
  return Array.from(map.entries())
    .map(([exp, buckets]) => ({ exp, buckets }))
    .sort((a, b) => (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
}

export function flagUnusualVolume(row: OptRow, baseline: number | null | undefined): boolean {
  if (!row.volume || row.volume <= 0) {
    return false;
  }
  if (baseline == null || baseline <= 0) {
    return false;
  }
  return row.volume >= baseline * 3;
}

export function flagIVSpike(row: OptRow, baseline: IvBaselineStats | null | undefined): boolean {
  if (!row.iv || row.iv <= 0) {
    return false;
  }
  if (!baseline || baseline.stdDev <= 0) {
    return false;
  }
  const center = baseline.median || baseline.mean || 0;
  if (center <= 0) {
    return false;
  }
  const zScore = (row.iv - center) / baseline.stdDev;
  return zScore >= 2;
}

export function detectSweepHeuristic(rows: OptRow[]): SweepSignal[] {
  const events: SweepSignal[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, OptRow[]>();
  rows.forEach((row) => {
    if ((row.volume ?? 0) <= 0) {
      return;
    }
    const key = `${row.exp}|${row.type}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  });

  groups.forEach((group, key) => {
    if (group.length < 3) {
      return;
    }
    const sorted = [...group].sort((a, b) => (a.ts - b.ts) || (a.strike - b.strike));
    let start = 0;
    for (let end = 0; end < sorted.length; end += 1) {
      while (start < end && sorted[end].ts - sorted[start].ts > 2000) {
        start += 1;
      }
      const window = sorted.slice(start, end + 1);
      if (window.length < 3) {
        continue;
      }
      const strikes = window.map((row) => row.strike);
      const isAsc = strikes.every((value, index) => index === 0 || value >= strikes[index - 1]);
      const isDesc = strikes.every((value, index) => index === 0 || value <= strikes[index - 1]);
      if (!isAsc && !isDesc) {
        continue;
      }
      const uniqueStrikes = Array.from(new Set(strikes));
      if (uniqueStrikes.length < 3) {
        continue;
      }
      const totalVolume = window.reduce((sum, row) => sum + (row.volume ?? 0), 0);
      if (totalVolume <= 0) {
        continue;
      }
      const direction: 'up' | 'down' = isAsc ? 'up' : 'down';
      const dedupeKey = [
        key,
        Math.floor(window[0].ts / 1000).toString(),
        Math.floor(window.at(-1)!.ts / 1000).toString(),
        direction,
        uniqueStrikes[0]?.toString() ?? '',
        uniqueStrikes.at(-1)?.toString() ?? '',
      ].join('|');
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      events.push({
        ts: window.at(-1)!.ts,
        exp: window[0].exp,
        type: window[0].type,
        strikes: direction === 'up' ? [...uniqueStrikes].sort((a, b) => a - b) : [...uniqueStrikes].sort((a, b) => b - a),
        direction,
        totalVolume,
      });
    }
  });

  return events.sort((a, b) => a.ts - b.ts);
}

function createEmptyBuckets(): Record<MoneynessBucket, MoneynessCell> {
  return MONEYNESS_ORDER.reduce((acc, bucket) => {
    acc[bucket] = { volume: 0, openInterest: 0, rows: [] };
    return acc;
  }, {} as Record<MoneynessBucket, MoneynessCell>);
}
