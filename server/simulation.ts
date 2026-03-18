import { fetchDailyBarsCached, fetchIntradayBarsCached } from "./lib/polygon";
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
import type { DailyBar, TradePlan, SetupType } from "@shared/schema";

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
}

export interface RankedSimEntry {
  signalId: number;
  ticker: string;
  setupType: string;
  qualityScore: number;
  rank: number;
}

export interface SimDayResult {
  date: string;
  phase: string;
  signalsGenerated: SimSignal[];
  btodTop3: RankedSimEntry[];
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

function rankSimSignalsForBtod(signals: SimSignal[]): RankedSimEntry[] {
  const eligible = signals.filter(
    (s) =>
      s.status === "pending" &&
      s.activationStatus === "NOT_ACTIVE" &&
      (s.setupType === "A" || s.setupType === "B" || s.setupType === "C") &&
      s.qualityScore >= 62,
  );

  eligible.sort((a, b) => {
    const qsDiff = b.qualityScore - a.qualityScore;
    if (qsDiff !== 0) return qsDiff;
    const setupOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
    const setupDiff =
      (setupOrder[a.setupType] ?? 99) - (setupOrder[b.setupType] ?? 99);
    if (setupDiff !== 0) return setupDiff;
    return a.ticker.localeCompare(b.ticker);
  });

  return eligible.map((s, i) => ({
    signalId: s.id,
    ticker: s.ticker,
    setupType: s.setupType,
    qualityScore: s.qualityScore,
    rank: i + 1,
  }));
}

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

async function waitWhilePaused(ctrl: SimControlSignal): Promise<void> {
  while (ctrl.paused && !ctrl.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 200));
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

  emit("log", {
    message: `Simulation: ${tradingDays.length} trading days, ${config.tickers.length} tickers, setups [${config.setups.join(",")}]`,
    type: "info",
  });
  emit("log", {
    message: `Range: ${tradingDays[0]} → ${tradingDays[tradingDays.length - 1]}`,
    type: "info",
  });

  const dailyCache: Map<string, DailyBar[]> = new Map();

  async function getDailyBarsForTicker(
    ticker: string,
    upToDate: string,
  ): Promise<DailyBar[]> {
    const cacheKey = ticker;
    let allBars = dailyCache.get(cacheKey);
    if (!allBars) {
      const from250 = getTradingDaysBack(config.endDate, 250);
      try {
        const polygon = await fetchDailyBarsCached(
          ticker,
          from250,
          config.endDate,
        );
        const bars: DailyBar[] = polygon.map((b: any) => ({
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
        bars.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        dailyCache.set(cacheKey, bars);
        allBars = bars;
      } catch (err: any) {
        emit("log", {
          message: `  Failed to fetch daily bars for ${ticker}: ${err.message}`,
          type: "error",
        });
        return [];
      }
    }
    return allBars.filter((b) => b.date <= upToDate);
  }

  let btodExecutedToday = false;

  for (let dayIdx = 0; dayIdx < tradingDays.length; dayIdx++) {
    if (abortSignal?.aborted) {
      emit("log", { message: "Simulation aborted", type: "error" });
      break;
    }
    if (abortSignal?.paused) {
      emit("log", { message: "Simulation paused...", type: "info" });
      await waitWhilePaused(abortSignal);
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
      activations: [],
      hits: [],
      misses: [],
      summary: { totalPending: 0, totalActive: 0, totalHit: 0, totalMiss: 0 },
    };

    emit("progress", {
      completed: dayIdx,
      total: tradingDays.length,
      day: today,
      phase: "after-close-scan",
    });
    emit("log", {
      message: `═══ Day ${dayIdx + 1}/${tradingDays.length}: ${today} ═══`,
      type: "info",
    });

    for (const [id, sig] of allSignals) {
      if (sig.status === "pending" && sig.targetDate < today) {
        sig.status = "miss";
        sig.missReason = "Target date expired";
        dayResult.misses.push({
          signalId: id,
          ticker: sig.ticker,
          reason: "Target date expired",
        });
      }
    }

    emit("log", {
      message: `  Phase 1: After-close scan (detect setups)`,
      type: "processing",
    });
    for (const ticker of config.tickers) {
      if (abortSignal?.aborted) break;
      if (abortSignal?.paused) await waitWhilePaused(abortSignal);
      if (abortSignal?.aborted) break;
      try {
        const dailyBars = await getDailyBarsForTicker(ticker, today);
        if (dailyBars.length < 5) continue;

        const recentBars = dailyBars.slice(-30);
        const setups = detectAllSetups(
          recentBars,
          config.setups,
          config.gapThreshold,
        );

        const relevantSetups = setups.filter((s) => s.targetDate >= today);
        if (relevantSetups.length === 0) continue;

        const atr = computeATR(dailyBars);
        const avgVol = computeAvgVolume(dailyBars);
        const avgDollarVol = computeAvgDollarVolume(dailyBars);
        const lastBar = dailyBars[dailyBars.length - 1];
        const slice20 = dailyBars.slice(-20);
        const avgRange20d =
          slice20.length > 0
            ? slice20.reduce((s, b) => s + (b.high - b.low), 0) /
              slice20.length
            : 0;

        for (const setup of relevantSetups) {
          const existingSig = Array.from(allSignals.values()).find(
            (s) =>
              s.ticker === ticker &&
              s.setupType === setup.setupType &&
              s.asofDate === setup.asofDate &&
              s.targetDate === setup.targetDate,
          );
          if (existingSig) continue;

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
            avgRange20d,
            atr,
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
            historicalHitRate: null,
            p60: null,
            p390: null,
            timePriorityMode: "BLEND",
          });

          const tier = qualityScoreToTier(qualityResult.total, null, null);

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

    emit("log", {
      message: `  Phase 2: Pre-open ranking (BTOD)`,
      type: "processing",
    });

    const pendingForBtod = Array.from(allSignals.values()).filter(
      (s) =>
        s.status === "pending" &&
        s.activationStatus === "NOT_ACTIVE" &&
        s.targetDate >= today,
    );

    const ranked = rankSimSignalsForBtod(pendingForBtod);
    const top3 = ranked.slice(0, 3);
    dayResult.btodTop3 = top3;
    const btodSignalIds = new Set(top3.map((r) => r.signalId));

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

    emit("log", {
      message: `  Phase 3: Intraday monitor (activation + magnet touch)`,
      type: "processing",
    });

    const todaysPending = Array.from(allSignals.values()).filter(
      (s) =>
        s.status === "pending" &&
        s.targetDate === today &&
        s.activationStatus !== "INVALIDATED",
    );

    if (todaysPending.length > 0) {
      const tickersNeeded = [...new Set(todaysPending.map((s) => s.ticker))];

      for (const ticker of tickersNeeded) {
        if (abortSignal?.aborted) break;
        if (abortSignal?.paused) await waitWhilePaused(abortSignal);
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

            const triggerResult = checkEntryTrigger(
              intradayBars,
              sig.tradePlan,
              config.entryMode,
            );

            if (triggerResult.triggered) {
              if (isBtodCandidate && !btodExecutedToday) {
                sig.activationStatus = "ACTIVE";
                sig.activatedTs = triggerResult.triggerTs ?? null;
                sig.entryPrice = triggerResult.entryPrice ?? null;
                btodExecutedToday = true;

                dayResult.activations.push({
                  signalId: sig.id,
                  ticker: sig.ticker,
                  setupType: sig.setupType,
                  triggerTs: triggerResult.triggerTs ?? today,
                  entryPrice: triggerResult.entryPrice ?? 0,
                  isBtod: true,
                });

                emit("log", {
                  message: `  ★ BTOD ACTIVATION: ${sig.ticker}/${sig.setupType} @ $${triggerResult.entryPrice?.toFixed(2)} (Rank #${top3.find((r) => r.signalId === sig.id)?.rank})`,
                  type: "success",
                });
              } else if (isBtodCandidate && btodExecutedToday) {
                emit("log", {
                  message: `  ○ BTOD gate closed: ${sig.ticker}/${sig.setupType} triggered but BTOD already executed today`,
                  type: "info",
                });
              } else {
                sig.activationStatus = "ACTIVE";
                sig.activatedTs = triggerResult.triggerTs ?? null;
                sig.entryPrice = triggerResult.entryPrice ?? null;

                dayResult.activations.push({
                  signalId: sig.id,
                  ticker: sig.ticker,
                  setupType: sig.setupType,
                  triggerTs: triggerResult.triggerTs ?? today,
                  entryPrice: triggerResult.entryPrice ?? 0,
                  isBtod: false,
                });

                emit("log", {
                  message: `  → Activated: ${sig.ticker}/${sig.setupType} @ $${triggerResult.entryPrice?.toFixed(2)}`,
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

    let totalPending = 0,
      totalActive = 0,
      totalHit = 0,
      totalMiss = 0;
    for (const sig of allSignals.values()) {
      if (sig.status === "pending") totalPending++;
      if (sig.activationStatus === "ACTIVE" && sig.status !== "hit")
        totalActive++;
      if (sig.status === "hit") totalHit++;
      if (sig.status === "miss") totalMiss++;
    }
    dayResult.summary = { totalPending, totalActive, totalHit, totalMiss };

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
