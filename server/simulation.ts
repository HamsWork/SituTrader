import {
  nextTradingDay,
  isTradingDay,
} from "./lib/calendar";
import { storage } from "./storage";
import { SimTickerStepper } from "./simTickerStepper";
import type { TradePlan } from "@shared/schema";

export interface SimSignal {
  id: number;
  ticker: string;
  setupType: string;
  asofDate: string;
  targetDate: string;
  magnetPrice: number;
  direction: string;
  confidence: number;
  qualityScore: number;
  tier: string;
  tradePlan: TradePlan;
  status: "pending" | "hit" | "miss" | "activated" | "invalidated";
  activationStatus: "NOT_ACTIVE" | "ACTIVE" | "INVALIDATED";
  hitTs: string | null;
  timeToHitMin: number | null;
  missReason: string | null;
  activatedTs: string | null;
  entryPrice: number | null;
  stopPrice: number | null;
  mae: number | null;
  mfe: number | null;
  // Pre-open enrichment / activation tracking (best-effort for simulation)
  optionContractTicker?: string | null;
  optionEntryMark?: number | null;
}

export interface RankedSimEntry {
  signalId: number;
  ticker: string;
  setupType: string;
  qualityScore: number;
  rank: number;
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
  signalsGenerated: SimSignal[];
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
  signalsGenerated: SimSignal[];
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
  allSignals: Map<number, SimSignal>;
  watchlistSet: Set<string>;
  timePriorityMode: "EARLY" | "SAME_DAY" | "BLEND";
  nextSimSignalId: number;
  btodExecutedToday: boolean;
  today: string;
  dayIdx: number;
  totalDays: number;
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
  const allSignals: Map<number, SimSignal> = new Map();
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

  let btodExecutedToday = false;

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

    const dayOutput = await simulateDay({
      config, emit, abortSignal, allSignals, watchlistSet,
      timePriorityMode, nextSimSignalId, btodExecutedToday,
      today: tradingDays[dayIdx],
      dayIdx,
      totalDays: tradingDays.length,
    });

    nextSimSignalId = dayOutput.nextSimSignalId;
    btodExecutedToday = dayOutput.btodExecutedToday;
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
  const hitRate =
    totalHitsAll / Math.max(1, totalHitsAll + totalMissesAll) || 0;

  const finalStats = {
    totalDays: tradingDays.length,
    totalSignalsGenerated,
    totalActivations,
    totalHits: totalHitsAll,
    totalMisses: totalMissesAll,
    btodActivations,
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

  emit("done", finalStats);

  return results;
}
