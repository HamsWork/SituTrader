import type { Bar, GetBarsParams } from "./types";
import { getStalenessSeconds } from "./staleness";
import { makeMemKey, memGet, memSet } from "./memoryCache";
import {
  queryBarsRange,
  getLatestCachedTs,
  getEarliestCachedTs,
  getCachedBarCount,
  getMeta,
  upsertBarsAndMeta,
  touchMeta,
} from "./db";
import { makeLockKey, acquireLock } from "./locks";

const TIMEFRAME_INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

function estimateExpectedBars(timeframe: string, startTs: number, endTs: number): number {
  const intervalMs = TIMEFRAME_INTERVAL_MS[timeframe];
  if (!intervalMs) return 0;
  return Math.max(1, Math.floor((endTs - startTs) / intervalMs) + 1);
}

function hasInternalGaps(
  bars: Bar[],
  timeframe: string,
): boolean {
  if (bars.length < 2) return false;
  const intervalMs = TIMEFRAME_INTERVAL_MS[timeframe];
  if (!intervalMs) return false;
  const maxGap = intervalMs * 3;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].timestamp - bars[i - 1].timestamp > maxGap) {
      return true;
    }
  }
  return false;
}

let cacheDisabled = false;
let cacheDisabledLoggedAt = 0;

export async function getBars(params: GetBarsParams): Promise<Bar[]> {
  const { symbol, timeframe, adjusted, startTs, endTs, fetcher } = params;

  const memKey = makeMemKey(symbol, timeframe, adjusted, startTs, endTs);
  const memHit = memGet(memKey);
  if (memHit) return memHit;

  if (cacheDisabled) {
    const bars = await fetcher({ symbol, timeframe, adjusted, startTs, endTs });
    if (bars.length > 0) memSet(memKey, bars);
    return bars;
  }

  const lockKey = makeLockKey(symbol, timeframe, adjusted);
  let releaseLock: (() => void) | null = null;

  try {
    releaseLock = await acquireLock(lockKey);

    const memHit2 = memGet(memKey);
    if (memHit2) return memHit2;

    const earliestCachedTs = await getEarliestCachedTs(symbol, timeframe, adjusted, startTs, endTs);
    const latestCachedTs = await getLatestCachedTs(symbol, timeframe, adjusted, startTs, endTs);
    const meta = await getMeta(symbol, timeframe, adjusted);
    const stalenessMs = getStalenessSeconds(timeframe) * 1000;
    const now = Date.now();
    const isFresh = meta != null && now - meta.lastFetched <= stalenessMs;

    const hasFullEdgeCoverage =
      earliestCachedTs != null &&
      latestCachedTs != null &&
      earliestCachedTs <= startTs &&
      latestCachedTs >= endTs;

    if (hasFullEdgeCoverage && isFresh) {
      const bars = await queryBarsRange(symbol, timeframe, adjusted, startTs, endTs);
      const expected = estimateExpectedBars(timeframe, startTs, endTs);
      const minRatio = 0.5;
      const hasSufficientCount = expected === 0 || bars.length >= expected * minRatio;
      if (hasSufficientCount && !hasInternalGaps(bars, timeframe)) {
        memSet(memKey, bars);
        return bars;
      }
    }

    if (latestCachedTs != null && isFresh && hasFullEdgeCoverage) {
      const allBars = await fetcher({ symbol, timeframe, adjusted, startTs, endTs });
      if (allBars.length > 0) {
        await upsertBarsAndMeta(symbol, timeframe, adjusted, allBars);
      } else {
        await touchMeta(symbol, timeframe, adjusted);
      }
    } else if (latestCachedTs != null) {
      if (earliestCachedTs != null && earliestCachedTs > startTs) {
        const prefixBars = await fetcher({
          symbol, timeframe, adjusted,
          startTs,
          endTs: earliestCachedTs - 1,
        });
        if (prefixBars.length > 0) {
          await upsertBarsAndMeta(symbol, timeframe, adjusted, prefixBars);
        }
      }

      if (!isFresh) {
        const allBars = await fetcher({ symbol, timeframe, adjusted, startTs, endTs });
        if (allBars.length > 0) {
          await upsertBarsAndMeta(symbol, timeframe, adjusted, allBars);
        } else {
          await touchMeta(symbol, timeframe, adjusted);
        }
      } else {
        const fetchStart = latestCachedTs + 1;
        if (fetchStart <= endTs) {
          const suffixBars = await fetcher({
            symbol, timeframe, adjusted,
            startTs: fetchStart,
            endTs,
          });
          if (suffixBars.length > 0) {
            await upsertBarsAndMeta(symbol, timeframe, adjusted, suffixBars);
          } else {
            await touchMeta(symbol, timeframe, adjusted);
          }
        } else {
          await touchMeta(symbol, timeframe, adjusted);
        }
      }
    } else {
      const allBars = await fetcher({ symbol, timeframe, adjusted, startTs, endTs });
      if (allBars.length > 0) {
        await upsertBarsAndMeta(symbol, timeframe, adjusted, allBars);
      } else {
        await touchMeta(symbol, timeframe, adjusted);
      }
    }

    const finalBars = await queryBarsRange(symbol, timeframe, adjusted, startTs, endTs);
    memSet(memKey, finalBars);
    return finalBars;
  } catch (err: any) {
    const now = Date.now();
    if (!cacheDisabled || now - cacheDisabledLoggedAt > 60_000) {
      console.error(`[barCache] Cache layer failed, falling back to direct fetch: ${err.message}`);
      cacheDisabledLoggedAt = now;
    }
    cacheDisabled = true;
    try {
      const bars = await fetcher({ symbol, timeframe, adjusted, startTs, endTs });
      if (bars.length > 0) memSet(memKey, bars);
      return bars;
    } catch (fetchErr: any) {
      throw fetchErr;
    }
  } finally {
    if (releaseLock) releaseLock();
  }
}
