import type {
  ActivityFlag,
  ExpirySummary,
  MoneynessBucket,
  OptionAnalytics,
  OptionContractSnapshot,
  OptionSnapshot
} from './types';

const BUCKETS: MoneynessBucket[] = ['Deep ITM', 'ITM', 'ATM', 'OTM', 'Deep OTM'];

function bucketForContract(spot: number, contract: OptionContractSnapshot): MoneynessBucket {
  if (!Number.isFinite(spot) || spot <= 0) {
    return 'ATM';
  }

  const { strike, type } = contract;
  if (!Number.isFinite(strike) || strike <= 0) {
    return 'ATM';
  }

  let ratio: number;
  if (type === 'call') {
    ratio = (spot - strike) / spot;
  } else {
    ratio = (strike - spot) / strike;
  }

  if (ratio >= 0.15) return 'Deep ITM';
  if (ratio >= 0.05) return 'ITM';
  if (ratio > -0.05) return 'ATM';
  if (ratio > -0.15) return 'OTM';
  return 'Deep OTM';
}

function sumVolumes(contracts: OptionContractSnapshot[]): number {
  return contracts.reduce((sum, contract) => sum + (contract.volume ?? 0), 0);
}

function formatContract(contract: OptionContractSnapshot): string {
  const strike = contract.strike.toFixed(2);
  const type = contract.type === 'call' ? 'C' : 'P';
  return `${contract.exp} ${strike}${type}`;
}

function detectUnusualVolume(
  contract: OptionContractSnapshot,
  prev?: OptionContractSnapshot
): ActivityFlag | null {
  const volume = contract.volume ?? 0;
  const baseline = contract.avg30Volume ?? prev?.avg30Volume;
  if (!baseline || baseline <= 0 || volume <= baseline * 3) {
    return null;
  }
  const ratio = volume / baseline;
  return {
    ts: contract.ts,
    type: 'UnusualVolume',
    contract,
    message: `Unusual volume ${ratio.toFixed(1)}x ${formatContract(contract)}`
  };
}

function detectIvSpike(contract: OptionContractSnapshot, prev?: OptionContractSnapshot): ActivityFlag | null {
  if (contract.iv == null || prev?.iv == null) {
    return null;
  }
  const baseline = contract.iv30Median ?? prev.iv30Median ?? prev.iv;
  const stdev = contract.iv30Stdev ?? prev.iv30Stdev ?? baseline * 0.1;
  const delta = contract.iv - prev.iv;
  if (stdev <= 0 || Math.abs(delta) < stdev * 2) {
    return null;
  }
  const direction = delta > 0 ? 'higher' : 'lower';
  return {
    ts: contract.ts,
    type: 'IVSpike',
    contract,
    message: `IV spike ${direction} ${formatContract(contract)} (${delta.toFixed(2)})`
  };
}

function detectOiChange(contract: OptionContractSnapshot, prev?: OptionContractSnapshot): ActivityFlag | null {
  if (contract.openInterest == null) {
    return null;
  }
  const prior = prev?.openInterest ?? contract.previousOpenInterest;
  if (prior == null || prior <= 0) {
    return null;
  }
  const change = contract.openInterest - prior;
  const ratio = change / prior;
  if (Math.abs(ratio) < 0.1) {
    return null;
  }
  const direction = change > 0 ? 'up' : 'down';
  return {
    ts: contract.ts,
    type: 'OIChange',
    contract,
    message: `OI ${direction} ${(ratio * 100).toFixed(1)}% ${formatContract(contract)}`
  };
}

interface VolumeDelta {
  contract: OptionContractSnapshot;
  delta: number;
}

function detectSweepLikeActivity(
  contracts: OptionContractSnapshot[],
  previous: Map<string, OptionContractSnapshot>
): ActivityFlag[] {
  const expiries = new Map<string, VolumeDelta[]>();
  for (const contract of contracts) {
    const prev = previous.get(contract.occ);
    const delta = (contract.volume ?? 0) - (prev?.volume ?? 0);
    if (delta <= Math.max(20, (prev?.volume ?? 0) * 0.3)) {
      continue;
    }
    const key = `${contract.exp}-${contract.type}`;
    if (!expiries.has(key)) {
      expiries.set(key, []);
    }
    expiries.get(key)!.push({ contract, delta });
  }

  const flags: ActivityFlag[] = [];
  expiries.forEach((entries) => {
    entries.sort((a, b) => a.contract.strike - b.contract.strike);
    let run: VolumeDelta[] = [];
    for (const entry of entries) {
      if (run.length === 0) {
        run.push(entry);
        continue;
      }
      const last = run[run.length - 1];
      const timeGap = Math.abs((entry.contract.lastTradeTs ?? entry.contract.ts) - (last.contract.lastTradeTs ?? last.contract.ts));
      const ascending = entry.contract.strike >= last.contract.strike;
      if (ascending && timeGap <= 2000) {
        run.push(entry);
      } else {
        if (run.length >= 3) {
          flags.push({
            ts: run[run.length - 1].contract.ts,
            type: 'Sweep',
            contract: run[run.length - 1].contract,
            message: `Sweep-like flow ${run.length} legs ${formatContract(run[0].contract)}→${formatContract(run[run.length - 1].contract)}`
          });
        }
        run = [entry];
      }
    }
    if (run.length >= 3) {
      flags.push({
        ts: run[run.length - 1].contract.ts,
        type: 'Sweep',
        contract: run[run.length - 1].contract,
        message: `Sweep-like flow ${run.length} legs ${formatContract(run[0].contract)}→${formatContract(run[run.length - 1].contract)}`
      });
    }
  });
  return flags;
}

export function analyzeOptions(snapshot: OptionSnapshot, history: OptionSnapshot[]): OptionAnalytics {
  const prevSnapshot = history.length > 0 ? history[history.length - 1] : undefined;
  const previousContracts = new Map<string, OptionContractSnapshot>();
  if (prevSnapshot) {
    for (const contract of prevSnapshot.contracts) {
      previousContracts.set(contract.occ, contract);
    }
  }

  const expiriesMap = new Map<string, OptionContractSnapshot[]>();
  for (const contract of snapshot.contracts) {
    if (!expiriesMap.has(contract.exp)) {
      expiriesMap.set(contract.exp, []);
    }
    expiriesMap.get(contract.exp)!.push(contract);
  }

  const sortedExpiries = Array.from(expiriesMap.keys()).sort();
  const limitedExpiries = sortedExpiries.slice(0, 4);

  const expirySummaries: ExpirySummary[] = [];
  const moneynessMap: Record<MoneynessBucket, { callVolume: number; putVolume: number }> = {
    'Deep ITM': { callVolume: 0, putVolume: 0 },
    ITM: { callVolume: 0, putVolume: 0 },
    ATM: { callVolume: 0, putVolume: 0 },
    OTM: { callVolume: 0, putVolume: 0 },
    'Deep OTM': { callVolume: 0, putVolume: 0 }
  };

  for (const expiry of limitedExpiries) {
    const contracts = expiriesMap.get(expiry) ?? [];
    const callContracts = contracts.filter((contract) => contract.type === 'call');
    const putContracts = contracts.filter((contract) => contract.type === 'put');
    const callVolume = sumVolumes(callContracts);
    const putVolume = sumVolumes(putContracts);
    const bucketSummaries = BUCKETS.map((bucket) => ({
      bucket,
      callVolume: 0,
      putVolume: 0,
      contracts: [] as OptionContractSnapshot[]
    }));

    for (const contract of contracts) {
      const bucket = bucketForContract(snapshot.spot, contract);
      const bucketSummary = bucketSummaries.find((entry) => entry.bucket === bucket)!;
      if (contract.type === 'call') {
        bucketSummary.callVolume += contract.volume ?? 0;
        moneynessMap[bucket].callVolume += contract.volume ?? 0;
      } else {
        bucketSummary.putVolume += contract.volume ?? 0;
        moneynessMap[bucket].putVolume += contract.volume ?? 0;
      }
      bucketSummary.contracts.push(contract);
    }

    expirySummaries.push({
      expiry,
      callVolume,
      putVolume,
      netCallPutVolume: callVolume - putVolume,
      buckets: bucketSummaries
    });
  }

  const flags: ActivityFlag[] = [];
  for (const contract of snapshot.contracts) {
    const prev = previousContracts.get(contract.occ);
    const unusual = detectUnusualVolume(contract, prev);
    if (unusual) flags.push(unusual);
    const iv = detectIvSpike(contract, prev);
    if (iv) flags.push(iv);
    const oi = detectOiChange(contract, prev);
    if (oi) flags.push(oi);
  }

  flags.push(...detectSweepLikeActivity(snapshot.contracts, previousContracts));

  return {
    expiries: expirySummaries,
    moneyness: moneynessMap,
    flags: flags.sort((a, b) => a.ts - b.ts)
  };
}
