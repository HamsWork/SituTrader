import { storage } from "../storage";
import { runBacktest, computeAndStoreTimeToHitStats } from "../lib/backtest";
import { log } from "../index";

export interface BacktestRunStatus {
  running: boolean;
  logs: Array<{ message: string; type: string; ts: number }>;
  progress: { completed: number; total: number; ticker: string; setup: string } | null;
  finalStats: { completed: number; total: number } | null;
  error: string | null;
  startedAt: number | null;
  config: { tickers: string[]; setups: string[]; startDate: string; endDate: string } | null;
}

interface BacktestRunState {
  aborted: boolean;
  logs: Array<{ message: string; type: string; ts: number }>;
  logBaseOffset: number;
  progress: { completed: number; total: number; ticker: string; setup: string } | null;
  finalStats: { completed: number; total: number } | null;
  error: string | null;
  startedAt: number;
  config: { tickers: string[]; setups: string[]; startDate: string; endDate: string };
}

let activeRun: BacktestRunState | null = null;

const MAX_LOGS = 5000;
const AUTO_CLEAR_MS = 30 * 60 * 1000;

let autoClearTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoClear() {
  if (autoClearTimer) clearTimeout(autoClearTimer);
  autoClearTimer = setTimeout(() => {
    if (activeRun && !isBacktestRunActive()) {
      activeRun = null;
    }
    autoClearTimer = null;
  }, AUTO_CLEAR_MS);
}

export function isBacktestRunActive(): boolean {
  return activeRun !== null && !activeRun.aborted && activeRun.finalStats === null && activeRun.error === null;
}

export function getBacktestRunStatus(): BacktestRunStatus {
  if (!activeRun) {
    return {
      running: false,
      logs: [],
      progress: null,
      finalStats: null,
      error: null,
      startedAt: null,
      config: null,
    };
  }

  const running = !activeRun.aborted && activeRun.finalStats === null && activeRun.error === null;

  return {
    running,
    logs: activeRun.logs,
    progress: activeRun.progress,
    finalStats: activeRun.finalStats,
    error: activeRun.error,
    startedAt: activeRun.startedAt,
    config: activeRun.config,
  };
}

export function getBacktestRunLogsSince(fromIndex: number): { logs: Array<{ message: string; type: string; ts: number }>; totalLogs: number } {
  if (!activeRun) return { logs: [], totalLogs: 0 };
  const totalEverWritten = activeRun.logBaseOffset + activeRun.logs.length;
  const arrayIdx = Math.max(0, fromIndex - activeRun.logBaseOffset);
  return {
    logs: activeRun.logs.slice(arrayIdx),
    totalLogs: totalEverWritten,
  };
}

export async function startBacktestRun(tickers: string[], setups: string[], startDate: string, endDate: string): Promise<{ ok: boolean; message?: string }> {
  if (isBacktestRunActive()) {
    activeRun!.aborted = true;
    await new Promise(r => setTimeout(r, 200));
  }

  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null; }
  const state: BacktestRunState = {
    aborted: false,
    logs: [],
    logBaseOffset: 0,
    progress: null,
    finalStats: null,
    error: null,
    startedAt: Date.now(),
    config: { tickers, setups, startDate, endDate },
  };

  activeRun = state;

  (async () => {
    try {
      const settings = await storage.getAllSettings();
      const timeframe = settings.intradayTimeframe || "5";
      const totalCombos = tickers.length * setups.length;
      let completed = 0;

      const addLog = (message: string, type: string) => {
        state.logs.push({ message, type, ts: Date.now() });
        if (state.logs.length > MAX_LOGS) {
          const drop = state.logs.length - MAX_LOGS;
          state.logs = state.logs.slice(drop);
          state.logBaseOffset += drop;
        }
      };

      addLog(`Starting backtest: ${tickers.length} tickers × ${setups.length} setups = ${totalCombos} combos`, "info");
      addLog(`Date range: ${startDate} → ${endDate} | Timeframe: ${timeframe}min`, "info");

      for (const ticker of tickers) {
        for (const setup of setups) {
          if (state.aborted) {
            addLog("Backtest cancelled", "info");
            return;
          }

          state.progress = { completed, total: totalCombos, ticker, setup };
          addLog(`[${completed + 1}/${totalCombos}] Running ${ticker} setup ${setup}...`, "processing");

          try {
            const result = await runBacktest(ticker, setup, startDate, endDate, timeframe);
            await storage.upsertBacktest(result);

            const hitInfo = result.occurrences > 0
              ? `${result.hits}/${result.occurrences} hits (${(result.hitRate * 100).toFixed(1)}%)`
              : "0 occurrences";
            addLog(`  ✓ ${ticker} ${setup}: ${hitInfo}`, "success");

            await computeAndStoreTimeToHitStats(ticker, setup, timeframe);
          } catch (err: any) {
            addLog(`  ✗ ${ticker} ${setup}: ${err.message}`, "error");
          }
          completed++;
          state.progress = { completed, total: totalCombos, ticker, setup };
        }
      }

      if (!state.aborted) {
        try {
          addLog("Recomputing expectancy stats...", "info");
          const { recomputeAllExpectancy } = await import("../lib/expectancy");
          await recomputeAllExpectancy();
          addLog("Expectancy stats recomputed", "success");
        } catch (err: any) {
          addLog(`Expectancy recompute failed: ${err.message}`, "error");
        }

        state.finalStats = { completed: totalCombos, total: totalCombos };
        addLog(`Backtest complete: ${totalCombos} combos processed`, "done");
      }

      log(`Backtest run finished: ${completed}/${totalCombos} combos`, "backtest-run");
      scheduleAutoClear();
    } catch (err: any) {
      state.error = err.message;
      state.logs.push({ message: `Fatal error: ${err.message}`, type: "error", ts: Date.now() });
      log(`Backtest run error: ${err.message}`, "backtest-run");
      scheduleAutoClear();
    }
  })();

  return { ok: true };
}

export function cancelBacktestRun(): boolean {
  if (!activeRun) return false;
  activeRun.aborted = true;
  return true;
}

export function clearBacktestRun(): void {
  if (activeRun && !isBacktestRunActive()) {
    activeRun = null;
  }
}
