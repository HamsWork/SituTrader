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
import { validateMagnetTouch, computeMAEMFE } from "./lib/validate";
import { storage } from "./storage";
import type { DailyBar, Signal, TradePlan } from "@shared/schema";

import {
  type RankedSimEntry,
  type SimDayResult,
  type SimPhaseSnapshot,
  type SimConfig,
  type SimEventCallback,
  type SimControlSignal,
  type SimDayContext,
  type SimDayOutput,
  SIM_BEFORE_PRE_OPEN_CT,
  SIM_PRE_OPEN_CT,
  SIM_RTH_START_CT,
  SIM_RTH_END_CT,
  SIM_AFTER_CLOSE_CT,
  simulateAllTradeTracking,
} from "./simulation";
import { initializeBtodForDay } from "./lib/btod";
import type { RankedSignalEntry } from "./lib/btod";
import {
  runActivationCheck,
  processDetectSetups,
  type ScanTickerConfig,
  type ActivationScanConfig,
  type ActivationMutation,
  getOnDeckSignals,
} from "./lib/signalHelper";
import { runLiveMonitorTickForTicker } from "./jobs/jobFunctions";

type IBar = { ts: string; open: number; high: number; low: number; close: number; volume: number };

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



function formatSimTime(minutesCT: number): string {
  const h = Math.floor(minutesCT / 60);
  const m = minutesCT % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${suffix} CT`;
}

export class SimTickerStepper {
  private ctx: SimDayContext;
  
  private top3: RankedSimEntry[] = [];

  private get dayResult() { return this.ctx.dayResult; }
  private get btodSignalIds() { return this.ctx.btodSignalIds; }

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

  private get nextSimSignalId() { return this.ctx.nextSimSignalId; }
  private set nextSimSignalId(value: number) { this.ctx.nextSimSignalId = value; }
  private get btodExecutedToday() { return this.ctx.btodExecutedToday; }
  private set btodExecutedToday(value: boolean) { this.ctx.btodExecutedToday = value; }

  constructor(ctx: SimDayContext) {
    this.ctx = ctx;

    ctx.dayResult = {
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
    ctx.btodSignalIds = new Set();
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
      .filter((s) => s.activationStatus === "NOT_ACTIVE")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
        status: s.status, optionsJson: s.optionsJson ?? null,
      }));
    const active = Array.from(this.allSignals.values())
      .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
        entryPrice: s.entryPriceAtActivation, activatedTs: s.activatedTs,
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
      .filter((s) => s.activationStatus === "NOT_ACTIVE")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
        status: s.status, optionsJson: s.optionsJson ?? null,
      }));
    const active = Array.from(this.allSignals.values())
      .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
        entryPrice: s.entryPriceAtActivation, activatedTs: s.activatedTs,
      }));
    this.emit("day", {
      date: this.today,
      dayIndex: this.dayIdx,
      totalDays: this.totalDays,
      simTimeCT: this.ctx.currentMin,
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
    const delay = this.getPhaseDelay();
    const step = 50;
    let elapsed = 0;
    while (elapsed < delay) {
      if (this.isAborted()) return true;
      await new Promise((r) => setTimeout(r, Math.min(step, delay - elapsed)));
      elapsed += step;
    }
    if (this.abortSignal?.paused) await waitWhilePaused(this.abortSignal, this.emit);
    return this.isAborted();
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

    
    // detect setup C
    if (this.config.setups.includes("C")) {
      const scanConfig: ScanTickerConfig = {
        setups: ["C"],
        gapThreshold: this.config.gapThreshold,
        timePriorityMode: this.ctx.timePriorityMode,
        entryMode: this.config.entryMode,
        stopMode: this.config.stopMode,
        atrMultiplier: this.config.atrMultiplier,
        alertGateEnabled: false,
        liquidityFloor: 0,
      };
      for (const ticker of this.config.tickers) {
         if (this.isAborted()) break;
         const processed = await processDetectSetups({
          ticker,
          config: scanConfig,
          isOnWatchlist: this.watchlistSet.has(ticker),
          today: this.today,
          from200: getTradingDaysBack(this.today, 200),
         }, true);
         for (const scored of processed) {
          if (scored.status !== "pending") continue;
          const signalId = this.ctx.nextSimSignalId++;
          const simSig: Signal = {
            id: signalId,
            ticker,
            setupType: scored.setupType,
            asofDate: scored.asofDate,
            targetDate: scored.targetDate,
            targetDate2: null,
            targetDate3: null,
            magnetPrice: scored.magnetPrice,
            magnetPrice2: null,
            direction: scored.direction,
            confidence: scored.confidence,
            qualityScore: scored.qualityScore,
            tier: scored.tier,
            tradePlanJson: scored.tradePlan,
            confidenceBreakdown: scored.confidenceBreakdown,
            qualityBreakdown: scored.qualityBreakdown,
            status: "pending",
            activationStatus: "NOT_ACTIVE",
            hitTs: null,
            timeToHitMin: null,
            missReason: null,
            activatedTs: null,
            entryPriceAtActivation: null,
            stopPrice: scored.stopPrice,
            entryTriggerPrice: null,
            invalidationTs: null,
            stopStage: "INITIAL",
            stopMovedToBeTs: null,
            timeStopTriggeredTs: null,
            alertState: "new",
            nextAlertEligibleAt: null,
            pHit60: scored.sigP60,
            pHit120: scored.sigP120,
            pHit390: scored.sigP390,
            timeScore: scored.timeScore,
            universePass: scored.universePass,
            optionsJson: null,
            optionContractTicker: null,
            optionEntryMark: null,
            instrumentType: "OPTION",
            instrumentTicker: null,
            instrumentEntryPrice: null,
            leveragedEtfJson: null,
            createdAt: null,
          };
          this.ctx.allSignals.set(signalId, simSig);
          this.ctx.onDeckSignals.set(signalId, simSig);
          this.dayResult.signalsGenerated.push(simSig);
          this.dayResult.summary.totalPending++;
         }
      }
    }


    // initialize btod for day
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
    this.ctx.btodSignalIds = new Set(this.top3.map((r) => r.signalId));

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

    if (this.ctx.onDeckSignals.size === 0 && this.ctx.activeSignals.size === 0) {
      this.emit("log", { message: `  No signals targeting ${this.today}`, type: "info" });
      return true;
    }

    this.emit("log", { message: `  Monitoring ${this.ctx.onDeckSignals.size} on-deck + ${this.ctx.activeSignals.size} active signals`, type: "info" });

    return false;
  }

  private async applyActivationMutation(mut: ActivationMutation, min: number): Promise<void> {
    const sig = this.allSignals.get(mut.signalId);
    if (!sig) return;

    switch (mut.type) {
      case "invalidated":
        this.emit("log", {
          message: `  ✗ INVALIDATED [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} (entry $${(sig.entryPriceAtActivation ?? 0).toFixed(2)})`,
          type: "error",
        });
        break;

      case "stop_to_be":
        this.emit("log", {
          message: `  ⟳ ${mut.message.replace(/^STOP→BE: /, `STOP→BE [${formatSimTime(min)}]: `)}`,
          type: "info",
        });
        break;

      case "time_stop":
        this.emit("log", {
          message: `  ⏱ ${mut.message.replace(/^TIME STOP: /, `TIME STOP [${formatSimTime(min)}]: `)}`,
          type: "info",
        });
        break;

      case "activated": {
        const isBtodCandidate = this.btodSignalIds.has(sig.id);
        const lastActivation = this.dayResult.activations[this.dayResult.activations.length - 1];
        const wasBtod = lastActivation?.signalId === sig.id && lastActivation?.isBtod;

        if (wasBtod) {
          const tp = sig.tradePlanJson as TradePlan;
          const instruments: string[] = ["Shares"];
          if (tp?.stopDistance) instruments.push("Options");
          instruments.push("LETF", "LETF Options");

          const activationEntry = mut.entryPrice ?? 0;
          const stopDist = tp?.stopDistance ?? 0;
          const isBuy = sig.direction?.includes("up");
          const effectiveStop = isBuy
            ? activationEntry - stopDist
            : activationEntry + stopDist;

          let trackingResults: any[] = [];
          try {
            trackingResults = await simulateAllTradeTracking(sig, this.ctx);
          } catch (err: any) {
            this.emit("log", { message: `  ⚠ TradeSync tracking error: ${err.message}`, type: "error" });
          }

          const anyWin = trackingResults.some((r: any) => r.win);
          this.dayResult.tradeSyncCalls.push({
            signalId: sig.id,
            ticker: sig.ticker,
            setupType: sig.setupType,
            direction: sig.direction,
            entryPrice: activationEntry,
            stopPrice: effectiveStop,
            targetPrice: sig.magnetPrice,
            instruments,
            status: "SIMULATED",
            triggerTs: mut.activatedTs ?? this.today,
            outcome: anyWin ? "hit" : "miss",
            trackingResults,
          });

          this.emit("log", {
            message: `  ★ BTOD ACTIVATION [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} @ $${activationEntry.toFixed(2)} (Rank #${this.top3.find((r) => r.signalId === sig.id)?.rank})`,
            type: "success",
          });
          this.emit("log", {
            message: `  📡 TradeSync (sim): Would send ${instruments.join(", ")} for ${sig.ticker} ${sig.direction} @$${activationEntry.toFixed(2)} → target $${sig.magnetPrice.toFixed(2)}`,
            type: "info",
          });
        } else {
          this.emit("log", {
            message: `  → Activated [${formatSimTime(min)}]: ${sig.ticker}/${sig.setupType} @ $${(mut.entryPrice ?? 0).toFixed(2)}${isBtodCandidate && this.btodExecutedToday ? " (BTOD gate closed)" : ""}`,
            type: "success",
          });
        }
        break;
      }

      case "entry_invalidated":
        break;
    }
  }

  private checkMagnetTouchAndMAEMFE(min: number, barsMap: Map<string, IBar[]>, cutoffMs: number): void {
    const activatedSignals = Array.from(this.allSignals.values()).filter(
      (s) => s.activationStatus === "ACTIVE" && s.status === "pending",
    );
    if (activatedSignals.length === 0) return;

    for (const sig of activatedSignals) {
      const rthBars = barsMap.get(sig.ticker);
      if (!rthBars) continue;
      const barsToNow = rthBars.filter((b) => Date.parse(b.ts) <= cutoffMs);
      if (barsToNow.length === 0) continue;

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

      if (sig.entryPriceAtActivation) {
        const allRthBars = barsMap.get(sig.ticker) ?? [];
        computeMAEMFE(allRthBars as any, sig.entryPriceAtActivation, sig.direction);
      }
    }
  }


  async liveMonitorTick(): Promise<{ allResolved: boolean; hadEvents: boolean }> {
    this.emit("progress", {
      completed: this.dayIdx,
      total: this.totalDays,
      day: this.today,
      phase: "live-monitor",
      simTimeCT: this.ctx.currentMin,
    });

    const prevActivations = this.dayResult.activations.length;
    const prevMisses = this.dayResult.misses.length;

    let hadEvents = false;
    const monitorSignals = Array.from(this.ctx.onDeckSignals.values()).concat(Array.from(this.ctx.activeSignals.values()));
    const tickerArr = Array.from(new Set(monitorSignals.map(s => s.ticker)));
    if (tickerArr.length === 0) {
      this.emit("log", { message: `  All signals resolved by ${formatSimTime(this.ctx.currentMin)}`, type: "info" });
      return { allResolved: true, hadEvents: false };
    }

    for (const ticker of tickerArr) {
      if (this.isAborted()) break;
      const pendingSignals = Array.from(this.ctx.onDeckSignals.values()).filter(s => s.ticker === ticker);
      const activeSignals = Array.from(this.ctx.activeSignals.values()).filter(s => s.ticker === ticker);
      const result = await runLiveMonitorTickForTicker(ticker, pendingSignals, activeSignals, this.ctx);
      hadEvents = hadEvents || result.hadEvents;

      for (const mut of result.mutations) {
        await this.applyActivationMutation(mut, this.ctx.currentMin);
      }
    }

    const pendingCount = Array.from(this.ctx.onDeckSignals.values()).filter(
      (s) => s.status === "pending" && s.activationStatus !== "INVALIDATED",
    ).length;
    const activeCount = Array.from(this.ctx.activeSignals.values()).filter(
      (s) => s.activationStatus === "ACTIVE" && s.status === "pending",
    ).length;

    hadEvents = hadEvents || this.dayResult.activations.length > prevActivations ||
      this.dayResult.misses.length > prevMisses;

    if (pendingCount === 0 && activeCount === 0) {
      this.emit("log", { message: `  All signals resolved by ${formatSimTime(this.ctx.currentMin)}`, type: "info" });
      return { allResolved: true, hadEvents };
    }

    return { allResolved: false, hadEvents };
  }

  emitDayUpdatePublic(): void {
    this.emitDayUpdate();
  }

  async liveMonitorFinalize(): Promise<boolean> {
    this.ctx.currentMin = SIM_RTH_END_CT;
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

    const timeframe = "5"; //TODO: get from config

    // validate hit or miss
    const onDeckSignals = await getOnDeckSignals(this.allSignals);
    for (const sig of onDeckSignals) {
      if (this.isAborted()) break;
      const rawBars = await fetchIntradayBarsCached(sig.ticker, sig.targetDate, sig.targetDate, timeframe);
      const intradayBars = rawBars.map((b) => ({ ts: new Date(b.t).toISOString(), high: b.h, low: b.l }));
      const validateResult = validateMagnetTouch(
        intradayBars,
        sig.magnetPrice,
        sig.direction,
      );
      if (validateResult.hit) {
        sig.status = "hit";
        this.dayResult.hits.push({
          signalId: sig.id,
          ticker: sig.ticker,
          hitTs: sig.targetDate,
          timeToHitMin: 0,
        });
      } else {
        sig.status = "miss";
        sig.missReason = "Magnet not touched during RTH";
        this.dayResult.misses.push({
          signalId: sig.id,
          ticker: sig.ticker,
          reason: "Magnet not touched during RTH",
        });
      }
    }

    const scanConfig: ScanTickerConfig = {
      setups: this.config.setups,
      gapThreshold: this.config.gapThreshold,
      timePriorityMode: this.timePriorityMode,
      entryMode: this.config.entryMode,
      stopMode: this.config.stopMode,
      atrMultiplier: this.config.atrMultiplier,
      alertGateEnabled: false,
      liquidityFloor: 0,
    };

    const today = formatDate(new Date(this.today));
    const from200 = getTradingDaysBack(today, 200);
    const from15 = getTradingDaysBack(today, 15);


    for (const ticker of this.config.tickers) {
      if (this.isAborted()) break;
      if (await this.checkPause()) break;
      try {
        const processed = await processDetectSetups({
          ticker,
          config: scanConfig,
          isOnWatchlist: this.watchlistSet.has(ticker),
          today,
          from200,
        });


        for (const scored of processed) {
          if (scored.status !== "pending") continue;

          const signalId = this.ctx.nextSimSignalId++;
          const simSig: Signal = {
            id: signalId,
            ticker,
            setupType: scored.setupType,
            asofDate: scored.asofDate,
            targetDate: scored.targetDate,
            targetDate2: null,
            targetDate3: null,
            magnetPrice: scored.magnetPrice,
            magnetPrice2: null,
            direction: scored.direction,
            confidence: scored.confidence,
            qualityScore: scored.qualityScore,
            tier: scored.tier,
            tradePlanJson: scored.tradePlan,
            confidenceBreakdown: scored.confidenceBreakdown,
            qualityBreakdown: scored.qualityBreakdown,
            status: "pending",
            activationStatus: "NOT_ACTIVE",
            hitTs: null,
            timeToHitMin: null,
            missReason: null,
            activatedTs: null,
            entryPriceAtActivation: null,
            stopPrice: scored.stopPrice,
            entryTriggerPrice: null,
            invalidationTs: null,
            stopStage: "INITIAL",
            stopMovedToBeTs: null,
            timeStopTriggeredTs: null,
            alertState: "new",
            nextAlertEligibleAt: null,
            pHit60: scored.sigP60,
            pHit120: scored.sigP120,
            pHit390: scored.sigP390,
            timeScore: scored.timeScore,
            universePass: scored.universePass,
            optionsJson: null,
            optionContractTicker: null,
            optionEntryMark: null,
            instrumentType: "OPTION",
            instrumentTicker: null,
            instrumentEntryPrice: null,
            leveragedEtfJson: null,
            createdAt: null,
          };

          this.ctx.allSignals.set(signalId, simSig);
          this.ctx.onDeckSignals.set(signalId, simSig);
          this.dayResult.signalsGenerated.push(simSig);
          this.dayResult.summary.totalPending++;
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

    const hitSigIds = new Set(this.dayResult.hits.map((h) => h.signalId));
    const missSigIds = new Set(this.dayResult.misses.map((m) => m.signalId));
    for (const tc of this.dayResult.tradeSyncCalls) {
      if (hitSigIds.has(tc.signalId)) tc.outcome = "hit";
      else if (missSigIds.has(tc.signalId)) tc.outcome = "miss";
      else tc.outcome = "pending";
    }

    this.dayResult.phases.push(this.captureSnapshot("End of Day"));

    this.emit("log", {
      message: `  Summary: ${totalPending} pending | ${totalActive} active | ${totalHit} hits | ${totalMiss} misses`,
      type: "info",
    });

    const onDeckSignals = Array.from(this.allSignals.values())
      .filter((s) => s.activationStatus === "NOT_ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => ({
        id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
        qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice, targetDate: s.targetDate,
        status: s.status, optionsJson: s.optionsJson ?? null,
      }));

    const activeSignals = Array.from(this.allSignals.values())
      .filter((s) => s.activationStatus === "ACTIVE" && s.status !== "hit" && s.status !== "miss")
      .map((s) => {
        const tp = s.tradePlanJson as import("@shared/schema").TradePlan | null;
        return {
          id: s.id, ticker: s.ticker, setupType: s.setupType, direction: s.direction,
          qualityScore: s.qualityScore, tier: s.tier, magnetPrice: s.magnetPrice,
          entryPrice: s.entryPriceAtActivation, activatedTs: s.activatedTs,
          stopPrice: s.stopPrice, stopDistance: tp?.stopDistance ?? null,
          t1: tp?.t1 ?? null, t2: tp?.t2 ?? null, bias: tp?.bias ?? null,
          riskReward: tp?.riskReward ?? null,
        };
      });

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


    this.ctx.currentMin = SIM_BEFORE_PRE_OPEN_CT;
    this.emit("log", { message: `  ⏰ ${formatSimTime(this.ctx.currentMin)} — Day starts`, type: "info" });
    this.emitDayUpdatePublic();

    this.ctx.currentMin = SIM_PRE_OPEN_CT;
    if (await this.preOpenScan()) return this.earlyReturn();
    this.emitDayUpdatePublic();

    const noSignals = this.liveMonitorStart();
    
    if (!noSignals) {
      this.ctx.currentMin = SIM_RTH_START_CT;
      if (this.isAborted() || await this.checkPause()) {
      } else {
        const { allResolved, hadEvents } = await this.liveMonitorTick();
        this.emitDayUpdatePublic();
      }
    }
    if (await this.liveMonitorFinalize()) return this.earlyReturn();

    this.ctx.currentMin = SIM_AFTER_CLOSE_CT;
    if (await this.afterCloseScan()) return this.earlyReturn();
    this.emitDayUpdatePublic();

    this.ctx.currentMin = SIM_AFTER_CLOSE_CT + 5;
    return await this.endOfDay();
  }
}
