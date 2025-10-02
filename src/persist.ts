import type { OptRow } from './data/optionsClient';
import type { BaselineSnapshot } from './options/chain';

const STORAGE_KEY = 'gme-radar-state';

export interface PersistedChainState {
  symbol: string;
  rows: OptRow[];
  meta?: Record<string, unknown>;
  spot?: number;
  updatedAt: number;
}

export interface PersistedState {
  symbol: string;
  options?: {
    chain?: PersistedChainState;
    baselines?: BaselineSnapshot;
  };
}

export function loadState(): PersistedState | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures – a fresh session still works.
  }
}
