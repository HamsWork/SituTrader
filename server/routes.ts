import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { fetchDailyBars, fetchIntradayBars, fetchSnapshot } from "./lib/polygon";
import { formatDate, getTradingDaysBack, nextTradingDay, prevTradingDay } from "./lib/calendar";
import { detectAllSetups } from "./lib/rules";
import { validateMagnetTouch } from "./lib/validate";
import { computeConfidence, computeATR, computeAvgVolume } from "./lib/confidence";
import { computeQualityScore, qualityScoreToTier, computeAvgDollarVolume } from "./lib/quality";
import { generateTradePlan } from "./lib/tradeplan";
import { runBacktest, computeAndStoreTimeToHitStats } from "./lib/backtest";
import { runAlerts } from "./lib/alerts";
import { runActivationScan } from "./lib/activation";
import { log } from "./index";
import type { SetupType } from "@shared/schema";

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
      const sigs = await storage.getSignals(undefined, 100);
      res.json(sigs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/stats", async (_req, res) => {
    try {
      const stats = await storage.getSignalStats();
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
      const enabledSymbols = await storage.getEnabledSymbols();
      if (enabledSymbols.length === 0) {
        return res.status(400).json({ message: "No enabled symbols" });
      }

      const settings = await storage.getAllSettings();
      const timeframe = settings.intradayTimeframe || "5";
      const gapThreshold = parseFloat(settings.gapThreshold || "0.30") / 100;

      const today = formatDate(new Date());
      const from200 = getTradingDaysBack(today, 200);
      const from15 = getTradingDaysBack(today, 15);

      log(`Refreshing data for ${enabledSymbols.length} symbols...`, "refresh");

      for (const sym of enabledSymbols) {
        try {
          const dailyPolygon = await fetchDailyBars(sym.ticker, from200, today);
          for (const bar of dailyPolygon) {
            const date = formatDate(new Date(bar.t));
            await storage.upsertDailyBar({
              ticker: sym.ticker,
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
          log(`Fetched ${dailyPolygon.length} daily bars for ${sym.ticker}`, "refresh");

          const intradayPolygon = await fetchIntradayBars(sym.ticker, from15, today, timeframe);
          for (const bar of intradayPolygon) {
            const ts = new Date(bar.t).toISOString();
            await storage.upsertIntradayBar({
              ticker: sym.ticker,
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
          log(`Fetched ${intradayPolygon.length} intraday bars for ${sym.ticker}`, "refresh");

          const allDailyBars = await storage.getDailyBars(sym.ticker);
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

          const watchlistTickers = (settings.watchlistPriority || "SPY,QQQ,NVDA,TSLA").split(",").map(t => t.trim().toUpperCase());

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

            const historicalHitRate = await storage.getHitRateForTickerSetup(sym.ticker, setup.setupType);
            const tthStats = await storage.getTimeToHitStats(sym.ticker, setup.setupType);
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
            const universeMode = settings.universeMode || "HYBRID";
            const liquidityThreshold = parseFloat(settings.liquidityThreshold || "250000000");
            if (universeMode === "WATCHLIST_ONLY") {
              universePass = watchlistTickers.includes(sym.ticker);
            } else if (universeMode === "LIQUIDITY_ONLY") {
              universePass = avgDollarVol >= liquidityThreshold;
            } else {
              universePass = watchlistTickers.includes(sym.ticker) || avgDollarVol >= liquidityThreshold;
            }

            let tier = qualityScoreToTier(qualityResult.total, sigP60, sigP120);
            if (watchlistTickers.includes(sym.ticker) && tier === "B") {
              tier = "A";
            } else if (watchlistTickers.includes(sym.ticker) && tier === "C") {
              tier = "B";
            }

            const tradePlan = generateTradePlan(
              lastBar.close,
              setup.magnetPrice,
              allDailyBars,
              settings.entryMode || "conservative",
              settings.stopMode || "atr"
            );

            let status = "pending";
            let hitTs: string | null = null;
            let missReason: string | null = null;

            const intradayBarsData = await storage.getIntradayBars(sym.ticker, setup.targetDate, timeframe);
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
              ticker: sym.ticker,
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
            });
          }

          log(`Generated ${setups.length} setups for ${sym.ticker}`, "refresh");
        } catch (err: any) {
          log(`Error refreshing ${sym.ticker}: ${err.message}`, "refresh");
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
      const allowedKeys = ["intradayTimeframe", "gapThreshold", "entryMode", "stopMode", "sessionStart", "sessionEnd", "watchlistPriority", "alertTierAplus", "alertTierA", "alertTierB", "alertTierC", "universeMode", "liquidityThreshold", "timePriorityMode"];
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

  return httpServer;
}
