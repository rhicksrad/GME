import type { MinuteBar, OptionContractSnapshot, OptionSnapshot, PriceTick } from '../types';

export interface DemoData {
  ticks: PriceTick[];
  minuteBars: MinuteBar[];
  optionSnapshots: OptionSnapshot[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseOptionSnapshot(value: unknown): OptionSnapshot | null {
  const record = asRecord(value);
  if (!record || typeof record.ts !== 'number' || typeof record.spot !== 'number') {
    return null;
  }
  const contracts = Array.isArray(record.contracts)
    ? record.contracts
        .map((contractValue) => {
          const contract = asRecord(contractValue);
          if (!contract || typeof contract.occ !== 'string' || typeof contract.strike !== 'number' || typeof contract.exp !== 'string') {
            return null;
          }
          return contract as unknown as OptionContractSnapshot;
        })
        .filter((contract): contract is OptionContractSnapshot => contract !== null)
    : [];

  return {
    ts: record.ts,
    spot: record.spot,
    contracts
  };
}

export async function loadDemoData(baseUrl: string): Promise<DemoData> {
  const [priceRes, optionsRes] = await Promise.all([
    fetch(`${baseUrl}demo/price.json`),
    fetch(`${baseUrl}demo/options.json`)
  ]);

  if (!priceRes.ok || !optionsRes.ok) {
    throw new Error('Demo data failed to load');
  }

  const priceJson = await priceRes.json();
  const optionsJson = await optionsRes.json();

  const ticks: PriceTick[] = Array.isArray(priceJson.ticks) ? priceJson.ticks : [];
  const minuteBars: MinuteBar[] = Array.isArray(priceJson.minuteBars) ? priceJson.minuteBars : [];
  const optionSnapshots: OptionSnapshot[] = Array.isArray(optionsJson.snapshots)
    ? optionsJson.snapshots
        .map((snapshot: unknown) => parseOptionSnapshot(snapshot))
        .filter((snapshot): snapshot is OptionSnapshot => snapshot !== null)
    : [];

  return { ticks, minuteBars, optionSnapshots };
}

export interface DemoFeedOptions {
  ticks: PriceTick[];
  minuteBars: MinuteBar[];
  onTick: (tick: PriceTick) => void;
  onMinuteBar: (bar: MinuteBar) => void;
  tickInterval?: number;
  barInterval?: number;
}

export function startDemoPriceFeed({
  ticks,
  minuteBars,
  onTick,
  onMinuteBar,
  tickInterval = 750,
  barInterval = 5_000
}: DemoFeedOptions) {
  let tickIndex = 0;
  let barIndex = 0;
  const tickTimer = window.setInterval(() => {
    if (tickIndex >= ticks.length) {
      window.clearInterval(tickTimer);
      return;
    }
    onTick(ticks[tickIndex]);
    tickIndex += 1;
  }, tickInterval);

  const barTimer = window.setInterval(() => {
    if (barIndex >= minuteBars.length) {
      window.clearInterval(barTimer);
      return;
    }
    onMinuteBar(minuteBars[barIndex]);
    barIndex += 1;
  }, barInterval);

  return {
    stop() {
      window.clearInterval(tickTimer);
      window.clearInterval(barTimer);
    }
  };
}

export interface DemoOptionsFeedOptions {
  snapshots: OptionSnapshot[];
  onSnapshot: (snapshot: OptionSnapshot) => void;
  interval?: number;
}

export function startDemoOptionsFeed({
  snapshots,
  onSnapshot,
  interval = 12_000
}: DemoOptionsFeedOptions) {
  let index = 0;
  const timer = window.setInterval(() => {
    if (index >= snapshots.length) {
      window.clearInterval(timer);
      return;
    }
    onSnapshot(snapshots[index]);
    index += 1;
  }, interval);

  return {
    stop() {
      window.clearInterval(timer);
    }
  };
}
