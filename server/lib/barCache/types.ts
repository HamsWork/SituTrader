export interface Bar {
  timestamp: number; // milliseconds since epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GetBarsParams {
  symbol: string;
  timeframe: string; // "1m", "5m", "15m", "1h", "4h", "1d"
  adjusted: boolean;
  startTs: number; // milliseconds
  endTs: number; // milliseconds
  fetcher: (params: {
    symbol: string;
    timeframe: string;
    adjusted: boolean;
    startTs: number;
    endTs: number;
  }) => Promise<Bar[]>;
}

export interface BarCacheStats {
  totalBarsCached: number;
  uniqueSymbols: number;
  dbSizeBytes: number;
  oldestBarTimestamp: number | null;
  newestBarTimestamp: number | null;
  oldestLastFetched: number | null;
  newestLastFetched: number | null;
  walMode: string;
  synchronous: string;
}
