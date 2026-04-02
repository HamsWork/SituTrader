import {
  nextTradingDay,
  isTradingDay,
} from "./lib/calendar";
import { storage } from "./storage";
import { SimTickerStepper } from "./simTickerStepper";
import type { Signal } from "@shared/schema";

export const SIM_BEFORE_PRE_OPEN_CT = 8 * 60 + 15;
export const SIM_PRE_OPEN_CT = 8 * 60 + 20;
export const SIM_RTH_START_CT = 8 * 60 + 30;
export const SIM_RTH_END_CT = 15 * 60;
export const SIM_AFTER_CLOSE_CT = 15 * 60 + 10;

export interface RankedSimEntry {
  signalId: number;
  ticker: string;
  setupType: string;
  qualityScore: number;
  rank: number;
}

export interface SimTrackingBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface SimTrackingResult {
  instrument: string;
  tradeType: "ten_percent" | "normal";
  win: boolean;
  profitPercent: number;
  lastMilestone: number;
  durationDays: number;
  exitReason: "stop_loss" | "milestone_then_stop" | "end_of_data" | "target_hit";
  entryBarTs?: number;
  exitBarTs?: number;
  chartBars?: SimTrackingBar[];
  chartEntry?: number;
  chartStop?: number;
  chartTarget?: number;
  chartMilestones?: { pct: number; price: number }[];
}

export interface SimTradeSyncCall {
  signalId: number;
  ticker: string;
  setupType: string;
  direction: string;
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number;
  instruments: string[];
  status: "SIMULATED";
  triggerTs: string;
  outcome?: "hit" | "miss" | "pending";
  trackingResults?: SimTrackingResult[];
}

export interface InstrumentTradeTypeStats {
  instrument: string;
  tradeType: "ten_percent" | "normal";
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfitPct: number;
  totalProfitPct: number;
  avgDurationDays: number;
}

export interface InstrumentStats {
  instrument: string;
  totalTrades: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  avgProfitPct: number;
  totalProfitPct: number;
}

export interface SimBtodStatus {
  phase: "SELECTIVE" | "OPEN" | "CLOSED";
  gateOpen: boolean;
  executedSignalId: number | null;
  executedTicker: string | null;
  top3Ids: number[];
  eligibleCount: number;
}

export interface SimPhaseSnapshot {
  label: string;
  btodTop3: RankedSimEntry[];
  btodStatus: SimBtodStatus;
  tradeSyncCalls: SimTradeSyncCall[];
  activations: Array<{
    signalId: number;
    ticker: string;
    setupType: string;
    triggerTs: string;
    entryPrice: number;
    isBtod: boolean;
  }>;
  hits: Array<{
    signalId: number;
    ticker: string;
    hitTs: string;
    timeToHitMin: number;
  }>;
  misses: Array<{
    signalId: number;
    ticker: string;
    reason: string;
  }>;
  summary: {
    totalPending: number;
    totalActive: number;
    totalHit: number;
    totalMiss: number;
  };
  signalsGenerated: Signal[];
  onDeckSignals: Array<{
    id: number;
    ticker: string;
    setupType: string;
    direction: string;
    qualityScore: number;
    tier: string;
    magnetPrice: number;
    targetDate: string;
  }>;
  activeSignals: Array<{
    id: number;
    ticker: string;
    setupType: string;
    direction: string;
    qualityScore: number;
    tier: string;
    magnetPrice: number;
    entryPrice: number | null;
    activatedTs: string | null;
  }>;
}

export interface SimDayResult {
  date: string;
  phase: string;
  signalsGenerated: Signal[];
  btodTop3: RankedSimEntry[];
  btodStatus: SimBtodStatus;
  tradeSyncCalls: SimTradeSyncCall[];
  activations: Array<{
    signalId: number;
    ticker: string;
    setupType: string;
    triggerTs: string;
    entryPrice: number;
    isBtod: boolean;
  }>;
  hits: Array<{
    signalId: number;
    ticker: string;
    hitTs: string;
    timeToHitMin: number;
  }>;
  misses: Array<{
    signalId: number;
    ticker: string;
    reason: string;
  }>;
  summary: {
    totalPending: number;
    totalActive: number;
    totalHit: number;
    totalMiss: number;
  };
  phases: SimPhaseSnapshot[];
}

export interface SimConfig {
  startDate: string;
  endDate: string;
  tickers: string[];
  setups: string[];
  timeframe: string;
  entryMode: string;
  stopMode: string;
  atrMultiplier: number;
  gapThreshold: number;
  phaseDelayMs: number;
  btodSetupTypes: string[];
  monitorBtodOnly: boolean;
}

export type SimEventCallback = (
  event: string,
  data: Record<string, any>,
) => void;

function iterateTradingDays(start: string, end: string): string[] {
  const days: string[] = [];
  let current = start;
  if (!isTradingDay(current)) {
    current = nextTradingDay(current);
  }
  while (current <= end) {
    days.push(current);
    current = nextTradingDay(current);
  }
  return days;
}

export interface SimControlSignal {
  aborted: boolean;
  paused: boolean;
  phaseDelayMs: number;
}

async function waitWhilePaused(ctrl: SimControlSignal, emit?: SimEventCallback): Promise<void> {
  let ticks = 0;
  while (ctrl.paused && !ctrl.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    ticks++;
    if (emit && ticks % 25 === 0) {
      emit("heartbeat", { paused: true, elapsed: Math.floor(ticks / 5) });
    }
  }
}

export interface SimDayContext {
  config: SimConfig;
  emit: SimEventCallback;
  abortSignal?: SimControlSignal;
  watchlistSet: Set<string>;
  timePriorityMode: "EARLY" | "SAME_DAY" | "BLEND";
  nextSimSignalId: number;
  
  currentMin: number;
  // signals
  allSignals: Map<number, Signal>;
  onDeckSignals: Map<number, Signal>;
  doneSignals: Map<number, Signal>;
  activeSignals: Map<number, Signal>;
  // current day info
  today: string;
  dayIdx: number;
  totalDays: number;
  btodExecutedToday: boolean;
  btodSignalIds: Set<number>;
  dayResult: SimDayResult;
  prefetchedBars: Map<string, import("./lib/polygon").PolygonBar[]>;

}

function applyActivationToCtx(
  ctx: SimDayContext,
  mut: import("./lib/signalHelper").ActivationMutation,
): void {
  const sig = ctx.onDeckSignals.get(mut.signalId) ?? ctx.activeSignals.get(mut.signalId);
  if (!sig) return;
  sig.activationStatus = "ACTIVE";
  sig.activatedTs = mut.activatedTs ?? null;
  sig.entryPriceAtActivation = mut.entryPrice ?? null;
  sig.stopPrice = mut.stopPrice ?? null;
  sig.stopStage = "INITIAL";
  ctx.onDeckSignals.delete(sig.id);
  ctx.activeSignals.set(sig.id, sig);
  ctx.allSignals.set(sig.id, sig);
}

export function applyMutationsToCtx(
  ctx: SimDayContext,
  mutations: import("./lib/signalHelper").ActivationMutation[],
  now: Date,
): void {
  for (const mut of mutations) {
    const sig = ctx.onDeckSignals.get(mut.signalId) ?? ctx.activeSignals.get(mut.signalId);
    if (!sig) continue;

    switch (mut.type) {
      case "invalidated":
        sig.activationStatus = "INVALIDATED";
        sig.status = "miss";
        sig.missReason = mut.message;
        sig.invalidationTs = now.toISOString();
        ctx.onDeckSignals.delete(sig.id);
        ctx.activeSignals.delete(sig.id);
        ctx.allSignals.set(sig.id, sig);
        break;
      case "stop_to_be":
        sig.stopStage = "BE";
        sig.stopPrice = mut.stopPrice ?? sig.entryPriceAtActivation ?? 0;
        sig.stopMovedToBeTs = now.toISOString();
        ctx.activeSignals.set(sig.id, sig);
        ctx.allSignals.set(sig.id, sig);
        break;
      case "time_stop":
        sig.stopStage = "TIME_TIGHTENED";
        sig.stopPrice = mut.stopPrice ?? sig.stopPrice;
        sig.timeStopTriggeredTs = now.toISOString();
        ctx.activeSignals.set(sig.id, sig);
        ctx.allSignals.set(sig.id, sig);
        break;
      case "entry_invalidated":
        sig.activationStatus = "INVALIDATED";
        sig.status = "miss";
        sig.missReason = mut.message;
        ctx.onDeckSignals.delete(sig.id);
        ctx.allSignals.set(sig.id, sig);
        break;
    }
  }
}

export async function handlePostActivationSim(
  ctx: SimDayContext,
  mutations: import("./lib/signalHelper").ActivationMutation[],
): Promise<void> {
  for (const mut of mutations) {
    if (mut.type === "activated") {
      const sig = ctx.onDeckSignals.get(mut.signalId) ?? ctx.allSignals.get(mut.signalId);
      if (!sig) continue;

      const isBtodCandidate = ctx.btodSignalIds.has(sig.id);

      if (isBtodCandidate && !ctx.btodExecutedToday) {
        ctx.btodExecutedToday = true;

        applyActivationToCtx(ctx, mut);

        ctx.dayResult.activations.push({
          signalId: sig.id,
          ticker: sig.ticker,
          setupType: sig.setupType,
          triggerTs: mut.activatedTs ?? ctx.today,
          entryPrice: mut.entryPrice ?? 0,
          isBtod: true,
        });

        ctx.dayResult.btodStatus.phase = "CLOSED";
        ctx.dayResult.btodStatus.gateOpen = false;
        ctx.dayResult.btodStatus.executedSignalId = sig.id;
        ctx.dayResult.btodStatus.executedTicker = sig.ticker;

        const tp = sig.tradePlanJson as import("@shared/schema").TradePlan;
        const instruments: string[] = ["Shares"];
        if (tp?.stopDistance) instruments.push("Options");
        instruments.push("LETF", "LETF Options");

        const activationEntry = mut.entryPrice ?? 0;
        const stopDist = tp?.stopDistance ?? 0;
        const isBuy = sig.direction?.includes("up");
        const effectiveStop = isBuy
          ? activationEntry - stopDist
          : activationEntry + stopDist;

        const trackingResults = await simulateAllTradeTracking(sig, ctx);

        const anyWin = trackingResults.some((r) => r.win);
        ctx.dayResult.tradeSyncCalls.push({
          signalId: sig.id,
          ticker: sig.ticker,
          setupType: sig.setupType,
          direction: sig.direction,
          entryPrice: activationEntry,
          stopPrice: effectiveStop,
          targetPrice: sig.magnetPrice,
          instruments,
          status: "SIMULATED",
          triggerTs: mut.activatedTs ?? ctx.today,
          outcome: anyWin ? "hit" : "miss",
          trackingResults,
        });
      } else {
        applyActivationToCtx(ctx, mut);

        ctx.dayResult.activations.push({
          signalId: sig.id,
          ticker: sig.ticker,
          setupType: sig.setupType,
          triggerTs: mut.activatedTs ?? ctx.today,
          entryPrice: mut.entryPrice ?? 0,
          isBtod: false,
        });
      }
      continue;
    }

    if (mut.type === "invalidated" || mut.type === "entry_invalidated") {
      const sig = ctx.allSignals.get(mut.signalId);
      if (!sig) continue;
      ctx.dayResult.misses.push({
        signalId: sig.id,
        ticker: sig.ticker,
        reason: mut.message ?? "Entry trigger invalidated",
      });
    }
  }
}

export async function simulateAllTradeTracking(
  sig: Signal,
  ctx: SimDayContext,
): Promise<SimTrackingResult[]> {
  const { fetchIntradayBars, buildOccSymbol, getStrikeIncrement, generateFridaysBetween } = await import("./lib/polygon");

  const entryPrice = sig.entryPriceAtActivation ?? 0;
  const stopPrice = sig.stopPrice ?? 0;
  if (entryPrice <= 0) return [];

  const tp = sig.tradePlanJson as import("@shared/schema").TradePlan;
  const isBuy = tp?.bias === "BUY";
  const activationDate = sig.activatedTs
    ? sig.activatedTs.slice(0, 10)
    : ctx.today;

  const stopDist = tp?.stopDistance ?? Math.abs(entryPrice - stopPrice);
  const actTs = sig.activatedTs ? new Date(sig.activatedTs).getTime() : undefined;

  const sharesBars = await fetchIntradayBars(
    sig.ticker,
    activationDate,
    ctx.config.endDate,
    "1",
  );

  const results: SimTrackingResult[] = [];
  const barSources: Record<string, import("./lib/polygon").PolygonBar[]> = {};

  if (sharesBars.length > 0) {
    barSources["Shares"] = sharesBars;
    results.push(runTenPercentTrack("Shares", entryPrice, stopPrice, isBuy, sharesBars, actTs));
    results.push(runNormalTrack("Shares", entryPrice, stopPrice, tp?.t1 ?? sig.magnetPrice, tp?.t2 ?? null, isBuy, sharesBars, actTs));
  }

  const optionEntryMark = sig.optionEntryMark;
  if (optionEntryMark && optionEntryMark > 0) {
    const delta = 0.5;
    const optStopPrice = Math.max(0, optionEntryMark - delta * stopDist);
    const optT1Price = optionEntryMark + delta * Math.abs((tp?.t1 ?? sig.magnetPrice) - entryPrice);
    const optT2 = tp?.t2 != null ? optionEntryMark + delta * Math.abs(tp.t2 - entryPrice) : null;

    let optBars: import("./lib/polygon").PolygonBar[] = [];
    const optContractTicker = sig.optionContractTicker;
    if (optContractTicker) {
      optBars = await fetchIntradayBars(optContractTicker, activationDate, ctx.config.endDate, "1");
    }
    if (optBars.length === 0) {
      const right: "C" | "P" = isBuy ? "C" : "P";
      const inc = getStrikeIncrement(entryPrice);
      const atmStrike = Math.round(entryPrice / inc) * inc;
      const minExp = activationDate;
      const maxExpD = new Date(activationDate);
      maxExpD.setDate(maxExpD.getDate() + 14);
      const maxExp = maxExpD.toISOString().slice(0, 10);
      const fridays = generateFridaysBetween(minExp, maxExp);
      const expDate = fridays.length > 0 ? fridays[0] : maxExp;
      const occSymbol = buildOccSymbol(sig.ticker, expDate, right, atmStrike);
      optBars = await fetchIntradayBars(occSymbol, activationDate, ctx.config.endDate, "1");
    }
    if (optBars.length > 0) {
      barSources["Options"] = optBars;
      results.push(runTenPercentTrack("Options", optionEntryMark, optStopPrice, true, optBars, actTs));
      results.push(runNormalTrack("Options", optionEntryMark, optStopPrice, optT1Price, optT2, true, optBars, actTs));
    }
  }

  const letfJson = sig.leveragedEtfJson as import("@shared/schema").LeveragedEtfSuggestion | null;
  const letfTicker = sig.instrumentTicker ?? letfJson?.ticker;
  const letfEntryPrice = sig.instrumentEntryPrice;
  if (letfTicker && letfEntryPrice && letfEntryPrice > 0) {
    const letfBars = await fetchIntradayBars(letfTicker, activationDate, ctx.config.endDate, "1");
    if (letfBars.length > 0) {
      barSources["LETF"] = letfBars;
      const leverage = letfJson?.leverage ?? 1;
      const letfIsBuy = leverage < 0 ? !isBuy : isBuy;
      const letfStopPct = Math.abs(stopDist / entryPrice);
      const letfStop = letfIsBuy
        ? letfEntryPrice * (1 - letfStopPct * Math.abs(leverage))
        : letfEntryPrice * (1 + letfStopPct * Math.abs(leverage));
      const letfT1Pct = Math.abs((tp?.t1 ?? sig.magnetPrice) - entryPrice) / entryPrice;
      const letfT1 = letfIsBuy
        ? letfEntryPrice * (1 + letfT1Pct * Math.abs(leverage))
        : letfEntryPrice * (1 - letfT1Pct * Math.abs(leverage));
      const letfT2 = tp?.t2 != null
        ? (letfIsBuy
            ? letfEntryPrice * (1 + (Math.abs(tp.t2 - entryPrice) / entryPrice) * Math.abs(leverage))
            : letfEntryPrice * (1 - (Math.abs(tp.t2 - entryPrice) / entryPrice) * Math.abs(leverage)))
        : null;

      results.push(runTenPercentTrack("LETF", letfEntryPrice, letfStop, letfIsBuy, letfBars, actTs));
      results.push(runNormalTrack("LETF", letfEntryPrice, letfStop, letfT1, letfT2, letfIsBuy, letfBars, actTs));

      const letfOptDelta = 0.5;
      const letfOptEntry = letfEntryPrice * 0.03;
      const letfOptStop = Math.max(0, letfOptEntry - letfOptDelta * Math.abs(letfStop - letfEntryPrice));
      const letfOptT1 = letfOptEntry + letfOptDelta * Math.abs(letfT1 - letfEntryPrice);
      const letfOptT2 = letfT2 != null ? letfOptEntry + letfOptDelta * Math.abs(letfT2 - letfEntryPrice) : null;

      const letfRight: "C" | "P" = letfIsBuy ? "C" : "P";
      const letfInc = getStrikeIncrement(letfEntryPrice);
      const letfAtmStrike = Math.round(letfEntryPrice / letfInc) * letfInc;
      const letfMinExp = activationDate;
      const letfMaxExpD = new Date(activationDate);
      letfMaxExpD.setDate(letfMaxExpD.getDate() + 14);
      const letfMaxExp = letfMaxExpD.toISOString().slice(0, 10);
      const letfFridays = generateFridaysBetween(letfMinExp, letfMaxExp);
      const letfExpDate = letfFridays.length > 0 ? letfFridays[0] : letfMaxExp;
      const letfOccSymbol = buildOccSymbol(letfTicker, letfExpDate, letfRight, letfAtmStrike);
      const letfOptBars = await fetchIntradayBars(letfOccSymbol, activationDate, ctx.config.endDate, "1");
      if (letfOptBars.length > 0) {
        barSources["LETF Options"] = letfOptBars;
        results.push(runTenPercentTrack("LETF Options", letfOptEntry, letfOptStop, true, letfOptBars, actTs));
        results.push(runNormalTrack("LETF Options", letfOptEntry, letfOptStop, letfOptT1, letfOptT2, true, letfOptBars, actTs));
      }
    }
  }

  for (const r of results) {
    if (!r.entryBarTs) continue;
    const src = barSources[r.instrument];
    if (!src || src.length === 0) continue;
    const entryDay = new Date(r.entryBarTs);
    entryDay.setUTCHours(0, 0, 0, 0);
    const exitDay = r.exitBarTs ? new Date(r.exitBarTs) : entryDay;
    exitDay.setUTCHours(23, 59, 59, 999);
    r.chartBars = src.filter(b => b.t >= entryDay.getTime() && b.t <= exitDay.getTime()).map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
  }

  return results;
}

function tradingDaysFromTs(entryTs: number, exitTs: number): number {
  const d1 = new Date(entryTs);
  const d2 = new Date(exitTs);
  d1.setUTCHours(0, 0, 0, 0);
  d2.setUTCHours(0, 0, 0, 0);
  const diffMs = d2.getTime() - d1.getTime();
  return Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)) + 1);
}

function runTenPercentTrack(
  instrument: string,
  entryPrice: number,
  stopPrice: number,
  isBuy: boolean,
  bars: import("./lib/polygon").PolygonBar[],
  activationTs?: number,
): SimTrackingResult {
  const stopPctFromEntry = isBuy
    ? ((stopPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - stopPrice) / entryPrice) * 100;

  let lastMilestone = 0;
  const startIdx = activationTs ? bars.findIndex(b => b.t >= activationTs) : 0;
  const trackBars = startIdx > 0 ? bars.slice(startIdx) : bars;
  const entryBarTs = trackBars.length > 0 ? trackBars[0].t : undefined;

  const buildMilestones = (ms: number) => {
    const arr: { pct: number; price: number }[] = [];
    for (let p = 10; p <= ms; p += 10) {
      const price = isBuy
        ? entryPrice * (1 + p / 100)
        : entryPrice * (1 - p / 100);
      arr.push({ pct: p, price: parseFloat(price.toFixed(4)) });
    }
    return arr;
  };

  for (const bar of trackBars) {

    const favorablePct = isBuy
      ? ((bar.h - entryPrice) / entryPrice) * 100
      : ((entryPrice - bar.l) / entryPrice) * 100;

    const stopHit = isBuy ? bar.l <= stopPrice : bar.h >= stopPrice;

    if (stopHit) {
      const days = entryBarTs ? tradingDaysFromTs(entryBarTs, bar.t) : 1;
      if (lastMilestone === 0) {
        return {
          instrument, tradeType: "ten_percent", win: false,
          profitPercent: parseFloat((-Math.abs(stopPctFromEntry)).toFixed(2)),
          lastMilestone: 0, durationDays: days, exitReason: "stop_loss",
          entryBarTs, exitBarTs: bar.t,
          chartEntry: entryPrice, chartStop: stopPrice,
        };
      } else {
        return {
          instrument, tradeType: "ten_percent", win: true,
          profitPercent: lastMilestone, lastMilestone, durationDays: days,
          exitReason: "milestone_then_stop",
          entryBarTs, exitBarTs: bar.t,
          chartEntry: entryPrice, chartStop: stopPrice,
          chartMilestones: buildMilestones(lastMilestone),
        };
      }
    }

    const milestone = Math.floor(favorablePct / 10) * 10;
    if (milestone > lastMilestone) {
      lastMilestone = milestone;
    }
  }

  const lastTs = trackBars.length > 0 ? trackBars[trackBars.length - 1].t : undefined;
  const endDays = entryBarTs && lastTs ? tradingDaysFromTs(entryBarTs, lastTs) : 1;
  return {
    instrument, tradeType: "ten_percent",
    win: lastMilestone > 0,
    profitPercent: lastMilestone > 0 ? lastMilestone : 0,
    lastMilestone, durationDays: endDays, exitReason: "end_of_data",
    entryBarTs, exitBarTs: lastTs,
    chartEntry: entryPrice, chartStop: stopPrice,
    chartMilestones: lastMilestone > 0 ? buildMilestones(lastMilestone) : undefined,
  };
}

function runNormalTrack(
  instrument: string,
  entryPrice: number,
  stopPrice: number,
  t1Price: number,
  t2Price: number | null,
  isBuy: boolean,
  bars: import("./lib/polygon").PolygonBar[],
  activationTs?: number,
): SimTrackingResult {
  const stopPctFromEntry = Math.abs(stopPrice - entryPrice) / entryPrice * 100;
  let t1Hit = false;
  const startIdx = activationTs ? bars.findIndex(b => b.t >= activationTs) : 0;
  const trackBars = startIdx > 0 ? bars.slice(startIdx) : bars;
  const entryBarTs = trackBars.length > 0 ? trackBars[0].t : undefined;
  const target = t2Price ?? t1Price;

  for (const bar of trackBars) {
    const stopHit = isBuy ? bar.l <= stopPrice : bar.h >= stopPrice;
    const t1HitThisBar = isBuy ? bar.h >= t1Price : bar.l <= t1Price;
    const t2HitThisBar = t2Price != null && (isBuy ? bar.h >= t2Price : bar.l <= t2Price);

    if (t2HitThisBar) {
      const profitPct = Math.abs(t2Price! - entryPrice) / entryPrice * 100;
      const days = entryBarTs ? tradingDaysFromTs(entryBarTs, bar.t) : 1;
      return {
        instrument, tradeType: "normal", win: true,
        profitPercent: parseFloat(profitPct.toFixed(2)),
        lastMilestone: 2, durationDays: days, exitReason: "target_hit",
        entryBarTs, exitBarTs: bar.t,
        chartEntry: entryPrice, chartStop: stopPrice, chartTarget: target,
      };
    }

    if (t1HitThisBar && !t1Hit) {
      t1Hit = true;
    }

    if (stopHit) {
      const days = entryBarTs ? tradingDaysFromTs(entryBarTs, bar.t) : 1;
      if (t1Hit) {
        const profitPct = Math.abs(t1Price - entryPrice) / entryPrice * 100;
        return {
          instrument, tradeType: "normal", win: true,
          profitPercent: parseFloat((profitPct * 0.5).toFixed(2)),
          lastMilestone: 1, durationDays: days, exitReason: "milestone_then_stop",
          entryBarTs, exitBarTs: bar.t,
          chartEntry: entryPrice, chartStop: stopPrice, chartTarget: target,
        };
      }
      return {
        instrument, tradeType: "normal", win: false,
        profitPercent: parseFloat((-stopPctFromEntry).toFixed(2)),
        lastMilestone: 0, durationDays: days, exitReason: "stop_loss",
        entryBarTs, exitBarTs: bar.t,
        chartEntry: entryPrice, chartStop: stopPrice, chartTarget: target,
      };
    }
  }

  const lastTs = trackBars.length > 0 ? trackBars[trackBars.length - 1].t : undefined;
  const endDays = entryBarTs && lastTs ? tradingDaysFromTs(entryBarTs, lastTs) : 1;

  if (t1Hit) {
    const lastClose = trackBars[trackBars.length - 1].c;
    const unrealized = isBuy
      ? (lastClose - entryPrice) / entryPrice * 100
      : (entryPrice - lastClose) / entryPrice * 100;
    return {
      instrument, tradeType: "normal", win: true,
      profitPercent: parseFloat(unrealized.toFixed(2)),
      lastMilestone: 1, durationDays: endDays, exitReason: "end_of_data",
      entryBarTs, exitBarTs: lastTs,
      chartEntry: entryPrice, chartStop: stopPrice, chartTarget: target,
    };
  }

  const lastClose = trackBars.length > 0 ? trackBars[trackBars.length - 1].c : entryPrice;
  const unrealized = isBuy
    ? (lastClose - entryPrice) / entryPrice * 100
    : (entryPrice - lastClose) / entryPrice * 100;
  return {
    instrument, tradeType: "normal",
    win: unrealized > 0,
    profitPercent: parseFloat(unrealized.toFixed(2)),
    lastMilestone: 0, durationDays: endDays, exitReason: "end_of_data",
    entryBarTs, exitBarTs: lastTs,
    chartEntry: entryPrice, chartStop: stopPrice, chartTarget: target,
  };
}



export interface SimDayOutput {
  result: SimDayResult;
  nextSimSignalId: number;
  btodExecutedToday: boolean;
  shouldBreak: boolean;
}

async function simulateDay(ctx: SimDayContext): Promise<SimDayOutput> {
  const stepper = new SimTickerStepper(ctx);
  return stepper.run();
}

export async function runSimulation(
  config: SimConfig,
  emit: SimEventCallback,
  abortSignal?: SimControlSignal,
): Promise<SimDayResult[]> {
  let nextSimSignalId = 1;
  const allSignals: Map<number, Signal> = new Map();
  const results: SimDayResult[] = [];

  const tradingDays = iterateTradingDays(config.startDate, config.endDate);
  if (tradingDays.length === 0) {
    emit("error", { message: "No trading days in selected range" });
    return [];
  }

  const settings = await storage.getAllSettings();
  const timePriorityMode = (settings.timePriorityMode || "BLEND") as "EARLY" | "SAME_DAY" | "BLEND";
  const watchlist = await storage.getWatchlistSymbols();
  const watchlistSet = new Set(watchlist.map((s: any) => s.ticker));

  emit("log", {
    message: `Simulation: ${tradingDays.length} trading days, ${config.tickers.length} tickers, setups [${config.setups.join(",")}]`,
    type: "info",
  });
  emit("log", {
    message: `Range: ${tradingDays[0]} → ${tradingDays[tradingDays.length - 1]}`,
    type: "info",
  });
  emit("log", {
    message: `Settings: timePriorityMode=${timePriorityMode}, watchlist=${watchlistSet.size} symbols`,
    type: "info",
  });

  // IMPORTANT (no look-ahead):
  // In simulation, treat the simulated "today" as the only available "current time".
  // So each day we fetch daily bars up to `today`, not up to config.endDate.

  const emptyDayResult: SimDayResult = {
    date: tradingDays[0],
    phase: "scan",
    signalsGenerated: [],
    btodTop3: [],
    btodStatus: { phase: "SELECTIVE", gateOpen: true, executedSignalId: null, executedTicker: null, top3Ids: [], eligibleCount: 0 },
    tradeSyncCalls: [],
    activations: [],
    hits: [],
    misses: [],
    summary: { totalPending: 0, totalActive: 0, totalHit: 0, totalMiss: 0 },
    phases: [],
  };

  const currentDayCtx: SimDayContext = {
    config,
    emit,
    abortSignal,
    watchlistSet,
    timePriorityMode,
    nextSimSignalId,
    allSignals,
    onDeckSignals: new Map(),
    doneSignals: new Map(),
    activeSignals: new Map(),
    currentMin: SIM_BEFORE_PRE_OPEN_CT,
    btodExecutedToday: false,
    btodSignalIds: new Set(),
    dayResult: emptyDayResult,
    today: tradingDays[0],
    dayIdx: 0,
    totalDays: tradingDays.length,
    prefetchedBars: new Map(),
  };

  for (let dayIdx = 0; dayIdx < tradingDays.length; dayIdx++) {
    if (abortSignal?.aborted) {
      emit("log", { message: "Simulation aborted", type: "error" });
      break;
    }
    if (abortSignal?.paused) {
      emit("log", { message: "Simulation paused...", type: "info" });
      await waitWhilePaused(abortSignal, emit);
      if (abortSignal?.aborted) break;
      emit("log", { message: "Simulation resumed", type: "info" });
    }

    currentDayCtx.today = tradingDays[dayIdx];
    currentDayCtx.dayIdx = dayIdx;
    currentDayCtx.totalDays = tradingDays.length;
    currentDayCtx.btodExecutedToday = false;
    currentDayCtx.prefetchedBars = new Map();

    currentDayCtx.currentMin = SIM_BEFORE_PRE_OPEN_CT;

    const dayOutput = await simulateDay(currentDayCtx);

    results.push(dayOutput.result);

    if (dayOutput.shouldBreak) break;
  }

  const totalSignalsGenerated = results.reduce(
    (s, r) => s + r.signalsGenerated.length,
    0,
  );
  const totalActivations = results.reduce(
    (s, r) => s + r.activations.length,
    0,
  );
  const totalHitsAll = results.reduce((s, r) => s + r.hits.length, 0);
  const totalMissesAll = results.reduce((s, r) => s + r.misses.length, 0);
  const btodActivations = results.reduce(
    (s, r) => s + r.activations.filter((a) => a.isBtod).length,
    0,
  );
  const allHitSignalIds = new Set(results.flatMap((r) => r.hits.map((h) => h.signalId)));
  const allMissSignalIds = new Set(results.flatMap((r) => r.misses.map((m) => m.signalId)));
  const allTsCalls: SimTradeSyncCall[] = results.flatMap((r) => r.tradeSyncCalls);
  for (const tc of allTsCalls) {
    if (allHitSignalIds.has(tc.signalId)) tc.outcome = "hit";
    else if (allMissSignalIds.has(tc.signalId)) tc.outcome = "miss";
    else tc.outcome = "pending";
  }

  type BucketKey = string;
  const detailedMap = new Map<BucketKey, { wins: number; losses: number; profitPcts: number[]; durations: number[] }>();

  for (const tc of allTsCalls) {
    if (!tc.trackingResults || tc.trackingResults.length === 0) continue;
    for (const tr of tc.trackingResults) {
      const key = `${tr.instrument}__${tr.tradeType}`;
      if (!detailedMap.has(key)) detailedMap.set(key, { wins: 0, losses: 0, profitPcts: [], durations: [] });
      const bucket = detailedMap.get(key)!;
      if (tr.win) {
        bucket.wins++;
      } else {
        bucket.losses++;
      }
      bucket.profitPcts.push(tr.profitPercent);
      bucket.durations.push(tr.durationDays);
    }
  }

  const instrumentTradeTypeStats: InstrumentTradeTypeStats[] = Array.from(detailedMap.entries())
    .map(([key, data]) => {
      const [instrument, tradeType] = key.split("__") as [string, "ten_percent" | "normal"];
      const resolved = data.wins + data.losses;
      return {
        instrument,
        tradeType,
        totalTrades: resolved,
        wins: data.wins,
        losses: data.losses,
        winRate: resolved > 0 ? data.wins / resolved : 0,
        avgProfitPct: data.profitPcts.length > 0 ? data.profitPcts.reduce((a, b) => a + b, 0) / data.profitPcts.length : 0,
        totalProfitPct: data.profitPcts.reduce((a, b) => a + b, 0),
        avgDurationDays: data.durations.length > 0 ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length : 0,
      };
    })
    .sort((a, b) => {
      const instOrder = ["Shares", "Options", "LETF", "LETF Options"];
      const ai = instOrder.indexOf(a.instrument);
      const bi = instOrder.indexOf(b.instrument);
      if (ai !== bi) return ai - bi;
      return a.tradeType === "ten_percent" ? -1 : 1;
    });

  const instrumentStatsMap = new Map<string, { wins: number; losses: number; pending: number; profitPcts: number[] }>();
  for (const s of instrumentTradeTypeStats) {
    if (!instrumentStatsMap.has(s.instrument)) instrumentStatsMap.set(s.instrument, { wins: 0, losses: 0, pending: 0, profitPcts: [] });
    const bucket = instrumentStatsMap.get(s.instrument)!;
    bucket.wins += s.wins;
    bucket.losses += s.losses;
    bucket.profitPcts.push(s.totalProfitPct);
  }
  const instrumentStats: InstrumentStats[] = Array.from(instrumentStatsMap.entries()).map(([inst, data]) => {
    const resolved = data.wins + data.losses;
    return {
      instrument: inst,
      totalTrades: resolved + data.pending,
      wins: data.wins,
      losses: data.losses,
      pending: data.pending,
      winRate: resolved > 0 ? data.wins / resolved : 0,
      avgProfitPct: data.profitPcts.length > 0 ? data.profitPcts.reduce((a, b) => a + b, 0) / data.profitPcts.length : 0,
      totalProfitPct: data.profitPcts.reduce((a, b) => a + b, 0),
    };
  });

  const totalTradeSyncCalls = allTsCalls.length;
  const tradeSyncDays = results.filter((r) => r.tradeSyncCalls.length > 0).length;
  const tsWins = allTsCalls.filter((tc) => tc.outcome === "hit").length;
  const tsLosses = allTsCalls.filter((tc) => tc.outcome === "miss").length;
  const tsResolved = tsWins + tsLosses;
  const tsWinRate = tsResolved > 0 ? tsWins / tsResolved : 0;

  const hitRate =
    totalHitsAll / Math.max(1, totalHitsAll + totalMissesAll) || 0;

  const finalStats = {
    totalDays: tradingDays.length,
    totalSignalsGenerated,
    totalActivations,
    totalHits: totalHitsAll,
    totalMisses: totalMissesAll,
    btodActivations,
    totalTradeSyncCalls,
    tradeSyncDays,
    tradeSyncDayPct: tradingDays.length > 0 ? tradeSyncDays / tradingDays.length : 0,
    tsWinRate,
    instrumentStats,
    instrumentTradeTypeStats,
    hitRate,
    dayResults: results.map((r) => ({
      date: r.date,
      signalsGenerated: r.signalsGenerated.length,
      btodTop3: r.btodTop3,
      activations: r.activations,
      hits: r.hits,
      misses: r.misses,
      summary: r.summary,
    })),
  };

  emit("log", {
    message: `\n══════════════════════════════════`,
    type: "info",
  });
  emit("log", {
    message: `SIMULATION COMPLETE`,
    type: "success",
  });
  emit("log", {
    message: `  Days: ${finalStats.totalDays} | Signals: ${finalStats.totalSignalsGenerated} | Activations: ${finalStats.totalActivations}`,
    type: "info",
  });
  emit("log", {
    message: `  Hits: ${finalStats.totalHits} | Misses: ${finalStats.totalMisses} | Hit Rate: ${(finalStats.hitRate * 100).toFixed(1)}%`,
    type: "info",
  });
  emit("log", {
    message: `  BTOD Activations: ${finalStats.btodActivations}`,
    type: "info",
  });
  emit("log", {
    message: `  TradeSync Calls: ${finalStats.totalTradeSyncCalls} (${finalStats.tradeSyncDays}/${finalStats.totalDays} days) | Win Rate: ${(tsWinRate * 100).toFixed(1)}% (${tsWins}W/${tsLosses}L)`,
    type: "info",
  });
  for (const is of instrumentTradeTypeStats) {
    const label = is.tradeType === "ten_percent" ? "10%" : "T1/T2";
    emit("log", {
      message: `    ${is.instrument} [${label}]: ${(is.winRate * 100).toFixed(1)}% WR (${is.wins}W/${is.losses}L) | Avg P/L: ${is.avgProfitPct >= 0 ? "+" : ""}${is.avgProfitPct.toFixed(2)}% | Total: ${is.totalProfitPct >= 0 ? "+" : ""}${is.totalProfitPct.toFixed(2)}% | ~${is.avgDurationDays.toFixed(1)}d`,
      type: "info",
    });
  }

  emit("done", finalStats);

  return results;
}
