import type { DailyBar } from "@shared/schema";
import { getDayOfWeek, nextTradingDay } from "./calendar";

export interface SetupResult {
  setupType: string;
  asofDate: string;
  targetDate: string;
  magnetPrice: number;
  magnetPrice2?: number;
  direction: string;
  triggerMargin: number;
}

export function detectSetupA(bars: DailyBar[]): SetupResult[] {
  const results: SetupResult[] = [];
  for (let i = 1; i < bars.length; i++) {
    const fri = bars[i];
    const thu = bars[i - 1];
    if (getDayOfWeek(fri.date) !== 5) continue;
    if (getDayOfWeek(thu.date) !== 4) continue;
    if (fri.high >= thu.high) continue;

    const targetDate = nextTradingDay(fri.date);
    results.push({
      setupType: "A",
      asofDate: fri.date,
      targetDate,
      magnetPrice: fri.low,
      direction: "down-to-magnet",
      triggerMargin: thu.high - fri.high,
    });
  }
  return results;
}

export function detectSetupB(bars: DailyBar[]): SetupResult[] {
  const results: SetupResult[] = [];
  for (let i = 0; i < bars.length; i++) {
    const wed = bars[i];
    if (getDayOfWeek(wed.date) !== 3) continue;

    const mon = bars.slice(0, i).reverse().find((b) => getDayOfWeek(b.date) === 1);
    if (!mon) continue;

    if (wed.high >= mon.high) continue;

    const targetDate = nextTradingDay(wed.date);
    results.push({
      setupType: "B",
      asofDate: wed.date,
      targetDate,
      magnetPrice: wed.low,
      direction: "down-to-magnet",
      triggerMargin: mon.high - wed.high,
    });
  }
  return results;
}

export function detectSetupC(
  bars: DailyBar[],
  gapThreshold: number = 0.003
): SetupResult[] {
  const results: SetupResult[] = [];
  for (let i = 1; i < bars.length; i++) {
    const today = bars[i];
    const prev = bars[i - 1];

    const gapPercent = (today.open - prev.close) / prev.close;
    if (Math.abs(gapPercent) < gapThreshold) continue;

    const direction = gapPercent > 0 ? "down-to-magnet" : "up-to-magnet";

    results.push({
      setupType: "C",
      asofDate: today.date,
      targetDate: today.date,
      magnetPrice: prev.close,
      direction,
      triggerMargin: Math.abs(today.open - prev.close),
    });
  }
  return results;
}

export function detectSetupD(bars: DailyBar[]): SetupResult[] {
  const results: SetupResult[] = [];
  for (let i = 1; i < bars.length; i++) {
    const today = bars[i];
    const yesterday = bars[i - 1];

    if (today.high >= yesterday.high || today.low <= yesterday.low) continue;

    const targetDate = nextTradingDay(today.date);
    results.push({
      setupType: "D",
      asofDate: today.date,
      targetDate,
      magnetPrice: yesterday.high,
      magnetPrice2: yesterday.low,
      direction: "both",
      triggerMargin: yesterday.high - today.high,
    });
  }
  return results;
}

export function detectSetupE(bars: DailyBar[]): SetupResult[] {
  const results: SetupResult[] = [];
  for (let i = 1; i < bars.length; i++) {
    const today = bars[i];
    const prev = bars[i - 1];
    const targetDate = nextTradingDay(today.date);

    results.push({
      setupType: "E",
      asofDate: today.date,
      targetDate,
      magnetPrice: prev.high,
      magnetPrice2: prev.low,
      direction: "both",
      triggerMargin: 0,
    });
  }
  return results;
}

export function detectSetupF(bars: DailyBar[]): SetupResult[] {
  const results: SetupResult[] = [];
  for (let i = 1; i < bars.length; i++) {
    const today = bars[i];
    const prev = bars[i - 1];

    const range = today.high - today.low;
    if (range <= 0) continue;

    const closePosition = (today.close - today.low) / range;
    if (closePosition < 0.65) continue;

    const pdl = prev.low;
    const nearPdl = Math.abs(today.low - pdl) / today.close < 0.0005;
    const roundLevels = [
      Math.floor(today.low),
      Math.floor(today.low) + 0.5,
      Math.ceil(today.low),
    ];
    const nearRound = roundLevels.some(
      (level) => Math.abs(today.low - level) / today.close < 0.0005
    );

    if (!nearPdl && !nearRound) continue;

    const targetDate = nextTradingDay(today.date);
    results.push({
      setupType: "F",
      asofDate: today.date,
      targetDate,
      magnetPrice: today.low,
      direction: "down-to-magnet",
      triggerMargin: range * closePosition,
    });
  }
  return results;
}

export function detectAllSetups(
  bars: DailyBar[],
  enabledSetups: string[] = ["A", "B", "C", "D", "E", "F"],
  gapThreshold: number = 0.003
): SetupResult[] {
  const all: SetupResult[] = [];
  if (enabledSetups.includes("A")) all.push(...detectSetupA(bars));
  if (enabledSetups.includes("B")) all.push(...detectSetupB(bars));
  if (enabledSetups.includes("C")) all.push(...detectSetupC(bars, gapThreshold));
  if (enabledSetups.includes("D")) all.push(...detectSetupD(bars));
  if (enabledSetups.includes("E")) all.push(...detectSetupE(bars));
  if (enabledSetups.includes("F")) all.push(...detectSetupF(bars));
  return all;
}
