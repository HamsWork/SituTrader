import type { Express } from "express";
import { createServer, type Server } from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { storage } from "./storage";
import { fetchDailyBars, fetchIntradayBars, fetchSnapshot, fetchOptionSnapshot } from "./lib/polygon";
import { formatDate, getTradingDaysBack, nextTradingDay, prevTradingDay } from "./lib/calendar";
import { detectAllSetups } from "./lib/rules";
import { validateMagnetTouch } from "./lib/validate";
import { computeConfidence, computeATR, computeAvgVolume } from "./lib/confidence";
import { computeQualityScore, qualityScoreToTier, computeAvgDollarVolume } from "./lib/quality";
import { generateTradePlan } from "./lib/tradeplan";
import { runBacktest, computeAndStoreTimeToHitStats } from "./lib/backtest";
import { runAlerts } from "./lib/alerts";
import { runActivationScan } from "./lib/activation";
import { rebuildUniverse, getUniverseStatus } from "./lib/universe";
import { recomputeAllExpectancy, getSetupAlertCategory } from "./lib/expectancy";
import { log } from "./index";
import { initScheduler, reconfigureJobs, runAutoNow, computeNextAfterCloseTs, computeNextPreOpenTs, isRTH, nowCT } from "./jobs/scheduler";
import { enrichPendingSignalsWithOptions } from "./lib/options";
import { startBacktestWorker, pauseBacktestWorker, resumeBacktestWorker, isBacktestWorkerRunning, isBacktestWorkerPaused, autoStartBacktestWorker } from "./jobs/backtestWorker";
import { startOptionMonitor, getOptionLiveData, refreshOptionQuotesForActiveSignals } from "./lib/optionMonitor";
import { fetchOptionMark } from "./lib/polygon";
import { selectBestLeveragedEtf, fetchStockNbbo, hasLeveragedEtfMapping } from "./lib/leveragedEtf";
import { startLetfMonitor, getLetfLiveData, refreshLetfQuotesForActiveSignals } from "./lib/letfMonitor";
import { connectIBKR, disconnectIBKR, isConnected, getPositions, getAccountSummary } from "./lib/ibkr";
import { executeTradeForSignal, monitorActiveTrades, closeTradeManually, getIbkrDashboardData } from "./lib/ibkrOrders";
import { postOptionsAlert, postLetfAlert } from "./lib/discord";
import { computeAllProfitWindows, type TradeInput } from "./lib/profitWindows";
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
          const dailyPolygon = await fetchDailyBars(ticker, from200, today);
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

          const intradayPolygon = await fetchIntradayBars(ticker, from15, today, timeframe);
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
              qualityScore: qualityResult.total,
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
          const riskR = entryPrice * 0.01;

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

  // ── Discord Routes ──

  app.post("/api/discord/test-options", async (req, res) => {
    try {
      const { signalId } = req.body;
      if (!signalId) return res.status(400).json({ message: "signalId required" });
      const sigs = await storage.getSignals(undefined, 500);
      const sig = sigs.find(s => s.id === signalId);
      if (!sig) return res.status(404).json({ message: "Signal not found" });
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
      const ok = await postLetfAlert(sig);
      res.json({ ok });
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

      const tradeResults: any[] = [];

      const signalDateKeys = new Set<string>();

      for (const sig of allSignals) {
        const tp = sig.tradePlanJson as any;
        if (!tp) continue;

        const isHit = sig.status === "hit";
        const isMiss = sig.status === "miss" || sig.status === "invalidated" || sig.status === "stopped";
        if (!isHit && !isMiss) continue;

        if (!matchesProfile(sig)) continue;

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
          const sd = stopDist || (entryPrice * 0.02);
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

      let btIdCounter = -1;
      for (const bt of allBacktests) {
        const details = bt.details as any[] | null;
        if (!details) continue;

        for (const d of details) {
          if (!d.triggered) continue;
          if (!d.entryPrice || d.entryPrice <= 0) continue;
          if (!d.date) continue;

          const dateKey = `${bt.ticker}:${bt.setupType}:${d.date}`;
          if (signalDateKeys.has(dateKey)) continue;

          const entryPrice = d.entryPrice;
          const magnetPrice = d.magnetPrice;
          const bias = magnetPrice >= entryPrice ? "BUY" : "SELL";
          const reward = Math.abs(magnetPrice - entryPrice);
          const stopDist = entryPrice * 0.01;

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
          roi: totalInvested > 0 ? Math.round((totalPnl / totalInvested) * 10000) / 100 : 0,
          bestTrade: bestTrade ? { ticker: bestTrade.ticker, pnl: bestTrade.pnlDollar } : null,
          worstTrade: worstTrade ? { ticker: worstTrade.ticker, pnl: worstTrade.pnlDollar } : null,
          instrumentBreakdown,
          liveCount,
          backtestCount: btCount,
          dateFrom,
          dateTo,
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

      const periodSummaries = [
        buildSummary("30 Days", trades30),
        buildSummary("31-60 Days", trades60),
        buildSummary("61-90 Days", trades90),
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

      res.json({
        capitalPerTrade,
        totalSignalsAnalyzed: allSignals.length,
        totalResolvedTrades: tradeResults.length,
        activeProfileName: activeProfile?.name ?? null,
        dataSpanDays,
        earliestDate,
        latestDate,
        periodSummaries,
        trades: tradeResults,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Profit Windows (Multi-Instrument Performance) ──

  app.get("/api/performance/profit-windows", async (req, res) => {
    try {
      const riskPerTrade = parseFloat(req.query.risk as string) || 1000;
      const minWinRate = parseFloat(req.query.minWinRate as string) || 0;
      const minExpectancyR = parseFloat(req.query.minExpectancyR as string) || 0;
      const minSampleSize = parseInt(req.query.minSampleSize as string) || 0;
      const includeBacktests = req.query.includeBacktests === "true";

      const allSignals = await storage.getSignals(undefined, 10000);

      const activeProfile = await storage.getActiveProfile();
      const TIER_RANK: Record<string, number> = { APLUS: 0, A: 1, B: 2, C: 3 };

      let allExpectancy: any[] = [];
      try {
        allExpectancy = await storage.getOverallSetupExpectancy();
      } catch {}

      const perTickerStatsMap = new Map<string, { sampleSize: number; winRate: number; expectancyR: number }>();
      const overallStatsMap = new Map<string, { sampleSize: number; winRate: number; expectancyR: number }>();
      for (const s of allExpectancy) {
        if (s.ticker) {
          perTickerStatsMap.set(`${s.ticker}:${s.setupType}`, { sampleSize: s.sampleSize, winRate: s.winRate, expectancyR: s.expectancyR });
        } else {
          overallStatsMap.set(s.setupType, { sampleSize: s.sampleSize, winRate: s.winRate, expectancyR: s.expectancyR });
        }
      }

      const passesOptimization = (ticker: string, setupType: string): boolean => {
        const stat = perTickerStatsMap.get(`${ticker}:${setupType}`);
        if (!stat) {
          const overall = overallStatsMap.get(setupType);
          if (!overall) return minWinRate <= 0 && minExpectancyR <= 0 && minSampleSize <= 0;
          if (minSampleSize > 0 && overall.sampleSize < minSampleSize) return false;
          if (minWinRate > 0 && overall.winRate < minWinRate) return false;
          if (minExpectancyR > 0 && overall.expectancyR < minExpectancyR) return false;
          return true;
        }
        if (minSampleSize > 0 && stat.sampleSize < minSampleSize) return false;
        if (minWinRate > 0 && stat.winRate < minWinRate) return false;
        if (minExpectancyR > 0 && stat.expectancyR < minExpectancyR) return false;
        return true;
      };

      const matchesProfile = (sig: any): boolean => {
        if (!activeProfile) return true;
        if (!activeProfile.allowedSetups.includes(sig.setupType)) return false;
        const sigTierRank = TIER_RANK[sig.tier] ?? 3;
        const minTierRank = TIER_RANK[activeProfile.minTier] ?? 3;
        if (sigTierRank > minTierRank) return false;
        if (sig.qualityScore < activeProfile.minQualityScore) return false;
        return true;
      };

      const tradeInputs: TradeInput[] = [];
      const signalDateKeys = new Set<string>();
      let totalSignalsConsidered = 0;
      let signalsFilteredByProfile = 0;
      let signalsFilteredByOptimization = 0;
      let signalsIncluded = 0;

      for (const sig of allSignals) {
        const tp = sig.tradePlanJson as any;
        if (!tp) continue;
        const isHit = sig.status === "hit";
        const isMiss = sig.status === "miss" || sig.status === "invalidated" || sig.status === "stopped";
        if (!isHit && !isMiss) continue;
        totalSignalsConsidered++;

        if (!matchesProfile(sig)) { signalsFilteredByProfile++; continue; }
        if (!passesOptimization(sig.ticker, sig.setupType)) { signalsFilteredByOptimization++; continue; }

        const stopDist = tp.stopDistance || 0;
        const bias = tp.bias as string | undefined;

        let entryPrice: number;
        if (sig.entryPriceAtActivation && sig.entryPriceAtActivation > 0) {
          entryPrice = sig.entryPriceAtActivation;
        } else if (sig.stopPrice && sig.stopPrice > 0 && stopDist > 0) {
          entryPrice = bias === "BUY" ? sig.stopPrice + stopDist : sig.stopPrice - stopDist;
        } else if (tp.riskReward && stopDist > 0 && sig.magnetPrice > 0) {
          entryPrice = bias === "BUY" ? sig.magnetPrice - (tp.riskReward * stopDist) : sig.magnetPrice + (tp.riskReward * stopDist);
        } else continue;

        if (entryPrice <= 0 || stopDist <= 0) continue;

        let rMultiple: number;
        if (isHit && tp.t1) {
          const reward = Math.abs(tp.t1 - entryPrice);
          rMultiple = reward / stopDist;
        } else {
          rMultiple = -1;
        }

        const signalDate = sig.hitTs ? new Date(sig.hitTs).toISOString().slice(0, 10) : sig.targetDate;
        const exitDate = signalDate || sig.asofDate;
        const entryDate = sig.asofDate;

        signalDateKeys.add(`${sig.ticker}:${sig.setupType}:${exitDate}`);

        const entryTs = Math.floor(new Date(entryDate + "T10:00:00-05:00").getTime() / 1000);
        const exitTs = Math.floor(new Date(exitDate + "T14:00:00-05:00").getTime() / 1000);

        tradeInputs.push({
          r_multiple: Math.round(rMultiple * 10000) / 10000,
          entry_ts: entryTs,
          exit_ts: exitTs,
          symbol: sig.ticker,
          entry_price: entryPrice,
          timeframe: "1d",
        });
        signalsIncluded++;
      }

      let backtestsIncluded = 0;
      if (includeBacktests) {
        const allBacktests = await storage.getBacktests();
        for (const bt of allBacktests) {
          if (!passesOptimization(bt.ticker, bt.setupType)) continue;
          const details = bt.details as any[] | null;
          if (!details) continue;

          for (const d of details) {
            if (!d.triggered) continue;
            if (!d.entryPrice || d.entryPrice <= 0) continue;
            if (!d.date) continue;

            const dateKey = `${bt.ticker}:${bt.setupType}:${d.date}`;
            if (signalDateKeys.has(dateKey)) continue;

            const entryPrice = d.entryPrice;
            const magnetPrice = d.magnetPrice;
            const stopDist = entryPrice * 0.01;
            const reward = Math.abs(magnetPrice - entryPrice);
            const rMultiple = d.hit ? reward / stopDist : -1;

            const exitTs = Math.floor(new Date(d.date + "T14:00:00-05:00").getTime() / 1000);
            const entryTs = exitTs - 86400;

            tradeInputs.push({
              r_multiple: Math.round(rMultiple * 10000) / 10000,
              entry_ts: entryTs,
              exit_ts: exitTs,
              symbol: bt.ticker,
              entry_price: entryPrice,
              timeframe: "1d",
            });
            backtestsIncluded++;
          }
        }
      }

      const result = computeAllProfitWindows(tradeInputs, riskPerTrade, [30, 60, 90]);
      res.json({
        ...result,
        filters: {
          min_win_rate: minWinRate,
          min_expectancy_r: minExpectancyR,
          min_sample_size: minSampleSize,
          include_backtests: includeBacktests,
        },
        data_summary: {
          total_signals_considered: totalSignalsConsidered,
          signals_filtered_by_profile: signalsFilteredByProfile,
          signals_filtered_by_optimization: signalsFilteredByOptimization,
          signals_included: signalsIncluded,
          backtests_included: backtestsIncluded,
          total_trade_inputs: tradeInputs.length,
        },
      });
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

  return httpServer;
}
