import { describe, expect, it } from 'vitest';

import { analyzeOptions } from './signals';
import type { OptionSnapshot } from './types';

const baseSnapshot: OptionSnapshot = {
  ts: Date.now(),
  spot: 18,
  contracts: [
    {
      ts: Date.now(),
      occ: 'GME250607C00018000',
      type: 'call',
      strike: 18,
      exp: '2025-06-07',
      volume: 400,
      avg30Volume: 100,
      openInterest: 200,
      previousOpenInterest: 180,
      iv: 1.3,
      iv30Median: 1.0,
      iv30Stdev: 0.1
    },
    {
      ts: Date.now(),
      occ: 'GME250607P00018000',
      type: 'put',
      strike: 18,
      exp: '2025-06-07',
      volume: 50,
      avg30Volume: 60,
      openInterest: 150,
      previousOpenInterest: 140,
      iv: 0.9,
      iv30Median: 1.0,
      iv30Stdev: 0.1
    }
  ]
};

describe('analyzeOptions', () => {
  it('buckets call vs put volume', () => {
    const analytics = analyzeOptions(baseSnapshot, []);
    expect(analytics.expiries[0].callVolume).toBe(400);
    expect(analytics.expiries[0].putVolume).toBe(50);
  });

  it('flags unusual volume when threshold crossed', () => {
    const previous: OptionSnapshot = {
      ts: baseSnapshot.ts - 60_000,
      spot: 18,
      contracts: baseSnapshot.contracts.map((contract) => ({
        ...contract,
        volume: (contract.volume ?? 0) / 4,
        openInterest: contract.previousOpenInterest
      }))
    };

    const analytics = analyzeOptions(baseSnapshot, [previous]);
    const flagTypes = analytics.flags.map((flag) => flag.type);
    expect(flagTypes).toContain('UnusualVolume');
  });
});
