const STALENESS_MAP: Record<string, number> = {
  "1m": 120,
  "5m": 300,
  "15m": 600,
  "1h": 1800,
  "4h": 3600,
  "1d": 14400,
};

export function getStalenessSeconds(timeframe: string): number {
  return STALENESS_MAP[timeframe] ?? STALENESS_MAP["1d"];
}
