import { runSimulation, type SimConfig, type SimControlSignal, type SimDayResult, type SimEventCallback } from "../simulation";
import { storage } from "../storage";
import { log } from "../index";

export interface SimulationStatus {
  running: boolean;
  paused: boolean;
  logs: Array<{ message: string; type: string; ts: number }>;
  progress: { completed: number; total: number; day: string; phase: string } | null;
  dayResults: any[];
  finalStats: any | null;
  error: string | null;
  startedAt: number | null;
  config: { tickers: string[]; setups: string[]; startDate: string; endDate: string } | null;
}

interface SimulationState {
  control: SimControlSignal;
  logs: Array<{ message: string; type: string; ts: number }>;
  logBaseOffset: number;
  progress: { completed: number; total: number; day: string; phase: string } | null;
  dayResults: any[];
  finalStats: any | null;
  error: string | null;
  startedAt: number;
  config: { tickers: string[]; setups: string[]; startDate: string; endDate: string };
}

let activeState: SimulationState | null = null;

const MAX_LOGS = 5000;
const AUTO_CLEAR_MS = 30 * 60 * 1000;

function emitToState(state: SimulationState): SimEventCallback {
  return (event: string, data: Record<string, any>) => {
    if (event === "log") {
      state.logs.push({ message: data.message, type: data.type, ts: Date.now() });
      if (state.logs.length > MAX_LOGS) {
        const drop = state.logs.length - MAX_LOGS;
        state.logs = state.logs.slice(drop);
        state.logBaseOffset += drop;
      }
    } else if (event === "progress") {
      state.progress = data as any;
    } else if (event === "day") {
      state.dayResults.push(data);
    } else if (event === "done") {
      state.finalStats = data;
      scheduleAutoClear();
    } else if (event === "error") {
      state.error = data.message;
      scheduleAutoClear();
    }
  };
}

let autoClearTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoClear() {
  if (autoClearTimer) clearTimeout(autoClearTimer);
  autoClearTimer = setTimeout(() => {
    if (activeState && !isSimulationRunning()) {
      activeState = null;
    }
    autoClearTimer = null;
  }, AUTO_CLEAR_MS);
}

export function isSimulationRunning(): boolean {
  return activeState !== null && !activeState.control.aborted && activeState.finalStats === null && activeState.error === null;
}

export function getSimulationStatus(): SimulationStatus {
  if (!activeState) {
    return {
      running: false,
      paused: false,
      logs: [],
      progress: null,
      dayResults: [],
      finalStats: null,
      error: null,
      startedAt: null,
      config: null,
    };
  }

  const running = !activeState.control.aborted && activeState.finalStats === null && activeState.error === null;

  return {
    running,
    paused: activeState.control.paused,
    logs: activeState.logs,
    progress: activeState.progress,
    dayResults: activeState.dayResults,
    finalStats: activeState.finalStats,
    error: activeState.error,
    startedAt: activeState.startedAt,
    config: activeState.config,
  };
}

export function getSimulationLogsSince(fromIndex: number): { logs: Array<{ message: string; type: string; ts: number }>; totalLogs: number } {
  if (!activeState) return { logs: [], totalLogs: 0 };
  const totalEverWritten = activeState.logBaseOffset + activeState.logs.length;
  const arrayIdx = Math.max(0, fromIndex - activeState.logBaseOffset);
  return {
    logs: activeState.logs.slice(arrayIdx),
    totalLogs: totalEverWritten,
  };
}

export async function startSimulation(tickers: string[], setups: string[], startDate: string, endDate: string): Promise<{ ok: boolean; message?: string }> {
  if (isSimulationRunning()) {
    activeState!.control.aborted = true;
    await new Promise(r => setTimeout(r, 200));
  }

  const control: SimControlSignal = { aborted: false, paused: false };
  if (autoClearTimer) { clearTimeout(autoClearTimer); autoClearTimer = null; }
  const state: SimulationState = {
    control,
    logs: [],
    logBaseOffset: 0,
    progress: null,
    dayResults: [],
    finalStats: null,
    error: null,
    startedAt: Date.now(),
    config: { tickers, setups, startDate, endDate },
  };

  activeState = state;

  (async () => {
    try {
      const settings = await storage.getAllSettings();
      const config: SimConfig = {
        startDate,
        endDate,
        tickers,
        setups,
        timeframe: settings.intradayTimeframe || "5",
        entryMode: settings.entryMode || "conservative",
        stopMode: settings.stopMode || "atr",
        atrMultiplier: parseFloat(settings.stopAtrMultiplier || "0.25") || 0.25,
        gapThreshold: parseFloat(settings.gapThreshold || "0.30") / 100,
      };

      const emit = emitToState(state);
      await runSimulation(config, emit, control);

      if (control.aborted && !state.finalStats) {
        state.logs.push({ message: "Simulation cancelled", type: "info", ts: Date.now() });
      }

      log(`Simulation finished: ${state.dayResults.length} days processed`, "simulation");
    } catch (err: any) {
      state.error = err.message;
      state.logs.push({ message: `Fatal error: ${err.message}`, type: "error", ts: Date.now() });
      log(`Simulation error: ${err.message}`, "simulation");
    }
  })();

  return { ok: true };
}

export function pauseSimulation(): boolean {
  if (!activeState || activeState.control.aborted) return false;
  activeState.control.paused = true;
  return true;
}

export function resumeSimulation(): boolean {
  if (!activeState || activeState.control.aborted) return false;
  activeState.control.paused = false;
  return true;
}

export function cancelSimulation(): boolean {
  if (!activeState) return false;
  activeState.control.aborted = true;
  return true;
}

export function clearSimulation(): void {
  if (activeState && !isSimulationRunning()) {
    activeState = null;
  }
}
