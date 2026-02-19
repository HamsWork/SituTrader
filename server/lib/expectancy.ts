import { storage } from "../storage";
import { computeATR } from "./confidence";
import { log } from "../index";
import type { BacktestDetail, Backtest, SetupExpectancy } from "@shared/schema";

export interface RMultipleResult {
  r: number;
  hit: boolean;
  maeR: number;
}

export interface ExpectancyStats {
  setupType: string;
  ticker: string | null;
  sampleSize: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  medianR: number;
  expectancyR: number;
  profitFactor: number;
  avgMaeR: number;
  medianMaeR: number;
  tradeability: "CLEAN" | "CAUTION" | "AVOID";
  category: "PRIMARY" | "SECONDARY" | "OFF";
}

function computeStopDistance(entryPrice: number, atr: number): number {
  return Math.max(0.25 * atr, entryPrice * 0.0015);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computeRMultiples(
  details: BacktestDetail[],
  atr: number
): RMultipleResult[] {
  const results: RMultipleResult[] = [];

  for (const d of details) {
    if (!d.triggered) continue;
    if (!d.entryPrice || d.entryPrice <= 0) continue;

    const stopDistance = computeStopDistance(d.entryPrice, atr);
    if (stopDistance <= 0) continue;

    const reward = Math.abs(d.magnetPrice - d.entryPrice);
    const maeR = d.mae != null ? (d.mae * d.entryPrice) / stopDistance : 0;

    if (d.hit) {
      const winR = reward / stopDistance;
      results.push({ r: winR, hit: true, maeR });
    } else {
      results.push({ r: -1, hit: false, maeR });
    }
  }

  return results;
}

export function aggregateExpectancy(
  rMultiples: RMultipleResult[],
  setupType: string,
  ticker: string | null,
  minSampleForCategory: number = 30
): ExpectancyStats {
  const sampleSize = rMultiples.length;

  if (sampleSize === 0) {
    return {
      setupType,
      ticker,
      sampleSize: 0,
      winRate: 0,
      avgWinR: 0,
      avgLossR: 0,
      medianR: 0,
      expectancyR: 0,
      profitFactor: 0,
      avgMaeR: 0,
      medianMaeR: 0,
      tradeability: "CLEAN",
      category: "OFF",
    };
  }

  const wins = rMultiples.filter(r => r.hit);
  const losses = rMultiples.filter(r => !r.hit);

  const winRate = wins.length / sampleSize;
  const avgWinR = wins.length > 0 ? wins.reduce((s, r) => s + r.r, 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r.r, 0) / losses.length) : 1;

  const expectancyR = (winRate * avgWinR) - ((1 - winRate) * avgLossR);

  const allR = rMultiples.map(r => r.r);
  const medianR = median(allR);

  const grossWin = wins.reduce((s, r) => s + r.r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.r, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  const allMaeR = rMultiples.map(r => r.maeR);
  const avgMaeR = allMaeR.length > 0 ? allMaeR.reduce((s, v) => s + v, 0) / allMaeR.length : 0;
  const medianMaeR = median(allMaeR);

  let tradeability: "CLEAN" | "CAUTION" | "AVOID" = "CLEAN";
  if (medianMaeR > 1.5) {
    tradeability = "AVOID";
  } else if (medianMaeR > 1.2) {
    tradeability = "CAUTION";
  }

  let category: "PRIMARY" | "SECONDARY" | "OFF" = "OFF";
  if (sampleSize >= minSampleForCategory) {
    if (expectancyR >= 0.20 && tradeability !== "AVOID") {
      category = "PRIMARY";
    } else if (expectancyR >= 0.05) {
      category = "SECONDARY";
    } else {
      category = "OFF";
    }
  } else {
    category = "SECONDARY";
  }

  return {
    setupType,
    ticker,
    sampleSize,
    winRate: Math.round(winRate * 1000) / 1000,
    avgWinR: Math.round(avgWinR * 100) / 100,
    avgLossR: Math.round(avgLossR * 100) / 100,
    medianR: Math.round(medianR * 100) / 100,
    expectancyR: Math.round(expectancyR * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgMaeR: Math.round(avgMaeR * 100) / 100,
    medianMaeR: Math.round(medianMaeR * 100) / 100,
    tradeability,
    category,
  };
}

export async function computeAndStoreExpectancy(
  setupType: string,
  ticker?: string
): Promise<ExpectancyStats | null> {
  const allBacktests = await storage.getBacktests();

  const relevant = allBacktests.filter(bt => {
    if (bt.setupType !== setupType) return false;
    if (ticker && bt.ticker !== ticker) return false;
    return true;
  });

  if (relevant.length === 0) return null;

  const allRMultiples: RMultipleResult[] = [];

  for (const bt of relevant) {
    const details = bt.details as BacktestDetail[] | null;
    if (!details) continue;

    const dailyBars = await storage.getDailyBars(bt.ticker);
    const atr = computeATR(dailyBars);

    if (atr <= 0) continue;

    const rms = computeRMultiples(details, atr);
    allRMultiples.push(...rms);
  }

  if (allRMultiples.length === 0) return null;

  const stats = aggregateExpectancy(allRMultiples, setupType, ticker ?? null);

  await storage.upsertSetupExpectancy({
    setupType: stats.setupType,
    ticker: stats.ticker,
    sampleSize: stats.sampleSize,
    winRate: stats.winRate,
    avgWinR: stats.avgWinR,
    avgLossR: stats.avgLossR,
    medianR: stats.medianR,
    expectancyR: stats.expectancyR,
    profitFactor: stats.profitFactor,
    avgMaeR: stats.avgMaeR,
    medianMaeR: stats.medianMaeR,
    tradeability: stats.tradeability,
    category: stats.category,
  });

  return stats;
}

export async function recomputeAllExpectancy(): Promise<ExpectancyStats[]> {
  const allBacktests = await storage.getBacktests();
  const setupTypeSet = new Set(allBacktests.map(bt => bt.setupType));
  const setupTypes = Array.from(setupTypeSet);
  const results: ExpectancyStats[] = [];

  for (const setupType of setupTypes) {
    const perSetupBacktests = allBacktests.filter(bt => bt.setupType === setupType);
    const allRMultiples: RMultipleResult[] = [];

    const tickerRMultiples = new Map<string, RMultipleResult[]>();

    for (const bt of perSetupBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;

      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;

      const rms = computeRMultiples(details, atr);
      allRMultiples.push(...rms);

      if (!tickerRMultiples.has(bt.ticker)) {
        tickerRMultiples.set(bt.ticker, []);
      }
      tickerRMultiples.get(bt.ticker)!.push(...rms);
    }

    if (allRMultiples.length > 0) {
      const overallStats = aggregateExpectancy(allRMultiples, setupType, null);
      await storage.upsertSetupExpectancy({
        setupType: overallStats.setupType,
        ticker: overallStats.ticker,
        sampleSize: overallStats.sampleSize,
        winRate: overallStats.winRate,
        avgWinR: overallStats.avgWinR,
        avgLossR: overallStats.avgLossR,
        medianR: overallStats.medianR,
        expectancyR: overallStats.expectancyR,
        profitFactor: overallStats.profitFactor,
        avgMaeR: overallStats.avgMaeR,
        medianMaeR: overallStats.medianMaeR,
        tradeability: overallStats.tradeability,
        category: overallStats.category,
      });
      results.push(overallStats);
    }

    for (const [tickerName, rms] of Array.from(tickerRMultiples.entries())) {
      if (rms.length === 0) continue;
      const tickerStats = aggregateExpectancy(rms, setupType, tickerName);
      await storage.upsertSetupExpectancy({
        setupType: tickerStats.setupType,
        ticker: tickerStats.ticker,
        sampleSize: tickerStats.sampleSize,
        winRate: tickerStats.winRate,
        avgWinR: tickerStats.avgWinR,
        avgLossR: tickerStats.avgLossR,
        medianR: tickerStats.medianR,
        expectancyR: tickerStats.expectancyR,
        profitFactor: tickerStats.profitFactor,
        avgMaeR: tickerStats.avgMaeR,
        medianMaeR: tickerStats.medianMaeR,
        tradeability: tickerStats.tradeability,
        category: tickerStats.category,
      });
      results.push(tickerStats);
    }
  }

  log(`Recomputed expectancy for ${results.length} setup/ticker combos`, "expectancy");
  return results;
}

export function getSetupAlertCategory(
  setupType: string,
  focusMode: string,
  setupStats: ExpectancyStats[],
  winRateThreshold: number = 0.70,
  expectancyThreshold: number = 0.15
): "PRIMARY" | "SECONDARY" | "OFF" {
  const overall = setupStats.find(s => s.setupType === setupType && s.ticker === null);
  if (!overall || overall.sampleSize < 30) return "SECONDARY";

  if (focusMode === "WIN_RATE") {
    if (overall.winRate >= winRateThreshold) return "PRIMARY";
    return "OFF";
  }

  if (focusMode === "EXPECTANCY") {
    if (overall.expectancyR >= expectancyThreshold && overall.tradeability !== "AVOID") return "PRIMARY";
    if (overall.expectancyR >= 0.05) return "SECONDARY";
    return "OFF";
  }

  if (focusMode === "BARBELL") {
    const overalls = setupStats.filter(s => s.ticker === null && s.sampleSize >= 30);
    if (overalls.length === 0) return "SECONDARY";

    const sortedByWinRate = [...overalls].sort((a, b) => b.winRate - a.winRate);
    const sortedByExpectancy = [...overalls].sort((a, b) => b.expectancyR - a.expectancyR);

    const topWinRate = sortedByWinRate.slice(0, 2).map(s => s.setupType);
    const topExpectancy = sortedByExpectancy.slice(0, 2).map(s => s.setupType);

    if (topWinRate.includes(setupType) || topExpectancy.includes(setupType)) return "PRIMARY";
    return "SECONDARY";
  }

  return overall.category;
}
