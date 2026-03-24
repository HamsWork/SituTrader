import dayjs from "dayjs";
import {
  fetchIntradayBarsCached,
  fetchDailyBarsCached,
  fetchOptionsChain,
  fetchOptionMarkAtTime,
} from "./lib/polygon";
import {
  formatDate,
  getTradingDaysBack,
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
import { storage } from "./storage";
import type { DailyBar, SetupType } from "@shared/schema";

import type {
  SimSignal,
  RankedSimEntry,
  SimDayResult,
  SimPhaseSnapshot,
  SimConfig,
  SimEventCallback,
  SimControlSignal,
  SimDayContext,
  SimDayOutput,
} from "./simulation";
import { initializeBtodForDay } from "./lib/btod";
import type { RankedSignalEntry } from "./lib/btod";
import { checkInvalidation, computeRNow, computeProgressToTarget, shouldApplyBE, shouldApplyTimeStop } from "./lib/signalHelper";

type IBar = { ts: string; open: number; high: number; low: number; close: number; volume: number };

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

const SIM_PRE_OPEN_CT = 8 * 60 + 15;
const SIM_RTH_START_CT = 8 * 60 + 30;
const SIM_RTH_END_CT = 15 * 60;
const SIM_AFTER_CLOSE_CT = 15 * 60 + 10;

function formatSimTime(minutesCT: number): string {
  const h = Math.floor(minutesCT / 60);
  const m = minutesCT % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix} CT`;
}

export class SimTickerStepper {
  private ctx: SimDayContext;
  private dayResult: SimDayResult;
  private preloadedIntraday = new Map<string, IBar[]>();
  private preloadedDaily = new Map<string, DailyBar[]>();
  private preloadedOptions = new Map<string, Awaited<ReturnType<typeof fetchOptionsChain>>>();
  private btodSignalIds = new Set<number>();
  private top3: RankedSimEntry[] = [];
  private nextSimSignalId: number;
  private btodExecutedToday: boolean;
  private simTimeCT: number = SIM_PRE_OPEN_CT;

  private get config() { return this.ctx.config; }
  private get emit() { return this.ctx.emit; }
  private get abortSignal() { return this.ctx.abortSignal; }
  private get allSignals() { return this.ctx.allSignals; }
  private get watchlistSet() { return this.ctx.watchlistSet; }
  private get timePriorityMode() { return this.ctx.timePriorityMode; }
  private get today() { return this.ctx.today; }
  private get dayIdx() { return this.ctx.dayIdx; }
  private get totalDays() { return this.ctx.totalDays; }
  private get CT() { return "America/Chicago"; }

  constructor(ctx: SimDayContext) {
    this.ctx = ctx;
    this.nextSimSignalId = ctx.nextSimSignalId;
    this.btodExecutedToday = false;

    this.dayResult = {
      date: this.today,
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

    this.initLiveMonitorSignals();
  }

  private initLiveMonitorSignals(): void {
    const rthStartMs = dayjs.tz(`${this.today} 08:30:00`, this.CT).valueOf();

    this.liveMonitorPending = Array.from(this.allSignals.values()).filter(
      (s) =>
        s.status === "pending" &&
        s.targetDate === this.today &&
        s.activationStatus !== "INVALIDATED",
    );

    const activatedSignals = Array.from(this.allSignals.values()).filter(
      (s) => s.activationStatus === "ACTIVE" && s.status === "pending",
    );

    const allMonitorSignals = [...this.liveMonitorPending, ...activatedSignals.filter(
      (s) => !this.liveMonitorPending.some((p) => p.id === s.id),
    )];

    this.liveMonitorTickers = Array.from(new Set(allMonitorSignals.map((s) => s.ticker)));

    this.liveMonitorRthBars = new Map();
    for (const ticker of this.liveMonitorTickers) {
      const allBars = this.preloadedIntraday.get(ticker) ?? [];
      const rthBars = allBars.filter((b) => Date.parse(b.ts) >= rthStartMs);
      if (rthBars.length > 0) this.liveMonitorRthBars.set(ticker, rthBars);
    }
  }

  private getPhaseDelay(): number {
    return this.abortSignal?.phaseDelayMs ?? 4000;
  }

  private isAborted(): boolean {
    return !!this.abortSignal?.aborted;
  }

  private async checkPause(): Promise<boolean> {
    if (this.abortSignal?.paused) await waitWhilePaused(this.abortSignal, this.emit);
    return this.isAborted();
  }

  private earlyReturn(): SimDayOutput {
    return {
      result: this.dayResult,
      nextSimSignalId: this.nextSimSignalId,
      btodExecutedToday: this.btodExecutedToday,
      shouldBreak: true,
    };
  }

  private captureSnapshot(label: string): SimPhaseSnapshot {
    const onDeck = Array.from(this.allSignals.values())
      .filter((s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
      }));
    const active = Array.from(this.allSignals.values())
      .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
        entryPrice: s.entryPrice, activatedTs: s.activatedTs,
      }));
    let p = 0, a = 0, h = 0, m = 0;
    for (const sig of Array.from(this.allSignals.values())) {
      if (sig.status === "pending") p++;
      if (sig.activationStatus === "ACTIVE" && sig.status !== "hit") a++;
      if (sig.status === "hit") h++;
      if (sig.status === "miss") m++;
    }
    return {
      label,
      btodTop3: this.dayResult.btodTop3.map((e) => {
        const sig = this.allSignals.get(e.signalId);
        return { ...e, activationStatus: sig?.activationStatus ?? "NOT_ACTIVE" };
      }),
      btodStatus: { ...this.dayResult.btodStatus, top3Ids: [...this.dayResult.btodStatus.top3Ids] },
      tradeSyncCalls: [...this.dayResult.tradeSyncCalls],
      activations: [...this.dayResult.activations],
      hits: [...this.dayResult.hits],
      misses: [...this.dayResult.misses],
      summary: { totalPending: p, totalActive: a, totalHit: h, totalMiss: m },
      signalsGenerated: [...this.dayResult.signalsGenerated],
      onDeckSignals: onDeck,
      activeSignals: active,
    };
  }

  private emitDayUpdate(): void {
    const onDeck = Array.from(this.allSignals.values())
      .filter((s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
      }));
    const active = Array.from(this.allSignals.values())
      .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
        entryPrice: s.entryPrice, activatedTs: s.activatedTs,
      }));
    this.emit("day", {
      date: this.today,
      dayIndex: this.dayIdx,
      totalDays: this.totalDays,
      simTimeCT: this.simTimeCT,
      signalsGenerated: this.dayResult.signalsGenerated.length,
      btodTop3Count: this.dayResult.btodTop3.length,
      btodTop3: this.dayResult.btodTop3,
      btodStatus: this.dayResult.btodStatus,
      tradeSyncCalls: this.dayResult.tradeSyncCalls,
      activations: this.dayResult.activations.length,
      activationDetails: this.dayResult.activations,
      hits: this.dayResult.hits.length,
      hitDetails: this.dayResult.hits,
      misses: this.dayResult.misses.length,
      missDetails: this.dayResult.misses,
      summary: this.dayResult.summary,
      onDeckSignals: onDeck,
      activeSignals: active,
      newSignals: this.dayResult.signalsGenerated.map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
      })),
      phases: this.dayResult.phases,
    });
  }

  private async phaseTransition(snapshotLabel: string): Promise<boolean> {
    this.dayResult.phases.push(this.captureSnapshot(snapshotLabel));
    this.emitDayUpdate();
    await new Promise((r) => setTimeout(r, this.getPhaseDelay()));
    return this.isAborted();
  }

  //TODO should remove or update
  async preloadData(): Promise<boolean> {
    this.emit("progress", {
      completed: this.dayIdx,
      total: this.totalDays,
      day: this.today,
      phase: "preload",
    });
    this.emit("log", {
      message: `  Preloading data for ${this.today}...`,
      type: "processing",
    });

    // load intraday bars
    const pendingForToday = Array.from(this.allSignals.values()).filter(
      (s) => s.status === "pending" && s.targetDate === this.today && s.activationStatus !== "INVALIDATED",
    );
    const activatedFromPriorDays = Array.from(this.allSignals.values()).filter(
      (s) => s.activationStatus === "ACTIVE" && s.status === "pending",
    );
    const intradayTickers = Array.from(new Set([
      ...pendingForToday.map((s) => s.ticker),
      ...activatedFromPriorDays.map((s) => s.ticker),
    ]));

    for (const ticker of intradayTickers) {
      if (this.isAborted()) break;
      if (await this.checkPause()) break;
      try {
        const raw = await fetchIntradayBarsCached(ticker, this.today, this.today, this.config.timeframe);
        this.preloadedIntraday.set(ticker, raw.map((b: any) => ({
          ts: new Date(b.t).toISOString(), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        })));
      } catch (err: any) {
        this.emit("log", { message: `  Preload intraday error ${ticker}: ${err.message}`, type: "error" });
      }
    }

    // load options chains
    const preOpenForPreload = pendingForToday.filter((s) => s.activationStatus === "NOT_ACTIVE");
    if (preOpenForPreload.length > 0) {
      const minExpDate = dayjs.tz(this.today, this.CT).add(4, "day").format("YYYY-MM-DD");
      const maxExpDate = dayjs.tz(this.today, this.CT).add(45, "day").format("YYYY-MM-DD");
      const getRight = (bias: "BUY" | "SELL") => (bias === "BUY" ? "call" : "put") as "call" | "put";
      const seenKeys = new Set<string>();

      for (const sig of preOpenForPreload) {
        if (this.isAborted()) break;
        if (await this.checkPause()) break;
        const key = `${sig.ticker}|${getRight(sig.tradePlan.bias)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        try {
          const chain = await fetchOptionsChain(sig.ticker, getRight(sig.tradePlan.bias), minExpDate, maxExpDate, 250);
          this.preloadedOptions.set(key, chain);
        } catch (err: any) {
          this.emit("log", { message: `  Preload options error ${sig.ticker}: ${err.message}`, type: "error" });
        }
      }
    }

    // load daily bars
    for (let i = 0; i < this.config.tickers.length; i++) {
      const ticker = this.config.tickers[i];
      if (this.isAborted()) break;
      if (await this.checkPause()) break;
      try {
        const from200 = getTradingDaysBack(this.today, 200);
        const polygon = await fetchDailyBarsCached(ticker, from200, this.today);
        const dailyBars: DailyBar[] = polygon.map((b: any) => ({
          id: 0, ticker, date: formatDate(new Date(b.t)),
          open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
          vwap: b.vw ?? null, source: "polygon",
        }));
        dailyBars.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        this.preloadedDaily.set(ticker, dailyBars);
      } catch (err: any) {
        this.emit("log", { message: `  Preload daily error ${ticker}: ${err.message}`, type: "error" });
      }
      if ((i + 1) % 50 === 0) {
        this.emit("log", { message: `  Preload: ${i + 1}/${this.config.tickers.length} tickers loaded`, type: "info" });
      }
    }

    this.emit("log", {
      message: `  Data loaded: ${this.preloadedIntraday.size} intraday, ${this.preloadedOptions.size} option chains, ${this.preloadedDaily.size} daily`,
      type: "success",
    });

    if (this.isAborted()) return true;
    if (await this.checkPause()) return true;
    return false;
  }

  async preOpenScan(): Promise<boolean> {
    this.emit("progress", {
      completed: this.dayIdx,
      total: this.totalDays,
      day: this.today,
      phase: "pre-open-scan",
    });
    this.emit("log", {
      message: `  Phase 1: Pre-open scan (BTOD selection)`,
      type: "processing",
    });

    const btodState = await initializeBtodForDay(this.ctx);
    const ranked = (btodState.rankedQueue as RankedSignalEntry[]) || [];
    const top3Ranked = ranked.slice(0, 3);

    this.top3 = top3Ranked.map((r) => ({
      signalId: r.signalId,
      ticker: r.ticker,
      setupType: r.setupType,
      qualityScore: r.qualityScore,
      rank: r.rank,
    }));
    this.dayResult.btodTop3 = this.top3;
    this.btodSignalIds = new Set(this.top3.map((r) => r.signalId));

    this.dayResult.btodStatus = {
      phase: btodState.phase as "SELECTIVE" | "CLOSED",
      gateOpen: btodState.gateOpen,
      executedSignalId: null,
      executedTicker: null,
      top3Ids: (btodState.top3Ids as number[]) || [],
      eligibleCount: ranked.length,
    };

    if (this.top3.length > 0) {
      this.emit("log", {
        message: `  BTOD Top ${this.top3.length}: ${this.top3.map((r) => `#${r.rank} ${r.ticker}/${r.setupType} QS=${r.qualityScore}`).join(" | ")}`,
        type: "success",
      });
    } else {
      const setupLabel = (this.config.btodSetupTypes || ["A", "B", "C"]).join("/");
      this.emit("log", {
        message: `  BTOD: No eligible signals (need ${setupLabel} with QS≥62)`,
        type: "info",
      });
    }
    
    return await this.phaseTransition("Pre-Open Scan");
  }

  private liveMonitorPending: SimSignal[] = [];
  private liveMonitorTickers: string[] = [];
  private liveMonitorRthBars = new Map<string, IBar[]>();

  liveMonitorStart(): boolean {
    this.emit("progress", {
      completed: this.dayIdx,
      total: this.totalDays,
      day: this.today,
      phase: "live-monitor",
    });
    this.emit("log", {
      message: `  Phase 2: Live monitor (${formatSimTime(SIM_RTH_START_CT)} → ${formatSimTime(SIM_RTH_END_CT)}) — 1-min ticks`,
      type: "processing",
    });

    if (this.liveMonitorPending.length === 0 && this.liveMonitorTickers.length === 0) {
      this.emit("log", { message: `  No signals targeting ${this.today}`, type: "info" });
      return true;
    }

    const activatedCount = Array.from(this.allSignals.values()).filter(
      (s) => s.activationStatus === "ACTIVE" && s.status === "pending",
    ).length;

    if (activatedCount > 0) {
      this.emit("log", {
        message: `  Monitoring ${this.liveMonitorPending.length} pending + ${activatedCount} active signals across ${this.liveMonitorTickers.length} tickers`,
        type: "info",
      });
    }

    return false;
  }

  private checkActivatedSignals(min: number, barsMap: Map<string, IBar[]>, cutoffMs: number): void {
    const activatedSignals = Array.from(this.allSignals.values()).filter(
      (s) => s.activationStatus === "ACTIVE" && s.status === "pending",
    );
    if (activatedSignals.length === 0) return;

    const tickerGroups = new Map<string, SimSignal[]>();
    for (const sig of activatedSignals) {
      if (!tickerGroups.has(sig.ticker)) tickerGroups.set(sig.ticker, []);
      tickerGroups.get(sig.ticker)!.push(sig);
    }

    for (const [ticker, sigs] of tickerGroups) {
      const rthBars = barsMap.get(ticker);
      if (!rthBars) continue;
      const barsToNow = rthBars.filter((b) => Date.parse(b.ts) <= cutoffMs);
      if (barsToNow.length === 0) continue;

      const currentPrice = barsToNow[barsToNow.length - 1].close;

      for (const sig of sigs) {
        const entryPrice = sig.entryPrice ?? 0;
        const isSell = sig.tradePlan.bias === "SELL";

        if (checkInvalidation(currentPrice, sig.tradePlan, sig.entryPrice ?? 0, sig.stopPrice)) {
          sig.activationStatus = "INVALIDATED";
          sig.status = "miss";
          sig.missReason = `Stopped out at $${currentPrice.toFixed(2)}`;
          this.dayResult.misses.push({
            signalId: sig.id,
            ticker: sig.ticker,
            reason: `Stopped out at $${currentPrice.toFixed(2)}`,
          });
          this.emit("log", {
            message: `  ✗ INVALIDATED [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} stopped out at $${currentPrice.toFixed(2)} (entry $${entryPrice.toFixed(2)})`,
            type: "error",
          });
          continue;
        }

        if (entryPrice > 0 && sig.stopPrice != null) {
          const rNow = computeRNow(currentPrice, entryPrice, sig.stopPrice, isSell);
          const progress = computeProgressToTarget(currentPrice, entryPrice, sig.tradePlan.t1, isSell);

          const activatedAtMs = sig.activatedTs ? new Date(sig.activatedTs).getTime() : 0;
          const nowMs = dayjs.tz(`${this.today} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`, this.CT).valueOf();
          const activeMinutes = activatedAtMs > 0 ? Math.floor((nowMs - activatedAtMs) / 60000) : 0;

          if (shouldApplyBE(this.config.stopMode) && sig.stopStage === "INITIAL") {
            const beEarned = rNow >= 0.5 || progress >= 0.25;
            if (beEarned) {
              sig.stopStage = "BE";
              sig.stopPrice = entryPrice;
              this.emit("log", {
                message: `  ⟳ STOP→BE [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} stop moved to breakeven $${entryPrice.toFixed(2)} (R=${rNow.toFixed(2)}, progress=${(progress * 100).toFixed(0)}%)`,
                type: "info",
              });
            }
          }

          if (shouldApplyTimeStop(this.config.stopMode) && sig.stopStage !== "TIME_TIGHTENED") {
            if (activeMinutes >= 120 && progress < 0.15) {
              const stopDist = Math.abs(entryPrice - sig.stopPrice);
              const tightenedDist = stopDist * 0.5;
              const newStop = isSell ? entryPrice + tightenedDist : entryPrice - tightenedDist;
              sig.stopStage = "TIME_TIGHTENED";
              sig.stopPrice = newStop;
              this.emit("log", {
                message: `  ⏱ TIME STOP [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} stop tightened to $${newStop.toFixed(2)} after ${activeMinutes}min (progress=${(progress * 100).toFixed(0)}%)`,
                type: "info",
              });
            }
          }
        }

        const touchResult = validateMagnetTouch(
          barsToNow.map((b) => ({ ts: b.ts, high: b.high, low: b.low })),
          sig.magnetPrice,
          sig.direction,
        );
        if (touchResult.hit) {
          sig.status = "hit";
          sig.hitTs = touchResult.hitTs ?? null;
          sig.timeToHitMin = touchResult.timeToHitMin ?? null;
          this.dayResult.hits.push({
            signalId: sig.id,
            ticker: sig.ticker,
            hitTs: touchResult.hitTs ?? this.today,
            timeToHitMin: touchResult.timeToHitMin ?? 0,
          });
          this.emit("log", {
            message: `  ✓ HIT [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} magnet $${sig.magnetPrice.toFixed(2)} touched`,
            type: "success",
          });
        }

        if (sig.entryPrice) {
          const allRthBars = barsMap.get(ticker) ?? [];
          const maeMfe = computeMAEMFE(allRthBars as any, sig.entryPrice, sig.direction);
          sig.mae = maeMfe.mae;
          sig.mfe = maeMfe.mfe;
        }
      }
    }
  }

  private processTriggeredSignal(sig: SimSignal, triggerResult: { triggered: boolean; triggerTs?: string; entryPrice?: number }, min: number): void {
    const isBtodCandidate = this.btodSignalIds.has(sig.id);

    sig.activationStatus = "ACTIVE";
    sig.activatedTs = triggerResult.triggerTs ?? null;
    sig.entryPrice = triggerResult.entryPrice ?? null;

    if (sig.tradePlan.stopDistance && sig.tradePlan.stopDistance > 0 && triggerResult.entryPrice) {
      sig.stopPrice = sig.tradePlan.bias === "SELL"
        ? triggerResult.entryPrice + sig.tradePlan.stopDistance
        : triggerResult.entryPrice - sig.tradePlan.stopDistance;
    }
    sig.stopStage = "INITIAL";

    if (isBtodCandidate && !this.btodExecutedToday) {
      this.btodExecutedToday = true;

      this.dayResult.activations.push({
        signalId: sig.id,
        ticker: sig.ticker,
        setupType: sig.setupType,
        triggerTs: triggerResult.triggerTs ?? this.today,
        entryPrice: triggerResult.entryPrice ?? 0,
        isBtod: true,
      });

      this.dayResult.btodStatus.phase = "CLOSED";
      this.dayResult.btodStatus.gateOpen = false;
      this.dayResult.btodStatus.executedSignalId = sig.id;
      this.dayResult.btodStatus.executedTicker = sig.ticker;

      const instruments: string[] = ["Shares"];
      if (sig.tradePlan.stopDistance) instruments.push("Options");
      instruments.push("LETF", "LETF Options");

      this.dayResult.tradeSyncCalls.push({
        signalId: sig.id,
        ticker: sig.ticker,
        setupType: sig.setupType,
        direction: sig.direction,
        entryPrice: triggerResult.entryPrice ?? 0,
        stopPrice: sig.stopPrice,
        targetPrice: sig.magnetPrice,
        instruments,
        status: "SIMULATED",
        triggerTs: triggerResult.triggerTs ?? this.today,
      });

      this.emit("log", {
        message: `  ★ BTOD ACTIVATION [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} @ $${triggerResult.entryPrice?.toFixed(2)} (Rank #${this.top3.find((r) => r.signalId === sig.id)?.rank})`,
        type: "success",
      });
      this.emit("log", {
        message: `  📡 TradeSync (sim): Would send ${instruments.join(", ")} for ${sig.ticker} ${sig.direction} @$${(triggerResult.entryPrice ?? 0).toFixed(2)} → target $${sig.magnetPrice.toFixed(2)}`,
        type: "info",
      });
    } else {
      this.dayResult.activations.push({
        signalId: sig.id,
        ticker: sig.ticker,
        setupType: sig.setupType,
        triggerTs: triggerResult.triggerTs ?? this.today,
        entryPrice: triggerResult.entryPrice ?? 0,
        isBtod: false,
      });

      this.emit("log", {
        message: `  → Activated [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} @ $${triggerResult.entryPrice?.toFixed(2)}${isBtodCandidate && this.btodExecutedToday ? " (BTOD gate closed)" : ""}`,
        type: "success",
      });
    }
  }

  private checkPendingSignals(min: number, barsMap: Map<string, IBar[]>, cutoffMs: number): void {
    for (const ticker of this.liveMonitorTickers) {
      const rthBars = barsMap.get(ticker);
      if (!rthBars) continue;

      const barsToNow = rthBars.filter((b) => Date.parse(b.ts) <= cutoffMs);
      if (barsToNow.length === 0) continue;

      const tickerSignals = this.liveMonitorPending.filter((s) => s.ticker === ticker);

      for (const sig of tickerSignals) {
        if (sig.status !== "pending") continue;
        if (sig.activationStatus === "INVALIDATED") continue;
        if (sig.activationStatus === "ACTIVE") continue;

        const triggerResult = checkEntryTrigger(
          barsToNow,
          sig.tradePlan,
          this.config.entryMode,
        );

        if (triggerResult.triggered && triggerResult.entryPrice) {
          this.processTriggeredSignal(sig, triggerResult, min);
        } else if (triggerResult.invalidated) {
          sig.activationStatus = "INVALIDATED";
          sig.status = "miss";
          sig.missReason = "Entry trigger invalidated";
          this.dayResult.misses.push({
            signalId: sig.id,
            ticker: sig.ticker,
            reason: "Entry trigger invalidated",
          });
        }
      }
    }
  }

  liveMonitorTick(min: number): { allResolved: boolean; hadEvents: boolean } {
    this.simTimeCT = min;
    const prevActivations = this.dayResult.activations.length;
    const prevHits = this.dayResult.hits.length;
    const prevMisses = this.dayResult.misses.length;
    const prevTradeSyncCalls = this.dayResult.tradeSyncCalls.length;

    const cutoffMs = dayjs
      .tz(`${this.today} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:59`, this.CT)
      .valueOf();

    const pendingCount = this.liveMonitorPending.filter(
      (s) => s.status === "pending" && s.activationStatus !== "INVALIDATED",
    ).length;
    const activeCount = Array.from(this.allSignals.values()).filter(
      (s) => s.activationStatus === "ACTIVE" && s.status === "pending",
    ).length;
    if (pendingCount === 0 && activeCount === 0) {
      this.emit("log", { message: `  All signals resolved by ${formatSimTime(min)}`, type: "info" });
      return { allResolved: true, hadEvents: false };
    }

    this.checkActivatedSignals(min, this.liveMonitorRthBars, cutoffMs);

    this.checkPendingSignals(min, this.liveMonitorRthBars, cutoffMs);

    const hadEvents =
      this.dayResult.activations.length > prevActivations ||
      this.dayResult.hits.length > prevHits ||
      this.dayResult.misses.length > prevMisses ||
      this.dayResult.tradeSyncCalls.length > prevTradeSyncCalls;

    return { allResolved: false, hadEvents };
  }

  emitDayUpdatePublic(): void {
    this.emitDayUpdate();
  }

  async liveMonitorFinalize(): Promise<boolean> {
    this.simTimeCT = SIM_RTH_END_CT;
    return await this.phaseTransition("Live Monitor");
  }

  async afterCloseScan(): Promise<boolean> {
    this.emit("progress", {
      completed: this.dayIdx,
      total: this.totalDays,
      day: this.today,
      phase: "after-close-scan",
    });
    this.emit("log", {
      message: `  Phase 3: After-close scan (finalize misses + detect setups)`,
      type: "processing",
    });

    for (const sig of Array.from(this.allSignals.values())) {
      if (sig.status !== "pending") continue;
      if (sig.targetDate !== this.today) continue;
      sig.status = "miss";
      sig.missReason = "Magnet not touched during RTH";
      this.dayResult.misses.push({
        signalId: sig.id,
        ticker: sig.ticker,
        reason: sig.missReason,
      });
    }

    const afterCloseExistingSignalKeys = new Set<string>(
      Array.from(this.allSignals.values()).map(
        (s) => `${s.ticker}|${s.setupType}|${s.asofDate}|${s.targetDate}`,
      ),
    );

    for (const ticker of this.config.tickers) {
      if (this.isAborted()) break;
      if (await this.checkPause()) break;
      try {
        const dailyBars = this.preloadedDaily.get(ticker);
        if (!dailyBars || dailyBars.length < 5) continue;

        const recentBars = dailyBars.slice(-30);
        const setups = detectAllSetups(
          recentBars,
          this.config.setups,
          this.config.gapThreshold,
        );

        const relevantSetups = setups.filter((s) => s.targetDate > this.today);
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

        const isOnWatchlist = this.watchlistSet.has(ticker);

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
            timePriorityMode: this.timePriorityMode,
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
            this.config.entryMode,
            this.config.stopMode,
            this.config.atrMultiplier,
          );

          const simSig: SimSignal = {
            id: this.nextSimSignalId++,
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
            stopStage: "INITIAL",
            mae: null,
            mfe: null,
          };

          this.allSignals.set(simSig.id, simSig);
          this.dayResult.signalsGenerated.push(simSig);
        }
      } catch (err: any) {
        this.emit("log", {
          message: `  Scan error ${ticker}: ${err.message}`,
          type: "error",
        });
      }
    }

    if (this.dayResult.signalsGenerated.length > 0) {
      const truncated = this.dayResult.signalsGenerated.slice(0, 10);
      const suffix =
        this.dayResult.signalsGenerated.length > 10
          ? ` ...and ${this.dayResult.signalsGenerated.length - 10} more`
          : "";
      this.emit("log", {
        message: `  Detected ${this.dayResult.signalsGenerated.length} new signal(s): ${truncated.map((s) => `${s.ticker}/${s.setupType}[QS=${s.qualityScore},${s.tier}]`).join(", ")}${suffix}`,
        type: "success",
      });
    }

    return await this.phaseTransition("After-Close Scan");
  }

  async endOfDay(): Promise<SimDayOutput> {
    this.emit("progress", {
      completed: this.dayIdx,
      total: this.totalDays,
      day: this.today,
      phase: "end-of-day",
    });

    let totalPending = 0, totalActive = 0, totalHit = 0, totalMiss = 0;
    for (const sig of Array.from(this.allSignals.values())) {
      if (sig.status === "pending") totalPending++;
      if (sig.activationStatus === "ACTIVE" && sig.status !== "hit") totalActive++;
      if (sig.status === "hit") totalHit++;
      if (sig.status === "miss") totalMiss++;
    }
    this.dayResult.summary = { totalPending, totalActive, totalHit, totalMiss };

    this.dayResult.phases.push(this.captureSnapshot("End of Day"));

    this.emit("log", {
      message: `  Summary: ${totalPending} pending | ${totalActive} active | ${totalHit} hits | ${totalMiss} misses`,
      type: "info",
    });

    const onDeckSignals = Array.from(this.allSignals.values())
      .filter((s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
      }));

    const activeSignals = Array.from(this.allSignals.values())
      .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
        entryPrice: s.entryPrice, activatedTs: s.activatedTs,
      }));

    this.emit("day", {
      date: this.today,
      dayIndex: this.dayIdx,
      totalDays: this.totalDays,
      signalsGenerated: this.dayResult.signalsGenerated.length,
      btodTop3Count: this.dayResult.btodTop3.length,
      btodTop3: this.dayResult.btodTop3,
      btodStatus: this.dayResult.btodStatus,
      tradeSyncCalls: this.dayResult.tradeSyncCalls,
      activations: this.dayResult.activations.length,
      activationDetails: this.dayResult.activations,
      hits: this.dayResult.hits.length,
      hitDetails: this.dayResult.hits,
      misses: this.dayResult.misses.length,
      missDetails: this.dayResult.misses,
      summary: this.dayResult.summary,
      onDeckSignals,
      activeSignals,
      newSignals: this.dayResult.signalsGenerated.map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
      })),
      phases: this.dayResult.phases,
    });

    return {
      result: this.dayResult,
      nextSimSignalId: this.nextSimSignalId,
      btodExecutedToday: this.btodExecutedToday,
      shouldBreak: false,
    };
  }

  async run(): Promise<SimDayOutput> {
    this.emit("log", {
      message: `═══ Day ${this.dayIdx + 1}/${this.totalDays}: ${this.today} ═══`,
      type: "info",
    });

    // if (await this.preloadData()) return this.earlyReturn();

    this.simTimeCT = SIM_PRE_OPEN_CT;
    this.emit("log", { message: `  ⏰ ${formatSimTime(this.simTimeCT)} — Day starts`, type: "info" });
    this.emitDayUpdatePublic();

    this.simTimeCT = SIM_PRE_OPEN_CT + 5;
    if (await this.preOpenScan()) return this.earlyReturn();
    this.emitDayUpdatePublic();

    const noSignals = this.liveMonitorStart();
    
    if (!noSignals) {
      for (let min = SIM_RTH_START_CT; min < SIM_RTH_END_CT; min++) {
        if (this.isAborted()) break;
        if (await this.checkPause()) break;

        const { allResolved, hadEvents } = this.liveMonitorTick(min);
        if (hadEvents || allResolved) this.emitDayUpdatePublic();
        if (allResolved) break;
      }
    }
    if (await this.liveMonitorFinalize()) return this.earlyReturn();

    this.simTimeCT = SIM_AFTER_CLOSE_CT;
    if (await this.afterCloseScan()) return this.earlyReturn();
    this.emitDayUpdatePublic();

    this.simTimeCT = SIM_AFTER_CLOSE_CT + 5;
    return await this.endOfDay();
  }
}
