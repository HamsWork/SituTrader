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

export interface SimTrackingResult {
  instrument: string;
  win: boolean;
  profitPercent: number;
  lastMilestone: number;
  durationDays: number;
  exitReason: "stop_loss" | "milestone_then_stop" | "end_of_data";
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
  let heartbeatCount = 0;
  while (ctrl.paused && !ctrl.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    heartbeatCount++;
    if (emit && heartbeatCount % 5 === 0) {
      emit("heartbeat", { paused: true, elapsed: heartbeatCount });
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
      case "activated":
        sig.activationStatus = "ACTIVE";
        sig.activatedTs = mut.activatedTs ?? null;
        sig.entryPriceAtActivation = mut.entryPrice ?? null;
        sig.stopPrice = mut.stopPrice ?? null;
        sig.stopStage = "INITIAL";
        ctx.onDeckSignals.delete(sig.id);
        ctx.activeSignals.set(sig.id, sig);
        ctx.allSignals.set(sig.id, sig);
        break;
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
    const sig = ctx.allSignals.get(mut.signalId);
    if (!sig) continue;

    switch (mut.type) {
      case "activated": {
        const isBtodCandidate = ctx.btodSignalIds.has(sig.id);

        if (isBtodCandidate && !ctx.btodExecutedToday) {
          ctx.btodExecutedToday = true;

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

          const trackingResults = await simulateTenPercentTracking(sig, ctx);

          const anyWin = trackingResults.some((r) => r.win);
          ctx.dayResult.tradeSyncCalls.push({
            signalId: sig.id,
            ticker: sig.ticker,
            setupType: sig.setupType,
            direction: sig.direction,
            entryPrice: mut.entryPrice ?? 0,
            stopPrice: sig.stopPrice,
            targetPrice: sig.magnetPrice,
            instruments,
            status: "SIMULATED",
            triggerTs: mut.activatedTs ?? ctx.today,
            outcome: anyWin ? "hit" : "miss",
            trackingResults,
          });
        } else {
          ctx.dayResult.activations.push({
            signalId: sig.id,
            ticker: sig.ticker,
            setupType: sig.setupType,
            triggerTs: mut.activatedTs ?? ctx.today,
            entryPrice: mut.entryPrice ?? 0,
            isBtod: false,
          });
        }
        break;
      }

      case "invalidated":
      case "entry_invalidated":
        ctx.dayResult.misses.push({
          signalId: sig.id,
          ticker: sig.ticker,
          reason: mut.message ?? "Entry trigger invalidated",
        });
        break;
    }
  }
}

async function simulateTenPercentTracking(
  sig: Signal,
  ctx: SimDayContext,
): Promise<SimTrackingResult[]> {
  const { fetchDailyBarsCached } = await import("./lib/polygon");

  const entryPrice = sig.entryPriceAtActivation ?? 0;
  const stopPrice = sig.stopPrice ?? 0;
  if (entryPrice <= 0) return [];

  const tp = sig.tradePlanJson as import("@shared/schema").TradePlan;
  const isBuy = tp?.bias === "BUY";
  const activationDate = sig.activatedTs
    ? sig.activatedTs.slice(0, 10)
    : ctx.today;

  const bars = await fetchDailyBarsCached(
    sig.ticker,
    activationDate,
    ctx.config.endDate,
  );

  if (bars.length === 0) return [];

  const sharesResult = runTenPercentMilestoneTrack(
    "Shares",
    entryPrice,
    stopPrice,
    isBuy,
    bars,
    activationDate,
  );

  return [sharesResult];
}

function runTenPercentMilestoneTrack(
  instrument: string,
  entryPrice: number,
  stopPrice: number,
  isBuy: boolean,
  bars: import("./lib/polygon").PolygonBar[],
  activationDate: string,
): SimTrackingResult {
  const stopPercent = ((stopPrice - entryPrice) / entryPrice) * 100;

  let lastMilestone = 0;
  let durationDays = 0;

  for (const bar of bars) {
    durationDays++;

    const highPct = ((bar.h - entryPrice) / entryPrice) * 100;
    const lowPct = ((bar.l - entryPrice) / entryPrice) * 100;

    const favorablePct = isBuy ? highPct : -lowPct;
    const adversePct = isBuy ? lowPct : -highPct;

    const stopHit = isBuy
      ? bar.l <= stopPrice
      : bar.h >= stopPrice;

    if (stopHit) {
      if (lastMilestone === 0) {
        return {
          instrument,
          win: false,
          profitPercent: parseFloat(stopPercent.toFixed(2)),
          lastMilestone: 0,
          durationDays,
          exitReason: "stop_loss",
        };
      } else {
        return {
          instrument,
          win: true,
          profitPercent: lastMilestone,
          lastMilestone,
          durationDays,
          exitReason: "milestone_then_stop",
        };
      }
    }

    const milestone = Math.floor(favorablePct / 10) * 10;
    if (milestone > lastMilestone) {
      lastMilestone = milestone;
    }
  }

  const win = lastMilestone > 0;
  return {
    instrument,
    win,
    profitPercent: win ? lastMilestone : 0,
    lastMilestone,
    durationDays,
    exitReason: "end_of_data",
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

  const LETF_MULTIPLIER = 2;
  const instrumentStatsMap = new Map<string, { wins: number; losses: number; pending: number; profitPcts: number[] }>();
  for (const tc of allTsCalls) {
    const isLong = tc.direction.includes("up");
    const entry = tc.entryPrice;
    const target = tc.targetPrice;
    const stop = tc.stopPrice ?? entry;

    const underlyingProfitPct = isLong
      ? ((target - entry) / entry) * 100
      : ((entry - target) / entry) * 100;
    const underlyingLossPct = isLong
      ? ((stop - entry) / entry) * 100
      : ((entry - stop) / entry) * 100;

    for (const inst of tc.instruments) {
      if (!instrumentStatsMap.has(inst)) instrumentStatsMap.set(inst, { wins: 0, losses: 0, pending: 0, profitPcts: [] });
      const bucket = instrumentStatsMap.get(inst)!;

      let multiplier = 1;
      if (inst === "LETF" || inst === "LETF Options") multiplier = LETF_MULTIPLIER;

      if (tc.outcome === "hit") {
        bucket.wins++;
        bucket.profitPcts.push(underlyingProfitPct * multiplier);
      } else if (tc.outcome === "miss") {
        bucket.losses++;
        bucket.profitPcts.push(underlyingLossPct * multiplier);
      } else {
        bucket.pending++;
      }
    }
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
    tsWinRate,
    instrumentStats,
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
  for (const is of instrumentStats) {
    emit("log", {
      message: `    ${is.instrument}: ${(is.winRate * 100).toFixed(1)}% WR (${is.wins}W/${is.losses}L) | Avg P/L: ${is.avgProfitPct >= 0 ? "+" : ""}${is.avgProfitPct.toFixed(2)}% | Total: ${is.totalProfitPct >= 0 ? "+" : ""}${is.totalProfitPct.toFixed(2)}%`,
      type: "info",
    });
  }

  emit("done", finalStats);

  return results;
}
