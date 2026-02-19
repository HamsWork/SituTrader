import type { DailyBar, QualityBreakdown, SetupType } from "@shared/schema";

export interface QualityInput {
  setupType: SetupType;
  triggerMargin: number;
  lastClose: number;
  magnetPrice: number;
  atr14: number;
  avgDollarVolume20d: number;
  todayTrueRange: number;
  avgTrueRange20d: number;
  todayVolume: number;
  avgVolume20d: number;
  historicalHitRate: number | null;
  p60?: number | null;
  p390?: number | null;
  timePriorityMode?: "EARLY" | "SAME_DAY" | "BLEND";
}

export function computeQualityScore(input: QualityInput): QualityBreakdown {
  const edgeStrength = scoreEdgeStrength(input.setupType, input.triggerMargin, input.lastClose);
  const magnetDistance = scoreMagnetDistance(input.lastClose, input.magnetPrice, input.atr14);
  const liquidity = scoreLiquidity(input.avgDollarVolume20d);
  const movementEnv = scoreMovementEnvironment(
    input.todayTrueRange, input.avgTrueRange20d,
    input.todayVolume, input.avgVolume20d
  );
  const historicalHitRate = scoreHistoricalHitRate(input.historicalHitRate);
  const timeScore = scoreTimeToHit(input.p60 ?? null, input.p390 ?? null, input.timePriorityMode ?? "BLEND");

  const total = Math.min(100, Math.max(0,
    edgeStrength + magnetDistance + liquidity + movementEnv + historicalHitRate + timeScore
  ));

  return { edgeStrength, magnetDistance, liquidity, movementEnv, historicalHitRate, timeScore, total };
}

function scoreEdgeStrength(setupType: SetupType, triggerMargin: number, lastClose: number): number {
  const baseScores: Record<SetupType, number> = {
    A: 25, B: 25, C: 18, D: 15, E: 10, F: 12,
  };
  let score = baseScores[setupType] || 10;

  if (lastClose > 0 && triggerMargin > 0) {
    const marginPct = triggerMargin / lastClose;
    if (marginPct >= 0.005) score += 10;
    else if (marginPct >= 0.003) score += 7;
    else if (marginPct >= 0.001) score += 4;
    else score += 1;
  }

  return Math.min(35, score);
}

function scoreMagnetDistance(lastClose: number, magnetPrice: number, atr14: number): number {
  if (atr14 <= 0) return 12;
  const distance = Math.abs(lastClose - magnetPrice);
  const ratio = distance / atr14;

  if (ratio <= 0.40) return 25;
  if (ratio <= 0.80) return 18;
  if (ratio <= 1.25) return 10;
  return 0;
}

function scoreLiquidity(avgDollarVolume20d: number): number {
  if (avgDollarVolume20d >= 5_000_000_000) return 15;
  if (avgDollarVolume20d >= 1_000_000_000) return 10;
  if (avgDollarVolume20d >= 250_000_000) return 6;
  return 0;
}

function scoreMovementEnvironment(
  todayTrueRange: number, avgTrueRange20d: number,
  todayVolume: number, avgVolume20d: number
): number {
  let score = 0;
  if (avgTrueRange20d > 0 && todayTrueRange > avgTrueRange20d) score += 10;
  if (avgVolume20d > 0 && todayVolume > avgVolume20d) score += 5;
  return Math.min(15, score);
}

function scoreHistoricalHitRate(hitRate: number | null): number {
  if (hitRate === null || hitRate === undefined) return 5;
  if (hitRate >= 0.75) return 10;
  if (hitRate >= 0.65) return 7;
  if (hitRate >= 0.55) return 4;
  return 0;
}

function scoreTimeToHit(p60: number | null, p390: number | null, mode: "EARLY" | "SAME_DAY" | "BLEND"): number {
  const p60v = p60 ?? 0;
  const p390v = p390 ?? 0;

  let raw: number;
  if (mode === "EARLY") {
    raw = 25 * p60v;
  } else if (mode === "SAME_DAY") {
    raw = 25 * p390v;
  } else {
    raw = 15 * p60v + 10 * p390v;
  }

  return Math.min(25, Math.max(0, Math.round(raw * 10) / 10));
}

export function qualityScoreToTier(
  score: number,
  p60?: number | null,
  p120?: number | null,
): string {
  if (score >= 90 && (p60 ?? 0) >= 0.55) return "APLUS";
  if (score >= 90) return "A";
  if (score >= 80 && (p120 ?? 0) >= 0.60) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "B";
  return "C";
}

export function computeAvgDollarVolume(bars: DailyBar[], period: number = 20): number {
  const last = bars.slice(-period);
  if (last.length === 0) return 0;
  return last.reduce((sum, b) => sum + b.close * b.volume, 0) / last.length;
}
