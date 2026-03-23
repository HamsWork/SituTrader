import { storage } from "../storage";
import { fetchDailyBarsCached, fetchIntradayBarsCached, fetchSnapshot } from "../lib/polygon";
import { formatDate, getTradingDaysBack, nextTradingDay, isTradingDay } from "../lib/calendar";
import { detectAllSetups } from "../lib/rules";
import { validateMagnetTouch } from "../lib/validate";
import { computeConfidence, computeATR, computeAvgVolume } from "../lib/confidence";
import { computeQualityScore, qualityScoreToTier, computeAvgDollarVolume } from "../lib/quality";
import { generateTradePlan } from "../lib/tradeplan";
import { runActivationScan } from "../lib/activation";
import { runAlerts } from "../lib/alerts";
import { rebuildUniverse } from "../lib/universe";
import { enrichPendingSignalsWithOptions, reEnrichExpiredOptions } from "../lib/options";
import { log } from "../index";
import type { SetupType } from "@shared/schema";

export interface ScanSummary {
  tickersScanned: number;
  signalsGenerated: number;
  byTier: Record<string, number>;
  bySetup: Record<string, number>;
  errors: number;
  durationMs: number;
}

export interface LiveSummary {
  activeTickers: number;
  activeSignals: number;
  activationEvents: number;
  alertEvents: number;
  durationMs: number;
}

export async function runAfterCloseScan(): Promise<ScanSummary> {
  const start = Date.now();
  const summary: ScanSummary = { tickersScanned: 0, signalsGenerated: 0, byTier: {}, bySetup: {}, errors: 0, durationMs: 0 };

  try {
    const settings = await storage.getAllSettings();
    const universeMode = settings.universeMode || "HYBRID";
    const timeframe = settings.intradayTimeframe || "5";
    const gapThreshold = parseFloat(settings.gapThreshold || "0.30") / 100;
    const scanMaxTickers = parseInt(settings.scanMaxTickers || "200", 10);
    const liquidityFloor = parseFloat(settings.liquidityThreshold || "1000000000");
    const topN = parseInt(settings.topNUniverse || "150", 10);
    const alertGateEnabled = settings.alertLiquidityGateEnabled !== "false";

    if (universeMode !== "WATCHLIST_ONLY") {
      try {
        await rebuildUniverse({ topN, liquidityFloor });
      } catch (err: any) {
        log(`AfterClose: Universe rebuild error: ${err.message}`, "scheduler");
      }
    }

    const scanList = await storage.getScanList(universeMode);
    const tickersToScan = scanList.slice(0, scanMaxTickers);
    summary.tickersScanned = tickersToScan.length;

    const today = formatDate(new Date());
    const from200 = getTradingDaysBack(today, 200);
    const from15 = getTradingDaysBack(today, 15);
    const watchlist = await storage.getWatchlistSymbols();
    const watchlistSet = new Set(watchlist.map(s => s.ticker));

    log(`AfterClose: Scanning ${tickersToScan.length} tickers...`, "scheduler");

    for (const ticker of tickersToScan) {
      try {
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

        const allDailyBars = await storage.getDailyBars(ticker);
        if (allDailyBars.length < 5) continue;

        const recentBars = allDailyBars.slice(-30);
        const setups = detectAllSetups(recentBars, ["A", "B", "C", "D", "E", "F"], gapThreshold);

        const atr = computeATR(allDailyBars);
        const avgVol = computeAvgVolume(allDailyBars);
        const avgDollarVol = computeAvgDollarVolume(allDailyBars);
        const lastBar = allDailyBars[allDailyBars.length - 1];
        const avgRange20d = allDailyBars.slice(-20).length > 0
          ? allDailyBars.slice(-20).reduce((s, b) => s + (b.high - b.low), 0) / allDailyBars.slice(-20).length
          : 0;

        const isOnWatchlist = watchlistSet.has(ticker);

        for (const setup of setups) {
          if (setup.targetDate < from15) continue;

          const triggerDayBar = recentBars.find(b => b.date === setup.asofDate);
          const triggerDayVolume = triggerDayBar?.volume ?? 0;
          const triggerDayRange = triggerDayBar ? triggerDayBar.high - triggerDayBar.low : 0;
          const avgRange = recentBars.length > 0
            ? recentBars.reduce((s, b) => s + (b.high - b.low), 0) / recentBars.length : 0;

          const confidence = computeConfidence(lastBar.close, setup.magnetPrice, setup.triggerMargin,
            triggerDayVolume, avgVol, triggerDayRange, avgRange, atr);

          const historicalHitRate = await storage.getHitRateForTickerSetup(ticker, setup.setupType);
          const tthStats = await storage.getTimeToHitStats(ticker, setup.setupType);
          const timePriorityMode = (settings.timePriorityMode || "BLEND") as "EARLY" | "SAME_DAY" | "BLEND";

          const qualityResult = computeQualityScore({
            setupType: setup.setupType as SetupType,
            triggerMargin: setup.triggerMargin,
            lastClose: lastBar.close, magnetPrice: setup.magnetPrice,
            atr14: atr, avgDollarVolume20d: avgDollarVol,
            todayTrueRange: triggerDayRange, avgTrueRange20d: avgRange20d,
            todayVolume: triggerDayVolume, avgVolume20d: avgVol,
            historicalHitRate,
            p60: tthStats?.p60 ?? null, p390: tthStats?.p390 ?? null,
            timePriorityMode,
          });

          const sigP60 = tthStats?.p60 ?? null;
          const sigP120 = tthStats?.p120 ?? null;
          const sigP390 = tthStats?.p390 ?? null;

          let universePass = true;
          if (alertGateEnabled) {
            universePass = isOnWatchlist || avgDollarVol >= liquidityFloor;
          }

          let tier = qualityScoreToTier(qualityResult.total, sigP60, sigP120);
          if (isOnWatchlist && tier === "B") tier = "A";
          else if (isOnWatchlist && tier === "C") tier = "B";

          const atrMult = parseFloat(settings.stopAtrMultiplier || "0.25") || 0.25;
          const tradePlan = generateTradePlan(lastBar.close, setup.magnetPrice, allDailyBars,
            settings.entryMode || "conservative", settings.stopMode || "atr", atrMult);

          let status = "pending";
          let hitTs: string | null = null;
          let missReason: string | null = null;

          const intradayBarsData = await storage.getIntradayBars(ticker, setup.targetDate, timeframe);
          if (intradayBarsData.length > 0) {
            const result = validateMagnetTouch(
              intradayBarsData.map(b => ({ ts: b.ts, high: b.high, low: b.low })),
              setup.magnetPrice, setup.direction);
            if (result.hit) { status = "hit"; hitTs = result.hitTs ?? null; }
            else if (setup.targetDate < today) { status = "miss"; missReason = "Magnet not touched during RTH"; }
          } else if (setup.targetDate < today) {
            status = "miss"; missReason = "No intraday data available for validation";
          }

          await storage.upsertSignal({
            ticker, 
            setupType: setup.setupType, 
            asofDate: setup.asofDate,
            targetDate: setup.targetDate, 
            targetDate2: null, 
            targetDate3: null,
            magnetPrice: setup.magnetPrice, 
            magnetPrice2: setup.magnetPrice2 ?? null,
            direction: setup.direction, 
            confidence: confidence.total,
            status, 
            hitTs, 
            timeToHitMin: null, 
            missReason,
            tradePlanJson: tradePlan as any, 
            confidenceBreakdown: confidence as any,
            qualityScore: Math.round(qualityResult.total), 
            tier,
            alertState: "new", 
            nextAlertEligibleAt: null,
            qualityBreakdown: qualityResult as any,
            pHit60: sigP60, 
            pHit120: sigP120, 
            pHit390: sigP390,
            timeScore: qualityResult.timeScore ?? null, 
            universePass,
            activationStatus: "NOT_ACTIVE", 
            activatedTs: null,
            entryPriceAtActivation: null,
            stopPrice: tradePlan.stopDistance
              ? (tradePlan.bias === "SELL" ? lastBar.close + tradePlan.stopDistance : lastBar.close - tradePlan.stopDistance)
              : null,
            entryTriggerPrice: null, 
            invalidationTs: null,
            stopStage: "INITIAL", 
            stopMovedToBeTs: null, 
            timeStopTriggeredTs: null,
            optionsJson: null,
            optionContractTicker: null,
            optionEntryMark: null,
            instrumentType: "OPTION",
            instrumentTicker: null,
            instrumentEntryPrice: null,
            leveragedEtfJson: null,
          });

          summary.signalsGenerated++;
          summary.byTier[tier] = (summary.byTier[tier] || 0) + 1;
          summary.bySetup[setup.setupType] = (summary.bySetup[setup.setupType] || 0) + 1;
        }
      } catch (err: any) {
        summary.errors++;
        log(`AfterClose: Error scanning ${ticker}: ${err.message}`, "scheduler");
      }
    }

    await storage.setSetting("lastRefresh", new Date().toISOString());
  } catch (err: any) {
    log(`AfterClose: Fatal error: ${err.message}`, "scheduler");
    summary.errors++;
  }

  summary.durationMs = Date.now() - start;
  return summary;
}

export async function runPreOpenScan(): Promise<ScanSummary> {
  const start = Date.now();
  const summary: ScanSummary = { tickersScanned: 0, signalsGenerated: 0, byTier: {}, bySetup: {}, errors: 0, durationMs: 0 };

  try {
    const settings = await storage.getAllSettings();
    const signals = await storage.getSignals(undefined, 200);
    const todayStr = formatDate(new Date());

    const pendingSignals = signals.filter(s => s.status === "pending" && s.targetDate >= todayStr);
    const tickerList = Array.from(new Set(pendingSignals.map(s => s.ticker)));
    summary.tickersScanned = tickerList.length;

    // TODO: dose it need?
    for (const ticker of tickerList) {
      try {
        const snap = await fetchSnapshot(ticker);
        if (!snap || snap.lastPrice <= 0) continue;
      } catch (err: any) {
        summary.errors++;
      }
    }

    // try {
    //   await enrichPendingSignalsWithOptions();
    // } catch (err: any) {
    //   log(`PreOpen: Options enrichment error: ${err.message}`, "scheduler");
    // }

    try {
      const btodEnabled = (await storage.getSetting("btodEnabled")) !== "false";
      if (btodEnabled) {
        const { initializeBtodForDay } = await import("../lib/btod");
        await initializeBtodForDay();
      }
    } catch (btodErr: any) {
      log(`BTOD init error: ${btodErr.message}`, "scheduler");
    }

    // try {
    //   const activationEvents = await runActivationScan();
    //   summary.signalsGenerated = activationEvents.length;
    //   for (const evt of activationEvents) {
    //     summary.bySetup[evt.type] = (summary.bySetup[evt.type] || 0) + 1;
    //   }
    // } catch (err: any) {
    //   log(`PreOpen: Activation scan error: ${err.message}`, "scheduler");
    //   summary.errors++;
    // }

    await storage.setSetting("lastRefresh", new Date().toISOString());
  } catch (err: any) {
    log(`PreOpen: Fatal error: ${err.message}`, "scheduler");
    summary.errors++;
  }

  summary.durationMs = Date.now() - start;
  return summary;
}

export async function runLiveMonitorTick(): Promise<LiveSummary> {
  const start = Date.now();
  const summary: LiveSummary = { activeTickers: 0, activeSignals: 0, activationEvents: 0, alertEvents: 0, durationMs: 0 };

  try {
    const activeSignals = await storage.getActiveSignals();
    const pendingSignals = (await storage.getSignals(undefined, 200))
      .filter(s => s.status === "pending" && s.activationStatus === "NOT_ACTIVE");

    const monitorSignals = [...activeSignals, ...pendingSignals];
    summary.activeSignals = activeSignals.length;

    const tickerArr = Array.from(new Set(monitorSignals.map(s => s.ticker)));
    summary.activeTickers = tickerArr.length;

    if (tickerArr.length === 0) {
      log("Live monitor: no active/pending signals to monitor", "scheduler");
      summary.durationMs = Date.now() - start;
      return summary;
    }

    try {
      const reEnrichResult = await reEnrichExpiredOptions();
      if (reEnrichResult.checked > 0) {
        log(`Live monitor: Expired option re-enrichment: checked=${reEnrichResult.checked}, replaced=${reEnrichResult.reEnriched}, errors=${reEnrichResult.errors}`, "scheduler");
      }
    } catch (err: any) {
      log(`Live monitor: Expired option re-enrichment error: ${err.message}`, "scheduler");
    }

    try {
      await enrichPendingSignalsWithOptions();
    } catch (err: any) {
      log(`Live monitor: Options enrichment error: ${err.message}`, "scheduler");
    }

    try {
      const activationEvents = await runActivationScan();
      summary.activationEvents = activationEvents.length;
    } catch (err: any) {
      log(`Live monitor: Activation error: ${err.message}`, "scheduler");
    }

    try {
      const alertEvents = await runAlerts();
      summary.alertEvents = alertEvents.length;
    } catch (err: any) {
      log(`Live monitor: Alert error: ${err.message}`, "scheduler");
    }
  } catch (err: any) {
    log(`Live monitor: Fatal error: ${err.message}`, "scheduler");
  }

  summary.durationMs = Date.now() - start;
  return summary;
}
