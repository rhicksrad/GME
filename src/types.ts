export interface PriceTick {
  ts: number;
  lastPrice: number;
  lastSize: number;
  volume?: number;
  vwap?: number;
}

export interface MinuteBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
}

export type OptionType = 'call' | 'put';

export interface OptionContractSnapshot {
  ts: number;
  occ: string;
  type: OptionType;
  strike: number;
  exp: string;
  bid?: number;
  ask?: number;
  mid?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  previousOpenInterest?: number;
  avg30Volume?: number;
  iv?: number;
  iv30Median?: number;
  iv30Stdev?: number;
  lastTradePrice?: number;
  lastTradeSize?: number;
  lastTradeTs?: number;
}

export interface OptionSnapshot {
  ts: number;
  spot: number;
  contracts: OptionContractSnapshot[];
}

export interface ActivityFlag {
  ts: number;
  type: 'UnusualVolume' | 'IVSpike' | 'OIChange' | 'Sweep';
  contract: OptionContractSnapshot;
  message: string;
}

export type MoneynessBucket =
  | 'Deep ITM'
  | 'ITM'
  | 'ATM'
  | 'OTM'
  | 'Deep OTM';

export interface MoneynessSummary {
  bucket: MoneynessBucket;
  callVolume: number;
  putVolume: number;
  contracts: OptionContractSnapshot[];
}

export interface ExpirySummary {
  expiry: string;
  callVolume: number;
  putVolume: number;
  netCallPutVolume: number;
  buckets: MoneynessSummary[];
}

export interface OptionAnalytics {
  expiries: ExpirySummary[];
  moneyness: Record<MoneynessBucket, { callVolume: number; putVolume: number }>;
  flags: ActivityFlag[];
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
