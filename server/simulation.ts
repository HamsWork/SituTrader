import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import {
  fetchDailyBarsCached,
  fetchIntradayBarsCached,
  fetchOptionsChain,
  fetchOptionMarkAtTime,
} from "./lib/polygon";
import {
  formatDate,
  getTradingDaysBack,
  nextTradingDay,
  isTradingDay,
} from "./lib/calendar";
import { detectAllSetups } from "./lib/rules";
import { validateMagnetTouch, computeMAEMFE } from "./lib/validate";
import { checkEntryTrigger } from "./lib/activation";
import {
  computeConfidence,
  computeATR,
  computeAvgVolume,
} from "./lib/confidence";
import {
  computeQualityScore,
  qualityScoreToTier,
  computeAvgDollarVolume,
} from "./lib/quality";
import { generateTradePlan } from "./lib/tradeplan";
import { getBtodRankedQueueAndTop3Ids } from "./lib/btod";
import { storage } from "./storage";
import type { DailyBar, TradePlan, SetupType } from "@shared/schema";

dayjs.extend(utc);
dayjs.extend(timezone);

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

    const today = tradingDays[dayIdx];
    btodExecutedToday = false;
    const dayResult: SimDayResult = {
      date: today,
      phase: "scan",
      signalsGenerated: [],
      btodTop3: [],
      btodStatus: {
        phase: "SELECTIVE",
        gateOpen: true,
        executedSignalId: null,
        executedTicker: null,
        top3Ids: [],
        eligibleCount: 0,
      },
      tradeSyncCalls: [],
      activations: [],
      hits: [],
      misses: [],
      summary: { totalPending: 0, totalActive: 0, totalHit: 0, totalMiss: 0 },
      phases: [],
    };

    const captureSnapshot = (label: string): SimPhaseSnapshot => {
      const onDeck = Array.from(allSignals.values())
        .filter((s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE")
        .map((s) => ({
          id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
          qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
        }));
      const active = Array.from(allSignals.values())
        .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
        .map((s) => ({
          id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
          qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
          entryPrice: s.entryPrice, activatedTs: s.activatedTs,
        }));
      let p = 0, a = 0, h = 0, m = 0;
      for (const sig of Array.from(allSignals.values())) {
        if (sig.status === "pending") p++;
        if (sig.activationStatus === "ACTIVE" && sig.status !== "hit") a++;
        if (sig.status === "hit") h++;
        if (sig.status === "miss") m++;
      }
      return {
        label,
        btodTop3: [...dayResult.btodTop3],
        btodStatus: { ...dayResult.btodStatus, top3Ids: [...dayResult.btodStatus.top3Ids] },
        tradeSyncCalls: [...dayResult.tradeSyncCalls],
        activations: [...dayResult.activations],
        hits: [...dayResult.hits],
        misses: [...dayResult.misses],
        summary: { totalPending: p, totalActive: a, totalHit: h, totalMiss: m },
        signalsGenerated: [...dayResult.signalsGenerated],
        onDeckSignals: onDeck,
        activeSignals: active,
      };
    };

    const emitDayUpdate = () => {
      const onDeck = Array.from(allSignals.values())
        .filter((s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE")
        .map((s) => ({
          id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
          qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
        }));
      const active = Array.from(allSignals.values())
        .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
        .map((s) => ({
          id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
          qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
          entryPrice: s.entryPrice, activatedTs: s.activatedTs,
        }));
      emit("day", {
        date: today,
        dayIndex: dayIdx,
        totalDays: tradingDays.length,
        signalsGenerated: dayResult.signalsGenerated.length,
        btodTop3Count: dayResult.btodTop3.length,
        btodTop3: dayResult.btodTop3,
        btodStatus: dayResult.btodStatus,
        tradeSyncCalls: dayResult.tradeSyncCalls,
        activations: dayResult.activations.length,
        activationDetails: dayResult.activations,
        hits: dayResult.hits.length,
        hitDetails: dayResult.hits,
        misses: dayResult.misses.length,
        missDetails: dayResult.misses,
        summary: dayResult.summary,
        onDeckSignals: onDeck,
        activeSignals: active,
        newSignals: dayResult.signalsGenerated.map((s) => ({
          id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
          qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
        })),
        phases: dayResult.phases,
      });
    };

    emit("progress", {
      completed: dayIdx,
      total: tradingDays.length,
      day: today,
      phase: "pre-open-scan",
    });
    emit("log", {
      message: `═══ Day ${dayIdx + 1}/${tradingDays.length}: ${today} ═══`,
      type: "info",
    });

    // ═══════════════════════════════════════════════════════
    // Phase 1: Pre-Open Scan (like runPreOpenScan)
    // BTOD ranking — select top 3 eligible signals
    // ═══════════════════════════════════════════════════════
    emit("log", {
      message: `  Phase 1: Pre-open scan (BTOD selection)`,
      type: "processing",
    });

    const pendingForBtod = Array.from(allSignals.values()).filter(
      (s) =>
        s.status === "pending" &&
        s.activationStatus === "NOT_ACTIVE" &&
        s.targetDate === today,
    );

    const { rankedQueue } = getBtodRankedQueueAndTop3Ids(pendingForBtod);
    const top3: RankedSimEntry[] = rankedQueue.slice(0, 3).map((r) => ({
      signalId: r.signalId,
      ticker: r.ticker,
      setupType: r.setupType,
      qualityScore: r.qualityScore,
      rank: r.rank,
    }));
    dayResult.btodTop3 = top3;
    const btodSignalIds = new Set(top3.map((r) => r.signalId));

    dayResult.btodStatus = {
      phase: top3.length > 0 ? "SELECTIVE" : "CLOSED",
      gateOpen: top3.length > 0,
      executedSignalId: null,
      executedTicker: null,
      top3Ids: top3.map((r) => r.signalId),
      eligibleCount: pendingForBtod.length,
    };

    if (top3.length > 0) {
      emit("log", {
        message: `  BTOD Top ${top3.length}: ${top3.map((r) => `#${r.rank} ${r.ticker}/${r.setupType} QS=${r.qualityScore}`).join(" | ")}`,
        type: "success",
      });
    } else {
      emit("log", {
        message: `  BTOD: No eligible signals (need A/B/C with QS≥62)`,
        type: "info",
      });
    }

    // ===== Pre-open enrichment + activation scan (like runPreOpenScan) =====
    // Note: simulation keeps signals in-memory, so this is a best-effort
    // replica of enrichment + activation decisions (not DB writes).
    const preOpenCandidates = Array.from(allSignals.values()).filter(
      (s) =>
        s.status === "pending" &&
        s.activationStatus === "NOT_ACTIVE" &&
        s.targetDate === today,
    );

    if (preOpenCandidates.length > 0) {
      emit("log", {
        message: `  Pre-open: Enrich pending signals with options (simulation)`,
        type: "processing",
      });

      const CT = "America/Chicago";
      const minExpDate = dayjs.tz(today, CT).add(4, "day").format("YYYY-MM-DD");
      const maxExpDate = dayjs.tz(today, CT).add(45, "day").format("YYYY-MM-DD");
      const minOI = 500;

      // Fetch option chains once per (ticker,right) for performance.
      const optionChainCache = new Map<string, Awaited<ReturnType<typeof fetchOptionsChain>>>();
      const tickersNeeded = Array.from(new Set(preOpenCandidates.map((s) => s.ticker)));

      const getRight = (bias: "BUY" | "SELL") => (bias === "BUY" ? "call" : "put") as
        | "call"
        | "put";

      for (const ticker of tickersNeeded) {
        const tickerSignals = preOpenCandidates.filter((s) => s.ticker === ticker);
        const rightsNeeded = Array.from(
          new Set(
            tickerSignals.map((s) => getRight(s.tradePlan.bias)),
          ),
        );

        for (const right of rightsNeeded) {
          try {
            const chain = await fetchOptionsChain(ticker, right, minExpDate, maxExpDate, 250);
            optionChainCache.set(`${ticker}|${right}`, chain);
          } catch (err: any) {
            emit("log", {
              message: `  Pre-open: option chain fetch failed for ${ticker} (${right}): ${err.message}`,
              type: "error",
            });
          }
        }
      }

      for (const sig of preOpenCandidates) {
        try {
          const right = getRight(sig.tradePlan.bias);
          const chain = optionChainCache.get(`${sig.ticker}|${right}`) ?? [];
          if (chain.length === 0) continue;

          const current = sig.magnetPrice;
          if (!current || current <= 0) continue;

          const nearATM = chain.filter(
            (c) => Math.abs(c.strike_price - current) / current < 0.03,
          );
          const pool = nearATM.length > 0 ? nearATM : chain;

          const oiQualified = pool.filter((c) => (c.open_interest ?? 0) >= minOI);
          const oiPool = oiQualified.length > 0 ? oiQualified : pool;

          oiPool.sort((a, b) => {
            const dA = Math.abs(a.strike_price - current);
            const dB = Math.abs(b.strike_price - current);
            if (dA !== dB) return dA - dB;
            const oiA = a.open_interest ?? 0;
            const oiB = b.open_interest ?? 0;
            return oiB - oiA;
          });

          sig.optionContractTicker = oiPool[0]?.ticker ?? null;
        } catch (err: any) {
          emit("log", {
            message: `  Pre-open: options enrich failed for ${sig.ticker}/${sig.setupType}: ${err.message}`,
            type: "error",
          });
        }
      }

      emit("log", {
        message: `  Pre-open: Run activation scan (simulation)`,
        type: "processing",
      });

      const preOpenEndCTMs = dayjs
        .tz(`${today} 08:30:00`, CT)
        .valueOf();

      const preOpenTickers = Array.from(new Set(preOpenCandidates.map((s) => s.ticker)));
      for (const ticker of preOpenTickers) {
        if (abortSignal?.aborted) break;
        if (abortSignal?.paused) await waitWhilePaused(abortSignal, emit);
        if (abortSignal?.aborted) break;

        try {
          const intradayPolygon = await fetchIntradayBarsCached(
            ticker,
            today,
            today,
            config.timeframe,
          );
          const intradayBarsAll = intradayPolygon.map((b: any) => ({
            ts: new Date(b.t).toISOString(),
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
            volume: b.v,
          }));

          const intradayBars = intradayBarsAll.filter(
            (b) => Date.parse(b.ts) <= preOpenEndCTMs,
          );

          const tickerSignals = preOpenCandidates.filter((s) => s.ticker === ticker);

          for (const sig of tickerSignals) {
            if (sig.activationStatus !== "NOT_ACTIVE") continue;

            const triggerResult = checkEntryTrigger(
              intradayBars,
              sig.tradePlan,
              config.entryMode,
            );

            if (!triggerResult.triggered) {
              if (triggerResult.invalidated) {
                sig.activationStatus = "INVALIDATED";
                sig.status = "miss";
                sig.missReason = "Entry trigger invalidated (pre-open)";
                dayResult.misses.push({
                  signalId: sig.id,
                  ticker: sig.ticker,
                  reason: "Entry trigger invalidated",
                });
              }
              continue;
            }

            const isBtodCandidate = btodSignalIds.has(sig.id);

            // In the real system activation happens regardless of BTOD execution;
            // the BTOD gate only affects TradeSync/alerts.
            sig.activationStatus = "ACTIVE";
            sig.activatedTs = triggerResult.triggerTs ?? null;
            sig.entryPrice = triggerResult.entryPrice ?? null;

            if (sig.optionContractTicker && triggerResult.triggerTs) {
              const triggerMs = new Date(triggerResult.triggerTs).getTime();
              sig.optionEntryMark = await fetchOptionMarkAtTime(sig.optionContractTicker, triggerMs);
            }

            if (isBtodCandidate && !btodExecutedToday) {
              btodExecutedToday = true;
              dayResult.activations.push({
                signalId: sig.id,
                ticker: sig.ticker,
                setupType: sig.setupType,
                triggerTs: triggerResult.triggerTs ?? today,
                entryPrice: triggerResult.entryPrice ?? 0,
                isBtod: true,
              });

              dayResult.btodStatus.phase = "CLOSED";
              dayResult.btodStatus.gateOpen = false;
              dayResult.btodStatus.executedSignalId = sig.id;
              dayResult.btodStatus.executedTicker = sig.ticker;

              const instruments: string[] = ["Shares"];
              if (sig.tradePlan.stopDistance) instruments.push("Options");
              instruments.push("LETF", "LETF Options");

              dayResult.tradeSyncCalls.push({
                signalId: sig.id,
                ticker: sig.ticker,
                setupType: sig.setupType,
                direction: sig.direction,
                entryPrice: triggerResult.entryPrice ?? 0,
                stopPrice: sig.stopPrice,
                targetPrice: sig.magnetPrice,
                instruments,
                status: "SIMULATED",
                triggerTs: triggerResult.triggerTs ?? today,
              });

              emit("log", {
                message: `  ★ BTOD PRE-OPEN ACTIVATION: ${sig.ticker}/${sig.setupType} @ $${triggerResult.entryPrice?.toFixed(2)} (Rank #${top3.find((r) => r.signalId === sig.id)?.rank})`,
                type: "success",
              });
            } else {
              dayResult.activations.push({
                signalId: sig.id,
                ticker: sig.ticker,
                setupType: sig.setupType,
                triggerTs: triggerResult.triggerTs ?? today,
                entryPrice: triggerResult.entryPrice ?? 0,
                isBtod: false,
              });
            }
          }
        } catch (err: any) {
          emit("log", {
            message: `  Pre-open activation scan error ${ticker}: ${err.message}`,
            type: "error",
          });
        }
      }
    }

    dayResult.phases.push(captureSnapshot("Pre-Open Scan"));
    emitDayUpdate();
    await new Promise((r) => setTimeout(r, 4000));
    if (abortSignal?.aborted) break;

    // ═══════════════════════════════════════════════════════
    // Phase 2: Live Monitor Tick (like runLiveMonitorTick)
    // Activation scan + magnet touch validation
    // ═══════════════════════════════════════════════════════
    emit("log", {
      message: `  Phase 2: Live monitor tick (activation + magnet touch)`,
      type: "processing",
    });

    const todaysPending = Array.from(allSignals.values()).filter(
      (s) =>
        s.status === "pending" &&
        s.targetDate === today &&
        s.activationStatus !== "INVALIDATED",
    );

    if (todaysPending.length > 0) {
      const tickersNeeded = Array.from(new Set(todaysPending.map((s) => s.ticker)));

      for (const ticker of tickersNeeded) {
        if (abortSignal?.aborted) break;
        if (abortSignal?.paused) await waitWhilePaused(abortSignal, emit);
        if (abortSignal?.aborted) break;
        try {
          const intradayPolygon = await fetchIntradayBarsCached(
            ticker,
            today,
            today,
            config.timeframe,
          );
          const intradayBars = intradayPolygon.map((b: any) => ({
            ts: new Date(b.t).toISOString(),
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
            volume: b.v,
          }));

          const tickerSignals = todaysPending.filter(
            (s) => s.ticker === ticker,
          );

          for (const sig of tickerSignals) {
            const isBtodCandidate = btodSignalIds.has(sig.id);

            // Only attempt entry-trigger activation for NOT_ACTIVE signals.
            // Signals already activated in pre-open should still be magnet-tested.
            if (sig.activationStatus === "NOT_ACTIVE") {
              const triggerResult = checkEntryTrigger(
                intradayBars,
                sig.tradePlan,
                config.entryMode,
              );

              if (triggerResult.triggered) {
                sig.activationStatus = "ACTIVE";
                sig.activatedTs = triggerResult.triggerTs ?? null;
                sig.entryPrice = triggerResult.entryPrice ?? null;

                if (isBtodCandidate && !btodExecutedToday) {
                  btodExecutedToday = true;

                  dayResult.activations.push({
                    signalId: sig.id,
                    ticker: sig.ticker,
                    setupType: sig.setupType,
                    triggerTs: triggerResult.triggerTs ?? today,
                    entryPrice: triggerResult.entryPrice ?? 0,
                    isBtod: true,
                  });

                  dayResult.btodStatus.phase = "CLOSED";
                  dayResult.btodStatus.gateOpen = false;
                  dayResult.btodStatus.executedSignalId = sig.id;
                  dayResult.btodStatus.executedTicker = sig.ticker;

                  const instruments: string[] = ["Shares"];
                  if (sig.tradePlan.stopDistance) instruments.push("Options");
                  instruments.push("LETF", "LETF Options");

                  dayResult.tradeSyncCalls.push({
                    signalId: sig.id,
                    ticker: sig.ticker,
                    setupType: sig.setupType,
                    direction: sig.direction,
                    entryPrice: triggerResult.entryPrice ?? 0,
                    stopPrice: sig.stopPrice,
                    targetPrice: sig.magnetPrice,
                    instruments,
                    status: "SIMULATED",
                    triggerTs: triggerResult.triggerTs ?? today,
                  });

                  emit("log", {
                    message: `  ★ BTOD ACTIVATION: ${sig.ticker}/${sig.setupType} @ $${triggerResult.entryPrice?.toFixed(2)} (Rank #${top3.find((r) => r.signalId === sig.id)?.rank})`,
                    type: "success",
                  });
                  emit("log", {
                    message: `  📡 TradeSync (sim): Would send ${instruments.join(", ")} for ${sig.ticker} ${sig.direction} @$${(triggerResult.entryPrice ?? 0).toFixed(2)} → target $${sig.magnetPrice.toFixed(2)}`,
                    type: "info",
                  });
                } else {
                  dayResult.activations.push({
                    signalId: sig.id,
                    ticker: sig.ticker,
                    setupType: sig.setupType,
                    triggerTs: triggerResult.triggerTs ?? today,
                    entryPrice: triggerResult.entryPrice ?? 0,
                    isBtod: false,
                  });

                  emit("log", {
                    message: `  → Activated: ${sig.ticker}/${sig.setupType} @ $${triggerResult.entryPrice?.toFixed(2)}${isBtodCandidate && btodExecutedToday ? " (BTOD gate closed)" : ""}`,
                    type: "success",
                  });
                }
              } else if (triggerResult.invalidated) {
                sig.activationStatus = "INVALIDATED";
                sig.status = "miss";
                sig.missReason = "Entry trigger invalidated";
                dayResult.misses.push({
                  signalId: sig.id,
                  ticker: sig.ticker,
                  reason: "Entry trigger invalidated",
                });
                continue;
              }
            }

            const touchResult = validateMagnetTouch(
              intradayBars.map((b) => ({
                ts: b.ts,
                high: b.high,
                low: b.low,
              })),
              sig.magnetPrice,
              sig.direction,
            );

            if (touchResult.hit) {
              sig.status = "hit";
              sig.hitTs = touchResult.hitTs ?? null;
              sig.timeToHitMin = touchResult.timeToHitMin ?? null;
              dayResult.hits.push({
                signalId: sig.id,
                ticker: sig.ticker,
                hitTs: touchResult.hitTs ?? today,
                timeToHitMin: touchResult.timeToHitMin ?? 0,
              });
              emit("log", {
                message: `  ✓ HIT: ${sig.ticker}/${sig.setupType} magnet $${sig.magnetPrice.toFixed(2)} touched at ${touchResult.timeToHitMin}min`,
                type: "success",
              });
            }

            if (sig.entryPrice && intradayBars.length > 0) {
              const maeMfe = computeMAEMFE(
                intradayBars as any,
                sig.entryPrice,
                sig.direction,
              );
              sig.mae = maeMfe.mae;
              sig.mfe = maeMfe.mfe;
            }
          }
        } catch (err: any) {
          emit("log", {
            message: `  Intraday error ${ticker}: ${err.message}`,
            type: "error",
          });
        }
      }
    } else {
      emit("log", {
        message: `  No signals targeting ${today}`,
        type: "info",
      });
    }

    dayResult.phases.push(captureSnapshot("Live Monitor Tick"));
    emitDayUpdate();
    await new Promise((r) => setTimeout(r, 4000));
    if (abortSignal?.aborted) break;

    // ═══════════════════════════════════════════════════════
    // Phase 3: After-close Scan (like runAfterCloseScan)
    // Finalize misses for today's signals + detect new setups
    // ═══════════════════════════════════════════════════════
    emit("log", {
      message: `  Phase 3: After-close scan (finalize misses + detect setups)`,
      type: "processing",
    });

    // Finalize: any signal targeting `today` that never hit during the live tick is a miss.
    for (const sig of Array.from(allSignals.values())) {
      if (sig.status !== "pending") continue;
      if (sig.targetDate !== today) continue;
      sig.status = "miss";
      sig.missReason = "Magnet not touched during RTH";
      dayResult.misses.push({
        signalId: sig.id,
        ticker: sig.ticker,
        reason: sig.missReason,
      });
    }

    const afterCloseExistingSignalKeys = new Set<string>(
      Array.from(allSignals.values()).map(
        (s) => `${s.ticker}|${s.setupType}|${s.asofDate}|${s.targetDate}`,
      ),
    );

    for (const ticker of config.tickers) {
      if (abortSignal?.aborted) break;
      if (abortSignal?.paused) await waitWhilePaused(abortSignal, emit);
      if (abortSignal?.aborted) break;
      try {
        const from200 = getTradingDaysBack(today, 200);
        const polygon = await fetchDailyBarsCached(ticker, from200, today);
        const dailyBars: DailyBar[] = polygon.map((b: any) => ({
          id: 0,
          ticker,
          date: formatDate(new Date(b.t)),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
          vwap: b.vw ?? null,
          source: "polygon",
        }));

        dailyBars.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

        if (dailyBars.length < 5) continue;

        const recentBars = dailyBars.slice(-30);
        const setups = detectAllSetups(
          recentBars,
          config.setups,
          config.gapThreshold,
        );

        // After-close setups should target future days (strictly > today)
        const relevantSetups = setups.filter((s) => s.targetDate > today);
        if (relevantSetups.length === 0) continue;

        const atr = computeATR(dailyBars);
        const avgVol = computeAvgVolume(dailyBars);
        const avgDollarVol = computeAvgDollarVolume(dailyBars);
        const lastBar = dailyBars[dailyBars.length - 1];
        const avgRange20d = dailyBars.slice(-20).length > 0
          ? dailyBars.slice(-20).reduce((s, b) => s + (b.high - b.low), 0) / dailyBars.slice(-20).length
          : 0;
        const avgRange = recentBars.length > 0
          ? recentBars.reduce((s, b) => s + (b.high - b.low), 0) / recentBars.length
          : 0;

        const isOnWatchlist = watchlistSet.has(ticker);

        for (const setup of relevantSetups) {
          const key = `${ticker}|${setup.setupType}|${setup.asofDate}|${setup.targetDate}`;
          if (afterCloseExistingSignalKeys.has(key)) continue;
          afterCloseExistingSignalKeys.add(key);

          const triggerDayBar = recentBars.find(
            (b) => b.date === setup.asofDate,
          );
          const triggerDayVolume = triggerDayBar?.volume ?? 0;
          const triggerDayRange = triggerDayBar
            ? triggerDayBar.high - triggerDayBar.low
            : 0;

          const confidence = computeConfidence(
            lastBar.close,
            setup.magnetPrice,
            setup.triggerMargin,
            triggerDayVolume,
            avgVol,
            triggerDayRange,
            avgRange,
            atr,
          );

          const historicalHitRate = await storage.getHitRateForTickerSetup(
            ticker,
            setup.setupType,
          );
          const tthStats = await storage.getTimeToHitStats(
            ticker,
            setup.setupType,
          );

          const qualityResult = computeQualityScore({
            setupType: setup.setupType as SetupType,
            triggerMargin: setup.triggerMargin,
            lastClose: lastBar.close,
            magnetPrice: setup.magnetPrice,
            atr14: atr,
            avgDollarVolume20d: avgDollarVol,
            todayTrueRange: triggerDayRange,
            avgTrueRange20d: avgRange20d,
            todayVolume: triggerDayVolume,
            avgVolume20d: avgVol,
            historicalHitRate,
            p60: tthStats?.p60 ?? null,
            p390: tthStats?.p390 ?? null,
            timePriorityMode,
          });

          const sigP60 = tthStats?.p60 ?? null;
          const sigP120 = tthStats?.p120 ?? null;

          let tier = qualityScoreToTier(qualityResult.total, sigP60, sigP120);
          if (isOnWatchlist && tier === "B") tier = "A";
          else if (isOnWatchlist && tier === "C") tier = "B";

          const tradePlan = generateTradePlan(
            lastBar.close,
            setup.magnetPrice,
            dailyBars,
            config.entryMode,
            config.stopMode,
            config.atrMultiplier,
          );

          const simSig: SimSignal = {
            id: nextSimSignalId++,
            ticker,
            setupType: setup.setupType,
            asofDate: setup.asofDate,
            targetDate: setup.targetDate,
            magnetPrice: setup.magnetPrice,
            direction: setup.direction,
            confidence: confidence.total,
            qualityScore: Math.round(qualityResult.total),
            tier,
            tradePlan,
            status: "pending",
            activationStatus: "NOT_ACTIVE",
            hitTs: null,
            timeToHitMin: null,
            missReason: null,
            activatedTs: null,
            entryPrice: null,
            stopPrice: tradePlan.stopDistance
              ? tradePlan.bias === "SELL"
                ? lastBar.close + tradePlan.stopDistance
                : lastBar.close - tradePlan.stopDistance
              : null,
            mae: null,
            mfe: null,
          };

          allSignals.set(simSig.id, simSig);
          dayResult.signalsGenerated.push(simSig);
        }
      } catch (err: any) {
        emit("log", {
          message: `  Scan error ${ticker}: ${err.message}`,
          type: "error",
        });
      }
    }

    if (dayResult.signalsGenerated.length > 0) {
      const truncated = dayResult.signalsGenerated.slice(0, 10);
      const suffix =
        dayResult.signalsGenerated.length > 10
          ? ` ...and ${dayResult.signalsGenerated.length - 10} more`
          : "";
      emit("log", {
        message: `  Detected ${dayResult.signalsGenerated.length} new signal(s): ${truncated.map((s) => `${s.ticker}/${s.setupType}[QS=${s.qualityScore},${s.tier}]`).join(", ")}${suffix}`,
        type: "success",
      });
    }

    dayResult.phases.push(captureSnapshot("After-Close Scan"));
    emitDayUpdate();
    await new Promise((r) => setTimeout(r, 4000));
    if (abortSignal?.aborted) break;

    // ═══════════════════════════════════════════════════════
    // Phase 4: End of Day — final summary
    // ═══════════════════════════════════════════════════════
    let totalPending = 0,
      totalActive = 0,
      totalHit = 0,
      totalMiss = 0;
    for (const sig of Array.from(allSignals.values())) {
      if (sig.status === "pending") totalPending++;
      if (sig.activationStatus === "ACTIVE" && sig.status !== "hit")
        totalActive++;
      if (sig.status === "hit") totalHit++;
      if (sig.status === "miss") totalMiss++;
    }
    dayResult.summary = { totalPending, totalActive, totalHit, totalMiss };

    dayResult.phases.push(captureSnapshot("End of Day"));

    emit("log", {
      message: `  Summary: ${totalPending} pending | ${totalActive} active | ${totalHit} hits | ${totalMiss} misses`,
      type: "info",
    });

    const onDeckSignals = Array.from(allSignals.values())
      .filter((s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE")
      .map((s) => ({
        id: s.id,
        ticker: s.ticker,
        setupType: s.setupType,
        direction: s.direction,
        qualityScore: s.qualityScore,
        tier: s.tier,
        magnetPrice: s.magnetPrice,
        targetDate: s.targetDate,
      }));

    const activeSignals = Array.from(allSignals.values())
      .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => ({
        id: s.id,
        ticker: s.ticker,
        setupType: s.setupType,
        direction: s.direction,
        qualityScore: s.qualityScore,
        tier: s.tier,
        magnetPrice: s.magnetPrice,
        entryPrice: s.entryPrice,
        activatedTs: s.activatedTs,
      }));

    emit("day", {
      date: today,
      dayIndex: dayIdx,
      totalDays: tradingDays.length,
      signalsGenerated: dayResult.signalsGenerated.length,
      btodTop3Count: dayResult.btodTop3.length,
      btodTop3: dayResult.btodTop3,
      btodStatus: dayResult.btodStatus,
      tradeSyncCalls: dayResult.tradeSyncCalls,
      activations: dayResult.activations.length,
      activationDetails: dayResult.activations,
      hits: dayResult.hits.length,
      hitDetails: dayResult.hits,
      misses: dayResult.misses.length,
      missDetails: dayResult.misses,
      summary: dayResult.summary,
      onDeckSignals,
      activeSignals,
      newSignals: dayResult.signalsGenerated.map((s) => ({
        id: s.id,
        ticker: s.ticker,
        setupType: s.setupType,
        direction: s.direction,
        qualityScore: s.qualityScore,
        tier: s.tier,
        magnetPrice: s.magnetPrice,
        targetDate: s.targetDate,
      })),
      phases: dayResult.phases,
    });

    results.push(dayResult);
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
