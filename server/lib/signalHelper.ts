import type { Signal, TradePlan, DailyBar, SetupType } from "@shared/schema";
import { storage } from "../storage";
import { detectAllSetups, type SetupResult } from "./rules";
import { computeConfidence, computeATR, computeAvgVolume } from "./confidence";
import { computeQualityScore, qualityScoreToTier, computeAvgDollarVolume } from "./quality";
import { generateTradePlan } from "./tradeplan";
import { validateMagnetTouch } from "./validate";
import { fetchDailyBarsCached, fetchIntradayBarsCached } from "./polygon";
import { formatDate, getTradingDaysBack } from "./calendar";

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
): Promise<ScoredSetup[]> {
    if (dailyBars.length < 5) return [];

    const recentBars = dailyBars.slice(-30);
    const setups = detectAllSetups(recentBars, config.setups, config.gapThreshold);
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
    minTargetDate: string;
    dailyBars?: DailyBar[];
    fetchAndPersistBars?: {
        from200: string;
        from15: string;
        today: string;
        timeframe: string;
    };
    validateTouch?: {
        today: string;
        timeframe: string;
    };
}

export async function processTickerAfterClose(
    opts: ProcessTickerOptions,
): Promise<ProcessedSetup[]> {
    const { ticker, config, isOnWatchlist, minTargetDate } = opts;

    let dailyBars: DailyBar[];
    if (opts.fetchAndPersistBars) {
        const { from200, from15, today, timeframe } = opts.fetchAndPersistBars;
        const dailyPolygon = await fetchDailyBarsCached(ticker, from200, today);
        for (const bar of dailyPolygon) {
            const date = formatDate(new Date(bar.t));
            await storage.upsertDailyBar({
                ticker, date, open: bar.o, high: bar.h, low: bar.l, close: bar.c,
                volume: bar.v, vwap: bar.vw ?? null, source: "polygon",
            });
        }

        const intradayPolygon = await fetchIntradayBarsCached(ticker, from15, today, timeframe);
        for (const bar of intradayPolygon) {
            const ts = new Date(bar.t).toISOString();
            await storage.upsertIntradayBar({
                ticker, ts, open: bar.o, high: bar.h, low: bar.l, close: bar.c,
                volume: bar.v, timeframe, source: "polygon",
            });
        }

        dailyBars = await storage.getDailyBars(ticker);
    } else if (opts.dailyBars) {
        dailyBars = opts.dailyBars;
    } else {
        return [];
    }

    const scoredSetups = await scanTickerSetups(ticker, dailyBars, config, isOnWatchlist);
    const results: ProcessedSetup[] = [];

    for (const scored of scoredSetups) {
        if (scored.targetDate < minTargetDate) continue;

        let status = "pending";
        let hitTs: string | null = null;
        let missReason: string | null = null;

        if (opts.validateTouch) {
            const { today, timeframe } = opts.validateTouch;
            const intradayBarsData = await storage.getIntradayBars(ticker, scored.targetDate, timeframe);
            if (intradayBarsData.length > 0) {
                const result = validateMagnetTouch(
                    intradayBarsData.map(b => ({ ts: b.ts, high: b.high, low: b.low })),
                    scored.magnetPrice, scored.direction,
                );
                if (result.hit) { status = "hit"; hitTs = result.hitTs ?? null; }
                else if (scored.targetDate < today) { status = "miss"; missReason = "Magnet not touched during RTH"; }
            } else if (scored.targetDate < today) {
                status = "miss"; missReason = "No intraday data available for validation";
            }
        }

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
