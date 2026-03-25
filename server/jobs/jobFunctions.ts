import { storage } from "../storage";
import { fetchSnapshot } from "../lib/polygon";
import { formatDate, getTradingDaysBack, nextTradingDay, isTradingDay } from "../lib/calendar";
import { runActivationScan } from "../lib/activation";
import { runAlerts } from "../lib/alerts";
import { rebuildUniverse } from "../lib/universe";
import { enrichPendingSignalsWithOptions, reEnrichExpiredOptions } from "../lib/options";
import { processTickerAfterClose, type ScanTickerConfig } from "../lib/signalHelper";
import { log } from "../index";

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

    const scanConfig: ScanTickerConfig = {
      setups: ["A", "B", "C", "D", "E", "F"],
      gapThreshold,
      timePriorityMode: (settings.timePriorityMode || "BLEND") as "EARLY" | "SAME_DAY" | "BLEND",
      entryMode: settings.entryMode || "conservative",
      stopMode: settings.stopMode || "atr",
      atrMultiplier: parseFloat(settings.stopAtrMultiplier || "0.25") || 0.25,
      alertGateEnabled,
      liquidityFloor,
    };

    for (const ticker of tickersToScan) {
      try {
        const processed = await processTickerAfterClose({
          ticker,
          config: scanConfig,
          isOnWatchlist: watchlistSet.has(ticker),
          today,
          from200,
        });

        for (const scored of processed) {
          await storage.upsertSignal({
            ticker,
            setupType: scored.setupType,
            asofDate: scored.asofDate,
            targetDate: scored.targetDate,
            targetDate2: null,
            targetDate3: null,
            magnetPrice: scored.magnetPrice,
            magnetPrice2: scored.magnetPrice2,
            direction: scored.direction,
            confidence: scored.confidence,
            status: scored.status,
            hitTs: scored.hitTs,
            timeToHitMin: null,
            missReason: scored.missReason,
            tradePlanJson: scored.tradePlan as any,
            confidenceBreakdown: scored.confidenceBreakdown,
            qualityScore: scored.qualityScore,
            tier: scored.tier,
            alertState: "new",
            nextAlertEligibleAt: null,
            qualityBreakdown: scored.qualityBreakdown,
            pHit60: scored.sigP60,
            pHit120: scored.sigP120,
            pHit390: scored.sigP390,
            timeScore: scored.timeScore,
            universePass: scored.universePass,
            activationStatus: "NOT_ACTIVE",
            activatedTs: null,
            entryPriceAtActivation: null,
            stopPrice: scored.stopPrice,
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
          summary.byTier[scored.tier] = (summary.byTier[scored.tier] || 0) + 1;
          summary.bySetup[scored.setupType] = (summary.bySetup[scored.setupType] || 0) + 1;
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

    const staleSignals = signals.filter(s =>
      s.status === "pending" &&
      s.activationStatus === "NOT_ACTIVE" &&
      s.targetDate < todayStr
    );
    if (staleSignals.length > 0) {
      log(`PreOpen: Expiring ${staleSignals.length} stale signal(s) with past target dates`, "scheduler");
      for (const sig of staleSignals) {
        await storage.updateSignalStatus(sig.id, "miss", undefined, "TARGET_DATE_EXPIRED");
        log(`PreOpen: Expired signal #${sig.id} ${sig.ticker} ${sig.setupType} (target ${sig.targetDate})`, "scheduler");
      }
    }

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
    const { getOnDeckSignals } = await import("../lib/signalHelper");
    const activeSignals = await storage.getActiveSignals();
    const pendingSignals = await getOnDeckSignals();

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
