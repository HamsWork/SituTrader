import { storage } from "../storage";
import { runBacktest, computeAndStoreTimeToHitStats } from "../lib/backtest";
import { SETUP_TYPES } from "@shared/schema";
import { log } from "../index";

let workerRunning = false;
let workerPaused = false;

export function isBacktestWorkerRunning(): boolean {
  return workerRunning;
}

export function isBacktestWorkerPaused(): boolean {
  return workerPaused;
}

export function pauseBacktestWorker(): void {
  workerPaused = true;
}

export function resumeBacktestWorker(): void {
  workerPaused = false;
}

const INTER_COMBO_DELAY_MS = 2000;

export async function startBacktestWorker(jobId?: number): Promise<void> {
  if (workerRunning) {
    log("Backtest worker already running, skipping", "backtest-worker");
    return;
  }

  workerRunning = true;
  workerPaused = false;

  try {
    let job = jobId
      ? await storage.getBacktestJob(jobId)
      : await storage.getActiveBacktestJob();

    if (!job) {
      const allSymbols = await storage.getSymbols();
      const tickers = allSymbols.map(s => s.ticker);
      if (tickers.length === 0) {
        log("No tickers in universe, nothing to backtest", "backtest-worker");
        workerRunning = false;
        return;
      }

      const setupTypes = [...SETUP_TYPES];
      const totalCombos = tickers.length * setupTypes.length;

      job = await storage.createBacktestJob({
        status: "running",
        startDate: "2024-01-01",
        endDate: new Date().toISOString().slice(0, 10),
        timeframe: "5",
        setupTypes: setupTypes,
        totalCombos,
        completedCombos: 0,
        failedCombos: 0,
        currentTicker: null,
        currentSetup: null,
        lastError: null,
        completedPairs: [],
      });

      log(`Created backtest job #${job.id}: ${tickers.length} tickers × ${setupTypes.length} setups = ${totalCombos} combos`, "backtest-worker");
    } else {
      await storage.updateBacktestJob(job.id, { status: "running" });
      log(`Resuming backtest job #${job.id}: ${job.completedCombos}/${job.totalCombos} already done`, "backtest-worker");
    }

    const allSymbols = await storage.getSymbols();
    const tickers = allSymbols.map(s => s.ticker);
    const setupTypes = job.setupTypes as string[];
    const completedSet = new Set((job.completedPairs as string[] | null) ?? []);

    let completedCombos = job.completedCombos;
    let failedCombos = job.failedCombos;

    for (const ticker of tickers) {
      for (const setup of setupTypes) {
        const pairKey = `${ticker}:${setup}`;

        if (completedSet.has(pairKey)) continue;

        while (workerPaused) {
          await storage.updateBacktestJob(job.id, { status: "paused" });
          await new Promise(r => setTimeout(r, 5000));
          const refreshed = await storage.getBacktestJob(job.id);
          if (refreshed?.status === "cancelled") {
            log("Backtest job cancelled while paused", "backtest-worker");
            workerRunning = false;
            return;
          }
        }

        const refreshed = await storage.getBacktestJob(job.id);
        if (refreshed?.status === "cancelled") {
          log("Backtest job cancelled", "backtest-worker");
          workerRunning = false;
          return;
        }

        await storage.updateBacktestJob(job.id, {
          status: "running",
          currentTicker: ticker,
          currentSetup: setup,
        });

        try {
          log(`Backtesting ${ticker} setup ${setup}...`, "backtest-worker");

          const result = await runBacktest(ticker, setup, job.startDate, job.endDate, job.timeframe);
          await storage.upsertBacktest(result);

          if (result.occurrences > 0) {
            await computeAndStoreTimeToHitStats(ticker, setup, job.timeframe);
          }

          completedCombos++;
          completedSet.add(pairKey);

          await storage.updateBacktestJob(job.id, {
            completedCombos,
            completedPairs: Array.from(completedSet),
          });

          log(`Completed ${ticker}:${setup} - ${result.occurrences} setups, ${result.hits} hits (${completedCombos}/${job.totalCombos})`, "backtest-worker");
        } catch (err: any) {
          failedCombos++;
          completedCombos++;
          completedSet.add(pairKey);

          await storage.updateBacktestJob(job.id, {
            completedCombos,
            failedCombos,
            lastError: `${ticker}:${setup} - ${err.message}`,
            completedPairs: Array.from(completedSet),
          });

          log(`Failed ${ticker}:${setup}: ${err.message}`, "backtest-worker");
        }

        await new Promise(r => setTimeout(r, INTER_COMBO_DELAY_MS));
      }
    }

    await storage.updateBacktestJob(job.id, {
      status: "completed",
      currentTicker: null,
      currentSetup: null,
    });

    log(`Backtest job #${job.id} completed: ${completedCombos} done, ${failedCombos} failed`, "backtest-worker");
  } catch (err: any) {
    log(`Backtest worker fatal error: ${err.message}`, "backtest-worker");
  } finally {
    workerRunning = false;
  }
}

export async function autoStartBacktestWorker(): Promise<void> {
  try {
    const existingJob = await storage.getActiveBacktestJob();
    if (existingJob) {
      log(`Found incomplete backtest job #${existingJob.id}, auto-resuming...`, "backtest-worker");
      setTimeout(() => startBacktestWorker(existingJob.id), 10000);
    }
  } catch (err: any) {
    log(`Auto-start check failed: ${err.message}`, "backtest-worker");
  }
}
