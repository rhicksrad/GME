export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface Trade {
  price: number;
  volume: number;
  timestamp: number; // epoch milliseconds
  symbol: string;
}

export interface MinuteBar {
  t: number; // epoch milliseconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SignalSummary {
  vwap: number | null;
  high: number | null;
  low: number | null;
  oneMinuteChange: number | null;
  spike?: SpikeSignal;
}

export interface SpikeSignal {
  start: number;
  end: number;
  magnitude: number;
}
