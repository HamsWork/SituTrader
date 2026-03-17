import type { Express } from "express";
import { createServer, type Server } from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { storage } from "./storage";
import { fetchDailyBars, fetchIntradayBars, fetchDailyBarsCached, fetchIntradayBarsCached, fetchSnapshot, fetchOptionSnapshot } from "./lib/polygon";
import { formatDate, getTradingDaysBack, nextTradingDay, prevTradingDay } from "./lib/calendar";
import { detectAllSetups } from "./lib/rules";
import { validateMagnetTouch } from "./lib/validate";
import { computeConfidence, computeATR, computeAvgVolume } from "./lib/confidence";
import { computeQualityScore, qualityScoreToTier, computeAvgDollarVolume } from "./lib/quality";
import { generateTradePlan } from "./lib/tradeplan";
import { runBacktest, computeAndStoreTimeToHitStats } from "./lib/backtest";
import { runAlerts } from "./lib/alerts";
import { runActivationScan, checkEntryTrigger } from "./lib/activation";
import { rebuildUniverse, getUniverseStatus } from "./lib/universe";
import { recomputeAllExpectancy, getSetupAlertCategory } from "./lib/expectancy";
import { log } from "./index";
import { initScheduler, reconfigureJobs, runAutoNow, computeNextAfterCloseTs, computeNextPreOpenTs, isRTH, nowCT } from "./jobs/scheduler";
import { enrichPendingSignalsWithOptions } from "./lib/options";
import { startBacktestWorker, pauseBacktestWorker, resumeBacktestWorker, isBacktestWorkerRunning, isBacktestWorkerPaused, autoStartBacktestWorker } from "./jobs/backtestWorker";
import { startOptionMonitor, getOptionLiveData, refreshOptionQuotesForActiveSignals } from "./lib/optionMonitor";
import { fetchOptionMark } from "./lib/polygon";
import { selectBestLeveragedEtf, fetchStockNbbo, hasLeveragedEtfMapping, getCandidates } from "./lib/leveragedEtf";
import { startLetfMonitor, getLetfLiveData, refreshLetfQuotesForActiveSignals } from "./lib/letfMonitor";
import { connectIBKR, disconnectIBKR, isConnected, getPositions, getAccountSummary } from "./lib/ibkr";
import { executeTradeForSignal, monitorActiveTrades, closeTradeManually, getIbkrDashboardData } from "./lib/ibkrOrders";
import { postOptionsAlert, postLetfAlert, postSharesAlert, postTradeUpdate } from "./lib/discord";
import {
  computeReliabilitySummary,
  runFeesSlippageTest,
  runOutOfSampleTest,
  runWalkForwardTest,
  runMonteCarloTest,
  runStressTest,
  runParameterSweep,
  runStopSensitivityTest,
  runRegimeAnalysis,
} from "./lib/reliability";
import { getBarCacheStats } from "./lib/barCache";
import type { SetupType, OptionLive } from "@shared/schema";

const SEED_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "AMZN", "NVDA", "GOOGL", "META", "TSLA", "ARM", "AMD", "PLTR", "NFLX", "DIS", "LLY", "UNH", "BABA"];

async function seedSymbols() {
  try {
    for (const ticker of SEED_SYMBOLS) {
      await storage.upsertSymbol(ticker, true);
    }
    log("Seed symbols initialized", "startup");
  } catch (err: any) {
    log(`Seed symbols error: ${err.message}`, "startup");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await seedSymbols();
  await storage.seedDefaultProfiles();
  await initScheduler();
  startOptionMonitor();
  startLetfMonitor();
  autoStartBacktestWorker();

  app.get("/api/profiles", async (_req, res) => {
    try {
      const profiles = await storage.getProfiles();
      res.json(profiles);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/profiles/active", async (_req, res) => {
    try {
      const profile = await storage.getActiveProfile();
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/profiles", async (req, res) => {
    try {
      const { name, allowedSetups, minTier, minQualityScore, minSampleSize, minHitRate, minExpectancyR, timePriorityMode, isPinned, isActive } = req.body;
      if (!name || !allowedSetups || !Array.isArray(allowedSetups) || allowedSetups.length === 0) {
        return res.status(400).json({ message: "Name and allowedSetups are required" });
      }
      const profile = await storage.createProfile({
        name,
        allowedSetups,
        minTier: minTier ?? "C",
        minQualityScore: minQualityScore ?? 0,
        minSampleSize: minSampleSize ?? 30,
        minHitRate: minHitRate ?? 0,
        minExpectancyR: minExpectancyR ?? 0,
        timePriorityMode: timePriorityMode ?? "BLEND",
        isPinned: isPinned ?? false,
        isActive: isActive ?? false,
      });
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid profile id" });
      const updated = await storage.updateProfile(id, req.body);
      if (!updated) return res.status(404).json({ message: "Profile not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/profiles/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid profile id" });
      await storage.deleteProfile(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/profiles/:id/activate", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid profile id" });
      await storage.setActiveProfile(id);
      const profile = await storage.getProfile(id);
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/symbols", async (_req, res) => {
    try {
      const syms = await storage.getSymbols();
      res.json(syms);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/symbols", async (req, res) => {
    try {
      const { ticker } = req.body;
      if (!ticker || typeof ticker !== "string") {
        return res.status(400).json({ message: "Ticker required" });
      }
      const sym = await storage.upsertSymbol(ticker.toUpperCase().trim());
      res.json(sym);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/symbols/:ticker", async (req, res) => {
    try {
      const { ticker } = req.params;
      const { enabled } = req.body;
      await storage.toggleSymbol(ticker.toUpperCase(), enabled);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/symbols/:ticker", async (req, res) => {
    try {
      await storage.deleteSymbol(req.params.ticker.toUpperCase());
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/signals", async (_req, res) => {
    try {
      const sigs = await storage.getSignals(undefined, 500);
      const appSettings = await storage.getAllSettings();

      const pendingSignals = sigs.filter(s => s.status === "pending");
      if (pendingSignals.length === 0) {
        return res.json(sigs);
      }

      const allPendingTickers = Array.from(new Set(pendingSignals.map(s => s.ticker)));
      const priceMap = new Map<string, number>();
      const atrMap = new Map<string, number>();

      const today = new Date().toISOString().slice(0, 10);
      await Promise.all(allPendingTickers.map(async (ticker) => {
        try {
          const snap = await fetchSnapshot(ticker);
          if (snap && snap.lastPrice > 0) {
            priceMap.set(ticker, snap.lastPrice);
          }
        } catch {}
        if (!priceMap.has(ticker)) {
          try {
            const bars = await storage.getIntradayBars(ticker, today, "5");
            if (bars.length > 0) {
              const latest = bars[bars.length - 1];
              if (latest.close > 0) {
                priceMap.set(ticker, latest.close);
              }
            }
          } catch {}
        }
        try {
          const ts = await storage.getTickerStats(ticker);
          if (ts && ts.atr14 > 0) {
            atrMap.set(ticker, ts.atr14);
          }
        } catch {}
      }));

      const optionLiveMap = new Map<number, OptionLive>();
      for (const sig of pendingSignals) {
        const cached = getOptionLiveData(sig.id);
        if (cached) {
          optionLiveMap.set(sig.id, cached);
          continue;
        }
        const opts = sig.optionsJson as any;
        if (opts?.tradable && opts?.candidate?.contractSymbol) {
          try {
            const snap = await fetchOptionSnapshot(sig.ticker, opts.candidate.contractSymbol);
            if (snap) {
              const mid = snap.bid != null && snap.ask != null ? Math.round((snap.bid + snap.ask) / 2 * 100) / 100 : null;
              optionLiveMap.set(sig.id, {
                bid: snap.bid,
                ask: snap.ask,
                mid,
                openInterest: snap.openInterest,
                volume: snap.volume,
                impliedVol: snap.impliedVol,
                delta: snap.delta,
                lastUpdated: new Date().toISOString(),
                stale: false,
                optionMarkNow: mid,
                optionBidNow: snap.bid,
                optionAskNow: snap.ask,
                optionSpreadNow: snap.bid != null && snap.ask != null && snap.bid > 0 ? Math.round((snap.ask - snap.bid) * 100) / 100 : null,
                optionNowTs: Date.now(),
                optionEntryMark: sig.optionEntryMark ?? null,
                optionChangeAbs: sig.optionEntryMark != null && mid != null ? Math.round((mid - sig.optionEntryMark) * 100) / 100 : null,
                optionChangePct: sig.optionEntryMark != null && sig.optionEntryMark > 0 && mid != null ? Math.round(((mid - sig.optionEntryMark) / sig.optionEntryMark) * 10000) / 100 : null,
              });
            }
          } catch {}
        }
      }

      const nowMs = Date.now();

      const hydrated = sigs.map(sig => {
        if (sig.status !== "pending") return sig;

        const currentPrice = priceMap.get(sig.ticker);

        const optLive = optionLiveMap.get(sig.id);

        if (sig.activationStatus !== "ACTIVE") {
          if (currentPrice != null) {
            return {
              ...sig,
              live: { currentPrice, activeMinutes: null, progressToTarget: 0, rNow: null, distToTargetAtr: null, distToStopAtr: null, atr14: atrMap.get(sig.ticker) ?? null, stopStage: sig.stopStage || "INITIAL", timeStopMinutesLeft: null, ...(optLive ? { optionLive: optLive } : {}) },
            };
          }
          return sig;
        }

        if (currentPrice == null) return sig;

        const tp = sig.tradePlanJson as any;
        const E = sig.entryPriceAtActivation ?? sig.entryTriggerPrice ?? tp?.t1;
        if (E == null || E === 0) return sig;

        const stopDist = sig.stopPrice != null
          ? Math.abs(E - sig.stopPrice)
          : (tp?.stopDistance != null && tp.stopDistance > 0 ? tp.stopDistance : 0);
        const S = sig.stopPrice ?? (stopDist > 0
          ? (tp?.bias === "SELL" ? E + stopDist : E - stopDist)
          : null);
        const T = sig.magnetPrice;
        const isSell = tp?.bias === "SELL";
        const atr = atrMap.get(sig.ticker) ?? 0;

        const activeMinutes = sig.activatedTs
          ? Math.floor((nowMs - new Date(sig.activatedTs).getTime()) / 60000)
          : null;

        let progressToTarget: number;
        if (isSell) {
          progressToTarget = (E - T) !== 0 ? (E - currentPrice) / (E - T) : 0;
        } else {
          progressToTarget = (T - E) !== 0 ? (currentPrice - E) / (T - E) : 0;
        }
        progressToTarget = Math.max(0, Math.min(1, progressToTarget));

        let rNow: number | null;
        if (stopDist === 0 || S == null) {
          rNow = null;
        } else if (isSell) {
          rNow = (E - currentPrice) / stopDist;
        } else {
          rNow = (currentPrice - E) / stopDist;
        }

        const distToTargetAtr = atr > 0 ? Math.abs(T - currentPrice) / atr : null;
        const distToStopAtr = atr > 0 && S != null ? Math.abs(currentPrice - S) / atr : null;

        const mgmtMode = appSettings.stopManagementMode || "VOLATILITY_ONLY";
        const timeStopEnabled = mgmtMode === "VOLATILITY_TIME" || mgmtMode === "FULL";
        const timeStopMinutes = parseInt(appSettings.timeStopMinutes || "120");
        const timeStopMinutesLeft = timeStopEnabled && activeMinutes != null ? Math.max(0, timeStopMinutes - activeMinutes) : null;

        const instrumentLive = getLetfLiveData(sig.id) ?? undefined;

        return {
          ...sig,
          live: {
            currentPrice,
            activeMinutes,
            progressToTarget: Math.round(progressToTarget * 1000) / 1000,
            rNow: rNow != null ? Math.round(rNow * 100) / 100 : null,
            distToTargetAtr: distToTargetAtr != null ? Math.round(distToTargetAtr * 100) / 100 : null,
            distToStopAtr: distToStopAtr != null ? Math.round(distToStopAtr * 100) / 100 : null,
            atr14: atr > 0 ? atr : null,
            stopStage: sig.stopStage || "INITIAL",
            timeStopMinutesLeft,
            ...(optLive ? { optionLive: optLive } : {}),
          },
          ...(instrumentLive ? { instrumentLive } : {}),
        };
      });

      res.json(hydrated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      let profileFilter: { allowedSetups: string[]; minTier: string; minQualityScore: number } | null = null;
      const profileId = req.query.profileId;
      if (profileId && profileId !== "all") {
        const profiles = await storage.getProfiles();
        const profile = profiles.find(p => p.id === Number(profileId));
        if (profile) {
          profileFilter = { allowedSetups: profile.allowedSetups, minTier: profile.minTier, minQualityScore: profile.minQualityScore };
        }
      }
      const stats = await storage.getSignalStats(profileFilter);
      const lastRefresh = await storage.getSetting("lastRefresh");
      res.json({ ...stats, lastRefresh });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/symbol/:ticker", async (req, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      const dailyBarsData = await storage.getDailyBars(ticker);
      const signalsData = await storage.getSignals(ticker, 50);
      const dailyCoverage = await storage.getDailyCoverage(ticker);
      const intradayCoverage = await storage.getIntradayCoverage(ticker);

      let lastPrice: number | undefined;
      let change: number | undefined;
      let changePercent: number | undefined;

      if (dailyBarsData.length > 0) {
        const last = dailyBarsData[dailyBarsData.length - 1];
        lastPrice = last.close;
        if (dailyBarsData.length > 1) {
          const prev = dailyBarsData[dailyBarsData.length - 2];
          change = last.close - prev.close;
          changePercent = (change / prev.close) * 100;
        }
      }

      try {
        const snap = await fetchSnapshot(ticker);
        if (snap && snap.lastPrice > 0) {
          lastPrice = snap.lastPrice;
          change = snap.change;
          changePercent = snap.changePercent;
        }
      } catch {}

      res.json({
        ticker,
        lastPrice,
        change,
        changePercent,
        dailyBars: dailyBarsData,
        signals: signalsData,
        dailyCoverage,
        intradayCoverage,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/refresh", async (_req, res) => {
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
          log(`Universe rebuild during refresh: ${err.message}`, "refresh");
        }
      }

      const scanList = await storage.getScanList(universeMode);
      if (scanList.length === 0) {
        return res.status(400).json({ message: "No tickers in scan list" });
      }

      const tickersToScan = scanList.slice(0, scanMaxTickers);

      const today = formatDate(new Date());
      const from200 = getTradingDaysBack(today, 200);
      const from15 = getTradingDaysBack(today, 15);

      const watchlist = await storage.getWatchlistSymbols();
      const watchlistSet = new Set(watchlist.map(s => s.ticker));

      log(`Refreshing data for ${tickersToScan.length} tickers (mode: ${universeMode})...`, "refresh");

      for (const ticker of tickersToScan) {
        try {
          const dailyPolygon = await fetchDailyBarsCached(ticker, from200, today);
          for (const bar of dailyPolygon) {
            const date = formatDate(new Date(bar.t));
            await storage.upsertDailyBar({
              ticker,
              date,
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              volume: bar.v,
              vwap: bar.vw ?? null,
              source: "polygon",
            });
          }
          log(`Fetched ${dailyPolygon.length} daily bars for ${ticker}`, "refresh");

          const intradayPolygon = await fetchIntradayBarsCached(ticker, from15, today, timeframe);
          for (const bar of intradayPolygon) {
            const ts = new Date(bar.t).toISOString();
            await storage.upsertIntradayBar({
              ticker,
              ts,
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              volume: bar.v,
              timeframe,
              source: "polygon",
            });
          }
          log(`Fetched ${intradayPolygon.length} intraday bars for ${ticker}`, "refresh");

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

            const triggerDayBar = recentBars.find((b) => b.date === setup.asofDate);
            const triggerDayVolume = triggerDayBar?.volume ?? 0;
            const triggerDayRange = triggerDayBar ? triggerDayBar.high - triggerDayBar.low : 0;
            const avgRange = recentBars.length > 0
              ? recentBars.reduce((s, b) => s + (b.high - b.low), 0) / recentBars.length
              : 0;

            const confidence = computeConfidence(
              lastBar.close,
              setup.magnetPrice,
              setup.triggerMargin,
              triggerDayVolume,
              avgVol,
              triggerDayRange,
              avgRange,
              atr
            );

            const historicalHitRate = await storage.getHitRateForTickerSetup(ticker, setup.setupType);
            const tthStats = await storage.getTimeToHitStats(ticker, setup.setupType);
            const timePriorityMode = (settings.timePriorityMode || "BLEND") as "EARLY" | "SAME_DAY" | "BLEND";

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
            const sigP390 = tthStats?.p390 ?? null;

            let universePass = true;
            if (alertGateEnabled) {
              universePass = isOnWatchlist || avgDollarVol >= liquidityFloor;
            }

            let tier = qualityScoreToTier(qualityResult.total, sigP60, sigP120);
            if (isOnWatchlist && tier === "B") {
              tier = "A";
            } else if (isOnWatchlist && tier === "C") {
              tier = "B";
            }

            const atrMult = parseFloat(settings.stopAtrMultiplier || "0.25") || 0.25;
            const tradePlan = generateTradePlan(
              lastBar.close,
              setup.magnetPrice,
              allDailyBars,
              settings.entryMode || "conservative",
              settings.stopMode || "atr",
              atrMult
            );

            let status = "pending";
            let hitTs: string | null = null;
            let missReason: string | null = null;

            const intradayBarsData = await storage.getIntradayBars(ticker, setup.targetDate, timeframe);
            if (intradayBarsData.length > 0) {
              const result = validateMagnetTouch(
                intradayBarsData.map((b) => ({ ts: b.ts, high: b.high, low: b.low })),
                setup.magnetPrice,
                setup.direction
              );
              if (result.hit) {
                status = "hit";
                hitTs = result.hitTs ?? null;
              } else if (setup.targetDate < today) {
                status = "miss";
                missReason = "Magnet not touched during RTH";
              }
            } else if (setup.targetDate < today) {
              status = "miss";
              missReason = "No intraday data available for validation";
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
              stopPrice: tradePlan.stopDistance ? (tradePlan.bias === "SELL" ? lastBar.close + tradePlan.stopDistance : lastBar.close - tradePlan.stopDistance) : null,
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

            if (hasLeveragedEtfMapping(ticker)) {
              try {
                const suggestion = await selectBestLeveragedEtf(ticker, tradePlan.bias as "BUY" | "SELL");
                if (suggestion) {
                  const newSigs = await storage.getSignals(undefined, 1);
                  const newest = newSigs.find(s => s.ticker === ticker && s.setupType === setup.setupType);
                  if (newest) {
                    await storage.updateSignalLeveragedEtf(newest.id, suggestion);
                  }
                }
              } catch (e: any) {
                log(`LETF auto-suggest failed for ${ticker}: ${e.message}`, "refresh");
              }
            }
          }

          log(`Generated ${setups.length} setups for ${ticker}`, "refresh");
        } catch (err: any) {
          log(`Error refreshing ${ticker}: ${err.message}`, "refresh");
        }
      }

      await storage.setSetting("lastRefresh", new Date().toISOString());
      res.json({ ok: true, message: "Refresh complete" });
    } catch (err: any) {
      log(`Refresh error: ${err.message}`, "refresh");
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      const settings = await storage.getAllSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key || typeof key !== "string") {
        return res.status(400).json({ message: "Key required" });
      }
      const allowedKeys = ["intradayTimeframe", "gapThreshold", "entryMode", "stopMode", "sessionStart", "sessionEnd", "watchlistPriority", "alertTierAplus", "alertTierA", "alertTierB", "alertTierC", "universeMode", "liquidityThreshold", "timePriorityMode", "activationMinTier", "topNUniverse", "alertLiquidityGateEnabled", "focusMode", "focusWinRateThreshold", "focusExpectancyThreshold", "focusMinSampleSize", "stopAtrMultiplier", "stopManagementMode", "beProgressThreshold", "beRThreshold", "timeStopMinutes", "timeStopProgressThreshold", "timeStopTightenFactor"];
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ message: `Invalid setting key: ${key}` });
      }
      if (key === "gapThreshold") {
        const num = parseFloat(String(value));
        if (isNaN(num) || num < 0 || num > 10) {
          return res.status(400).json({ message: "Gap threshold must be a number between 0 and 10" });
        }
      }
      if (key === "intradayTimeframe" && !["1", "5"].includes(String(value))) {
        return res.status(400).json({ message: "Timeframe must be 1 or 5" });
      }
      if (key === "entryMode" && !["conservative", "aggressive"].includes(String(value))) {
        return res.status(400).json({ message: "Entry mode must be conservative or aggressive" });
      }
      if (key === "stopMode" && !["atr", "fixed"].includes(String(value))) {
        return res.status(400).json({ message: "Stop mode must be atr or fixed" });
      }
      if (key === "focusMode" && !["WIN_RATE", "EXPECTANCY", "BARBELL"].includes(String(value))) {
        return res.status(400).json({ message: "Focus mode must be WIN_RATE, EXPECTANCY, or BARBELL" });
      }
      if (key === "focusWinRateThreshold") {
        const num = parseFloat(String(value));
        if (isNaN(num) || num < 0 || num > 1) {
          return res.status(400).json({ message: "Win rate threshold must be between 0 and 1" });
        }
      }
      if (key === "focusExpectancyThreshold") {
        const num = parseFloat(String(value));
        if (isNaN(num) || num < -5 || num > 5) {
          return res.status(400).json({ message: "Expectancy threshold must be between -5 and 5" });
        }
      }
      if (key === "focusMinSampleSize") {
        const num = parseInt(String(value));
        if (isNaN(num) || num < 0 || num > 10000) {
          return res.status(400).json({ message: "Min sample size must be between 0 and 10000" });
        }
      }
      await storage.setSetting(key, String(value));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/backtest/run", async (req, res) => {
    try {
      const { tickers, setups, startDate, endDate } = req.body;
      if (!tickers?.length || !setups?.length) {
        return res.status(400).json({ message: "Tickers and setups required" });
      }

      const settings = await storage.getAllSettings();
      const timeframe = settings.intradayTimeframe || "5";
      const results: any[] = [];

      for (const ticker of tickers) {
        for (const setup of setups) {
          const result = await runBacktest(ticker, setup, startDate, endDate, timeframe);
          const saved = await storage.upsertBacktest(result);
          results.push(saved);
          await computeAndStoreTimeToHitStats(ticker, setup, timeframe);
        }
      }

      try {
        await recomputeAllExpectancy();
        log("Expectancy stats recomputed after backtest", "backtest");
      } catch (err: any) {
        log(`Expectancy recompute failed: ${err.message}`, "backtest");
      }

      res.json(results);
    } catch (err: any) {
      log(`Backtest error: ${err.message}`, "backtest");
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/time-to-hit-stats/:ticker/:setup", async (req, res) => {
    try {
      const { ticker, setup } = req.params;
      const stat = await storage.getTimeToHitStats(ticker, setup);
      if (!stat) return res.json(null);
      res.json(stat);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/time-to-hit-stats", async (req, res) => {
    try {
      const setup = req.query.setup as string;
      if (!setup) return res.status(400).json({ message: "setup query param required" });
      const stat = await storage.getOverallTimeToHitStats(setup);
      res.json(stat);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/backtests", async (_req, res) => {
    try {
      const bts = await storage.getBacktests();
      res.json(bts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/backtest/jobs/start", async (req, res) => {
    try {
      if (isBacktestWorkerRunning() && !isBacktestWorkerPaused()) {
        return res.status(409).json({ message: "Backtest worker is already running" });
      }

      const existingJob = await storage.getActiveBacktestJob();
      if (existingJob && !isBacktestWorkerRunning()) {
        startBacktestWorker(existingJob.id);
        return res.json({ message: "Resumed existing job", jobId: existingJob.id });
      }

      startBacktestWorker();
      res.json({ message: "Backtest worker started" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/backtest/jobs/pause", async (_req, res) => {
    try {
      pauseBacktestWorker();
      res.json({ message: "Backtest worker pausing..." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/backtest/jobs/resume", async (_req, res) => {
    try {
      if (isBacktestWorkerRunning()) {
        resumeBacktestWorker();
        res.json({ message: "Backtest worker resumed" });
      } else {
        const job = await storage.getActiveBacktestJob();
        if (job) {
          startBacktestWorker(job.id);
          res.json({ message: "Backtest worker restarted from last checkpoint" });
        } else {
          res.status(404).json({ message: "No active backtest job found" });
        }
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/backtest/jobs/cancel", async (_req, res) => {
    try {
      const job = await storage.getActiveBacktestJob();
      if (job) {
        await storage.updateBacktestJob(job.id, { status: "cancelled" });
        pauseBacktestWorker();
        res.json({ message: "Backtest job cancelled" });
      } else {
        res.status(404).json({ message: "No active backtest job" });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/backtest/jobs/status", async (_req, res) => {
    try {
      const job = await storage.getActiveBacktestJob();
      const allJobs = await storage.getAllBacktestJobs();
      const latestJob = allJobs[0] ?? null;

      res.json({
        workerRunning: isBacktestWorkerRunning(),
        workerPaused: isBacktestWorkerPaused(),
        activeJob: job,
        latestJob: latestJob,
        totalJobs: allJobs.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/activation/scan", async (_req, res) => {
    try {
      const events = await runActivationScan();
      res.json({ ok: true, events });
    } catch (err: any) {
      log(`Activation scan error: ${err.message}`, "activation");
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/alerts/run", async (_req, res) => {
    try {
      const events = await runAlerts();
      res.json({ ok: true, events });
    } catch (err: any) {
      log(`Alert run error: ${err.message}`, "alerts");
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/universe/rebuild", async (req, res) => {
    try {
      const settings = await storage.getAllSettings();
      const topN = parseInt(settings.topNUniverse || "150", 10);
      const liquidityFloor = parseFloat(settings.liquidityThreshold || "1000000000");
      const force = req.body?.force === true;
      const result = await rebuildUniverse({ topN, liquidityFloor, force });
      res.json({ ok: true, ...result });
    } catch (err: any) {
      log(`Universe rebuild error: ${err.message}`, "universe");
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/universe/status", async (_req, res) => {
    try {
      const status = await getUniverseStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/stats/bar-cache", async (_req, res) => {
    try {
      const stats = await getBarCacheStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/setup-stats", async (_req, res) => {
    try {
      const overall = await storage.getOverallSetupExpectancy();
      res.json(overall);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/setup-stats/all", async (_req, res) => {
    try {
      const all = await storage.getAllSetupExpectancy();
      res.json(all);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/optimization/comprehensive", async (_req, res) => {
    try {
      const allSignals = await storage.getSignals(undefined, 10000);
      const allBacktests = await storage.getBacktests();

      interface StatAccum {
        setupType: string;
        ticker: string | null;
        wins: number;
        losses: number;
        totalPnlPct: number;
        winPnlPcts: number[];
        lossPnlPcts: number[];
        timesToHit: number[];
      }

      const accums = new Map<string, StatAccum>();

      const getKey = (setup: string, ticker: string | null) =>
        `${setup}:${ticker ?? "__overall__"}`;

      const getOrCreate = (setup: string, ticker: string | null): StatAccum => {
        const key = getKey(setup, ticker);
        if (!accums.has(key)) {
          accums.set(key, {
            setupType: setup,
            ticker,
            wins: 0,
            losses: 0,
            totalPnlPct: 0,
            winPnlPcts: [],
            lossPnlPcts: [],
            timesToHit: [],
          });
        }
        return accums.get(key)!;
      };

      const seenKeys = new Set<string>();

      for (const sig of allSignals) {
        const tp = sig.tradePlanJson as any;
        if (!tp) continue;

        const isHit = sig.status === "hit";
        const isMiss = sig.status === "miss" || sig.status === "invalidated" || sig.status === "stopped";
        if (!isHit && !isMiss) continue;

        const dateKey = `${sig.ticker}:${sig.setupType}:${sig.targetDate}`;
        seenKeys.add(dateKey);

        const stopDist = tp.stopDistance || 0;
        const bias = tp.bias as string | undefined;

        let entryPrice: number;
        if (sig.entryPriceAtActivation && sig.entryPriceAtActivation > 0) {
          entryPrice = sig.entryPriceAtActivation;
        } else if (sig.stopPrice && sig.stopPrice > 0 && stopDist > 0) {
          entryPrice = bias === "BUY" ? sig.stopPrice + stopDist : sig.stopPrice - stopDist;
        } else {
          continue;
        }

        if (entryPrice <= 0) continue;

        const reward = tp.t1 ? Math.abs(tp.t1 - entryPrice) : 0;
        const riskR = stopDist > 0 ? stopDist : entryPrice * 0.01;

        const tickerAccum = getOrCreate(sig.setupType, sig.ticker);
        const overallAccum = getOrCreate(sig.setupType, null);

        for (const acc of [tickerAccum, overallAccum]) {
          if (isHit && reward > 0) {
            const winR = reward / riskR;
            acc.wins++;
            acc.winPnlPcts.push(winR);
          } else {
            acc.losses++;
            acc.lossPnlPcts.push(-1);
          }
          if (sig.timeToHitMin != null && sig.timeToHitMin > 0) {
            acc.timesToHit.push(sig.timeToHitMin);
          }
        }
      }

      for (const bt of allBacktests) {
        const details = bt.details as any[] | null;
        if (!details) continue;

        for (const d of details) {
          if (!d.triggered || !d.entryPrice || d.entryPrice <= 0 || !d.date) continue;

          const dateKey = `${bt.ticker}:${bt.setupType}:${d.date}`;
          if (seenKeys.has(dateKey)) continue;

          const entryPrice = d.entryPrice;
          const magnetPrice = d.magnetPrice;
          const reward = Math.abs(magnetPrice - entryPrice);
          const riskR = (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : entryPrice * 0.01;

          const tickerAccum = getOrCreate(bt.setupType, bt.ticker);
          const overallAccum = getOrCreate(bt.setupType, null);

          for (const acc of [tickerAccum, overallAccum]) {
            if (d.hit) {
              const winR = reward / riskR;
              acc.wins++;
              acc.winPnlPcts.push(winR);
            } else {
              acc.losses++;
              acc.lossPnlPcts.push(-1);
            }
            if (d.timeToHitMin != null && d.timeToHitMin > 0) {
              acc.timesToHit.push(d.timeToHitMin);
            }
          }
        }
      }

      const results: any[] = [];

      for (const acc of accums.values()) {
        const sampleSize = acc.wins + acc.losses;
        if (sampleSize === 0) continue;

        const winRate = acc.wins / sampleSize;
        const avgWinR = acc.winPnlPcts.length > 0
          ? acc.winPnlPcts.reduce((s, v) => s + v, 0) / acc.winPnlPcts.length
          : 0;
        const avgLossR = acc.lossPnlPcts.length > 0
          ? Math.abs(acc.lossPnlPcts.reduce((s, v) => s + v, 0) / acc.lossPnlPcts.length)
          : 1;
        const expectancyR = (winRate * avgWinR) - ((1 - winRate) * avgLossR);
        const grossWin = acc.winPnlPcts.reduce((s, v) => s + v, 0);
        const grossLoss = Math.abs(acc.lossPnlPcts.reduce((s, v) => s + v, 0));
        const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

        const allR = [...acc.winPnlPcts, ...acc.lossPnlPcts].sort((a, b) => a - b);
        const medianR = allR.length > 0
          ? allR.length % 2 === 0
            ? (allR[allR.length / 2 - 1] + allR[allR.length / 2]) / 2
            : allR[Math.floor(allR.length / 2)]
          : 0;

        let tradeability: string = "CLEAN";
        if (winRate < 0.3) tradeability = "AVOID";
        else if (winRate < 0.4) tradeability = "CAUTION";

        results.push({
          setupType: acc.setupType,
          ticker: acc.ticker,
          sampleSize,
          winRate: Math.round(winRate * 1000) / 1000,
          avgWinR: Math.round(avgWinR * 100) / 100,
          avgLossR: Math.round(avgLossR * 100) / 100,
          medianR: Math.round(medianR * 100) / 100,
          expectancyR: Math.round(expectancyR * 100) / 100,
          profitFactor: Math.round(profitFactor * 100) / 100,
          avgMaeR: 0,
          medianMaeR: 0,
          tradeability,
          category: expectancyR >= 0.20 ? "PRIMARY" : expectancyR >= 0.05 ? "SECONDARY" : "OFF",
        });
      }

      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/setup-stats/:setupType", async (req, res) => {
    try {
      const { setupType } = req.params;
      const ticker = req.query.ticker as string | undefined;
      const stat = await storage.getSetupExpectancy(setupType, ticker || null);
      res.json(stat);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/setup-stats/recompute", async (_req, res) => {
    try {
      const results = await recomputeAllExpectancy();
      res.json({ ok: true, count: results.length, results });
    } catch (err: any) {
      log(`Expectancy recompute error: ${err.message}`, "expectancy");
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/alerts/events", async (_req, res) => {
    try {
      const allSignals = await storage.getSignals(undefined, 200);
      const events = allSignals
        .filter(s => s.alertState && s.alertState !== "new")
        .map(s => ({
          signalId: s.id,
          ticker: s.ticker,
          setupType: s.setupType,
          type: s.alertState,
          tier: s.tier,
          qualityScore: s.qualityScore,
          status: s.status,
          magnetPrice: s.magnetPrice,
          direction: s.direction,
          asofDate: s.asofDate,
          targetDate: s.targetDate,
          confidence: s.confidence,
        }))
        .sort((a, b) => {
          const tierOrder: Record<string, number> = { APLUS: 0, A: 1, B: 2, C: 3 };
          const tierDiff = (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3);
          if (tierDiff !== 0) return tierDiff;
          return b.qualityScore - a.qualityScore;
        });
      res.json(events);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/signals/enrich-options", async (req, res) => {
    try {
      const { force, minOI, maxSpread } = req.body ?? {};
      const result = await enrichPendingSignalsWithOptions({
        force: force === true,
        minOI: typeof minOI === "number" ? minOI : undefined,
        maxSpread: typeof maxSpread === "number" ? maxSpread : undefined,
      });
      res.json(result);
    } catch (err: any) {
      log(`Options enrichment error: ${err.message}`, "options");
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/scheduler/state", async (_req, res) => {
    try {
      const state = await storage.getSchedulerState();
      const now = nowCT();
      const rth = isRTH();
      res.json({
        authorModeEnabled: state.authorModeEnabled,
        lastAfterCloseRunTs: state.lastAfterCloseRunTs,
        lastPreOpenRunTs: state.lastPreOpenRunTs,
        lastLiveMonitorRunTs: state.lastLiveMonitorRunTs,
        lastRunSummaryJson: state.lastRunSummaryJson,
        nextAfterCloseTs: computeNextAfterCloseTs(),
        nextPreOpenTs: computeNextPreOpenTs(),
        nowCT: now.format("YYYY-MM-DD HH:mm:ss"),
        liveStatus: rth && state.authorModeEnabled ? "Running" : "Idle",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/btod/status", async (_req, res) => {
    try {
      const { getBtodStatus } = await import("./lib/btod");
      const state = await getBtodStatus();
      if (!state) {
        return res.json({ initialized: false, message: "No BTOD state for today" });
      }

      const btodEnabled = (await storage.getSetting("btodEnabled")) !== "false";
      const ranked = state.rankedQueue as any[];
      const top3 = state.top3Ids as number[];

      const allSignals = await storage.getSignals(undefined, 5000);
      const enrichedQueue = ranked.map((entry: any) => {
        const sig = allSignals.find((s) => s.id === entry.signalId);
        return {
          ...entry,
          direction: sig?.direction ?? null,
          status: sig?.activationStatus ?? null,
          tier: sig?.tier ?? null,
          isTop3: top3.includes(entry.signalId),
        };
      });

      res.json({
        initialized: true,
        enabled: btodEnabled,
        tradeDate: state.tradeDate,
        phase: state.phase,
        gateOpen: state.gateOpen,
        tradesExecuted: state.tradesExecuted,
        selectedSignalId: state.selectedSignalId,
        secondSignalId: state.secondSignalId,
        phaseChangedAt: state.phaseChangedAt,
        top3Ids: top3,
        rankedQueue: enrichedQueue,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/btod/initialize", async (_req, res) => {
    try {
      const { initializeBtodForDay } = await import("./lib/btod");
      const state = await initializeBtodForDay();
      res.json({ success: true, state });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/btod/toggle", async (req, res) => {
    try {
      const { enabled } = req.body;
      await storage.setSetting("btodEnabled", enabled ? "true" : "false");
      res.json({ enabled });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/scheduler/toggle", async (req, res) => {
    try {
      const { authorModeEnabled } = req.body;
      if (typeof authorModeEnabled !== "boolean") {
        return res.status(400).json({ message: "authorModeEnabled (boolean) is required" });
      }
      const state = await storage.updateSchedulerState({ authorModeEnabled });
      reconfigureJobs(state.authorModeEnabled);
      res.json({ authorModeEnabled: state.authorModeEnabled });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/scheduler/run", async (req, res) => {
    try {
      const { job } = req.body;
      if (job && job !== "autoNow") {
        return res.status(400).json({ message: "Use { job: 'autoNow' } or omit job field" });
      }
      const result = await runAutoNow();
      res.json({ ok: true, job: result.job, summary: result.summary });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/dev/option-quote", async (req, res) => {
    try {
      const contract = req.query.contract as string;
      if (!contract) {
        return res.status(400).json({ message: "contract query param required (e.g. O:SPY260226C00685000)" });
      }
      const result = await fetchOptionMark(contract);
      res.json({ contract, result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/options/refresh", async (_req, res) => {
    try {
      const updated = await refreshOptionQuotesForActiveSignals();
      res.json({ ok: true, updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/signals/:id/instrument", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid signal id" });
      const { instrumentType, instrumentTicker } = req.body;
      if (!["OPTION", "SHARES", "LEVERAGED_ETF"].includes(instrumentType)) {
        return res.status(400).json({ message: "instrumentType must be OPTION, SHARES, or LEVERAGED_ETF" });
      }

      const sigs = await storage.getSignals(undefined, 500);
      const sig = sigs.find(s => s.id === id);

      let entryPrice: number | null = null;
      if (instrumentType === "LEVERAGED_ETF" && instrumentTicker) {
        if (sig?.activatedTs) {
          const activationMs = new Date(sig.activatedTs).getTime();
          const { fetchStockPriceAtTime } = await import("./lib/polygon");
          entryPrice = await fetchStockPriceAtTime(instrumentTicker, activationMs);
        }
        if (entryPrice == null) {
          const quote = await fetchStockNbbo(instrumentTicker);
          entryPrice = quote?.mid ?? null;
        }
      } else if (instrumentType === "SHARES") {
        entryPrice = sig?.entryPriceAtActivation ?? null;
      }

      const updated = await storage.updateSignalInstrument(id, instrumentType, instrumentTicker ?? null, entryPrice);
      res.json({ ok: true, signal: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/signals/batch-letf", async (_req, res) => {
    try {
      const allSigs = await storage.getSignals(undefined, 500);
      const needLetf = allSigs.filter(s =>
        (s.status === "pending" || s.status === "active") &&
        !s.leveragedEtfJson &&
        hasLeveragedEtfMapping(s.ticker)
      );

      let updated = 0;
      for (const sig of needLetf) {
        try {
          const tp = sig.tradePlanJson as any;
          const bias: "BUY" | "SELL" = tp?.bias === "SELL" ? "SELL" : "BUY";
          const suggestion = await selectBestLeveragedEtf(sig.ticker, bias);
          if (suggestion) {
            await storage.updateSignalLeveragedEtf(sig.id, suggestion);
            updated++;
          }
        } catch (e: any) {
          log(`Batch LETF error for signal ${sig.id}: ${e.message}`, "letf");
        }
      }

      res.json({ ok: true, processed: needLetf.length, updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/signals/:id/suggest-letf", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid signal id" });

      const sigs = await storage.getSignals(undefined, 500);
      const sig = sigs.find(s => s.id === id);
      if (!sig) return res.status(404).json({ message: "Signal not found" });

      const tp = sig.tradePlanJson as any;
      const bias: "BUY" | "SELL" = tp?.bias === "SELL" ? "SELL" : "BUY";
      const suggestion = await selectBestLeveragedEtf(sig.ticker, bias);

      if (suggestion) {
        await storage.updateSignalLeveragedEtf(id, suggestion);
      }
      res.json({ suggestion });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── IBKR Routes ──

  app.post("/api/ibkr/connect", async (_req, res) => {
    try {
      const ok = await connectIBKR();
      await storage.updateIbkrState({
        connected: ok,
        lastConnectedAt: ok ? new Date().toISOString() : undefined,
      });
      res.json({ connected: ok });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ibkr/disconnect", async (_req, res) => {
    try {
      disconnectIBKR();
      await storage.updateIbkrState({
        connected: false,
        lastDisconnectedAt: new Date().toISOString(),
      });
      res.json({ connected: false });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ibkr/status", async (_req, res) => {
    try {
      const connected = isConnected();
      const positions = getPositions();
      const account = getAccountSummary();
      res.json({ connected, positions, account });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ibkr/dashboard", async (_req, res) => {
    try {
      const data = await getIbkrDashboardData();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ibkr/execute", async (req, res) => {
    try {
      const { signalId, quantity } = req.body;
      if (!signalId) return res.status(400).json({ message: "signalId is required" });
      const trade = await executeTradeForSignal(signalId, quantity ?? 1);
      res.json({ ok: true, trade });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ibkr/close/:tradeId", async (req, res) => {
    try {
      const tradeId = parseInt(req.params.tradeId);
      if (isNaN(tradeId)) return res.status(400).json({ message: "Invalid trade id" });
      const trade = await closeTradeManually(tradeId);
      res.json({ ok: true, trade });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/ibkr/trades", async (_req, res) => {
    try {
      const trades = await storage.getAllIbkrTrades();
      res.json(trades);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ibkr/monitor", async (_req, res) => {
    try {
      await monitorActiveTrades();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tradesync/status", async (_req, res) => {
    try {
      const { getTradesyncStatus, isTradeSyncEnabled } = await import("./lib/tradesync");
      const status = await getTradesyncStatus();
      res.json({ ...status, enabled: isTradeSyncEnabled() });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tradesync/templates", async (_req, res) => {
    try {
      const { fetchDiscordTemplates, isTradeSyncEnabled } = await import("./lib/tradesync");
      if (!isTradeSyncEnabled()) {
        return res.status(400).json({ message: "TradeSync not configured" });
      }
      const result = await fetchDiscordTemplates();
      if (!result.ok) {
        return res.status(502).json({ message: result.error });
      }
      res.json(result.data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tradesync/trades", async (req, res) => {
    try {
      const { fetchTradeHistory, isTradeSyncEnabled } = await import("./lib/tradesync");
      if (!isTradeSyncEnabled()) {
        return res.status(400).json({ message: "TradeSync not configured" });
      }
      const limit = parseInt(req.query.limit as string) || 100;
      const status = req.query.status as string | undefined;
      const result = await fetchTradeHistory(limit, status);
      if (!result.ok) {
        return res.status(502).json({ message: result.error });
      }
      res.json(result.data);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/discord-trades", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const event = req.query.event as string | undefined;
      const channel = req.query.channel as string | undefined;
      const ticker = req.query.ticker as string | undefined;
      const logs = await storage.getDiscordTradeLogs({ limit, offset, event, channel, ticker });
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/embed-templates", async (_req, res) => {
    try {
      const templates = await storage.getEmbedTemplates();
      res.json(templates);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/embed-templates/variables", async (_req, res) => {
    try {
      const { AVAILABLE_VARIABLES } = await import("./lib/embedTemplateDefaults");
      res.json(AVAILABLE_VARIABLES);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/embed-templates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid template id" });
      const { embedJson, templateName, isActive } = req.body;
      if (embedJson !== undefined && (typeof embedJson !== "object" || embedJson === null)) {
        return res.status(400).json({ message: "embedJson must be a valid object" });
      }
      if (embedJson && (!embedJson.description || !Array.isArray(embedJson.fields))) {
        return res.status(400).json({ message: "embedJson must have description and fields array" });
      }
      if (templateName !== undefined && typeof templateName !== "string") {
        return res.status(400).json({ message: "templateName must be a string" });
      }
      if (isActive !== undefined && typeof isActive !== "boolean") {
        return res.status(400).json({ message: "isActive must be a boolean" });
      }
      const updates: any = {};
      if (embedJson !== undefined) updates.embedJson = embedJson;
      if (templateName !== undefined) updates.templateName = templateName;
      if (isActive !== undefined) updates.isActive = isActive;
      const result = await storage.updateEmbedTemplate(id, updates);
      if (!result) return res.status(404).json({ message: "Template not found" });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/embed-templates/seed", async (_req, res) => {
    try {
      const { seedDefaultTemplates } = await import("./lib/embedTemplateEngine");
      const count = await seedDefaultTemplates();
      res.json({ seeded: count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/embed-templates/reset/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid template id" });
      const templates = await storage.getEmbedTemplates();
      const existing = templates.find(t => t.id === id);
      if (!existing) return res.status(404).json({ message: "Template not found" });
      const { getDefaultTemplates } = await import("./lib/embedTemplateDefaults");
      const defaults = getDefaultTemplates();
      const def = defaults.find(d => d.instrumentType === existing.instrumentType && d.eventType === existing.eventType);
      if (!def) return res.status(404).json({ message: "No default template found for this combination" });
      const result = await storage.updateEmbedTemplate(id, { embedJson: def.embedJson as any, templateName: def.templateName });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/embed-templates/preview", async (req, res) => {
    try {
      const { embedJson, variables, instrumentType } = req.body;
      if (!embedJson) return res.status(400).json({ message: "embedJson required" });
      const { renderTemplate } = await import("./lib/embedTemplateEngine");
      const previewTicker = (instrumentType === "LEVERAGED_ETF" || instrumentType === "LETF_OPTIONS") ? "NVDA" : "AAPL";
      const sampleVars: Record<string, string> = {
        "{{ticker}}": previewTicker,
        "{{stock_price}}": "185.50",
        "{{entry_price}}": "$3.45",
        "{{stop_price}}": "$180.00",
        "{{stop_pct}}": "-3.0",
        "{{targets_line}}": "$190.00 (+2.4%), $195.00 (+5.1%)",
        "{{tp_plan}}": "Take Profit (1): At +2.4% take off 50.0% of position and raise stop loss to break even.\nTake Profit (2): At +5.1% take off 50.0% of remaining position.",
        "{{expiry}}": "03/14/2026",
        "{{strike}}": "185",
        "{{right}}": "CALL",
        "{{option_price}}": "3.45",
        "{{letf_ticker}}": "TQQQ",
        "{{leverage}}": "3",
        "{{letf_direction}}": "BULL",
        "{{tp1_fill_price}}": "$4.50",
        "{{tp2_fill_price}}": "$5.80",
        "{{profit_pct}}": "+30.4%",
        "{{exit_price}}": "$4.50",
        "{{new_stop_price}}": "$3.45",
        "{{pnl_dollar}}": "+$150.00",
        "{{r_multiple}}": "2.50",
        "{{tp2_rider_text}}": "\n🎯 Let remaining 50% ride to TP2 ($195.00)",
        "{{tp2_target_text}}": "\n🎯 Remaining target: TP2 at $195.00",
        "{{pnl_emoji}}": "💰",
        "{{pnl_color}}": "#22c55e",
        "{{status_emoji}}": "🟢",
        ...(variables || {}),
      };
      const rendered = renderTemplate(embedJson, sampleVars);
      res.json(rendered);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Discord Routes ──

  app.post("/api/discord/test-options", async (req, res) => {
    try {
      const { signalId } = req.body;
      if (!signalId) return res.status(400).json({ message: "signalId required" });
      const sigs = await storage.getSignals(undefined, 500);
      const sig = sigs.find(s => s.id === signalId);
      if (!sig) return res.status(404).json({ message: "Signal not found" });
      const qs = sig.qualityScore ?? 0;
      if (qs <= 80) return res.status(400).json({ message: `Signal quality score ${qs} must be > 80 to send Discord alert` });
      if ((sig.instrumentType || "OPTION") !== "OPTION") return res.status(400).json({ message: `Signal instrument type must be OPTION for this endpoint` });
      const ok = await postOptionsAlert(sig);
      res.json({ ok });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/discord/test-letf", async (req, res) => {
    try {
      const { signalId } = req.body;
      if (!signalId) return res.status(400).json({ message: "signalId required" });
      const sigs = await storage.getSignals(undefined, 500);
      const sig = sigs.find(s => s.id === signalId);
      if (!sig) return res.status(404).json({ message: "Signal not found" });
      const qs = sig.qualityScore ?? 0;
      if (qs <= 80) return res.status(400).json({ message: `Signal quality score ${qs} must be > 80 to send Discord alert` });
      if (sig.instrumentType !== "LEVERAGED_ETF") return res.status(400).json({ message: `Signal instrument type must be LEVERAGED_ETF for this endpoint` });
      const ok = await postLetfAlert(sig);
      res.json({ ok });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/discord/replay-test", async (req, res) => {
    try {
      const { dryRun = true } = req.body;
      const allSignals = await storage.getSignals(undefined, 5000);
      const activated = allSignals.filter(s =>
        s.activatedTs && (s.activationStatus === "ACTIVE" || s.activationStatus === "INVALIDATED")
      );

      const above80 = activated
        .filter(s => (s.qualityScore ?? 0) > 80)
        .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

      const bestOption = above80.find(s => (s.instrumentType || "OPTION") === "OPTION");
      const bestLetf = above80.find(s => s.instrumentType === "LEVERAGED_ETF");

      const results: any[] = [];

      const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const tradesCreatedToday = await storage.getIbkrTradesCreatedOnEtDate(todayEt);
      const hasOptionToday = tradesCreatedToday.some(t => t.instrumentType === "OPTION");
      const hasLetfToday = tradesCreatedToday.some(t => t.instrumentType === "LEVERAGED_ETF");

      for (const candidate of [
        { label: "OPTION", signal: bestOption, blocked: hasOptionToday },
        { label: "LETF", signal: bestLetf, blocked: hasLetfToday },
      ]) {
        if (!candidate.signal) {
          results.push({ label: candidate.label, status: "NO_CANDIDATE", reason: "No activated signal with QS > 80 found" });
          continue;
        }
        if (candidate.blocked) {
          results.push({
            label: candidate.label, status: "DAILY_LIMIT",
            reason: `Already 1 ${candidate.label} trade today`,
            signal: { id: candidate.signal.id, ticker: candidate.signal.ticker, qs: candidate.signal.qualityScore },
          });
          continue;
        }

        const sig = candidate.signal;
        const tp = sig.tradePlanJson as any;
        const inst = sig.instrumentType || "OPTION";

        if (dryRun) {
          results.push({
            label: candidate.label, status: "DRY_RUN",
            reason: "Would create trade + send Discord (set dryRun:false to execute)",
            signal: {
              id: sig.id, ticker: sig.ticker, setupType: sig.setupType,
              qs: sig.qualityScore, tier: sig.tier, instrumentType: inst,
              direction: tp?.bias, entryPrice: sig.entryPriceAtActivation,
              stopPrice: sig.stopPrice, t1: tp?.t1, t2: tp?.t2,
              activatedTs: sig.activatedTs,
            },
            discordChannel: inst === "OPTION" ? "GOAT_ALERTS" : inst === "SHARES" ? "GOAT_SHARES" : "GOAT_SWINGS",
          });
        } else {
          const isBuy = tp?.bias === "BUY";
          const action = isBuy ? "BUY" : "SELL";
          const optionTicker = sig.optionContractTicker || (sig.optionsJson as any)?.candidate?.contractSymbol;
          const instrumentTicker = sig.instrumentTicker || (sig.leveragedEtfJson as any)?.ticker;

          const trade = await storage.createIbkrTrade({
            signalId: sig.id,
            ticker: sig.ticker,
            instrumentType: inst,
            instrumentTicker: inst === "OPTION" ? optionTicker : instrumentTicker,
            side: action,
            quantity: 1,
            originalQuantity: 1,
            remainingQuantity: 1,
            tpHitLevel: 0,
            stopPrice: sig.stopPrice ?? null,
            target1Price: tp?.t1 ?? null,
            target2Price: tp?.t2 ?? null,
            status: "PENDING",
          });

          let discordOk = false;
          try {
            if (inst === "OPTION") {
              discordOk = await postOptionsAlert(sig, {
                ...trade,
                entryPrice: sig.entryPriceAtActivation ?? null,
                status: "PENDING",
              } as any);
            } else if (inst === "SHARES") {
              discordOk = await postSharesAlert(sig, {
                ...trade,
                entryPrice: sig.entryPriceAtActivation ?? null,
                status: "PENDING",
              } as any);
            } else {
              discordOk = await postLetfAlert(sig, {
                ...trade,
                entryPrice: sig.entryPriceAtActivation ?? null,
                status: "PENDING",
              } as any);
            }
            if (discordOk) {
              await storage.updateIbkrTrade(trade.id, { discordAlertSent: true });
            }
          } catch (discErr: any) {
            log(`Replay test Discord error: ${discErr.message}`, "discord");
          }

          await storage.updateIbkrTrade(trade.id, {
            status: "PENDING",
            notes: "Created via replay-test endpoint (IBKR not connected)",
          });

          results.push({
            label: candidate.label, status: "EXECUTED",
            tradeId: trade.id,
            discordSent: discordOk,
            discordChannel: inst === "OPTION" ? "GOAT_ALERTS" : inst === "SHARES" ? "GOAT_SHARES" : "GOAT_SWINGS",
            signal: {
              id: sig.id, ticker: sig.ticker, setupType: sig.setupType,
              qs: sig.qualityScore, tier: sig.tier, instrumentType: inst,
              entryPrice: sig.entryPriceAtActivation,
            },
          });
        }
      }

      res.json({
        dryRun,
        todayEt,
        existingTradesToday: { option: hasOptionToday, letf: hasLetfToday },
        candidatesAbove80: above80.length,
        results,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/discord/replay-lifecycle", async (req, res) => {
    try {
      const { dryRun = true, delayMs = 2000, scenarios } = req.body;

      const allSignals = await storage.getSignals(undefined, 5000);
      const activated = allSignals.filter(s =>
        s.activatedTs && (s.activationStatus === "ACTIVE" || s.activationStatus === "INVALIDATED")
      );
      const candidates = activated
        .filter(s => (s.qualityScore ?? 0) > 60)
        .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

      const optionCandidates = candidates.filter(s => (s.instrumentType || "OPTION") === "OPTION");
      const letfCandidates = candidates.filter(s => s.instrumentType === "LEVERAGED_ETF");
      const sharesCandidates = candidates.length > 0 ? candidates : optionCandidates;

      type ScenarioConfig = {
        name: string;
        events: string[];
        instrumentType: "OPTION" | "LEVERAGED_ETF" | "SHARES";
        outcome: "WINNER" | "LOSER" | "BE_STOP";
      };

      const defaultScenarios: ScenarioConfig[] = [
        { name: "Option Winner (Full Close)", events: ["FILLED", "TP1_HIT", "CLOSED"], instrumentType: "OPTION", outcome: "WINNER" },
        { name: "Option Loser (Stopped Out)", events: ["FILLED", "TIME_STOP", "STOPPED_OUT"], instrumentType: "OPTION", outcome: "LOSER" },
        { name: "LETF Winner (TP1 + BE Stop)", events: ["FILLED", "TP1_HIT", "RAISE_STOP", "STOPPED_OUT_AFTER_TP"], instrumentType: "LEVERAGED_ETF", outcome: "BE_STOP" },
        { name: "LETF Full Winner (Close)", events: ["FILLED", "TP1_HIT", "CLOSED"], instrumentType: "LEVERAGED_ETF", outcome: "WINNER" },
        { name: "Shares Winner (Full Close)", events: ["FILLED", "TP1_HIT", "CLOSED"], instrumentType: "SHARES", outcome: "WINNER" },
      ];

      const activeScenarios: ScenarioConfig[] = scenarios ?? defaultScenarios;
      const results: any[] = [];

      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      for (let i = 0; i < activeScenarios.length; i++) {
        const scenario = activeScenarios[i];
        const pool = scenario.instrumentType === "OPTION" ? optionCandidates : scenario.instrumentType === "SHARES" ? sharesCandidates : letfCandidates;
        const sig = pool[i % pool.length];

        if (!sig) {
          results.push({ scenario: scenario.name, status: "NO_CANDIDATE", instrumentType: scenario.instrumentType });
          continue;
        }

        const tp = sig.tradePlanJson as any;
        const inst = scenario.instrumentType || sig.instrumentType || "OPTION";
        const isBuy = tp?.bias === "BUY";
        const action = isBuy ? "BUY" : "SELL";
        const entryPx = sig.entryPriceAtActivation ?? tp?.t1 ?? 100;
        const stopPx = sig.stopPrice ?? (isBuy ? entryPx * 0.99 : entryPx * 1.01);
        const t1Px = tp?.t1 ?? (isBuy ? entryPx * 1.02 : entryPx * 0.98);
        const t2Px = tp?.t2 ?? (isBuy ? entryPx * 1.04 : entryPx * 0.96);
        const optionTicker = sig.optionContractTicker || (sig.optionsJson as any)?.candidate?.contractSymbol;
        const instrumentTicker = sig.instrumentTicker || (sig.leveragedEtfJson as any)?.ticker;

        if (dryRun) {
          results.push({
            scenario: scenario.name,
            status: "DRY_RUN",
            events: scenario.events,
            instrumentType: inst,
            signal: {
              id: sig.id, ticker: sig.ticker, setupType: sig.setupType,
              qs: sig.qualityScore, tier: sig.tier,
              entryPrice: entryPx, stopPrice: stopPx, t1: t1Px, t2: t2Px,
            },
            discordChannel: inst === "OPTION" ? "GOAT_ALERTS" : inst === "SHARES" ? "GOAT_SHARES" : "GOAT_SWINGS",
            discordMessages: scenario.events.length + 1,
          });
          continue;
        }

        const scenarioResults: any[] = [];
        const now = new Date().toISOString();

        const trade = await storage.createIbkrTrade({
          signalId: sig.id,
          ticker: sig.ticker,
          instrumentType: inst,
          instrumentTicker: inst === "OPTION" ? optionTicker : instrumentTicker,
          side: action,
          quantity: 2,
          originalQuantity: 2,
          remainingQuantity: 2,
          tpHitLevel: 0,
          stopPrice: stopPx,
          target1Price: t1Px,
          target2Price: t2Px,
          status: "PENDING",
          notes: `Replay lifecycle: ${scenario.name}`,
        });

        let entryAlertOk = false;
        try {
          if (inst === "OPTION") {
            entryAlertOk = await postOptionsAlert(sig, { ...trade, entryPrice: entryPx, status: "PENDING" } as any);
          } else if (inst === "SHARES") {
            entryAlertOk = await postSharesAlert(sig, { ...trade, entryPrice: entryPx, status: "PENDING" } as any);
          } else {
            entryAlertOk = await postLetfAlert(sig, { ...trade, entryPrice: entryPx, status: "PENDING" } as any);
          }
          if (entryAlertOk) await storage.updateIbkrTrade(trade.id, { discordAlertSent: true });
        } catch (e: any) {
          log(`Replay lifecycle entry alert error: ${e.message}`, "discord");
        }
        scenarioResults.push({ step: "ENTRY_ALERT", type: inst === "OPTION" ? "postOptionsAlert" : inst === "SHARES" ? "postSharesAlert" : "postLetfAlert", ok: entryAlertOk });

        if (delayMs > 0) await delay(delayMs);

        let currentTrade = { ...trade, entryPrice: entryPx, stopPrice: stopPx };

        for (const event of scenario.events) {
          let updatedFields: any = {};

          switch (event) {
            case "FILLED":
              updatedFields = {
                status: "FILLED",
                entryPrice: entryPx,
                filledAt: now,
              };
              break;
            case "TP1_HIT":
              updatedFields = {
                tpHitLevel: 1,
                tp1FillPrice: t1Px,
                tp1FilledAt: now,
                tp1PnlRealized: isBuy ? (t1Px - entryPx) * 1 : (entryPx - t1Px) * 1,
                remainingQuantity: 1,
                stopPrice: entryPx,
                stopMovedToBe: true,
                pnl: isBuy ? (t1Px - entryPx) * 1 : (entryPx - t1Px) * 1,
              };
              break;
            case "TP2_HIT":
              updatedFields = {
                tpHitLevel: 2,
                tp2FillPrice: t2Px,
                tp2FilledAt: now,
                remainingQuantity: 0,
                exitPrice: t2Px,
                status: "CLOSED",
                pnl: isBuy ? (t1Px - entryPx) * 1 + (t2Px - entryPx) * 1 : (entryPx - t1Px) * 1 + (entryPx - t2Px) * 1,
                pnlPct: isBuy ? ((t2Px - entryPx) / entryPx) * 100 : ((entryPx - t2Px) / entryPx) * 100,
                rMultiple: 2.0,
                closedAt: now,
              };
              break;
            case "RAISE_STOP":
              updatedFields = {
                stopPrice: entryPx,
                stopMovedToBe: true,
              };
              break;
            case "TIME_STOP": {
              const tightenFactor = 0.5;
              const dist = Math.abs(entryPx - stopPx);
              const newStopPx = isBuy ? entryPx - dist * tightenFactor : entryPx + dist * tightenFactor;
              updatedFields = {
                stopPrice: parseFloat(newStopPx.toFixed(2)),
                detailsJson: { oldStopPrice: stopPx, newStopPrice: parseFloat(newStopPx.toFixed(2)), timeStopTightenFactor: tightenFactor },
              };
              break;
            }
            case "STOPPED_OUT":
              updatedFields = {
                status: "CLOSED",
                exitPrice: currentTrade.stopPrice,
                remainingQuantity: 0,
                pnl: isBuy ? (currentTrade.stopPrice - entryPx) * (currentTrade as any).remainingQuantity || 2 : (entryPx - currentTrade.stopPrice) * (currentTrade as any).remainingQuantity || 2,
                pnlPct: isBuy ? ((currentTrade.stopPrice - entryPx) / entryPx) * 100 : ((entryPx - currentTrade.stopPrice) / entryPx) * 100,
                rMultiple: -1.0,
                closedAt: now,
              };
              break;
            case "STOPPED_OUT_AFTER_TP":
              updatedFields = {
                status: "CLOSED",
                exitPrice: entryPx,
                remainingQuantity: 0,
                pnl: isBuy ? (t1Px - entryPx) * 1 : (entryPx - t1Px) * 1,
                pnlPct: isBuy ? ((t1Px - entryPx) / entryPx) * 100 * 0.5 : ((entryPx - t1Px) / entryPx) * 100 * 0.5,
                rMultiple: 0.5,
                closedAt: now,
              };
              break;
            case "CLOSED": {
              const finalPnl = isBuy
                ? (t1Px - entryPx) * 1 + (t2Px - entryPx) * 1
                : (entryPx - t1Px) * 1 + (entryPx - t2Px) * 1;
              updatedFields = {
                status: "CLOSED",
                exitPrice: t2Px,
                remainingQuantity: 0,
                pnl: finalPnl,
                pnlPct: finalPnl > 0 ? Math.abs((finalPnl / (entryPx * 2)) * 100) : -Math.abs((finalPnl / (entryPx * 2)) * 100),
                rMultiple: finalPnl > 0 ? 2.5 : -1.0,
                closedAt: now,
              };
              break;
            }
          }

          await storage.updateIbkrTrade(trade.id, updatedFields);
          currentTrade = { ...currentTrade, ...updatedFields };

          let discordOk = false;
          try {
            discordOk = await postTradeUpdate(sig, currentTrade as any, event);
          } catch (e: any) {
            log(`Replay lifecycle Discord error (${event}): ${e.message}`, "discord");
          }

          scenarioResults.push({ step: event, discordSent: discordOk, updatedFields: Object.keys(updatedFields) });

          if (delayMs > 0 && event !== scenario.events[scenario.events.length - 1]) {
            await delay(delayMs);
          }
        }

        if (delayMs > 0 && i < activeScenarios.length - 1) {
          await delay(delayMs * 2);
        }

        results.push({
          scenario: scenario.name,
          status: "COMPLETED",
          tradeId: trade.id,
          instrumentType: inst,
          signal: { id: sig.id, ticker: sig.ticker, qs: sig.qualityScore, tier: sig.tier },
          discordChannel: inst === "OPTION" ? "GOAT_ALERTS" : inst === "SHARES" ? "GOAT_SHARES" : "GOAT_SWINGS",
          steps: scenarioResults,
        });
      }

      res.json({
        dryRun,
        availableCandidates: { options: optionCandidates.length, letf: letfCandidates.length, shares: sharesCandidates.length },
        scenariosRun: activeScenarios.length,
        results,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Performance Analysis Routes ──

  app.get("/api/performance/analysis", async (req, res) => {
    try {
      const allSignals = await storage.getSignals(undefined, 10000);
      const allTrades = await storage.getAllIbkrTrades();
      const allBacktests = await storage.getBacktests();

      const capitalPerTrade = parseFloat(req.query.capital as string) || 1000;
      const now = new Date();

      const TIER_RANK: Record<string, number> = { APLUS: 0, A: 1, B: 2, C: 3 };

      const activeProfile = await storage.getActiveProfile();

      let setupStatsMap = new Map<string, { sampleSize: number; winRate: number; expectancyR: number }>();
      try {
        const overallStats = await storage.getOverallSetupExpectancy();
        for (const s of overallStats) {
          if (!s.ticker) {
            setupStatsMap.set(s.setupType, {
              sampleSize: s.sampleSize,
              winRate: s.winRate,
              expectancyR: s.expectancyR,
            });
          }
        }
      } catch {}

      const matchesProfile = (sig: any): boolean => {
        if (!activeProfile) return true;

        if (!activeProfile.allowedSetups.includes(sig.setupType)) return false;
        const sigTierRank = TIER_RANK[sig.tier] ?? 3;
        const minTierRank = TIER_RANK[activeProfile.minTier] ?? 3;
        if (sigTierRank > minTierRank) return false;
        if (sig.qualityScore < activeProfile.minQualityScore) return false;

        const stat = setupStatsMap.get(sig.setupType);
        if (stat) {
          if (activeProfile.minSampleSize > 0 && stat.sampleSize < activeProfile.minSampleSize) return false;
          if (activeProfile.minHitRate > 0 && stat.winRate < activeProfile.minHitRate) return false;
          if (activeProfile.minExpectancyR > 0 && stat.expectancyR < activeProfile.minExpectancyR) return false;
        } else if (activeProfile.minSampleSize > 0 || activeProfile.minHitRate > 0 || activeProfile.minExpectancyR > 0) {
          return false;
        }

        return true;
      };

      const activatedOnly = req.query.activatedOnly === "true";

      const tradeResults: any[] = [];

      const signalDateKeys = new Set<string>();

      for (const sig of allSignals) {
        const tp = sig.tradePlanJson as any;
        if (!tp) continue;

        const isHit = sig.status === "hit";
        const isMiss = sig.status === "miss" || sig.status === "invalidated" || sig.status === "stopped";
        if (!isHit && !isMiss) continue;

        if (!matchesProfile(sig)) continue;

        if (activatedOnly) {
          const hasActivation = (sig.activationStatus === "ACTIVE" || sig.activationStatus === "INVALIDATED")
            && (sig.activatedTs != null || (sig.entryPriceAtActivation != null && sig.entryPriceAtActivation > 0));
          if (!hasActivation) continue;
        }

        const stopDist = tp.stopDistance || 0;
        const bias = tp.bias as string | undefined;

        let entryPrice: number;
        if (sig.entryPriceAtActivation && sig.entryPriceAtActivation > 0) {
          entryPrice = sig.entryPriceAtActivation;
        } else if (sig.stopPrice && sig.stopPrice > 0 && stopDist > 0) {
          entryPrice = bias === "BUY"
            ? sig.stopPrice + stopDist
            : sig.stopPrice - stopDist;
        } else if (tp.riskReward && stopDist > 0 && sig.magnetPrice > 0) {
          entryPrice = bias === "BUY"
            ? sig.magnetPrice - (tp.riskReward * stopDist)
            : sig.magnetPrice + (tp.riskReward * stopDist);
        } else {
          continue;
        }

        if (entryPrice <= 0) continue;

        const shares = Math.floor(capitalPerTrade / entryPrice);
        if (shares <= 0) continue;

        const actualInvested = shares * entryPrice;
        let exitPrice: number | null = null;
        let pnlDollar = 0;
        let pnlPct = 0;
        let outcome = "MISS";

        if (isHit && tp.t1) {
          exitPrice = tp.t1;
          const diff = bias === "BUY"
            ? (exitPrice! - entryPrice) * shares
            : (entryPrice - exitPrice!) * shares;
          pnlDollar = diff;
          pnlPct = (diff / actualInvested) * 100;
          outcome = "HIT_T1";
        } else if (isMiss) {
          const sd = stopDist || (entryPrice * 0.01);
          exitPrice = bias === "BUY" ? entryPrice - sd : entryPrice + sd;
          pnlDollar = -sd * shares;
          pnlPct = (pnlDollar / actualInvested) * 100;
          outcome = "STOPPED";
        }

        const signalDate = sig.hitTs
          ? new Date(sig.hitTs).toISOString().slice(0, 10)
          : sig.targetDate;

        const ibkrTrade = allTrades.find(t => t.signalId === sig.id);

        signalDateKeys.add(`${sig.ticker}:${sig.setupType}:${signalDate}`);

        tradeResults.push({
          signalId: sig.id,
          ticker: sig.ticker,
          setupType: sig.setupType,
          direction: sig.direction,
          bias: bias || sig.direction,
          instrumentType: sig.instrumentType || "OPTION",
          date: signalDate,
          entryPrice: Math.round(entryPrice * 100) / 100,
          exitPrice: exitPrice ? Math.round(exitPrice * 100) / 100 : null,
          shares,
          invested: Math.round(actualInvested * 100) / 100,
          pnlDollar: Math.round(pnlDollar * 100) / 100,
          pnlPct: Math.round(pnlPct * 100) / 100,
          outcome,
          tier: sig.tier,
          qualityScore: sig.qualityScore,
          timeToHitMin: sig.timeToHitMin,
          hasIbkrTrade: !!ibkrTrade,
          ibkrPnl: ibkrTrade?.pnl ?? null,
          ibkrStatus: ibkrTrade?.status ?? null,
          source: "signal",
        });
      }

      const seenBacktestKeys = new Set<string>();

      const latestBacktests = new Map<string, typeof allBacktests[0]>();
      for (const bt of allBacktests) {
        const key = `${bt.ticker}:${bt.setupType}`;
        const existing = latestBacktests.get(key);
        if (!existing || bt.id > existing.id) {
          latestBacktests.set(key, bt);
        }
      }

      let btIdCounter = -1;
      for (const bt of latestBacktests.values()) {
        const details = bt.details as any[] | null;
        if (!details) continue;

        for (const d of details) {
          if (!d.triggered) continue;
          if (!d.entryPrice || d.entryPrice <= 0) continue;
          if (!d.date) continue;

          const dateKey = `${bt.ticker}:${bt.setupType}:${d.date}`;
          if (signalDateKeys.has(dateKey)) continue;
          if (seenBacktestKeys.has(dateKey)) continue;
          seenBacktestKeys.add(dateKey);

          if (activatedOnly && d.activated !== true) continue;

          const entryPrice = (activatedOnly && d.activationPrice && d.activationPrice > 0)
            ? d.activationPrice : d.entryPrice;
          const magnetPrice = d.magnetPrice;
          const bias = magnetPrice >= entryPrice ? "BUY" : "SELL";
          const reward = Math.abs(magnetPrice - entryPrice);
          const stopDist = (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : entryPrice * 0.01;

          const shares = Math.floor(capitalPerTrade / entryPrice);
          if (shares <= 0) continue;

          const actualInvested = shares * entryPrice;
          let exitPrice: number;
          let pnlDollar: number;
          let pnlPct: number;
          let outcome: string;

          if (d.hit) {
            exitPrice = magnetPrice;
            const diff = bias === "BUY"
              ? (exitPrice - entryPrice) * shares
              : (entryPrice - exitPrice) * shares;
            pnlDollar = diff;
            pnlPct = (diff / actualInvested) * 100;
            outcome = "HIT_T1";
          } else {
            exitPrice = bias === "BUY" ? entryPrice - stopDist : entryPrice + stopDist;
            pnlDollar = -stopDist * shares;
            pnlPct = (pnlDollar / actualInvested) * 100;
            outcome = "STOPPED";
          }

          tradeResults.push({
            signalId: btIdCounter--,
            ticker: bt.ticker,
            setupType: bt.setupType,
            direction: bias === "BUY" ? "BULLISH" : "BEARISH",
            bias,
            instrumentType: "SHARES",
            date: d.date,
            entryPrice: Math.round(entryPrice * 100) / 100,
            exitPrice: Math.round(exitPrice * 100) / 100,
            shares,
            invested: Math.round(actualInvested * 100) / 100,
            pnlDollar: Math.round(pnlDollar * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            outcome,
            tier: "B",
            qualityScore: Math.round((bt.hitRate ?? 0.5) * 100),
            timeToHitMin: d.timeToHitMin ?? null,
            hasIbkrTrade: false,
            ibkrPnl: null,
            ibkrStatus: null,
            source: "backtest",
          });
        }
      }

      tradeResults.sort((a, b) => b.date.localeCompare(a.date));

      const buildSummary = (label: string, periodTrades: any[]) => {
        const totalTrades = periodTrades.length;
        const wins = periodTrades.filter(t => t.outcome === "HIT_T1").length;
        const losses = periodTrades.filter(t => t.outcome === "STOPPED").length;
        const totalPnl = periodTrades.reduce((s, t) => s + t.pnlDollar, 0);
        const totalInvested = periodTrades.reduce((s, t) => s + t.invested, 0);
        const maxConcurrent = Math.min(totalTrades, 10);
        const capitalRequired = maxConcurrent * capitalPerTrade;
        const winRate = totalTrades > 0 ? wins / totalTrades : 0;
        const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
        const bestTrade = periodTrades.length > 0
          ? periodTrades.reduce((best, t) => t.pnlDollar > best.pnlDollar ? t : best)
          : null;
        const worstTrade = periodTrades.length > 0
          ? periodTrades.reduce((worst, t) => t.pnlDollar < worst.pnlDollar ? t : worst)
          : null;

        const byInstrument = {
          OPTION: periodTrades.filter(t => t.instrumentType === "OPTION"),
          SHARES: periodTrades.filter(t => t.instrumentType === "SHARES"),
          LEVERAGED_ETF: periodTrades.filter(t => t.instrumentType === "LEVERAGED_ETF"),
        };

        const instrumentBreakdown = Object.entries(byInstrument).map(([type, trades]) => ({
          type,
          count: trades.length,
          pnl: Math.round(trades.reduce((s, t) => s + t.pnlDollar, 0) * 100) / 100,
          winRate: trades.length > 0 ? trades.filter(t => t.outcome === "HIT_T1").length / trades.length : 0,
        }));

        const liveCount = periodTrades.filter(t => t.source !== "backtest").length;
        const btCount = periodTrades.filter(t => t.source === "backtest").length;

        const tradeDates = periodTrades.map(t => t.date).sort();
        const dateFrom = tradeDates.length > 0 ? tradeDates[0] : null;
        const dateTo = tradeDates.length > 0 ? tradeDates[tradeDates.length - 1] : null;

        const sorted = [...periodTrades].sort((a, b) => a.date.localeCompare(b.date));
        let cumPnl = 0;
        const equityCurve = sorted.map((t, i) => {
          cumPnl += t.pnlDollar;
          return { trade: i + 1, date: t.date, ticker: t.ticker, pnl: Math.round(t.pnlDollar * 100) / 100, cumPnl: Math.round(cumPnl * 100) / 100 };
        });

        const dailyMap = new Map<string, number>();
        for (const t of periodTrades) {
          dailyMap.set(t.date, (dailyMap.get(t.date) ?? 0) + t.pnlDollar);
        }
        const dailyPnl = Array.from(dailyMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, pnl]) => ({ date: date.slice(5), pnl: Math.round(pnl * 100) / 100 }));

        const maxCurvePoints = 500;
        let sampledCurve = equityCurve;
        if (equityCurve.length > maxCurvePoints) {
          const step = Math.ceil(equityCurve.length / maxCurvePoints);
          sampledCurve = equityCurve.filter((_, i) => i % step === 0 || i === equityCurve.length - 1);
        }

        return {
          label,
          totalTrades,
          wins,
          losses,
          winRate: Math.round(winRate * 1000) / 10,
          totalPnl: Math.round(totalPnl * 100) / 100,
          totalInvested: Math.round(totalInvested * 100) / 100,
          capitalRequired: Math.round(capitalRequired),
          avgPnlPerTrade: Math.round(avgPnl * 100) / 100,
          roiOnCapital: capitalRequired > 0 ? Math.round((totalPnl / capitalRequired) * 10000) / 100 : 0,
          edgePct: totalInvested > 0 ? Math.round((totalPnl / totalInvested) * 10000) / 100 : 0,
          bestTrade: bestTrade ? { ticker: bestTrade.ticker, pnl: bestTrade.pnlDollar } : null,
          worstTrade: worstTrade ? { ticker: worstTrade.ticker, pnl: worstTrade.pnlDollar } : null,
          instrumentBreakdown,
          liveCount,
          backtestCount: btCount,
          dateFrom,
          dateTo,
          equityCurve: sampledCurve,
          dailyPnl,
        };
      };

      const todayStr = now.toISOString().slice(0, 10);
      const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);
      const cutoff60 = new Date(now); cutoff60.setDate(cutoff60.getDate() - 60);
      const cutoff90 = new Date(now); cutoff90.setDate(cutoff90.getDate() - 90);
      const c30 = cutoff30.toISOString().slice(0, 10);
      const c60 = cutoff60.toISOString().slice(0, 10);
      const c90 = cutoff90.toISOString().slice(0, 10);

      const trades30 = tradeResults.filter(t => t.date >= c30);
      const trades60 = tradeResults.filter(t => t.date >= c60 && t.date < c30);
      const trades90 = tradeResults.filter(t => t.date >= c90 && t.date < c60);
      const tradesOlder = tradeResults.filter(t => t.date < c90);

      const periodSummaries = [
        buildSummary("Last 30 Days", trades30),
        buildSummary("31–60 Days Ago", trades60),
        buildSummary("61–90 Days Ago", trades90),
        buildSummary("91+ Days Ago", tradesOlder),
        buildSummary("Total", tradeResults),
      ];

      const earliestDate = tradeResults.length > 0
        ? tradeResults.reduce((min, t) => t.date < min ? t.date : min, tradeResults[0].date)
        : null;
      const latestDate = tradeResults.length > 0
        ? tradeResults.reduce((max, t) => t.date > max ? t.date : max, tradeResults[0].date)
        : null;
      const dataSpanDays = earliestDate && latestDate
        ? Math.ceil((new Date(latestDate).getTime() - new Date(earliestDate).getTime()) / (1000 * 60 * 60 * 24)) + 1
        : 0;

      const period = parseInt(req.query.period as string ?? "4");
      const instrument = (req.query.instrument as string) || "all";
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string) || 100));

      const periodTradesMap = [trades30, trades60, trades90, tradesOlder, tradeResults];
      let selectedTrades = periodTradesMap[period] ?? tradeResults;
      if (instrument !== "all") {
        selectedTrades = selectedTrades.filter(t => t.instrumentType === instrument);
      }
      const totalFilteredTrades = selectedTrades.length;
      const totalPages = Math.ceil(totalFilteredTrades / pageSize);
      const paginatedTrades = selectedTrades.slice((page - 1) * pageSize, page * pageSize);

      res.json({
        capitalPerTrade,
        totalSignalsAnalyzed: allSignals.length,
        totalResolvedTrades: tradeResults.length,
        activeProfileName: activeProfile?.name ?? null,
        dataSpanDays,
        earliestDate,
        latestDate,
        periodSummaries,
        trades: paginatedTrades,
        pagination: { page, pageSize, totalFilteredTrades, totalPages },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Performance ROI Insights ──

  app.get("/api/performance/roi-insights", async (req, res) => {
    try {
      const setupOverride = req.query.setup as string | undefined;
      const allBacktests = await storage.getBacktests();

      const bySetup: Record<string, { wins: number; losses: number; count: number; actWins: number; actLosses: number; actCount: number }> = {};
      const byTicker: Record<string, { wins: number; losses: number; count: number; actWins: number; actLosses: number; actCount: number }> = {};
      const bySetupTicker: Record<string, { wins: number; losses: number; count: number }> = {};
      const byQS: Record<string, { wins: number; losses: number; count: number }> = {};

      const qsBuckets = [
        { label: "90-100", lo: 90, hi: 101 },
        { label: "80-89", lo: 80, hi: 90 },
        { label: "70-79", lo: 70, hi: 80 },
        { label: "60-69", lo: 60, hi: 70 },
        { label: "50-59", lo: 50, hi: 60 },
        { label: "0-49", lo: 0, hi: 50 },
      ];

      for (const bt of allBacktests) {
        const details = bt.details as any[] | null;
        if (!details) continue;
        const s = bt.setupType;
        const tick = bt.ticker;
        const qs = Math.round((bt.hitRate ?? 0.5) * 100);

        if (!bySetup[s]) bySetup[s] = { wins: 0, losses: 0, count: 0, actWins: 0, actLosses: 0, actCount: 0 };
        if (!byTicker[tick]) byTicker[tick] = { wins: 0, losses: 0, count: 0, actWins: 0, actLosses: 0, actCount: 0 };

        for (const d of details) {
          if (!d.triggered) continue;
          const hit = !!d.hit;
          const activated = d.activated === true;

          bySetup[s].count++;
          byTicker[tick].count++;
          if (hit) { bySetup[s].wins++; byTicker[tick].wins++; }
          else { bySetup[s].losses++; byTicker[tick].losses++; }

          if (activated) {
            bySetup[s].actCount++;
            byTicker[tick].actCount++;
            if (hit) { bySetup[s].actWins++; byTicker[tick].actWins++; }
            else { bySetup[s].actLosses++; byTicker[tick].actLosses++; }

            const stKey = `${s}|${tick}`;
            if (!bySetupTicker[stKey]) bySetupTicker[stKey] = { wins: 0, losses: 0, count: 0 };
            bySetupTicker[stKey].count++;
            if (hit) bySetupTicker[stKey].wins++;
            else bySetupTicker[stKey].losses++;

            for (const bucket of qsBuckets) {
              if (qs >= bucket.lo && qs < bucket.hi) {
                if (!byQS[bucket.label]) byQS[bucket.label] = { wins: 0, losses: 0, count: 0 };
                byQS[bucket.label].count++;
                if (hit) byQS[bucket.label].wins++;
                else byQS[bucket.label].losses++;
                break;
              }
            }
          }
        }
      }

      const setupRankings = Object.entries(bySetup)
        .map(([setup, b]) => ({
          setup,
          totalTrades: b.count,
          winRate: b.count > 0 ? Math.round(b.wins / b.count * 1000) / 10 : 0,
          activatedTrades: b.actCount,
          activatedWinRate: b.actCount > 0 ? Math.round(b.actWins / b.actCount * 1000) / 10 : 0,
          lift: b.actCount > 0 && b.count > 0 ? Math.round((b.actWins / b.actCount - b.wins / b.count) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.activatedWinRate - a.activatedWinRate);

      const autoBestSetup = setupRankings.length > 0 ? setupRankings[0].setup : null;
      const bestSetup = (setupOverride && setupOverride !== "best" && bySetup[setupOverride]) ? setupOverride : autoBestSetup;

      const topTickers = Object.entries(bySetupTicker)
        .filter(([key, b]) => key.startsWith(`${bestSetup}|`) && b.count >= 30)
        .map(([key, b]) => ({
          ticker: key.split("|")[1],
          setup: bestSetup!,
          trades: b.count,
          winRate: Math.round(b.wins / b.count * 1000) / 10,
          wins: b.wins,
          losses: b.losses,
        }))
        .sort((a, b) => b.winRate - a.winRate)
        .slice(0, 20);

      const avoidTickers = Object.entries(byTicker)
        .filter(([_, b]) => b.actCount >= 50)
        .map(([tick, b]) => ({
          ticker: tick,
          trades: b.actCount,
          winRate: Math.round(b.actWins / b.actCount * 1000) / 10,
        }))
        .sort((a, b) => a.winRate - b.winRate)
        .slice(0, 10);

      const qualityScoreBreakdown = qsBuckets
        .filter(bucket => byQS[bucket.label]?.count > 0)
        .map(bucket => {
          const b = byQS[bucket.label];
          return {
            range: bucket.label,
            trades: b.count,
            winRate: Math.round(b.wins / b.count * 1000) / 10,
            wins: b.wins,
            losses: b.losses,
          };
        });

      const totalActivated = Object.values(bySetup).reduce((s, b) => s + b.actCount, 0);
      const totalActivatedWins = Object.values(bySetup).reduce((s, b) => s + b.actWins, 0);

      const topTickerSet = new Set(topTickers.map(t => t.ticker));
      const capitalPerTrade = 1000;
      const forceRebuild = req.query.rebuild === "true";

      const cacheMeta = await storage.getRoiCacheMeta(bestSetup);
      const cacheValid = !forceRebuild && cacheMeta && cacheMeta.status === "ready" && cacheMeta.tradeCount > 0;

      let minDate = "9999-12-31", maxDate = "0000-01-01";
      const allTradeRecords: { date: string; ticker: string; ePrice: number; magnetPrice: number; stopDist: number; bias: "BUY" | "SELL"; hit: boolean; mfe: number }[] = [];

      for (const bt of allBacktests) {
        if (bt.setupType !== bestSetup) continue;
        if (!topTickerSet.has(bt.ticker)) continue;
        const details = bt.details as any[] | null;
        if (!details) continue;
        for (const d of details) {
          if (!d.triggered || d.activated !== true) continue;
          const ePrice = (d.activationPrice && d.activationPrice > 0) ? d.activationPrice : d.entryPrice;
          if (!ePrice || ePrice <= 0) continue;
          const magnetPrice = d.magnetPrice;
          const stopDist = (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : ePrice * 0.01;
          allTradeRecords.push({
            date: d.date, ticker: bt.ticker, ePrice, magnetPrice, stopDist,
            bias: magnetPrice >= ePrice ? "BUY" : "SELL",
            hit: !!d.hit,
            mfe: d.mfe || 0,
          });
          if (d.date < minDate) minDate = d.date;
          if (d.date > maxDate) maxDate = d.date;
        }
      }

      function buildInstrumentPerf(label: string, trades: { date: string; ticker: string; pnl: number }[]) {
        if (trades.length === 0) return null;
        const wins = trades.filter(t => t.pnl > 0).length;
        const losses = trades.filter(t => t.pnl <= 0).length;
        const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
        let cumPnl = 0;
        const equityCurve = trades.map((t, i) => {
          cumPnl += t.pnl;
          return { trade: i + 1, date: t.date, ticker: t.ticker, pnl: t.pnl, cumPnl: Math.round(cumPnl * 100) / 100 };
        });
        const maxPoints = 500;
        let sampledCurve = equityCurve;
        if (equityCurve.length > maxPoints) {
          const step = Math.ceil(equityCurve.length / maxPoints);
          sampledCurve = equityCurve.filter((_, i) => i % step === 0 || i === equityCurve.length - 1);
        }
        const dailyMap = new Map<string, number>();
        for (const t of trades) {
          dailyMap.set(t.date, (dailyMap.get(t.date) ?? 0) + t.pnl);
        }
        const dailyPnl = Array.from(dailyMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, pnl]) => ({ date: date.slice(5), pnl: Math.round(pnl * 100) / 100 }));
        const best = trades.reduce((b, t) => t.pnl > b.pnl ? t : b);
        const worst = trades.reduce((w, t) => t.pnl < w.pnl ? t : w);
        return {
          instrument: label,
          totalTrades: trades.length,
          wins,
          losses,
          winRate: Math.round(wins / trades.length * 1000) / 10,
          totalPnl: Math.round(totalPnl * 100) / 100,
          avgPnl: Math.round(totalPnl / trades.length * 100) / 100,
          bestTrade: { ticker: best.ticker, pnl: Math.round(best.pnl * 100) / 100 },
          worstTrade: { ticker: worst.ticker, pnl: Math.round(worst.pnl * 100) / 100 },
          equityCurve: sampledCurve,
          dailyPnl,
        };
      }

      let shareTrades: { date: string; ticker: string; pnl: number }[] = [];
      let letfTrades: { date: string; ticker: string; pnl: number }[] = [];
      let optionTrades: { date: string; ticker: string; pnl: number }[] = [];
      let letfOptionTrades: { date: string; ticker: string; pnl: number }[] = [];
      let optOverCapital = 0, letfOptOverCapital = 0, optSkipped = 0, letfOptSkipped = 0;
      let shareOverCapital = 0, letfOverCapital = 0;

      if (cacheValid) {
        log(`ROI Insights: serving from cache (${cacheMeta!.tradeCount} cached records for ${bestSetup})`, "roi");
        const cached = await storage.getRoiTradeCache(bestSetup);
        for (const c of cached) {
          const t = { date: c.tradeDate, ticker: c.ticker, pnl: c.pnl };
          if (c.instrument === "SHARES") {
            shareTrades.push(t);
            if (c.overCapital) shareOverCapital++;
          } else if (c.instrument === "LEVERAGED_ETF") {
            letfTrades.push(t);
            if (c.overCapital) letfOverCapital++;
          } else if (c.instrument === "OPTIONS") {
            optionTrades.push(t);
            if (c.overCapital) optOverCapital++;
          } else if (c.instrument === "LETF_OPTIONS") {
            letfOptionTrades.push(t);
            if (c.overCapital) letfOptOverCapital++;
          }
        }
        optSkipped = Math.max(0, allTradeRecords.length - optionTrades.length);
        letfOptSkipped = Math.max(0, allTradeRecords.length - letfOptionTrades.length);
      } else {
        log(`ROI Insights: computing fresh (${allTradeRecords.length} trades for ${bestSetup})...`, "roi");
        await storage.upsertRoiCacheMeta(bestSetup, 0, "computing");

      const tickerLetfInfo = new Map<string, { bull: { ticker: string; leverage: number; direction: string } | null; bear: { ticker: string; leverage: number; direction: string } | null }>();
      const uniqueLetfTickers = new Set<string>();
      for (const tick of topTickerSet) {
        const bullCands = getCandidates(tick, "BUY");
        const bearCands = getCandidates(tick, "SELL");
        const bestBull = bullCands.sort((a, b) => b.leverage - a.leverage)[0] || null;
        const bestBear = bearCands.sort((a, b) => b.leverage - a.leverage)[0] || null;
        tickerLetfInfo.set(tick, {
          bull: bestBull ? { ticker: bestBull.ticker, leverage: bestBull.leverage, direction: bestBull.direction } : null,
          bear: bestBear ? { ticker: bestBear.ticker, leverage: bestBear.leverage, direction: bestBear.direction } : null,
        });
        if (bestBull) uniqueLetfTickers.add(bestBull.ticker);
        if (bestBear) uniqueLetfTickers.add(bestBear.ticker);
      }

      const letfBarMap = new Map<string, Map<string, number>>();
      if (allTradeRecords.length > 0 && uniqueLetfTickers.size > 0) {
        await Promise.all(Array.from(uniqueLetfTickers).map(async (letfTick) => {
          try {
            const bars = await fetchDailyBarsCached(letfTick, minDate, maxDate);
            const dateMap = new Map<string, number>();
            for (const bar of bars) {
              const barDate = new Date(bar.t).toISOString().slice(0, 10);
              dateMap.set(barDate, bar.c);
            }
            letfBarMap.set(letfTick, dateMap);
          } catch {}
        }));
      }

      function getThirdFriday(year: number, month: number): string {
        const d = new Date(Date.UTC(year, month, 1));
        const dow = d.getUTCDay();
        const firstFri = dow <= 5 ? (5 - dow + 1) : (12 - dow + 1);
        const tf = new Date(Date.UTC(year, month, firstFri + 14));
        return tf.toISOString().slice(0, 10);
      }

      function findTargetExpiry(tradeDate: string): string {
        const d = new Date(tradeDate + "T12:00:00Z");
        const cands: string[] = [];
        for (let off = 0; off <= 2; off++) {
          const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, 1));
          cands.push(getThirdFriday(dt.getUTCFullYear(), dt.getUTCMonth()));
        }
        let best = cands[0];
        let bestScore = Infinity;
        for (const c of cands) {
          const dte = (new Date(c + "T12:00:00Z").getTime() - d.getTime()) / 86400000;
          if (dte >= 7) {
            const score = Math.abs(dte - 21);
            if (score < bestScore) { best = c; bestScore = score; }
          }
        }
        return best;
      }

      function strikeIncrement(price: number): number {
        if (price <= 5) return 0.5;
        if (price <= 25) return 1;
        if (price <= 200) return 5;
        if (price <= 500) return 5;
        if (price <= 1000) return 10;
        return 50;
      }

      function nearbyStrikes(price: number): number[] {
        const inc = strikeIncrement(price);
        const base = Math.round(price / inc) * inc;
        const candidates = [base];
        for (let d = 1; d <= 2; d++) {
          candidates.push(base + inc * d);
          candidates.push(base - inc * d);
        }
        candidates.sort((a, b) => Math.abs(a - price) - Math.abs(b - price));
        return candidates.filter(s => s > 0);
      }

      function buildOptTicker(underlying: string, expiry: string, type: "C" | "P", strike: number): string {
        const yy = expiry.slice(2, 4);
        const mm = expiry.slice(5, 7);
        const dd = expiry.slice(8, 10);
        const strikeInt = Math.round(strike * 1000);
        return `O:${underlying}${yy}${mm}${dd}${type}${String(strikeInt).padStart(8, "0")}`;
      }

      const tradeOptCandidates: string[][] = [];
      const tradeLetfOptCandidates: (string[] | null)[] = [];
      const uniqueOptTickers = new Set<string>();

      for (let i = 0; i < allTradeRecords.length; i++) {
        const t = allTradeRecords[i];
        const expiry = findTargetExpiry(t.date);
        const cType: "C" | "P" = t.bias === "BUY" ? "C" : "P";

        const strikes = nearbyStrikes(t.ePrice);
        const cands = strikes.map(s => buildOptTicker(t.ticker, expiry, cType, s));
        tradeOptCandidates.push(cands);
        cands.forEach(c => uniqueOptTickers.add(c));

        const lInfo = tickerLetfInfo.get(t.ticker);
        const lCand = t.bias === "BUY" ? lInfo?.bull : lInfo?.bear;
        if (lCand) {
          const lBars = letfBarMap.get(lCand.ticker);
          const lClose = lBars?.get(t.date);
          if (lClose && lClose > 0) {
            const lStrikes = nearbyStrikes(lClose);
            const lCands = lStrikes.map(s => buildOptTicker(lCand.ticker, expiry, cType, s));
            tradeLetfOptCandidates.push(lCands);
            lCands.forEach(c => uniqueOptTickers.add(c));
          } else {
            tradeLetfOptCandidates.push(null);
          }
        } else {
          tradeLetfOptCandidates.push(null);
        }
      }

      const optBarMap = new Map<string, Map<string, number>>();
      if (uniqueOptTickers.size > 0) {
        const optList = Array.from(uniqueOptTickers);
        log(`ROI Insights: fetching daily bars for ${optList.length} option contracts...`, "roi");
        const batchSz = 20;
        for (let b = 0; b < optList.length; b += batchSz) {
          const chunk = optList.slice(b, b + batchSz);
          await Promise.all(chunk.map(async (oTick) => {
            try {
              const bars = await fetchDailyBarsCached(oTick, minDate, maxDate);
              const dMap = new Map<string, number>();
              for (const bar of bars) {
                dMap.set(new Date(bar.t).toISOString().slice(0, 10), bar.c);
              }
              if (dMap.size > 0) optBarMap.set(oTick, dMap);
            } catch {}
          }));
        }
        log(`ROI Insights: got bars for ${optBarMap.size}/${optList.length} option contracts`, "roi");
      }

      const cacheRecords: any[] = [];

      for (let i = 0; i < allTradeRecords.length; i++) {
        const { date, ticker, ePrice, magnetPrice, stopDist, bias, hit } = allTradeRecords[i];
        const rewardDist = Math.abs(magnetPrice - ePrice);
        const stopPrice = bias === "BUY" ? ePrice - stopDist : ePrice + stopDist;

        const sharesQty = Math.floor(capitalPerTrade / ePrice);
        const shareIsOverCapital = ePrice > capitalPerTrade;
        if (shareIsOverCapital) shareOverCapital++;
        if (sharesQty > 0) {
          const shareWin = Math.round(rewardDist * sharesQty * 100) / 100;
          const shareLoss = Math.round(-stopDist * sharesQty * 100) / 100;
          const sharePnl = hit ? shareWin : shareLoss;
          shareTrades.push({ date, ticker, pnl: sharePnl });
          cacheRecords.push({
            setupType: bestSetup, ticker, tradeDate: date, instrument: "SHARES",
            ePrice, magnetPrice, stopDist, bias, hit, pnl: sharePnl,
            contracts: sharesQty, instrumentTicker: ticker, entryPremium: null,
            overCapital: shareIsOverCapital, mfe: allTradeRecords[i].mfe, halfwayHit: false,
          });
        }

        let letfEntryPrice = 0, letfT1Price = 0, letfStopPx = 0, letfTick = "";
        const letfInfo = tickerLetfInfo.get(ticker);
        const letfCand = bias === "BUY" ? letfInfo?.bull : letfInfo?.bear;
        if (letfCand) {
          const letfBars = letfBarMap.get(letfCand.ticker);
          const letfClose = letfBars?.get(date);
          if (letfClose && letfClose > 0) {
            const effLev = letfCand.direction === "BEAR" ? -letfCand.leverage : letfCand.leverage;
            const letfShares = Math.floor(capitalPerTrade / letfClose);
            if (letfShares > 0) {
              letfT1Price = letfClose * (1 + effLev * (magnetPrice - ePrice) / ePrice);
              letfStopPx = letfClose * (1 + effLev * (stopPrice - ePrice) / ePrice);
              const letfPnl = hit ? Math.round((letfT1Price - letfClose) * letfShares * 100) / 100 : Math.round((letfStopPx - letfClose) * letfShares * 100) / 100;
              const letfIsOverCapital = letfClose > capitalPerTrade;
              if (letfIsOverCapital) letfOverCapital++;
              letfTrades.push({ date, ticker, pnl: letfPnl });
              cacheRecords.push({
                setupType: bestSetup, ticker, tradeDate: date, instrument: "LEVERAGED_ETF",
                ePrice, magnetPrice, stopDist, bias, hit, pnl: letfPnl,
                contracts: letfShares, instrumentTicker: letfCand.ticker, entryPremium: letfClose,
                overCapital: letfIsOverCapital, mfe: allTradeRecords[i].mfe, halfwayHit: false,
              });
              letfEntryPrice = letfClose;
              letfTick = letfCand.ticker;
            }
          }
        }

        const optCands = tradeOptCandidates[i];
        let optHandled = false;
        if (optCands) {
          for (const optTick of optCands) {
            const oBars = optBarMap.get(optTick);
            const premium = oBars?.get(date);
            if (premium && premium > 0) {
              const costPerContract = premium * 100;
              const optIsOverCapital = costPerContract > capitalPerTrade;
              if (optIsOverCapital) optOverCapital++;
              const contracts = Math.max(1, Math.floor(capitalPerTrade / costPerContract));
              const delta = 0.50;
              const optT1Premium = premium + Math.abs(magnetPrice - ePrice) * delta;
              const optStopPremium = Math.max(0.01, premium - stopDist * delta);
              const optHalfwayPremium = premium + (optT1Premium - premium) / 2;
              const halfwayUnderlyingDist = (optHalfwayPremium - premium) / delta;
              const mfeAbsolute = allTradeRecords[i].mfe * ePrice;
              const halfwayHit = mfeAbsolute >= halfwayUnderlyingDist && halfwayUnderlyingDist > 0;

              let optPnl = 0;
              if (hit) {
                optPnl = (optT1Premium - premium) * contracts * 100;
              } else if (halfwayHit) {
                const halfContracts = Math.floor(contracts / 2);
                const halfProfit = (optHalfwayPremium - premium) * halfContracts * 100;
                optPnl = halfProfit;
              } else {
                optPnl = (optStopPremium - premium) * contracts * 100;
              }

              const roundedOptPnl = Math.round(optPnl * 100) / 100;
              optionTrades.push({ date, ticker, pnl: roundedOptPnl });
              cacheRecords.push({
                setupType: bestSetup, ticker, tradeDate: date, instrument: "OPTIONS",
                ePrice, magnetPrice, stopDist, bias, hit, pnl: roundedOptPnl,
                contracts, instrumentTicker: optTick, entryPremium: premium,
                overCapital: optIsOverCapital, mfe: allTradeRecords[i].mfe, halfwayHit,
              });
              optHandled = true;
              break;
            }
          }
          if (!optHandled) optSkipped++;
        }

        if (letfEntryPrice > 0 && letfTick) {
          const lOptCands = tradeLetfOptCandidates[i];
          if (lOptCands) {
            let lOptHandled = false;
            for (const lOptTick of lOptCands) {
              const loBars = optBarMap.get(lOptTick);
              const lPremium = loBars?.get(date);
              if (lPremium && lPremium > 0) {
                const lCost = lPremium * 100;
                const lOptIsOverCapital = lCost > capitalPerTrade;
                if (lOptIsOverCapital) letfOptOverCapital++;
                const lContracts = Math.max(1, Math.floor(capitalPerTrade / lCost));
                const delta = 0.50;
                const lOptT1Premium = lPremium + Math.abs(letfT1Price - letfEntryPrice) * delta;
                const lOptStopPremium = Math.max(0.01, lPremium - Math.abs(letfEntryPrice - letfStopPx) * delta);
                const lOptHalfwayPremium = lPremium + (lOptT1Premium - lPremium) / 2;
                const lHalfwayUnderlyingDist = (lOptHalfwayPremium - lPremium) / delta;
                const lMfeAbsolute = allTradeRecords[i].mfe * ePrice;
                const effLev2 = letfEntryPrice > 0 ? Math.abs(letfT1Price - letfEntryPrice) / Math.abs(magnetPrice - ePrice) : 1;
                const lHalfwayHit = (lMfeAbsolute * effLev2) >= lHalfwayUnderlyingDist && lHalfwayUnderlyingDist > 0;

                let lOptPnl = 0;
                if (hit) {
                  lOptPnl = (lOptT1Premium - lPremium) * lContracts * 100;
                } else if (lHalfwayHit) {
                  const lHalfContracts = Math.floor(lContracts / 2);
                  const lHalfProfit = (lOptHalfwayPremium - lPremium) * lHalfContracts * 100;
                  lOptPnl = lHalfProfit;
                } else {
                  lOptPnl = (lOptStopPremium - lPremium) * lContracts * 100;
                }

                const roundedLOptPnl = Math.round(lOptPnl * 100) / 100;
                letfOptionTrades.push({ date, ticker, pnl: roundedLOptPnl });
                cacheRecords.push({
                  setupType: bestSetup, ticker, tradeDate: date, instrument: "LETF_OPTIONS",
                  ePrice, magnetPrice, stopDist, bias, hit, pnl: roundedLOptPnl,
                  contracts: lContracts, instrumentTicker: lOptTick, entryPremium: lPremium,
                  overCapital: lOptIsOverCapital, mfe: allTradeRecords[i].mfe, halfwayHit: lHalfwayHit,
                });
                lOptHandled = true;
                break;
              }
            }
            if (!lOptHandled) letfOptSkipped++;
          }
        }
      }

        await storage.clearRoiTradeCache(bestSetup);
        await storage.upsertRoiTradeCacheBatch(cacheRecords);
        await storage.upsertRoiCacheMeta(bestSetup, cacheRecords.length, "ready");
        log(`ROI Insights: cached ${cacheRecords.length} trade records for setup ${bestSetup}`, "roi");
      }

      shareTrades.sort((a, b) => a.date.localeCompare(b.date));
      letfTrades.sort((a, b) => a.date.localeCompare(b.date));
      optionTrades.sort((a, b) => a.date.localeCompare(b.date));
      letfOptionTrades.sort((a, b) => a.date.localeCompare(b.date));

      const strategyPerformance = buildInstrumentPerf("SHARES", shareTrades);

      const instrumentBreakdown = [
        buildInstrumentPerf("SHARES", shareTrades),
        buildInstrumentPerf("LEVERAGED_ETF", letfTrades),
        buildInstrumentPerf("OPTIONS", optionTrades),
        buildInstrumentPerf("LETF_OPTIONS", letfOptionTrades),
      ].filter(Boolean);

      log(`ROI Insights: Shares ${shareTrades.length} (${shareOverCapital} >$1K), LETF ${letfTrades.length} (${letfOverCapital} >$1K), Options ${optionTrades.length} (${optSkipped} skipped, ${optOverCapital} >$1K), LETF Options ${letfOptionTrades.length} (${letfOptSkipped} skipped, ${letfOptOverCapital} >$1K)`, "roi");

      res.json({
        totalBacktestTrades: Object.values(bySetup).reduce((s, b) => s + b.count, 0),
        totalActivatedTrades: totalActivated,
        overallActivatedWinRate: totalActivated > 0 ? Math.round(totalActivatedWins / totalActivated * 1000) / 10 : 0,
        setupRankings,
        bestSetup,
        topTickers,
        avoidTickers,
        qualityScoreBreakdown,
        strategyPerformance,
        instrumentBreakdown,
        optionsOverCapital: optOverCapital,
        optionsSkipped: optSkipped,
        letfOptionsOverCapital: letfOptOverCapital,
        letfOptionsSkipped: letfOptSkipped,
        sharesOverCapital: shareOverCapital,
        letfOverCapital,
        cacheStatus: cacheValid ? "cached" : "fresh",
        cachedAt: cacheMeta?.computedAt ?? null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/roi-insights/rebuild", async (_req, res) => {
    try {
      const allSetups = ["A", "B", "C", "D", "E", "F"];
      for (const s of allSetups) {
        await storage.upsertRoiCacheMeta(s, 0, "stale");
      }
      await storage.clearRoiTradeCache();
      res.json({ message: "ROI cache cleared. Next page load will recompute." });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Performance ½ — Split Take-Profit Study ──

  app.get("/api/performance-half/analysis", async (req, res) => {
    try {
      const allSignals = await storage.getSignals(undefined, 10000);
      const allTrades = await storage.getAllIbkrTrades();
      const allBacktests = await storage.getBacktests();

      const capitalPerTrade = parseFloat(req.query.capital as string) || 1000;
      const now = new Date();

      const TIER_RANK: Record<string, number> = { APLUS: 0, A: 1, B: 2, C: 3 };

      const activeProfile = await storage.getActiveProfile();

      let setupStatsMap = new Map<string, { sampleSize: number; winRate: number; expectancyR: number }>();
      try {
        const overallStats = await storage.getOverallSetupExpectancy();
        for (const s of overallStats) {
          if (!s.ticker) {
            setupStatsMap.set(s.setupType, {
              sampleSize: s.sampleSize,
              winRate: s.winRate,
              expectancyR: s.expectancyR,
            });
          }
        }
      } catch {}

      const matchesProfile = (sig: any): boolean => {
        if (!activeProfile) return true;
        if (!activeProfile.allowedSetups.includes(sig.setupType)) return false;
        const sigTierRank = TIER_RANK[sig.tier] ?? 3;
        const minTierRank = TIER_RANK[activeProfile.minTier] ?? 3;
        if (sigTierRank > minTierRank) return false;
        if (sig.qualityScore < activeProfile.minQualityScore) return false;
        const stat = setupStatsMap.get(sig.setupType);
        if (stat) {
          if (activeProfile.minSampleSize > 0 && stat.sampleSize < activeProfile.minSampleSize) return false;
          if (activeProfile.minHitRate > 0 && stat.winRate < activeProfile.minHitRate) return false;
          if (activeProfile.minExpectancyR > 0 && stat.expectancyR < activeProfile.minExpectancyR) return false;
        } else if (activeProfile.minSampleSize > 0 || activeProfile.minHitRate > 0 || activeProfile.minExpectancyR > 0) {
          return false;
        }
        return true;
      };

      const t1OnlyResults: any[] = [];
      const splitResults: any[] = [];
      const activatedT1Results: any[] = [];
      const activatedSplitResults: any[] = [];
      const mktHoursT1Results: any[] = [];
      const mktHoursSplitResults: any[] = [];

      const isWithinRTH = (ts: string | null | undefined): boolean => {
        if (!ts) return false;
        const dt = new Date(ts);
        const etOffset = -5;
        const utcH = dt.getUTCHours();
        const utcM = dt.getUTCMinutes();
        const etMinutes = ((utcH + etOffset + 24) % 24) * 60 + utcM;
        return etMinutes >= 570 && etMinutes <= 960;
      };

      const signalDateKeys = new Set<string>();

      for (const sig of allSignals) {
        const tp = sig.tradePlanJson as any;
        if (!tp) continue;

        const isHit = sig.status === "hit";
        const isMiss = sig.status === "miss" || sig.status === "invalidated" || sig.status === "stopped";
        if (!isHit && !isMiss) continue;

        if (!matchesProfile(sig)) continue;

        const ibkrTrade = allTrades.find(t => t.signalId === sig.id);
        const wasActivated = (sig.activationStatus === "ACTIVE" || sig.activationStatus === "INVALIDATED")
          || (sig.entryPriceAtActivation != null && sig.entryPriceAtActivation > 0)
          || (sig.activatedTs != null)
          || !!ibkrTrade;

        const stopDist = tp.stopDistance || 0;
        const bias = tp.bias as string | undefined;

        let entryPrice: number;
        if (sig.entryPriceAtActivation && sig.entryPriceAtActivation > 0) {
          entryPrice = sig.entryPriceAtActivation;
        } else if (sig.stopPrice && sig.stopPrice > 0 && stopDist > 0) {
          entryPrice = bias === "BUY"
            ? sig.stopPrice + stopDist
            : sig.stopPrice - stopDist;
        } else if (tp.riskReward && stopDist > 0 && sig.magnetPrice > 0) {
          entryPrice = bias === "BUY"
            ? sig.magnetPrice - (tp.riskReward * stopDist)
            : sig.magnetPrice + (tp.riskReward * stopDist);
        } else {
          continue;
        }

        if (entryPrice <= 0) continue;

        const shares = Math.floor(capitalPerTrade / entryPrice);
        if (shares <= 0) continue;
        const actualInvested = shares * entryPrice;

        const signalDate = sig.hitTs
          ? new Date(sig.hitTs).toISOString().slice(0, 10)
          : sig.targetDate;

        signalDateKeys.add(`${sig.ticker}:${sig.setupType}:${signalDate}`);

        const t1Price = tp.t1 || sig.magnetPrice;
        const halfwayPrice = bias === "BUY"
          ? entryPrice + (t1Price - entryPrice) / 2
          : entryPrice - (entryPrice - t1Price) / 2;

        let t1Pnl = 0;
        let t1Exit: number | null = null;
        let t1Outcome = "MISS";
        if (isHit && t1Price) {
          t1Exit = t1Price;
          const diff = bias === "BUY"
            ? (t1Exit - entryPrice) * shares
            : (entryPrice - t1Exit) * shares;
          t1Pnl = diff;
          t1Outcome = "HIT_T1";
        } else if (isMiss) {
          const sd = stopDist || (entryPrice * 0.01);
          t1Exit = bias === "BUY" ? entryPrice - sd : entryPrice + sd;
          t1Pnl = -sd * shares;
          t1Outcome = "STOPPED";
        }

        const t1Row = {
          signalId: sig.id,
          ticker: sig.ticker,
          setupType: sig.setupType,
          direction: sig.direction,
          bias: bias || sig.direction,
          instrumentType: sig.instrumentType || "OPTION",
          date: signalDate,
          entryPrice: Math.round(entryPrice * 100) / 100,
          exitPrice: t1Exit ? Math.round(t1Exit * 100) / 100 : null,
          shares,
          invested: Math.round(actualInvested * 100) / 100,
          pnlDollar: Math.round(t1Pnl * 100) / 100,
          pnlPct: Math.round((t1Pnl / actualInvested) * 10000) / 100,
          outcome: t1Outcome,
          source: "signal",
        };
        t1OnlyResults.push(t1Row);
        if (wasActivated) activatedT1Results.push(t1Row);
        const sigInRTH = isHit ? isWithinRTH(sig.hitTs as string | null) : true;
        if (sigInRTH) mktHoursT1Results.push(t1Row);

        const halfShares = Math.floor(shares / 2);
        const remainShares = shares - halfShares;

        let splitPnl = 0;
        let splitOutcome = "MISS";
        let halfwayHit = false;

        if (isHit) {
          const halfLegPnl = bias === "BUY"
            ? (halfwayPrice - entryPrice) * halfShares
            : (entryPrice - halfwayPrice) * halfShares;
          const remainLegPnl = bias === "BUY"
            ? (t1Price - entryPrice) * remainShares
            : (entryPrice - t1Price) * remainShares;
          splitPnl = halfLegPnl + remainLegPnl;
          splitOutcome = "HIT_T1";
          halfwayHit = true;
        } else if (isMiss) {
          const sd = stopDist || (entryPrice * 0.01);
          const mfe = (sig as any).mfe || 0;
          const mfeAbsolute = mfe * entryPrice;
          const halfwayDist = Math.abs(halfwayPrice - entryPrice);

          if (mfeAbsolute >= halfwayDist && halfwayDist > 0) {
            halfwayHit = true;
            const halfLegPnl = bias === "BUY"
              ? (halfwayPrice - entryPrice) * halfShares
              : (entryPrice - halfwayPrice) * halfShares;
            const remainLegPnl = 0;
            splitPnl = halfLegPnl + remainLegPnl;
            splitOutcome = "PARTIAL";
          } else {
            splitPnl = -sd * shares;
            splitOutcome = "STOPPED";
          }
        }

        const splitRow = {
          signalId: sig.id,
          ticker: sig.ticker,
          setupType: sig.setupType,
          direction: sig.direction,
          bias: bias || sig.direction,
          instrumentType: sig.instrumentType || "OPTION",
          date: signalDate,
          entryPrice: Math.round(entryPrice * 100) / 100,
          halfwayPrice: Math.round(halfwayPrice * 100) / 100,
          t1Price: Math.round(t1Price * 100) / 100,
          shares,
          halfShares,
          remainShares,
          invested: Math.round(actualInvested * 100) / 100,
          pnlDollar: Math.round(splitPnl * 100) / 100,
          pnlPct: Math.round((splitPnl / actualInvested) * 10000) / 100,
          outcome: splitOutcome,
          halfwayHit,
          source: "signal",
        };
        splitResults.push(splitRow);
        if (wasActivated) activatedSplitResults.push(splitRow);
        if (sigInRTH) mktHoursSplitResults.push(splitRow);
      }

      const seenBacktestKeys = new Set<string>();
      const latestBacktests = new Map<string, typeof allBacktests[0]>();
      for (const bt of allBacktests) {
        const key = `${bt.ticker}:${bt.setupType}`;
        const existing = latestBacktests.get(key);
        if (!existing || bt.id > existing.id) {
          latestBacktests.set(key, bt);
        }
      }

      let btIdCounter = -1;
      for (const bt of latestBacktests.values()) {
        const details = bt.details as any[] | null;
        if (!details) continue;

        for (const d of details) {
          if (!d.triggered) continue;
          if (!d.entryPrice || d.entryPrice <= 0) continue;
          if (!d.date) continue;

          const dateKey = `${bt.ticker}:${bt.setupType}:${d.date}`;
          if (signalDateKeys.has(dateKey)) continue;
          if (seenBacktestKeys.has(dateKey)) continue;
          seenBacktestKeys.add(dateKey);

          const entryPrice = d.entryPrice;
          const magnetPrice = d.magnetPrice;
          const bias = magnetPrice >= entryPrice ? "BUY" : "SELL";
          const stopDist = (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : entryPrice * 0.01;

          const shares = Math.floor(capitalPerTrade / entryPrice);
          if (shares <= 0) continue;
          const actualInvested = shares * entryPrice;

          const halfwayPrice = bias === "BUY"
            ? entryPrice + (magnetPrice - entryPrice) / 2
            : entryPrice - (entryPrice - magnetPrice) / 2;

          let t1Pnl: number;
          let t1Outcome: string;
          let t1ExitPrice: number;
          if (d.hit) {
            t1ExitPrice = magnetPrice;
            const diff = bias === "BUY"
              ? (t1ExitPrice - entryPrice) * shares
              : (entryPrice - t1ExitPrice) * shares;
            t1Pnl = diff;
            t1Outcome = "HIT_T1";
          } else {
            t1ExitPrice = bias === "BUY" ? entryPrice - stopDist : entryPrice + stopDist;
            t1Pnl = -stopDist * shares;
            t1Outcome = "STOPPED";
          }

          const id = btIdCounter--;
          const btInRTH = d.hit
            ? (d.timeToHitMin == null || (d.timeToHitMin >= 0 && d.timeToHitMin <= 390))
            : true;

          const btActivated = d.activated === true;
          let btEntryForActivated = entryPrice;
          if (btActivated && d.activationPrice && d.activationPrice > 0) {
            btEntryForActivated = d.activationPrice;
          }

          const btT1Row = {
            signalId: id,
            ticker: bt.ticker,
            setupType: bt.setupType,
            direction: bias === "BUY" ? "BULLISH" : "BEARISH",
            bias,
            instrumentType: "SHARES",
            date: d.date,
            entryPrice: Math.round(entryPrice * 100) / 100,
            exitPrice: Math.round(t1ExitPrice * 100) / 100,
            shares,
            invested: Math.round(actualInvested * 100) / 100,
            pnlDollar: Math.round(t1Pnl * 100) / 100,
            pnlPct: Math.round((t1Pnl / actualInvested) * 10000) / 100,
            outcome: t1Outcome,
            source: "backtest",
          };
          t1OnlyResults.push(btT1Row);
          if (btInRTH) mktHoursT1Results.push(btT1Row);

          if (btActivated) {
            const actEntry = btEntryForActivated;
            const actShares = Math.floor(capitalPerTrade / actEntry);
            if (actShares > 0) {
              const actInvested = actShares * actEntry;
              let actT1Pnl: number;
              let actT1Exit: number;
              let actT1Outcome: string;
              if (d.hit) {
                actT1Exit = magnetPrice;
                actT1Pnl = bias === "BUY"
                  ? (actT1Exit - actEntry) * actShares
                  : (actEntry - actT1Exit) * actShares;
                actT1Outcome = "HIT_T1";
              } else {
                const actStopDist = (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : actEntry * 0.01;
                actT1Exit = bias === "BUY" ? actEntry - actStopDist : actEntry + actStopDist;
                actT1Pnl = -actStopDist * actShares;
                actT1Outcome = "STOPPED";
              }
              activatedT1Results.push({
                signalId: id,
                ticker: bt.ticker,
                setupType: bt.setupType,
                direction: bias === "BUY" ? "BULLISH" : "BEARISH",
                bias,
                instrumentType: "SHARES",
                date: d.date,
                entryPrice: Math.round(actEntry * 100) / 100,
                exitPrice: Math.round(actT1Exit * 100) / 100,
                shares: actShares,
                invested: Math.round(actInvested * 100) / 100,
                pnlDollar: Math.round(actT1Pnl * 100) / 100,
                pnlPct: Math.round((actT1Pnl / actInvested) * 10000) / 100,
                outcome: actT1Outcome,
                source: "backtest",
              });
            }
          }

          const halfShares = Math.floor(shares / 2);
          const remainShares = shares - halfShares;

          let splitPnl: number;
          let splitOutcome: string;
          let halfwayHit = false;

          if (d.hit) {
            const halfLegPnl = bias === "BUY"
              ? (halfwayPrice - entryPrice) * halfShares
              : (entryPrice - halfwayPrice) * halfShares;
            const remainLegPnl = bias === "BUY"
              ? (magnetPrice - entryPrice) * remainShares
              : (entryPrice - magnetPrice) * remainShares;
            splitPnl = halfLegPnl + remainLegPnl;
            splitOutcome = "HIT_T1";
            halfwayHit = true;
          } else {
            const mfe = d.mfe || 0;
            const mfeAbsolute = mfe * entryPrice;
            const halfwayDist = Math.abs(halfwayPrice - entryPrice);

            if (mfeAbsolute >= halfwayDist && halfwayDist > 0) {
              halfwayHit = true;
              const halfLegPnl = bias === "BUY"
                ? (halfwayPrice - entryPrice) * halfShares
                : (entryPrice - halfwayPrice) * halfShares;
              const remainLegPnl = 0;
              splitPnl = halfLegPnl + remainLegPnl;
              splitOutcome = "PARTIAL";
            } else {
              splitPnl = -stopDist * shares;
              splitOutcome = "STOPPED";
            }
          }

          const btSplitRow = {
            signalId: id,
            ticker: bt.ticker,
            setupType: bt.setupType,
            direction: bias === "BUY" ? "BULLISH" : "BEARISH",
            bias,
            instrumentType: "SHARES",
            date: d.date,
            entryPrice: Math.round(entryPrice * 100) / 100,
            halfwayPrice: Math.round(halfwayPrice * 100) / 100,
            t1Price: Math.round(magnetPrice * 100) / 100,
            shares,
            halfShares,
            remainShares,
            invested: Math.round(actualInvested * 100) / 100,
            pnlDollar: Math.round(splitPnl * 100) / 100,
            pnlPct: Math.round((splitPnl / actualInvested) * 10000) / 100,
            outcome: splitOutcome,
            halfwayHit,
            source: "backtest",
          };
          splitResults.push(btSplitRow);
          if (btInRTH) mktHoursSplitResults.push(btSplitRow);

          if (btActivated) {
            const actEntry = btEntryForActivated;
            const actShares = Math.floor(capitalPerTrade / actEntry);
            if (actShares > 0) {
              const actInvested = actShares * actEntry;
              const actHalfShares = Math.floor(actShares / 2);
              const actRemainShares = actShares - actHalfShares;
              const actHalfwayPrice = bias === "BUY"
                ? actEntry + (magnetPrice - actEntry) / 2
                : actEntry - (actEntry - magnetPrice) / 2;

              let actSplitPnl: number;
              let actSplitOutcome: string;
              let actHalfwayHit = false;

              if (d.hit) {
                const halfLeg = bias === "BUY"
                  ? (actHalfwayPrice - actEntry) * actHalfShares
                  : (actEntry - actHalfwayPrice) * actHalfShares;
                const remainLeg = bias === "BUY"
                  ? (magnetPrice - actEntry) * actRemainShares
                  : (actEntry - magnetPrice) * actRemainShares;
                actSplitPnl = halfLeg + remainLeg;
                actSplitOutcome = "HIT_T1";
                actHalfwayHit = true;
              } else {
                const mfeVal = d.mfe || 0;
                const mfeAbs = mfeVal * actEntry;
                const halfDist = Math.abs(actHalfwayPrice - actEntry);
                if (mfeAbs >= halfDist && halfDist > 0) {
                  actHalfwayHit = true;
                  const halfLeg = bias === "BUY"
                    ? (actHalfwayPrice - actEntry) * actHalfShares
                    : (actEntry - actHalfwayPrice) * actHalfShares;
                  actSplitPnl = halfLeg;
                  actSplitOutcome = "PARTIAL";
                } else {
                  const actStopDist = (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : actEntry * 0.01;
                  actSplitPnl = -actStopDist * actShares;
                  actSplitOutcome = "STOPPED";
                }
              }

              activatedSplitResults.push({
                signalId: id,
                ticker: bt.ticker,
                setupType: bt.setupType,
                direction: bias === "BUY" ? "BULLISH" : "BEARISH",
                bias,
                instrumentType: "SHARES",
                date: d.date,
                entryPrice: Math.round(actEntry * 100) / 100,
                halfwayPrice: Math.round(actHalfwayPrice * 100) / 100,
                t1Price: Math.round(magnetPrice * 100) / 100,
                shares: actShares,
                halfShares: actHalfShares,
                remainShares: actRemainShares,
                invested: Math.round(actInvested * 100) / 100,
                pnlDollar: Math.round(actSplitPnl * 100) / 100,
                pnlPct: Math.round((actSplitPnl / actInvested) * 10000) / 100,
                outcome: actSplitOutcome,
                halfwayHit: actHalfwayHit,
                source: "backtest",
              });
            }
          }
        }
      }

      t1OnlyResults.sort((a, b) => a.date.localeCompare(b.date));
      splitResults.sort((a, b) => a.date.localeCompare(b.date));

      const buildCurve = (trades: any[]) => {
        let cumPnl = 0;
        return trades.map((t, i) => {
          cumPnl += t.pnlDollar;
          return { trade: i + 1, date: t.date, ticker: t.ticker, pnl: Math.round(t.pnlDollar * 100) / 100, cumPnl: Math.round(cumPnl * 100) / 100 };
        });
      };

      const buildSummary = (trades: any[]) => {
        const totalTrades = trades.length;
        const wins = trades.filter(t => t.outcome === "HIT_T1").length;
        const partials = trades.filter(t => t.outcome === "PARTIAL").length;
        const losses = trades.filter(t => t.outcome === "STOPPED").length;
        const totalPnl = trades.reduce((s, t) => s + t.pnlDollar, 0);
        const totalInvested = trades.reduce((s, t) => s + t.invested, 0);
        const maxConcurrent = Math.min(totalTrades, 10);
        const capitalRequired = maxConcurrent * capitalPerTrade;
        const winRate = totalTrades > 0 ? wins / totalTrades : 0;
        const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
        const uniqueDays = new Set(trades.map(t => t.date)).size;
        const avgDailyTrades = uniqueDays > 0 ? Math.round((totalTrades / uniqueDays) * 10) / 10 : 0;
        return {
          totalTrades,
          wins,
          partials,
          losses,
          totalPnl: Math.round(totalPnl * 100) / 100,
          totalInvested: Math.round(totalInvested * 100) / 100,
          capitalRequired,
          winRate: Math.round(winRate * 1000) / 10,
          avgPnlPerTrade: Math.round(avgPnl * 100) / 100,
          roiOnCapital: capitalRequired > 0 ? Math.round((totalPnl / capitalRequired) * 10000) / 100 : 0,
          edgePct: totalInvested > 0 ? Math.round((totalPnl / totalInvested) * 10000) / 100 : 0,
          avgDailyTrades,
          tradingDays: uniqueDays,
        };
      };

      const maxCurvePoints = 500;
      const sampleCurve = (curve: any[]) => {
        if (curve.length <= maxCurvePoints) return curve;
        const step = Math.ceil(curve.length / maxCurvePoints);
        return curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
      };

      const period = parseInt(req.query.period as string ?? "4");
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string) || 100));

      const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);
      const cutoff60 = new Date(now); cutoff60.setDate(cutoff60.getDate() - 60);
      const cutoff90 = new Date(now); cutoff90.setDate(cutoff90.getDate() - 90);
      const c30 = cutoff30.toISOString().slice(0, 10);
      const c60 = cutoff60.toISOString().slice(0, 10);
      const c90 = cutoff90.toISOString().slice(0, 10);

      const filterByPeriod = (trades: any[], p: number) => {
        if (p === 0) return trades.filter(t => t.date >= c30);
        if (p === 1) return trades.filter(t => t.date >= c60 && t.date < c30);
        if (p === 2) return trades.filter(t => t.date >= c90 && t.date < c60);
        if (p === 3) return trades.filter(t => t.date < c90);
        return trades;
      };

      activatedT1Results.sort((a, b) => a.date.localeCompare(b.date));
      activatedSplitResults.sort((a, b) => a.date.localeCompare(b.date));
      mktHoursT1Results.sort((a, b) => a.date.localeCompare(b.date));
      mktHoursSplitResults.sort((a, b) => a.date.localeCompare(b.date));

      const filteredT1 = filterByPeriod(t1OnlyResults, period);
      const filteredSplit = filterByPeriod(splitResults, period);
      const filteredActT1 = filterByPeriod(activatedT1Results, period);
      const filteredActSplit = filterByPeriod(activatedSplitResults, period);
      const filteredMktT1 = filterByPeriod(mktHoursT1Results, period);
      const filteredMktSplit = filterByPeriod(mktHoursSplitResults, period);

      const t1Curve = buildCurve(filteredT1);
      const splitCurve = buildCurve(filteredSplit);
      const actT1Curve = buildCurve(filteredActT1);
      const actSplitCurve = buildCurve(filteredActSplit);
      const mktT1Curve = buildCurve(filteredMktT1);
      const mktSplitCurve = buildCurve(filteredMktSplit);

      const t1Summary = buildSummary(filteredT1);
      const splitSummary = buildSummary(filteredSplit);
      const actT1Summary = buildSummary(filteredActT1);
      const actSplitSummary = buildSummary(filteredActSplit);
      const mktT1Summary = buildSummary(filteredMktT1);
      const mktSplitSummary = buildSummary(filteredMktSplit);

      const halfwayHitCount = filteredSplit.filter(t => t.halfwayHit).length;
      const halfwayHitRate = filteredSplit.length > 0
        ? Math.round((halfwayHitCount / filteredSplit.length) * 1000) / 10
        : 0;

      const actHalfwayHitCount = filteredActSplit.filter(t => t.halfwayHit).length;
      const actHalfwayHitRate = filteredActSplit.length > 0
        ? Math.round((actHalfwayHitCount / filteredActSplit.length) * 1000) / 10
        : 0;

      const mktHalfwayHitCount = filteredMktSplit.filter(t => t.halfwayHit).length;
      const mktHalfwayHitRate = filteredMktSplit.length > 0
        ? Math.round((mktHalfwayHitCount / filteredMktSplit.length) * 1000) / 10
        : 0;

      const totalFilteredTrades = filteredSplit.length;
      const totalPages = Math.ceil(totalFilteredTrades / pageSize);
      const paginatedTrades = [...filteredSplit].sort((a, b) => b.date.localeCompare(a.date)).slice((page - 1) * pageSize, page * pageSize);

      res.json({
        capitalPerTrade,
        totalResolvedTrades: splitResults.length,
        halfwayHitCount,
        halfwayHitRate,
        t1OnlySummary: t1Summary,
        splitSummary,
        deltaPnl: Math.round((splitSummary.totalPnl - t1Summary.totalPnl) * 100) / 100,
        deltaPct: t1Summary.totalPnl !== 0
          ? Math.round(((splitSummary.totalPnl - t1Summary.totalPnl) / Math.abs(t1Summary.totalPnl)) * 10000) / 100
          : 0,
        activated: {
          totalResolvedTrades: activatedSplitResults.length,
          halfwayHitCount: actHalfwayHitCount,
          halfwayHitRate: actHalfwayHitRate,
          t1OnlySummary: actT1Summary,
          splitSummary: actSplitSummary,
          deltaPnl: Math.round((actSplitSummary.totalPnl - actT1Summary.totalPnl) * 100) / 100,
          deltaPct: actT1Summary.totalPnl !== 0
            ? Math.round(((actSplitSummary.totalPnl - actT1Summary.totalPnl) / Math.abs(actT1Summary.totalPnl)) * 10000) / 100
            : 0,
          t1Curve: sampleCurve(actT1Curve),
          splitCurve: sampleCurve(actSplitCurve),
        },
        marketHours: {
          totalResolvedTrades: mktHoursSplitResults.length,
          halfwayHitCount: mktHalfwayHitCount,
          halfwayHitRate: mktHalfwayHitRate,
          t1OnlySummary: mktT1Summary,
          splitSummary: mktSplitSummary,
          deltaPnl: Math.round((mktSplitSummary.totalPnl - mktT1Summary.totalPnl) * 100) / 100,
          deltaPct: mktT1Summary.totalPnl !== 0
            ? Math.round(((mktSplitSummary.totalPnl - mktT1Summary.totalPnl) / Math.abs(mktT1Summary.totalPnl)) * 10000) / 100
            : 0,
          t1Curve: sampleCurve(mktT1Curve),
          splitCurve: sampleCurve(mktSplitCurve),
        },
        t1Curve: sampleCurve(t1Curve),
        splitCurve: sampleCurve(splitCurve),
        trades: paginatedTrades,
        pagination: { page, pageSize, totalFilteredTrades, totalPages },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/backtests/backfill-activation", async (req, res) => {
    try {
      const batchSize = parseInt(req.query.batch as string) || 200;
      const allBacktests = await storage.getBacktests();
      let enriched = 0;
      let skipped = 0;
      let processed = 0;
      let remaining = 0;
      let apiFetches = 0;
      let activatedCount = 0;
      let notActivatedCount = 0;

      for (const bt of allBacktests) {
        if (processed >= batchSize) {
          const leftDetails = (bt.details as any[] | null) ?? [];
          const leftUndef = leftDetails.filter((dd: any) => dd.triggered && dd.activated === undefined).length;
          remaining += leftUndef;
          continue;
        }

        const details = bt.details as any[] | null;
        if (!details || details.length === 0) { skipped++; continue; }

        const needsWork = details.some((dd: any) => dd.triggered && dd.activated === undefined);
        if (!needsWork) { skipped++; continue; }

        let modified = false;
        const updatedDetails = [];

        for (const d of details) {
          if (!d.triggered || d.activated !== undefined) {
            updatedDetails.push(d);
            continue;
          }

          if (processed >= batchSize) {
            updatedDetails.push(d);
            remaining++;
            continue;
          }

          processed++;

          let intradayBars: any[] = await storage.getIntradayBars(bt.ticker, d.date, "5");
          if (intradayBars.length === 0) {
            try {
              apiFetches++;
              const cachedBars = await fetchIntradayBarsCached(bt.ticker, d.date, d.date, "5");
              if (cachedBars.length > 0) {
                intradayBars = cachedBars.map((b: any) => ({
                  ts: new Date(b.t).toISOString(),
                  open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
                }));
              }
            } catch {}
          }
          if (intradayBars.length === 0) {
            updatedDetails.push({ ...d, activated: false });
            notActivatedCount++;
            modified = true;
            continue;
          }

          const ePrice = d.entryPrice || (intradayBars[0]?.open ?? 0);
          const bias: "BUY" | "SELL" = d.magnetPrice >= ePrice ? "BUY" : "SELL";
          const syntheticTP = {
            bias,
            t1: d.magnetPrice,
            stopDistance: (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : ePrice * 0.01,
            riskReward: 0,
            entryTrigger: "",
            invalidation: "",
            notes: "",
          };

          try {
            const result = checkEntryTrigger(
              intradayBars.map((b: any) => ({
                ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
              })),
              syntheticTP,
              "conservative",
            );
            updatedDetails.push({
              ...d,
              activated: result.triggered,
              activationPrice: result.entryPrice,
              activationTs: result.triggerTs,
            });
            if (result.triggered) activatedCount++;
            else notActivatedCount++;
            modified = true;
          } catch {
            updatedDetails.push({ ...d, activated: false });
            notActivatedCount++;
            modified = true;
          }
        }

        if (modified) {
          await storage.updateBacktestDetails(bt.id, updatedDetails);
          enriched++;
        } else {
          skipped++;
        }
      }

      const done = remaining === 0;

      res.json({
        ok: true,
        enriched,
        skipped,
        processed,
        remaining,
        apiFetches,
        activatedCount,
        notActivatedCount,
        done,
        total: allBacktests.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Profit Windows (Multi-Instrument Performance) ──

  app.get("/api/performance/profit-windows", async (req, res) => {
    try {
      const capitalPerTrade = parseFloat(req.query.risk as string) || 1000;
      const forceRebuild = req.query.rebuild === "true";

      const cacheKey = `profit_windows:${capitalPerTrade}`;
      const cacheMeta = await storage.getPwCacheMeta(cacheKey);
      const cacheValid = !forceRebuild && cacheMeta && cacheMeta.status === "ready" && cacheMeta.tradeCount > 0;

      interface PwTrade {
        date: string;
        ticker: string;
        setupType: string;
        instrument: string;
        pnl: number;
        rMultiple: number;
        overCapital: boolean;
      }

      let allPwTrades: PwTrade[] = [];
      let totalBacktestTrades = 0;
      let activatedTradesUsed = 0;
      let polygonFetched = false;

      if (cacheValid) {
        log(`Profit Windows: serving from cache (${cacheMeta!.tradeCount} records)`, "pw");
        const cached = await storage.getPwTradeCache(cacheKey);
        allPwTrades = cached.map(c => ({
          date: c.tradeDate, ticker: c.ticker, setupType: c.setupType,
          instrument: c.instrument, pnl: c.pnl, rMultiple: c.rMultiple,
          overCapital: c.overCapital,
        }));
        activatedTradesUsed = new Set(cached.map(c => `${c.ticker}:${c.tradeDate}:${c.setupType}`)).size;
      } else {
        log("Profit Windows: computing fresh with real Polygon data...", "pw");
        await storage.upsertPwCacheMeta(cacheKey, 0, "computing");

        const allBacktests = await storage.getBacktests();
        const latestBt = new Map<string, typeof allBacktests[0]>();
        for (const bt of allBacktests) {
          const key = `${bt.ticker}:${bt.setupType}`;
          const existing = latestBt.get(key);
          if (!existing || bt.id > existing.id) latestBt.set(key, bt);
        }

        interface TradeRecord {
          date: string; ticker: string; setupType: string;
          ePrice: number; magnetPrice: number; stopDist: number;
          bias: "BUY" | "SELL"; hit: boolean; mfe: number;
        }
        const allTradeRecords: TradeRecord[] = [];
        let minDate = "9999-12-31", maxDate = "0000-01-01";

        for (const bt of latestBt.values()) {
          const details = bt.details as any[] | null;
          if (!details) continue;
          for (const d of details) {
            if (!d.triggered || d.activated !== true) continue;
            const ePrice = (d.activationPrice && d.activationPrice > 0) ? d.activationPrice : d.entryPrice;
            if (!ePrice || ePrice <= 0) continue;
            const magnetPrice = d.magnetPrice;
            if (!magnetPrice) continue;
            const stopDist = (d.stopDistance && d.stopDistance > 0) ? d.stopDistance : ePrice * 0.01;
            totalBacktestTrades++;
            allTradeRecords.push({
              date: d.date, ticker: bt.ticker, setupType: bt.setupType,
              ePrice, magnetPrice, stopDist,
              bias: magnetPrice >= ePrice ? "BUY" : "SELL",
              hit: !!d.hit, mfe: d.mfe || 0,
            });
            if (d.date < minDate) minDate = d.date;
            if (d.date > maxDate) maxDate = d.date;
          }
        }

        activatedTradesUsed = allTradeRecords.length;
        log(`Profit Windows: ${allTradeRecords.length} activated trades across all setups`, "pw");

        const uniqueTickers = new Set(allTradeRecords.map(t => t.ticker));
        const tickerLetfInfo = new Map<string, { bull: { ticker: string; leverage: number; direction: string } | null; bear: { ticker: string; leverage: number; direction: string } | null }>();
        const uniqueLetfTickers = new Set<string>();
        for (const tick of uniqueTickers) {
          const bullCands = getCandidates(tick, "BUY");
          const bearCands = getCandidates(tick, "SELL");
          const bestBull = bullCands.sort((a, b) => b.leverage - a.leverage)[0] || null;
          const bestBear = bearCands.sort((a, b) => b.leverage - a.leverage)[0] || null;
          tickerLetfInfo.set(tick, {
            bull: bestBull ? { ticker: bestBull.ticker, leverage: bestBull.leverage, direction: bestBull.direction } : null,
            bear: bestBear ? { ticker: bestBear.ticker, leverage: bestBear.leverage, direction: bestBear.direction } : null,
          });
          if (bestBull) uniqueLetfTickers.add(bestBull.ticker);
          if (bestBear) uniqueLetfTickers.add(bestBear.ticker);
        }

        const letfBarMap = new Map<string, Map<string, number>>();
        if (allTradeRecords.length > 0 && uniqueLetfTickers.size > 0) {
          const letfList = Array.from(uniqueLetfTickers);
          const batchSz = 20;
          for (let b = 0; b < letfList.length; b += batchSz) {
            await Promise.all(letfList.slice(b, b + batchSz).map(async (letfTick) => {
              try {
                const bars = await fetchDailyBarsCached(letfTick, minDate, maxDate);
                const dateMap = new Map<string, number>();
                for (const bar of bars) dateMap.set(new Date(bar.t).toISOString().slice(0, 10), bar.c);
                letfBarMap.set(letfTick, dateMap);
              } catch {}
            }));
          }
          log(`Profit Windows: fetched LETF bars for ${letfBarMap.size}/${uniqueLetfTickers.size} tickers`, "pw");
        }

        function getThirdFriday(year: number, month: number): string {
          const d = new Date(Date.UTC(year, month, 1));
          const dow = d.getUTCDay();
          const firstFri = dow <= 5 ? (5 - dow + 1) : (12 - dow + 1);
          const tf = new Date(Date.UTC(year, month, firstFri + 14));
          return tf.toISOString().slice(0, 10);
        }
        function findTargetExpiry(tradeDate: string): string {
          const d = new Date(tradeDate + "T12:00:00Z");
          const cands: string[] = [];
          for (let off = 0; off <= 2; off++) {
            const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, 1));
            cands.push(getThirdFriday(dt.getUTCFullYear(), dt.getUTCMonth()));
          }
          let best = cands[0]; let bestScore = Infinity;
          for (const c of cands) {
            const dte = (new Date(c + "T12:00:00Z").getTime() - d.getTime()) / 86400000;
            if (dte >= 7) { const score = Math.abs(dte - 21); if (score < bestScore) { best = c; bestScore = score; } }
          }
          return best;
        }
        function strikeIncrement(price: number): number {
          if (price <= 5) return 0.5; if (price <= 25) return 1;
          if (price <= 200) return 5; if (price <= 500) return 5;
          if (price <= 1000) return 10; return 50;
        }
        function nearbyStrikes(price: number): number[] {
          const inc = strikeIncrement(price);
          const base = Math.round(price / inc) * inc;
          const candidates = [base];
          for (let di = 1; di <= 2; di++) { candidates.push(base + inc * di); candidates.push(base - inc * di); }
          candidates.sort((a, b) => Math.abs(a - price) - Math.abs(b - price));
          return candidates.filter(s => s > 0);
        }
        function buildOptTicker(underlying: string, expiry: string, type: "C" | "P", strike: number): string {
          const yy = expiry.slice(2, 4); const mm = expiry.slice(5, 7); const dd = expiry.slice(8, 10);
          const strikeInt = Math.round(strike * 1000);
          return `O:${underlying}${yy}${mm}${dd}${type}${String(strikeInt).padStart(8, "0")}`;
        }

        const tradeOptCandidates: string[][] = [];
        const tradeLetfOptCandidates: (string[] | null)[] = [];
        const uniqueOptTickers = new Set<string>();

        for (let i = 0; i < allTradeRecords.length; i++) {
          const t = allTradeRecords[i];
          const expiry = findTargetExpiry(t.date);
          const cType: "C" | "P" = t.bias === "BUY" ? "C" : "P";
          const strikes = nearbyStrikes(t.ePrice);
          const cands = strikes.map(s => buildOptTicker(t.ticker, expiry, cType, s));
          tradeOptCandidates.push(cands);
          cands.forEach(c => uniqueOptTickers.add(c));

          const lInfo = tickerLetfInfo.get(t.ticker);
          const lCand = t.bias === "BUY" ? lInfo?.bull : lInfo?.bear;
          if (lCand) {
            const lBars = letfBarMap.get(lCand.ticker);
            const lClose = lBars?.get(t.date);
            if (lClose && lClose > 0) {
              const lStrikes = nearbyStrikes(lClose);
              const lCands = lStrikes.map(s => buildOptTicker(lCand.ticker, expiry, cType, s));
              tradeLetfOptCandidates.push(lCands);
              lCands.forEach(c => uniqueOptTickers.add(c));
            } else {
              tradeLetfOptCandidates.push(null);
            }
          } else {
            tradeLetfOptCandidates.push(null);
          }
        }

        const optBarMap = new Map<string, Map<string, number>>();
        if (uniqueOptTickers.size > 0) {
          const optList = Array.from(uniqueOptTickers);
          log(`Profit Windows: fetching bars for ${optList.length} option contracts...`, "pw");
          const batchSz = 20;
          for (let b = 0; b < optList.length; b += batchSz) {
            await Promise.all(optList.slice(b, b + batchSz).map(async (oTick) => {
              try {
                const bars = await fetchDailyBarsCached(oTick, minDate, maxDate);
                const dMap = new Map<string, number>();
                for (const bar of bars) dMap.set(new Date(bar.t).toISOString().slice(0, 10), bar.c);
                if (dMap.size > 0) optBarMap.set(oTick, dMap);
              } catch {}
            }));
          }
          log(`Profit Windows: got bars for ${optBarMap.size}/${optList.length} option contracts`, "pw");
          polygonFetched = true;
        }

        const cacheRecords: any[] = [];

        for (let i = 0; i < allTradeRecords.length; i++) {
          const t = allTradeRecords[i];
          const { date, ticker, setupType, ePrice, magnetPrice, stopDist, bias, hit, mfe } = t;
          const rewardDist = Math.abs(magnetPrice - ePrice);
          const stopPrice = bias === "BUY" ? ePrice - stopDist : ePrice + stopDist;

          const sharesQty = Math.floor(capitalPerTrade / ePrice);
          const shareIsOverCapital = ePrice > capitalPerTrade;
          if (sharesQty > 0) {
            const shareWin = Math.round(rewardDist * sharesQty * 100) / 100;
            const shareLoss = Math.round(-stopDist * sharesQty * 100) / 100;
            const sharePnl = hit ? shareWin : shareLoss;
            const shareRmult = hit ? rewardDist / stopDist : -1;
            allPwTrades.push({ date, ticker, setupType, instrument: "SHARES", pnl: sharePnl, rMultiple: shareRmult, overCapital: shareIsOverCapital });
            cacheRecords.push({
              ticker, tradeDate: date, instrument: "SHARES", setupType,
              ePrice, magnetPrice, stopDist, bias, hit, pnl: sharePnl,
              rMultiple: shareRmult, contracts: sharesQty, instrumentTicker: ticker,
              entryPremium: null, overCapital: shareIsOverCapital, mfe, halfwayHit: false,
              source: cacheKey,
            });
          }

          let letfEntryPrice = 0, letfT1Price = 0, letfStopPx = 0;
          const letfInfo = tickerLetfInfo.get(ticker);
          const letfCand = bias === "BUY" ? letfInfo?.bull : letfInfo?.bear;
          if (letfCand) {
            const letfBars = letfBarMap.get(letfCand.ticker);
            const letfClose = letfBars?.get(date);
            if (letfClose && letfClose > 0) {
              const effLev = letfCand.direction === "BEAR" ? -letfCand.leverage : letfCand.leverage;
              const letfShares = Math.floor(capitalPerTrade / letfClose);
              if (letfShares > 0) {
                letfT1Price = letfClose * (1 + effLev * (magnetPrice - ePrice) / ePrice);
                letfStopPx = letfClose * (1 + effLev * (stopPrice - ePrice) / ePrice);
                const letfPnl = hit
                  ? Math.round((letfT1Price - letfClose) * letfShares * 100) / 100
                  : Math.round((letfStopPx - letfClose) * letfShares * 100) / 100;
                const letfIsOverCapital = letfClose > capitalPerTrade;
                const letfRmult = letfPnl > 0 ? letfPnl / capitalPerTrade * (capitalPerTrade / (Math.abs(letfClose - letfStopPx) * letfShares || 1)) : -1;
                allPwTrades.push({ date, ticker, setupType, instrument: "LEVERAGED_ETF", pnl: letfPnl, rMultiple: letfRmult, overCapital: letfIsOverCapital });
                cacheRecords.push({
                  ticker, tradeDate: date, instrument: "LEVERAGED_ETF", setupType,
                  ePrice, magnetPrice, stopDist, bias, hit, pnl: letfPnl,
                  rMultiple: letfRmult, contracts: letfShares, instrumentTicker: letfCand.ticker,
                  entryPremium: letfClose, overCapital: letfIsOverCapital, mfe, halfwayHit: false,
                  source: cacheKey,
                });
                letfEntryPrice = letfClose;
              }
            }
          }

          const optCands = tradeOptCandidates[i];
          let optHandled = false;
          if (optCands) {
            for (const optTick of optCands) {
              const oBars = optBarMap.get(optTick);
              const premium = oBars?.get(date);
              if (premium && premium > 0) {
                const costPerContract = premium * 100;
                const optIsOverCapital = costPerContract > capitalPerTrade;
                const contracts = Math.max(1, Math.floor(capitalPerTrade / costPerContract));
                const delta = 0.50;
                const optT1Premium = premium + rewardDist * delta;
                const optStopPremium = Math.max(0.01, premium - stopDist * delta);
                const optHalfwayPremium = premium + (optT1Premium - premium) / 2;
                const halfwayUnderlyingDist = (optHalfwayPremium - premium) / delta;
                const mfeAbsolute = mfe * ePrice;
                const halfwayHit = mfeAbsolute >= halfwayUnderlyingDist && halfwayUnderlyingDist > 0;

                let optPnl = 0;
                if (hit) {
                  optPnl = (optT1Premium - premium) * contracts * 100;
                } else if (halfwayHit) {
                  const halfContracts = Math.floor(contracts / 2);
                  optPnl = (optHalfwayPremium - premium) * halfContracts * 100;
                } else {
                  optPnl = (optStopPremium - premium) * contracts * 100;
                }
                optPnl = Math.round(optPnl * 100) / 100;
                const optRisk = (premium - optStopPremium) * contracts * 100;
                const optRmult = optRisk > 0 ? optPnl / optRisk : (optPnl > 0 ? 1 : -1);
                allPwTrades.push({ date, ticker, setupType, instrument: "OPTIONS", pnl: optPnl, rMultiple: optRmult, overCapital: optIsOverCapital });
                cacheRecords.push({
                  ticker, tradeDate: date, instrument: "OPTIONS", setupType,
                  ePrice, magnetPrice, stopDist, bias, hit, pnl: optPnl,
                  rMultiple: optRmult, contracts, instrumentTicker: optTick,
                  entryPremium: premium, overCapital: optIsOverCapital, mfe, halfwayHit,
                  source: cacheKey,
                });
                optHandled = true;
                break;
              }
            }
          }

          if (letfEntryPrice > 0) {
            const lOptCands = tradeLetfOptCandidates[i];
            if (lOptCands) {
              for (const lOptTick of lOptCands) {
                const loBars = optBarMap.get(lOptTick);
                const lPremium = loBars?.get(date);
                if (lPremium && lPremium > 0) {
                  const lCost = lPremium * 100;
                  const lOptIsOverCapital = lCost > capitalPerTrade;
                  const lContracts = Math.max(1, Math.floor(capitalPerTrade / lCost));
                  const delta2 = 0.50;
                  const lOptT1Premium = lPremium + Math.abs(letfT1Price - letfEntryPrice) * delta2;
                  const lOptStopPremium = Math.max(0.01, lPremium - Math.abs(letfEntryPrice - letfStopPx) * delta2);
                  const lOptHalfwayPremium = lPremium + (lOptT1Premium - lPremium) / 2;
                  const lHalfwayDist = (lOptHalfwayPremium - lPremium) / delta2;
                  const lMfe = mfe * ePrice;
                  const effLev2 = letfEntryPrice > 0 ? Math.abs(letfT1Price - letfEntryPrice) / (rewardDist || 1) : 1;
                  const lHalfwayHit = (lMfe * effLev2) >= lHalfwayDist && lHalfwayDist > 0;

                  let lOptPnl = 0;
                  if (hit) {
                    lOptPnl = (lOptT1Premium - lPremium) * lContracts * 100;
                  } else if (lHalfwayHit) {
                    const lHalfContracts = Math.floor(lContracts / 2);
                    lOptPnl = (lOptHalfwayPremium - lPremium) * lHalfContracts * 100;
                  } else {
                    lOptPnl = (lOptStopPremium - lPremium) * lContracts * 100;
                  }
                  lOptPnl = Math.round(lOptPnl * 100) / 100;
                  const lOptRisk = (lPremium - lOptStopPremium) * lContracts * 100;
                  const lOptRmult = lOptRisk > 0 ? lOptPnl / lOptRisk : (lOptPnl > 0 ? 1 : -1);
                  allPwTrades.push({ date, ticker, setupType, instrument: "LETF_OPTIONS", pnl: lOptPnl, rMultiple: lOptRmult, overCapital: lOptIsOverCapital });
                  cacheRecords.push({
                    ticker, tradeDate: date, instrument: "LETF_OPTIONS", setupType,
                    ePrice, magnetPrice, stopDist, bias, hit, pnl: lOptPnl,
                    rMultiple: lOptRmult, contracts: lContracts, instrumentTicker: lOptTick,
                    entryPremium: lPremium, overCapital: lOptIsOverCapital, mfe, halfwayHit: lHalfwayHit,
                    source: cacheKey,
                  });
                  break;
                }
              }
            }
          }
        }

        await storage.clearPwTradeCache(cacheKey);
        await storage.upsertPwTradeCacheBatch(cacheRecords);
        await storage.upsertPwCacheMeta(cacheKey, cacheRecords.length, "ready");
        log(`Profit Windows: cached ${cacheRecords.length} trade records`, "pw");
      }

      const windowDays = [30, 60, 90];
      const now = new Date();
      const instrumentTypes = ["SHARES", "LEVERAGED_ETF", "OPTIONS", "LETF_OPTIONS"];

      const INST_PROFILES: Record<string, { name: string; leverage: number; rth_only: boolean; loss_cap: number | null; fee_per_trade: number }> = {
        SHARES: { name: "Shares (Real Data)", leverage: 1, rth_only: false, loss_cap: null, fee_per_trade: 0 },
        LEVERAGED_ETF: { name: "Leveraged ETF (Real Polygon)", leverage: 3, rth_only: true, loss_cap: null, fee_per_trade: 0 },
        OPTIONS: { name: "Options (Real Polygon)", leverage: 1, rth_only: true, loss_cap: null, fee_per_trade: 0 },
        LETF_OPTIONS: { name: "LETF Options (Real Polygon)", leverage: 1, rth_only: true, loss_cap: null, fee_per_trade: 0 },
      };

      const comparison: Record<string, any> = {};

      for (const instKey of instrumentTypes) {
        const frontendKey = instKey === "LEVERAGED_ETF" ? "LETF" : instKey;
        const instTrades = allPwTrades.filter(t => t.instrument === instKey).sort((a, b) => a.date.localeCompare(b.date));

        const windowResults: any[] = [];
        for (const wd of windowDays) {
          const cutoff = new Date(now.getTime() - wd * 86400000).toISOString().slice(0, 10);
          const windowTrades = instTrades.filter(t => t.date >= cutoff);

          const wins = windowTrades.filter(t => t.pnl > 0).length;
          const losses = windowTrades.filter(t => t.pnl <= 0).length;
          const totalPnl = windowTrades.reduce((s, t) => s + t.pnl, 0);

          let cumPnl = 0;
          let peak = 0;
          let maxDD = 0;
          let bestR = 0, worstR = 0, bestPnl = 0, worstPnl = 0;
          const equityCurve = windowTrades.map((t, idx) => {
            cumPnl += t.pnl;
            if (cumPnl > peak) peak = cumPnl;
            const dd = peak - cumPnl;
            if (dd > maxDD) maxDD = dd;
            if (t.rMultiple > bestR) bestR = t.rMultiple;
            if (t.rMultiple < worstR) worstR = t.rMultiple;
            if (t.pnl > bestPnl) bestPnl = t.pnl;
            if (t.pnl < worstPnl) worstPnl = t.pnl;
            return { trade: idx + 1, cum_r: Math.round(t.rMultiple * 100) / 100, cum_pnl: Math.round(cumPnl * 100) / 100 };
          });

          const maxPoints = 500;
          let sampledCurve = equityCurve;
          if (equityCurve.length > maxPoints) {
            const step = Math.ceil(equityCurve.length / maxPoints);
            sampledCurve = equityCurve.filter((_, i) => i % step === 0 || i === equityCurve.length - 1);
          }

          const grossW = windowTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
          const grossL = Math.abs(windowTrades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
          const tradingDays = Math.max(1, Math.ceil(wd * 252 / 365));

          const totalR = windowTrades.reduce((s, t) => s + t.rMultiple, 0);
          const overCapitalCount = windowTrades.filter(t => t.overCapital).length;

          windowResults.push({
            window_days: wd,
            trading_days: tradingDays,
            total_trades: windowTrades.length,
            wins,
            losses,
            win_rate: windowTrades.length > 0 ? Math.round(wins / windowTrades.length * 1000) / 10 : 0,
            total_r: Math.round(totalR * 100) / 100,
            avg_r: windowTrades.length > 0 ? Math.round(totalR / windowTrades.length * 100) / 100 : 0,
            total_pnl: Math.round(totalPnl * 100) / 100,
            avg_pnl: windowTrades.length > 0 ? Math.round(totalPnl / windowTrades.length * 100) / 100 : 0,
            trades_per_day: Math.round(windowTrades.length / tradingDays * 100) / 100,
            daily_avg_pnl: Math.round(totalPnl / tradingDays * 100) / 100,
            profit_factor: grossL > 0 ? Math.round(grossW / grossL * 100) / 100 : (grossW > 0 ? Infinity : 0),
            best_trade_r: Math.round(bestR * 100) / 100,
            best_trade_pnl: Math.round(bestPnl * 100) / 100,
            worst_trade_r: Math.round(worstR * 100) / 100,
            worst_trade_pnl: Math.round(worstPnl * 100) / 100,
            max_drawdown_r: Math.round(maxDD / capitalPerTrade * 100) / 100,
            max_drawdown_pnl: Math.round(maxDD * 100) / 100,
            equity_curve: sampledCurve,
            over_capital_count: overCapitalCount,
          });
        }

        comparison[frontendKey] = {
          profile: INST_PROFILES[instKey],
          windows: windowResults,
        };
      }

      const overCapital = {
        shares: allPwTrades.filter(t => t.instrument === "SHARES" && t.overCapital).length,
        letf: allPwTrades.filter(t => t.instrument === "LEVERAGED_ETF" && t.overCapital).length,
        options: allPwTrades.filter(t => t.instrument === "OPTIONS" && t.overCapital).length,
        letfOptions: allPwTrades.filter(t => t.instrument === "LETF_OPTIONS" && t.overCapital).length,
      };

      res.json({
        comparison,
        risk_per_trade: capitalPerTrade,
        generated_at: now.toISOString(),
        filters: { min_win_rate: 0, min_expectancy_r: 0, min_sample_size: 0, include_backtests: true },
        data_summary: {
          total_signals_considered: 0,
          signals_filtered_by_profile: 0,
          signals_filtered_by_optimization: 0,
          signals_included: 0,
          backtests_included: activatedTradesUsed,
          total_trade_inputs: activatedTradesUsed,
          polygon_data: true,
          over_capital: overCapital,
        },
        cache_status: cacheValid ? "cached" : "fresh",
        cached_at: cacheMeta?.computedAt ?? null,
      });
    } catch (err: any) {
      log(`Profit Windows error: ${err.message}`, "pw");
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/profit-windows/rebuild", async (_req, res) => {
    try {
      await storage.clearPwTradeCache();
      await storage.clearPwCacheMeta();
      res.json({ success: true, message: "Profit Windows cache cleared, will recompute on next load" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Audit File Routes ──

  const auditDir = join(process.cwd());

  app.get("/api/audit/system", (_req, res) => {
    try {
      const content = readFileSync(join(auditDir, "SYSTEM_AUDIT.md"), "utf-8");
      res.type("text/plain").send(content);
    } catch {
      res.status(404).send("SYSTEM_AUDIT.md not found");
    }
  });

  app.get("/api/audit/feature-map", (_req, res) => {
    try {
      const content = readFileSync(join(auditDir, "FEATURE_FILE_MAP.md"), "utf-8");
      res.type("text/plain").send(content);
    } catch {
      res.status(404).send("FEATURE_FILE_MAP.md not found");
    }
  });

  app.get("/api/audit/json", (_req, res) => {
    try {
      const content = readFileSync(join(auditDir, "SYSTEM_AUDIT.json"), "utf-8");
      res.type("text/plain").send(content);
    } catch {
      res.status(404).send("SYSTEM_AUDIT.json not found");
    }
  });

  app.get("/api/analysis/reliability", async (_req, res) => {
    try {
      const summary = await computeReliabilitySummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/analysis/robustness-runs", async (req, res) => {
    try {
      const testType = req.query.testType as string | undefined;
      const runs = await storage.getRobustnessRuns(testType);
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/analysis/robustness/run", async (req, res) => {
    try {
      const { testType, parameters } = req.body;
      if (!testType) return res.status(400).json({ error: "testType required" });

      let result;
      switch (testType) {
        case "fees_slippage": {
          const settings = await storage.getAllSettings();
          const fees = parameters?.feesPerTrade ?? parseFloat(settings["fees_per_trade"] ?? "0");
          const slippage = parameters?.slippageBps ?? parseFloat(settings["slippage_bps"] ?? "0");
          result = await runFeesSlippageTest(fees, slippage);
          break;
        }
        case "out_of_sample":
          result = await runOutOfSampleTest(parameters?.splitRatio ?? 0.7);
          break;
        case "walk_forward":
          result = await runWalkForwardTest(parameters?.windowCount ?? 3);
          break;
        case "monte_carlo":
          result = await runMonteCarloTest(parameters?.simulations ?? 1000);
          break;
        case "stress_test":
          result = await runStressTest();
          break;
        case "parameter_sweep":
          result = await runParameterSweep();
          break;
        case "stop_sensitivity":
          result = await runStopSensitivityTest();
          break;
        case "regime_analysis":
          result = await runRegimeAnalysis();
          break;
        default:
          return res.status(400).json({ error: `Unknown test type: ${testType}` });
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/analysis/robustness/run-all", async (_req, res) => {
    try {
      const settings = await storage.getAllSettings();
      const fees = parseFloat(settings["fees_per_trade"] ?? "0");
      const slippage = parseFloat(settings["slippage_bps"] ?? "0");

      const results = [];
      results.push(await runFeesSlippageTest(fees, slippage));
      results.push(await runOutOfSampleTest());
      results.push(await runWalkForwardTest());
      results.push(await runMonteCarloTest());
      results.push(await runStressTest());
      results.push(await runParameterSweep());
      results.push(await runStopSensitivityTest());
      results.push(await runRegimeAnalysis());

      const summary = await computeReliabilitySummary();
      res.json({ runs: results, summary });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/settings/assumptions", async (req, res) => {
    try {
      const { feesPerTrade, slippageBps } = req.body;
      if (feesPerTrade !== undefined) await storage.setSetting("fees_per_trade", String(feesPerTrade));
      if (slippageBps !== undefined) await storage.setSetting("slippage_bps", String(slippageBps));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/settings/forward-validation/start", async (_req, res) => {
    try {
      await storage.setSetting("forward_validation_start", new Date().toISOString());
      await storage.setSetting("forward_validation_last_check", new Date().toISOString());
      res.json({ success: true, startedAt: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/settings/forward-validation/stop", async (_req, res) => {
    try {
      await storage.setSetting("forward_validation_start", "");
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/activity-feed", async (req, res) => {
    try {
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const limit = Math.max(1, Math.min(isNaN(rawLimit) ? 50 : rawLimit, 500));
      const rawPage = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
      const typeFilter = req.query.type as string | undefined;

      const activities: Array<{
        id: string;
        type: string;
        timestamp: string;
        ticker: string;
        title: string;
        detail: string;
        meta?: Record<string, any>;
      }> = [];

      const recentSignals = await storage.getSignals(undefined, 500);

      for (const s of recentSignals) {
        if (s.activatedTs && s.activationStatus !== "NOT_ACTIVE") {
          activities.push({
            id: `activation-${s.id}`,
            type: "activation",
            timestamp: s.activatedTs,
            ticker: s.ticker,
            title: `${s.ticker} activated — ${s.activationStatus}`,
            detail: `Setup ${s.setupType} | ${s.direction} | QS ${s.qualityScore} | Tier ${s.tier}`,
            meta: { signalId: s.id, setupType: s.setupType, direction: s.direction, qualityScore: s.qualityScore, tier: s.tier, entryPrice: s.entryPriceAtActivation, stopPrice: s.stopPrice, activationStatus: s.activationStatus },
          });
        }

        if (s.status === "hit" && s.hitTs) {
          activities.push({
            id: `hit-${s.id}`,
            type: "hit",
            timestamp: s.hitTs,
            ticker: s.ticker,
            title: `${s.ticker} HIT target`,
            detail: `Setup ${s.setupType} | Magnet $${s.magnetPrice?.toFixed(2)} | ${s.timeToHitMin ? Math.round(s.timeToHitMin) + ' min' : ''}`,
            meta: { signalId: s.id, setupType: s.setupType, magnetPrice: s.magnetPrice, timeToHitMin: s.timeToHitMin, qualityScore: s.qualityScore, tier: s.tier },
          });
        }

        if (s.status === "miss") {
          const missTs = s.targetDate ? new Date(s.targetDate + "T16:00:00").toISOString() : s.asofDate;
          activities.push({
            id: `miss-${s.id}`,
            type: "miss",
            timestamp: missTs,
            ticker: s.ticker,
            title: `${s.ticker} MISSED`,
            detail: `Setup ${s.setupType} | ${s.missReason || 'expired'} | QS ${s.qualityScore}`,
            meta: { signalId: s.id, setupType: s.setupType, missReason: s.missReason, qualityScore: s.qualityScore, tier: s.tier },
          });
        }

        if (s.stopStage !== "INITIAL" && s.stopMovedToBeTs) {
          activities.push({
            id: `stop-move-${s.id}`,
            type: "stop_moved",
            timestamp: s.stopMovedToBeTs,
            ticker: s.ticker,
            title: `${s.ticker} stop moved to breakeven`,
            detail: `Setup ${s.setupType} | Stop stage: ${s.stopStage}`,
            meta: { signalId: s.id, setupType: s.setupType, stopStage: s.stopStage },
          });
        }
      }

      const discordLogs = await storage.getDiscordTradeLogs({ limit: 200 });

      const allTrades = await storage.getAllIbkrTrades();

      const stoppedTradeIds = new Set<number>();
      for (const d of discordLogs) {
        if ((d.event === "STOPPED_OUT" || d.event === "STOPPED_OUT_AFTER_TP") && d.tradeId) {
          stoppedTradeIds.add(d.tradeId);
        }
      }

      for (const t of allTrades) {
        if (t.filledAt) {
          activities.push({
            id: `trade-fill-${t.id}`,
            type: "trade_fill",
            timestamp: t.filledAt,
            ticker: t.ticker,
            title: `${t.ticker} ${t.instrumentType} trade filled`,
            detail: `${t.side} ${t.quantity} @ $${t.entryPrice?.toFixed(2) ?? '?'} | ${t.instrumentTicker || t.ticker}`,
            meta: { tradeId: t.id, signalId: t.signalId, instrumentType: t.instrumentType, entryPrice: t.entryPrice, side: t.side },
          });
        }

        if (t.tp1FilledAt) {
          activities.push({
            id: `trade-tp1-${t.id}`,
            type: "trade_tp1",
            timestamp: t.tp1FilledAt,
            ticker: t.ticker,
            title: `${t.ticker} TP1 hit`,
            detail: `${t.instrumentType} | Fill @ $${t.tp1FillPrice?.toFixed(2) ?? '?'} | P&L $${t.tp1PnlRealized?.toFixed(2) ?? '?'}`,
            meta: { tradeId: t.id, instrumentType: t.instrumentType, tp1FillPrice: t.tp1FillPrice, tp1Pnl: t.tp1PnlRealized },
          });
        }

        if (t.closedAt && t.status === "CLOSED") {
          const wasStopped = stoppedTradeIds.has(t.id);
          activities.push({
            id: `trade-close-${t.id}`,
            type: wasStopped ? "trade_stopped" : "trade_closed",
            timestamp: t.closedAt,
            ticker: t.ticker,
            title: `${t.ticker} ${wasStopped ? "stopped out" : "trade closed"}`,
            detail: `${t.instrumentType} | Exit $${t.exitPrice?.toFixed(2) ?? '?'} | P&L ${t.pnlPct != null ? (t.pnlPct > 0 ? '+' : '') + t.pnlPct.toFixed(1) + '%' : '?'} | R: ${t.rMultiple?.toFixed(2) ?? '?'}`,
            meta: { tradeId: t.id, instrumentType: t.instrumentType, exitPrice: t.exitPrice, pnl: t.pnl, pnlPct: t.pnlPct, rMultiple: t.rMultiple, status: t.status },
          });
        }
      }

      for (const d of discordLogs) {
        if (d.createdAt) {
          activities.push({
            id: `discord-${d.id}`,
            type: "discord",
            timestamp: new Date(d.createdAt).toISOString(),
            ticker: d.ticker || "—",
            title: `Discord: ${d.event}`,
            detail: `${d.instrumentType || ''} | ${d.channel} | ${d.webhookStatus}`,
            meta: { logId: d.id, event: d.event, channel: d.channel, instrumentType: d.instrumentType, status: d.webhookStatus },
          });
        }
      }

      const today = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const btod = await storage.getBtodState(dateStr);
        if (btod) {
          activities.push({
            id: `btod-${btod.id}`,
            type: "btod",
            timestamp: btod.updatedAt ? new Date(btod.updatedAt).toISOString() : btod.createdAt ? new Date(btod.createdAt).toISOString() : dateStr + "T09:30:00Z",
            ticker: "BTOD",
            title: `BTOD ${btod.phase} — ${dateStr}`,
            detail: `Top-3: [${(btod.top3Ids as number[])?.join(', ') || 'none'}] | Selected: ${btod.selectedSignalId ?? 'none'} | Trades: ${btod.tradesExecuted} | Gate: ${btod.gateOpen ? 'OPEN' : 'CLOSED'}`,
            meta: { btodId: btod.id, phase: btod.phase, selectedSignalId: btod.selectedSignalId, secondSignalId: btod.secondSignalId, tradesExecuted: btod.tradesExecuted, gateOpen: btod.gateOpen, top3Ids: btod.top3Ids },
          });
        }
      }

      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const typeCounts: Record<string, number> = {};
      for (const a of activities) {
        typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
      }

      const filtered = typeFilter
        ? activities.filter(a => a.type === typeFilter)
        : activities;

      const eventTypes = [...new Set(activities.map(a => a.type))].sort();

      const totalFiltered = filtered.length;
      const totalPages = Math.ceil(totalFiltered / limit);
      const offset = (page - 1) * limit;
      const paged = filtered.slice(offset, offset + limit);

      res.json({ activities: paged, eventTypes, typeCounts, total: totalFiltered, page, totalPages, perPage: limit });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
