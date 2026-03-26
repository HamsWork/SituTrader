import type { Signal, TradePlan, DailyBar, SetupType, IntradayBar } from "@shared/schema";
import { storage } from "../storage";
import { detectAllSetups, type SetupResult } from "./rules";
import { computeConfidence, computeATR, computeAvgVolume } from "./confidence";
import { computeQualityScore, qualityScoreToTier, computeAvgDollarVolume } from "./quality";
import { generateTradePlan } from "./tradeplan";
import { validateMagnetTouch, filterRTHBars, timestampToET } from "./validate";
import { fetchDailyBarsCached, fetchDailyBarsFromPolygon, fetchIntradayBarsCached, PolygonBar } from "./polygon";
import { formatDate, getTradingDaysBack } from "./calendar";
import { SimDayContext } from "server/simulation";

interface OnDeckFilterable {
    status: string;
    activationStatus: string;
}

export async function getAllSignals(): Promise<Signal[]>;
export async function getAllSignals<T extends OnDeckFilterable>(simSignals: Map<number, T>): Promise<T[]>;
export async function getAllSignals<T extends OnDeckFilterable>(simSignals?: Map<number, T>): Promise<(Signal | T)[]> {
    if (!simSignals) {
        return await storage.getSignals(undefined, 5000);
    }
    return Array.from(simSignals.values());
}

export async function getOnDeckSignals(): Promise<Signal[]>;
export async function getOnDeckSignals<T extends OnDeckFilterable>(simSignals: Map<number, T>): Promise<T[]>;
export async function getOnDeckSignals<T extends OnDeckFilterable>(simSignals?: Map<number, T>): Promise<(Signal | T)[]> {
    if (!simSignals) {
        const all = await storage.getSignals(undefined, 5000);
        return all.filter(
            (s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE",
        );
    }
    const all = Array.from(simSignals.values());
    return all.filter(
        (s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE",
    );
}


export function inferBias(signal: Signal): "BUY" | "SELL" {
  const dir = signal.direction.toLowerCase();
  if (dir.includes("up")) return "BUY";
  if (dir.includes("down")) return "SELL";
  const tp = signal.tradePlanJson as TradePlan | null;
  if (tp?.bias) return tp.bias;
  return "BUY";
}

export function computeRNow(
    currentPrice: number,
    entryPrice: number,
    stopPrice: number,
    isSell: boolean,
): number {
    const stopDist = Math.abs(entryPrice - stopPrice);
    if (stopDist === 0) return 0;
    return isSell
        ? (entryPrice - currentPrice) / stopDist
        : (currentPrice - entryPrice) / stopDist;
}

export function computeProgressToTarget(
    currentPrice: number,
    entryPrice: number,
    targetPrice: number,
    isSell: boolean,
): number {
    let progress: number;
    if (isSell) {
        progress =
            entryPrice - targetPrice !== 0
                ? (entryPrice - currentPrice) / (entryPrice - targetPrice)
                : 0;
    } else {
        progress =
            targetPrice - entryPrice !== 0
                ? (currentPrice - entryPrice) / (targetPrice - entryPrice)
                : 0;
    }
    return Math.max(0, Math.min(1, progress));
}

export function shouldApplyBE(stopMode: string): boolean {
    return stopMode === "VOLATILITY_BE" || stopMode === "FULL";
}

export function shouldApplyTimeStop(stopMode: string): boolean {
    return stopMode === "VOLATILITY_TIME" || stopMode === "FULL";
}

export interface ScanTickerConfig {
    setups: string[];
    gapThreshold: number;
    timePriorityMode: "EARLY" | "SAME_DAY" | "BLEND";
    entryMode: string;
    stopMode: string;
    atrMultiplier: number;
    alertGateEnabled: boolean;
    liquidityFloor: number;
}

export interface ScoredSetup {
    ticker: string;
    setupType: string;
    asofDate: string;
    targetDate: string;
    magnetPrice: number;
    magnetPrice2: number | null;
    direction: string;
    confidence: number;
    confidenceBreakdown: any;
    qualityScore: number;
    qualityBreakdown: any;
    tier: string;
    tradePlan: TradePlan;
    sigP60: number | null;
    sigP120: number | null;
    sigP390: number | null;
    timeScore: number | null;
    universePass: boolean;
    stopPrice: number | null;
    lastClose: number;
}

export async function scanTickerSetups(
    ticker: string,
    dailyBars: DailyBar[],
    config: ScanTickerConfig,
    isOnWatchlist: boolean,
    today: string,
    isPreOpen: boolean = false,
): Promise<ScoredSetup[]> {
    if (dailyBars.length < 5) return [];

    const recentBars = dailyBars.slice(-30);
    const setups = detectAllSetups(recentBars, config.setups, config.gapThreshold)
        .filter(setup => isPreOpen ? setup.targetDate >= today : setup.targetDate > today);


    if (setups.length === 0) return [];

    const atr = computeATR(dailyBars);
    const avgVol = computeAvgVolume(dailyBars);
    const avgDollarVol = computeAvgDollarVolume(dailyBars);
    const lastBar = dailyBars[dailyBars.length - 1];
    const slice20 = dailyBars.slice(-20);
    const avgRange20d = slice20.length > 0
        ? slice20.reduce((s, b) => s + (b.high - b.low), 0) / slice20.length
        : 0;
    const avgRange = recentBars.length > 0
        ? recentBars.reduce((s, b) => s + (b.high - b.low), 0) / recentBars.length
        : 0;

    const results: ScoredSetup[] = [];

    for (const setup of setups) {
        const triggerDayBar = recentBars.find((b) => b.date === setup.asofDate);
        const triggerDayVolume = triggerDayBar?.volume ?? 0;
        const triggerDayRange = triggerDayBar ? triggerDayBar.high - triggerDayBar.low : 0;

        const confidence = computeConfidence(
            lastBar.close, setup.magnetPrice, setup.triggerMargin,
            triggerDayVolume, avgVol, triggerDayRange, avgRange, atr,
        );

        const historicalHitRate = await storage.getHitRateForTickerSetup(ticker, setup.setupType);
        const tthStats = await storage.getTimeToHitStats(ticker, setup.setupType);

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
            timePriorityMode: config.timePriorityMode,
        });

        const sigP60 = tthStats?.p60 ?? null;
        const sigP120 = tthStats?.p120 ?? null;
        const sigP390 = tthStats?.p390 ?? null;

        let universePass = true;
        if (config.alertGateEnabled) {
            universePass = isOnWatchlist || avgDollarVol >= config.liquidityFloor;
        }

        let tier = qualityScoreToTier(qualityResult.total, sigP60, sigP120);
        if (isOnWatchlist && tier === "B") tier = "A";
        else if (isOnWatchlist && tier === "C") tier = "B";

        const tradePlan = generateTradePlan(
            lastBar.close, setup.magnetPrice, dailyBars,
            config.entryMode, config.stopMode, config.atrMultiplier,
        );

        const stopPrice = tradePlan.stopDistance
            ? (tradePlan.bias === "SELL"
                ? lastBar.close + tradePlan.stopDistance
                : lastBar.close - tradePlan.stopDistance)
            : null;

        results.push({
            ticker,
            setupType: setup.setupType,
            asofDate: setup.asofDate,
            targetDate: setup.targetDate,
            magnetPrice: setup.magnetPrice,
            magnetPrice2: setup.magnetPrice2 ?? null,
            direction: setup.direction,
            confidence: confidence.total,
            confidenceBreakdown: confidence,
            qualityScore: Math.round(qualityResult.total),
            qualityBreakdown: qualityResult,
            tier,
            tradePlan,
            sigP60,
            sigP120,
            sigP390,
            timeScore: qualityResult.timeScore ?? null,
            universePass,
            stopPrice,
            lastClose: lastBar.close,
        });
    }

    return results;
}

export interface ProcessedSetup extends ScoredSetup {
    status: string;
    hitTs: string | null;
    missReason: string | null;
}

export interface ProcessTickerOptions {
    ticker: string;
    config: ScanTickerConfig;
    isOnWatchlist: boolean;
    today: string;
    from200: string;
}


export async function processDetectSetups(
    opts: ProcessTickerOptions,
    isPreOpen: boolean = false,
): Promise<ProcessedSetup[]> {
    const { ticker, config, isOnWatchlist, today, from200 } = opts;

    const dailyBars = await fetchDailyBarsFromPolygon(ticker, from200, today);


    const scoredSetups = await scanTickerSetups(ticker, dailyBars, config, isOnWatchlist, today, isPreOpen);
    const results: ProcessedSetup[] = [];

    for (const scored of scoredSetups) {
        if (scored.targetDate < today) continue;

        let status = "pending";
        let hitTs: string | null = null;
        let missReason: string | null = null;

        results.push({
            ...scored,
            status,
            hitTs,
            missReason,
        });
    }

    return results;
}

export function checkInvalidation(
    currentPrice: number,
    tradePlan: TradePlan,
    entryPrice: number,
    stopPrice: number | null,
): boolean {
    if (stopPrice == null) {
        const stopDistance = tradePlan.stopDistance;
        if (!stopDistance || stopDistance <= 0) return false;
        if (tradePlan.bias === "SELL") {
            return currentPrice > entryPrice + stopDistance * 1.5;
        }
        return currentPrice < entryPrice - stopDistance * 1.5;
    }
    if (tradePlan.bias === "SELL") {
        return currentPrice > stopPrice;
    }
    return currentPrice < stopPrice;
}

export interface ActivationEvent {
    signalId: number;
    ticker: string;
    type: "activated" | "invalidated" | "stop_to_be" | "time_stop";
    tier: string;
    qualityScore: number;
    entryPrice: number;
    message: string;
    timestamp: string;
}

export function checkEntryTrigger(
    bars: Array<{
        ts: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    }>,
    tradePlan: TradePlan,
    entryMode: string,
): {
    triggered: boolean;
    triggerTs?: string;
    entryPrice?: number;
    entryTriggerPrice?: number;
    invalidated?: boolean;
} {
    const rthBars = filterRTHBars(bars);
    if (rthBars.length === 0) return { triggered: false };

    const isSell = tradePlan.bias === "SELL";
    const magnetPrice = tradePlan.t1;
    const firstClose = rthBars[0]?.close;
    const stopDistance =
        tradePlan.stopDistance ??
        ((firstClose != null ? Math.abs(magnetPrice - firstClose) * 0.5 : 1) || 1);

    if (entryMode === "aggressive") {
        for (const bar of rthBars) {
            const barET = timestampToET(bar.ts);
            const totalMin = barET.getHours() * 60 + barET.getMinutes();
            if (totalMin < 515) continue;

            if (isSell && bar.close < bar.open) {
                return {
                    triggered: true,
                    triggerTs: bar.ts,
                    entryPrice: bar.close,
                    entryTriggerPrice: bar.open,
                };
            }
            if (!isSell && bar.close > bar.open) {
                return {
                    triggered: true,
                    triggerTs: bar.ts,
                    entryPrice: bar.close,
                    entryTriggerPrice: bar.open,
                };
            }
        }
    } else {
        let breakoutSeen = false;
        let breakoutPrice = 0;
        let breakoutTs = "";

        for (let i = 1; i < rthBars.length; i++) {
            const bar = rthBars[i];
            const prevBar = rthBars[i - 1];

            if (!breakoutSeen) {
                if (isSell && bar.close < prevBar.low) {
                    breakoutSeen = true;
                    breakoutPrice = bar.close;
                    breakoutTs = bar.ts;
                } else if (!isSell && bar.close > prevBar.high) {
                    breakoutSeen = true;
                    breakoutPrice = bar.close;
                    breakoutTs = bar.ts;
                }
            } else {
                if (isSell) {
                    if (bar.high >= breakoutPrice && bar.close <= breakoutPrice) {
                        return {
                            triggered: true,
                            triggerTs: bar.ts,
                            entryPrice: bar.close,
                            entryTriggerPrice: breakoutPrice,
                        };
                    }
                    if (bar.close > breakoutPrice + stopDistance) {
                        breakoutSeen = false;
                    }
                } else {
                    if (bar.low <= breakoutPrice && bar.close >= breakoutPrice) {
                        return {
                            triggered: true,
                            triggerTs: bar.ts,
                            entryPrice: bar.close,
                            entryTriggerPrice: breakoutPrice,
                        };
                    }
                    if (bar.close < breakoutPrice - stopDistance) {
                        breakoutSeen = false;
                    }
                }
            }
        }
    }

    return { triggered: false };
}

export interface ActivationScanConfig {
    entryMode: string;
    stopMode: string;
    beProgressThreshold: number;
    beRThreshold: number;
    timeStopMinutes: number;
    timeStopProgressThreshold: number;
    timeStopTightenFactor: number;
    now: Date;
    today: string;
}

export interface ActivationMutation {
    signalId: number;
    ticker: string;
    setupType: string;
    type: "activated" | "invalidated" | "stop_to_be" | "time_stop" | "entry_invalidated";
    activatedTs?: string;
    entryPrice?: number;
    entryTriggerPrice?: number;
    stopPrice?: number;
    stopStage?: string;
    message: string;
    tier: string;
    qualityScore: number;
}

export function runActivationCheck(
    signals: Signal[],
    getCurrentPrice: (ticker: string) => number | null,
    getIntradayBars: (ticker: string, targetDate: string) => IntradayBar[],
    config: ActivationScanConfig,
): { events: ActivationEvent[]; mutations: ActivationMutation[] } {
    const events: ActivationEvent[] = [];
    const mutations: ActivationMutation[] = [];
    const nowIso = config.now.toISOString();

    const tickerGroups = new Map<string, Signal[]>();
    for (const sig of signals) {
        if (!tickerGroups.has(sig.ticker)) tickerGroups.set(sig.ticker, []);
        tickerGroups.get(sig.ticker)!.push(sig);
    }

    for (const [ticker, sigs] of tickerGroups) {
        const currentPrice = getCurrentPrice(ticker);

        for (const sig of sigs) {
            if (sig.activationStatus !== "ACTIVE") continue;
            if (sig.status !== "pending") continue;

            const tp = sig.tradePlanJson as TradePlan;
            if (!tp) continue;
            const entryPrice = sig.entryPriceAtActivation ?? 0;
            const isSell = tp.bias === "SELL";

            if (currentPrice && checkInvalidation(currentPrice, tp, entryPrice, sig.stopPrice)) {
                const msg = `INVALIDATED: ${ticker} ${sig.setupType} entry at ${entryPrice.toFixed(2)} stopped out at ${currentPrice.toFixed(2)}`;
                events.push({
                    signalId: sig.id, ticker, type: "invalidated", tier: sig.tier,
                    qualityScore: sig.qualityScore, entryPrice, message: msg, timestamp: nowIso,
                });
                mutations.push({
                    signalId: sig.id, ticker, setupType: sig.setupType,
                    type: "invalidated", tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
                });
                continue;
            }

            if (currentPrice && entryPrice > 0 && sig.stopPrice != null) {
                const rNow = computeRNow(currentPrice, entryPrice, sig.stopPrice, isSell);
                const progress = computeProgressToTarget(currentPrice, entryPrice, tp.t1, isSell);
                const timingAnchor = sig.activatedTs ? new Date(sig.activatedTs).getTime() : 0;
                const activeMinutes = timingAnchor > 0
                    ? Math.floor((config.now.getTime() - timingAnchor) / 60000)
                    : 0;

                if (shouldApplyBE(config.stopMode) && sig.stopStage === "INITIAL") {
                    const beEarned = rNow >= config.beRThreshold || progress >= config.beProgressThreshold;
                    if (beEarned) {
                        const msg = `STOP→BE: ${ticker} ${sig.setupType} stop moved to breakeven at $${entryPrice.toFixed(2)} (R=${rNow.toFixed(2)}, progress=${(progress * 100).toFixed(0)}%)`;
                        events.push({
                            signalId: sig.id, ticker, type: "stop_to_be", tier: sig.tier,
                            qualityScore: sig.qualityScore, entryPrice, message: msg, timestamp: nowIso,
                        });
                        mutations.push({
                            signalId: sig.id, ticker, setupType: sig.setupType, type: "stop_to_be",
                            stopPrice: entryPrice, stopStage: "BE",
                            tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
                        });
                        continue;
                    }
                }

                if (
                    shouldApplyTimeStop(config.stopMode) &&
                    sig.stopStage !== "TIME_TIGHTENED" &&
                    !sig.timeStopTriggeredTs
                ) {
                    if (activeMinutes >= config.timeStopMinutes && progress < config.timeStopProgressThreshold) {
                        const stopDist = Math.abs(entryPrice - sig.stopPrice);
                        const tightenedDist = stopDist * config.timeStopTightenFactor;
                        const newStop = isSell ? entryPrice + tightenedDist : entryPrice - tightenedDist;

                        const msg = `TIME STOP: ${ticker} ${sig.setupType} stop tightened to $${newStop.toFixed(2)} after ${activeMinutes}min with ${(progress * 100).toFixed(0)}% progress`;
                        events.push({
                            signalId: sig.id, ticker, type: "time_stop", tier: sig.tier,
                            qualityScore: sig.qualityScore, entryPrice, message: msg, timestamp: nowIso,
                        });
                        mutations.push({
                            signalId: sig.id, ticker, setupType: sig.setupType, type: "time_stop",
                            stopPrice: newStop, stopStage: "TIME_TIGHTENED",
                            tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
                        });
                        continue;
                    }
                }
            }
        }
    }

    for (const [ticker, sigs] of tickerGroups) {
        for (const sig of sigs) {
            if (sig.activationStatus === "ACTIVE") continue;
            if (sig.activationStatus === "INVALIDATED") continue;
            if (sig.status !== "pending") continue;

            const sigTp = sig.tradePlanJson as TradePlan;
            if (!sigTp) continue;

            const bars = getIntradayBars(ticker, sig.targetDate);
            if (bars.length === 0) continue;

            const result = checkEntryTrigger(bars, sigTp, config.entryMode);

            if (result.triggered && result.entryPrice) {
                let stopPrice: number | undefined;
                if (sigTp.stopDistance && sigTp.stopDistance > 0) {
                    stopPrice = sigTp.bias === "SELL"
                        ? result.entryPrice + sigTp.stopDistance
                        : result.entryPrice - sigTp.stopDistance;
                }

                const msg = `ACTIVATED (${sigTp.bias}) ${ticker} ${sig.setupType} - Entry: $${result.entryPrice.toFixed(2)}, Target: $${sigTp.t1.toFixed(2)}${stopPrice ? `, Stop: $${stopPrice.toFixed(2)}` : ""}`;
                events.push({
                    signalId: sig.id, ticker, type: "activated", tier: sig.tier,
                    qualityScore: sig.qualityScore, entryPrice: result.entryPrice,
                    message: msg, timestamp: nowIso,
                });
                mutations.push({
                    signalId: sig.id, ticker, setupType: sig.setupType, type: "activated",
                    activatedTs: result.triggerTs, entryPrice: result.entryPrice,
                    entryTriggerPrice: result.entryTriggerPrice, stopPrice, stopStage: "INITIAL",
                    tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
                });
            } else if (result.invalidated) {
                const msg = `Entry trigger invalidated for ${ticker} ${sig.setupType}`;
                mutations.push({
                    signalId: sig.id, ticker, setupType: sig.setupType,
                    type: "entry_invalidated", tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
                });
            }
        }
    }

    return { events, mutations };
}


export function monitorActivatedSignalsForTicker(
    ticker: string, activeSignals: Signal[], currentPrice: number | null, freshBars: IntradayBar[], config: ActivationScanConfig,
): { events: ActivationEvent[]; mutations: ActivationMutation[] } {
    const events: ActivationEvent[] = [];
    const mutations: ActivationMutation[] = [];
    const nowIso = config.now.toISOString();

    for (const sig of activeSignals) {
        if (sig.activationStatus !== "ACTIVE") continue;
        if (sig.status !== "pending") continue;

        const tp = sig.tradePlanJson as TradePlan;
        if (!tp) continue;
        const entryPrice = sig.entryPriceAtActivation ?? 0;
        const isSell = tp.bias === "SELL";

        if (currentPrice && checkInvalidation(currentPrice, tp, entryPrice, sig.stopPrice)) {
            const msg = `INVALIDATED: ${ticker} ${sig.setupType} entry at ${entryPrice.toFixed(2)} stopped out at ${currentPrice.toFixed(2)}`;
            events.push({
                signalId: sig.id, ticker, type: "invalidated", tier: sig.tier,
                qualityScore: sig.qualityScore, entryPrice, message: msg, timestamp: nowIso,
            });
            mutations.push({
                signalId: sig.id, ticker, setupType: sig.setupType,
                type: "invalidated", tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
            });
            continue;
        }

        if (currentPrice && entryPrice > 0 && sig.stopPrice != null) {
            const rNow = computeRNow(currentPrice, entryPrice, sig.stopPrice, isSell);
            const progress = computeProgressToTarget(currentPrice, entryPrice, tp.t1, isSell);
            const timingAnchor = sig.activatedTs ? new Date(sig.activatedTs).getTime() : 0;
            const activeMinutes = timingAnchor > 0
                ? Math.floor((config.now.getTime() - timingAnchor) / 60000)
                : 0;

            if (shouldApplyBE(config.stopMode) && sig.stopStage === "INITIAL") {
                const beEarned = rNow >= config.beRThreshold || progress >= config.beProgressThreshold;
                if (beEarned) {
                    const msg = `STOP→BE: ${ticker} ${sig.setupType} stop moved to breakeven at $${entryPrice.toFixed(2)} (R=${rNow.toFixed(2)}, progress=${(progress * 100).toFixed(0)}%)`;
                    events.push({
                        signalId: sig.id, ticker, type: "stop_to_be", tier: sig.tier,
                        qualityScore: sig.qualityScore, entryPrice, message: msg, timestamp: nowIso,
                    });
                    mutations.push({
                        signalId: sig.id, ticker, setupType: sig.setupType, type: "stop_to_be",
                        stopPrice: entryPrice, stopStage: "BE",
                        tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
                    });
                    continue;
                }
            }

            if (
                shouldApplyTimeStop(config.stopMode) &&
                sig.stopStage !== "TIME_TIGHTENED" &&
                !sig.timeStopTriggeredTs
            ) {
                if (activeMinutes >= config.timeStopMinutes && progress < config.timeStopProgressThreshold) {
                    const stopDist = Math.abs(entryPrice - sig.stopPrice);
                    const tightenedDist = stopDist * config.timeStopTightenFactor;
                    const newStop = isSell ? entryPrice + tightenedDist : entryPrice - tightenedDist;

                    const msg = `TIME STOP: ${ticker} ${sig.setupType} stop tightened to $${newStop.toFixed(2)} after ${activeMinutes}min with ${(progress * 100).toFixed(0)}% progress`;
                    events.push({
                        signalId: sig.id, ticker, type: "time_stop", tier: sig.tier,
                        qualityScore: sig.qualityScore, entryPrice, message: msg, timestamp: nowIso,
                    });
                    mutations.push({
                        signalId: sig.id, ticker, setupType: sig.setupType, type: "time_stop",
                        stopPrice: newStop, stopStage: "TIME_TIGHTENED",
                        tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
                    });
                    continue;
                }
            }
        }
    }

    return { events, mutations };
}

export function checkActivationForTicker(
    ticker: string,
    pendingSignals: Signal[],
    currentPrice: number | null,
    freshBars: IntradayBar[],
    config: ActivationScanConfig,
): { events: ActivationEvent[]; mutations: ActivationMutation[] } {
    const events: ActivationEvent[] = [];
    const mutations: ActivationMutation[] = [];
    const nowIso = config.now.toISOString();

    if (freshBars.length === 0) return { events, mutations };

    for (const sig of pendingSignals) {
        if (sig.activationStatus === "ACTIVE") continue;
        if (sig.activationStatus === "INVALIDATED") continue;
        if (sig.status !== "pending") continue;

        const tp = sig.tradePlanJson as TradePlan;
        if (!tp) continue;

        const triggerResult = checkEntryTrigger(freshBars, tp, config.entryMode);

        if (triggerResult.triggered && triggerResult.entryPrice) {
            let stopPrice: number | undefined;
            if (tp.stopDistance && tp.stopDistance > 0) {
                stopPrice = tp.bias === "SELL"
                    ? triggerResult.entryPrice + tp.stopDistance
                    : triggerResult.entryPrice - tp.stopDistance;
            }

            const msg = `ACTIVATED (${tp.bias}) ${ticker} ${sig.setupType} - Entry: $${triggerResult.entryPrice.toFixed(2)}, Target: $${tp.t1.toFixed(2)}${stopPrice ? `, Stop: $${stopPrice.toFixed(2)}` : ""}`;
            events.push({
                signalId: sig.id, ticker: sig.ticker, type: "activated", tier: sig.tier,
                qualityScore: sig.qualityScore, entryPrice: triggerResult.entryPrice,
                message: msg, timestamp: nowIso,
            });
            mutations.push({
                signalId: sig.id, ticker: sig.ticker, setupType: sig.setupType, type: "activated",
                activatedTs: triggerResult.triggerTs ?? undefined, entryPrice: triggerResult.entryPrice,
                entryTriggerPrice: triggerResult.entryTriggerPrice, stopPrice, stopStage: "INITIAL",
                tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
            });
        } else if (triggerResult.invalidated) {
            const msg = `Entry trigger invalidated for ${sig.ticker} ${sig.setupType}`;
            mutations.push({
                signalId: sig.id, ticker: sig.ticker, setupType: sig.setupType,
                type: "entry_invalidated", tier: sig.tier, qualityScore: sig.qualityScore, message: msg,
            });
        }  
    }
    
    return { events, mutations };
}