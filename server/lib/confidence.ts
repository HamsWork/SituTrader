import type { DailyBar, ConfidenceBreakdown } from "@shared/schema";

export function computeConfidence(
  lastClose: number,
  magnetPrice: number,
  triggerMargin: number,
  triggerDayVolume: number,
  avgVolume20d: number,
  dailyTrueRange: number,
  avgTrueRange20d: number,
  atr14: number
): ConfidenceBreakdown {
  let base = 0.5;
  let cleanEdge = 0;
  let volumeBoost = 0;
  let vixProxy = 0;
  let distancePenalty = 0;

  if (triggerMargin >= 0.001 * lastClose) {
    cleanEdge = 0.15;
  }

  if (avgVolume20d > 0 && triggerDayVolume > avgVolume20d) {
    volumeBoost = 0.10;
  }

  if (avgTrueRange20d > 0 && dailyTrueRange > avgTrueRange20d) {
    vixProxy = 0.05;
  }

  const distance = Math.abs(lastClose - magnetPrice);
  if (atr14 > 0 && distance > 1.25 * atr14) {
    distancePenalty = -0.10;
  }

  let total = base + cleanEdge + volumeBoost + vixProxy + distancePenalty;
  total = Math.max(0.05, Math.min(0.95, total));

  return {
    base,
    cleanEdge: cleanEdge || undefined,
    volumeBoost: volumeBoost || undefined,
    vixProxy: vixProxy || undefined,
    distancePenalty: distancePenalty || undefined,
    total,
  };
}

export function computeATR(bars: DailyBar[], period: number = 14): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const last = trs.slice(-period);
  if (last.length === 0) return 0;
  return last.reduce((a, b) => a + b, 0) / last.length;
}

export function computeAvgVolume(bars: DailyBar[], period: number = 20): number {
  const last = bars.slice(-period);
  if (last.length === 0) return 0;
  return last.reduce((a, b) => a + b.volume, 0) / last.length;
}
