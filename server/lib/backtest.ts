import { storage } from "../storage";
import { detectAllSetups, type SetupResult } from "./rules";
import { validateMagnetTouch, computeMAEMFE, filterRTHBars } from "./validate";
import { checkEntryTrigger } from "./activation";
import { fetchIntradayBarsCached } from "./polygon";
import { formatDate } from "./calendar";
import type { BacktestDetail, Backtest, TimeToHitStat, TradePlan } from "@shared/schema";
import { log } from "../index";

export async function runBacktest(
  ticker: string,
  setupType: string,
  startDate: string,
  endDate: string,
  timeframe: string = "5"
): Promise<Omit<Backtest, "id" | "createdAt">> {
  const dailyBars = await storage.getDailyBars(ticker, startDate, endDate);
  if (dailyBars.length < 5) {
    return {
      ticker,
      setupType,
      startDate,
      endDate,
      occurrences: 0,
      hits: 0,
      hitRate: 0,
      avgTimeToHitMin: null,
      medianTimeToHitMin: null,
      avgMae: null,
      avgMfe: null,
      details: [],
      notes: "Insufficient daily data",
    };
  }

  const setups = detectAllSetups(dailyBars, [setupType]);
  const details: BacktestDetail[] = [];
  let hits = 0;
  const timesToHit: number[] = [];
  const maes: number[] = [];
  const mfes: number[] = [];

  for (const setup of setups) {
    if (setup.targetDate < startDate || setup.targetDate > endDate) continue;

    let intradayBarsData = await storage.getIntradayBars(ticker, setup.targetDate, timeframe);

    if (intradayBarsData.length === 0) {
      try {
        const polygonBars = await fetchIntradayBarsCached(ticker, setup.targetDate, setup.targetDate, timeframe);
        for (const bar of polygonBars) {
          const ts = new Date(bar.t).toISOString();
          await storage.upsertIntradayBar({
            ticker,
            ts,
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
            timeframe,
            source: "polygon",
          });
        }
        intradayBarsData = await storage.getIntradayBars(ticker, setup.targetDate, timeframe);
      } catch (err: any) {
        log(`Backtest: failed to fetch intraday for ${ticker} ${setup.targetDate}: ${err.message}`, "backtest");
      }
    }

    if (intradayBarsData.length === 0) {
      details.push({
        date: setup.asofDate,
        triggered: true,
        hit: false,
        magnetPrice: setup.magnetPrice,
      });
      continue;
    }

    const result = validateMagnetTouch(
      intradayBarsData.map((b) => ({ ts: b.ts, high: b.high, low: b.low })),
      setup.magnetPrice,
      setup.direction
    );

    const rthBars = filterRTHBars(intradayBarsData as any);
    const entryPrice = rthBars.length > 0 ? rthBars[0].open : setup.magnetPrice;

    let mae: number | undefined;
    let mfe: number | undefined;
    if (rthBars.length > 0) {
      const maeResult = computeMAEMFE(
        intradayBarsData as any,
        entryPrice,
        setup.direction
      );
      mae = maeResult.mae;
      mfe = maeResult.mfe;
      if (mae > 0) maes.push(mae);
      if (mfe > 0) mfes.push(mfe);
    }

    if (result.hit) {
      hits++;
      if (result.timeToHitMin !== undefined) timesToHit.push(result.timeToHitMin);
    }

    let activated = false;
    let activationPrice: number | undefined;
    let activationTs: string | undefined;
    try {
      const syntheticTradePlan: TradePlan = {
        bias: setup.direction.includes("up") ? "BUY" : "SELL",
        t1: setup.magnetPrice,
        stopDistance: entryPrice * 0.01,
        riskReward: 0,
        entryTrigger: "",
        invalidation: "",
        notes: "",
      };
      const triggerResult = checkEntryTrigger(
        intradayBarsData.map(b => ({
          ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        })),
        syntheticTradePlan,
        "conservative",
      );
      activated = triggerResult.triggered;
      activationPrice = triggerResult.entryPrice;
      activationTs = triggerResult.triggerTs;
    } catch {}

    details.push({
      date: setup.asofDate,
      triggered: true,
      hit: result.hit,
      timeToHitMin: result.timeToHitMin,
      mae,
      mfe,
      magnetPrice: setup.magnetPrice,
      entryPrice,
      activated,
      activationPrice,
      activationTs,
    });
  }

  const occurrences = details.length;
  const hitRate = occurrences > 0 ? hits / occurrences : 0;
  const avgTimeToHitMin = timesToHit.length > 0 ? timesToHit.reduce((a, b) => a + b, 0) / timesToHit.length : null;

  const sorted = [...timesToHit].sort((a, b) => a - b);
  const medianTimeToHitMin = sorted.length > 0
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : null;

  const avgMae = maes.length > 0 ? maes.reduce((a, b) => a + b, 0) / maes.length : null;
  const avgMfe = mfes.length > 0 ? mfes.reduce((a, b) => a + b, 0) / mfes.length : null;

  return {
    ticker,
    setupType,
    startDate,
    endDate,
    occurrences,
    hits,
    hitRate,
    avgTimeToHitMin,
    medianTimeToHitMin,
    avgMae,
    avgMfe,
    details,
    notes: null,
  };
}

export function computeProbabilities(timesToHit: number[], totalOccurrences: number): {
  p15: number; p30: number; p60: number; p120: number; p240: number; p390: number;
  medianTimeToHitMin: number | null;
} {
  if (totalOccurrences === 0) {
    return { p15: 0, p30: 0, p60: 0, p120: 0, p240: 0, p390: 0, medianTimeToHitMin: null };
  }

  const countBelow = (threshold: number) =>
    timesToHit.filter(t => t <= threshold).length / totalOccurrences;

  const sorted = [...timesToHit].sort((a, b) => a - b);
  const medianTimeToHitMin = sorted.length > 0
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : null;

  return {
    p15: countBelow(15),
    p30: countBelow(30),
    p60: countBelow(60),
    p120: countBelow(120),
    p240: countBelow(240),
    p390: countBelow(390),
    medianTimeToHitMin,
  };
}

export async function computeAndStoreTimeToHitStats(
  ticker: string,
  setupType: string,
  timeframe: string = "5"
): Promise<Omit<TimeToHitStat, "id" | "updatedAt"> | null> {
  const backtestResults = await storage.getBacktests();
  const relevant = backtestResults.filter(
    bt => bt.ticker === ticker && bt.setupType === setupType
  );

  if (relevant.length === 0) return null;

  const allTimesToHit: number[] = [];
  let totalOccurrences = 0;

  for (const bt of relevant) {
    const details = bt.details as BacktestDetail[] | null;
    if (!details) continue;
    for (const d of details) {
      if (!d.triggered) continue;
      totalOccurrences++;
      if (d.hit && d.timeToHitMin !== undefined) {
        allTimesToHit.push(d.timeToHitMin);
      }
    }
  }

  if (totalOccurrences === 0) return null;

  const probs = computeProbabilities(allTimesToHit, totalOccurrences);

  const stat = {
    ticker,
    setupType,
    timeframe,
    sampleSize: totalOccurrences,
    ...probs,
  };

  await storage.upsertTimeToHitStats(stat);
  return stat;
}
