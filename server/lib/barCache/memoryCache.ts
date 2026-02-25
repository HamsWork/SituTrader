import type { Bar } from "./types";

interface CacheEntry {
  data: Bar[];
  expiresAt: number;
}

const MAX_ENTRIES = 500;
const TTL_MS = 300_000; // 5 minutes

const cache = new Map<string, CacheEntry>();

export function makeMemKey(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): string {
  return `${symbol}|${timeframe}|${adjusted ? 1 : 0}|${startTs}|${endTs}`;
}

export function memGet(key: string): Bar[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

export function memSet(key: string, data: Bar[]): void {
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
}

export function memClear(): void {
  cache.clear();
}
