import * as cron from "node-cron";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { storage } from "../storage";
import { log } from "../index";
import { isTradingDay, formatDate, nextTradingDay } from "../lib/calendar";
import { runAfterCloseScan, runPreOpenScan, runLiveMonitorTick } from "./jobFunctions";

dayjs.extend(utc);
dayjs.extend(timezone);

const CT = "America/Chicago";

let afterCloseJob: ReturnType<typeof cron.schedule> | null = null;
let preOpenJob: ReturnType<typeof cron.schedule> | null = null;
let liveMonitorJob: ReturnType<typeof cron.schedule> | null = null;
let isInitialized = false;

function nowCT() {
  return dayjs().tz(CT);
}

function todayCT(): string {
  return nowCT().format("YYYY-MM-DD");
}

function isTradingDayToday(): boolean {
  return isTradingDay(todayCT());
}

function isRTH(): boolean {
  if (!isTradingDayToday()) return false;
  const now = nowCT();
  const h = now.hour();
  const m = now.minute();
  const totalMin = h * 60 + m;
  return totalMin >= 510 && totalMin < 900;
}

function computeNextAfterCloseTs(): string {
  let d = todayCT();
  const now = nowCT();
  const afterCloseMinutes = 15 * 60 + 10;
  const nowMin = now.hour() * 60 + now.minute();
  if (!isTradingDay(d) || nowMin >= afterCloseMinutes) {
    d = nextTradingDay(d);
  }
  return dayjs.tz(`${d} 15:10:00`, CT).toISOString();
}

function computeNextPreOpenTs(): string {
  let d = todayCT();
  const now = nowCT();
  const preOpenMinutes = 8 * 60 + 20;
  const nowMin = now.hour() * 60 + now.minute();
  if (!isTradingDay(d) || nowMin >= preOpenMinutes) {
    d = nextTradingDay(d);
  }
  return dayjs.tz(`${d} 08:20:00`, CT).toISOString();
}

async function persistNextTimes() {
  try {
    await storage.updateSchedulerState({
      nextAfterCloseTs: computeNextAfterCloseTs(),
      nextPreOpenTs: computeNextPreOpenTs(),
    });
  } catch (err: any) {
    log(`Scheduler: failed to persist next times: ${err.message}`, "scheduler");
  }
}

export async function initScheduler() {
  if (isInitialized) return;
  isInitialized = true;

  log("Initializing Author Mode scheduler...", "scheduler");
  const state = await storage.ensureSchedulerState();
  await persistNextTimes();

  afterCloseJob = cron.schedule("10 15 * * 1-5", async () => {
    try {
      const st = await storage.getSchedulerState();
      if (!st.authorModeEnabled) {
        log("After Close job skipped (Author Mode disabled)", "scheduler");
        return;
      }
      if (!isTradingDayToday()) {
        log("After Close job skipped (not a trading day)", "scheduler");
        return;
      }
      log("After Close scan starting (scheduled)...", "scheduler");
      const summary = await runAfterCloseScan();
      await storage.updateSchedulerState({
        lastAfterCloseRunTs: new Date().toISOString(),
        lastRunSummaryJson: {
          ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
          afterClose: summary,
        },
      });
      await persistNextTimes();
      log(`After Close scan complete: ${JSON.stringify(summary)}`, "scheduler");
    } catch (err: any) {
      log(`After Close scan error: ${err.message}`, "scheduler");
    }
  }, { timezone: CT });

  preOpenJob = cron.schedule("20 8 * * 1-5", async () => {
    try {
      const st = await storage.getSchedulerState();
      if (!st.authorModeEnabled) {
        log("Pre-Open job skipped (Author Mode disabled)", "scheduler");
        return;
      }
      if (!isTradingDayToday()) {
        log("Pre-Open job skipped (not a trading day)", "scheduler");
        return;
      }
      log("Pre-Open scan starting (scheduled)...", "scheduler");
      const summary = await runPreOpenScan();

      try {
        const { reEnrichExpiredOptions } = await import("../lib/options");
        const reEnrichResult = await reEnrichExpiredOptions();
        if (reEnrichResult.checked > 0) {
          log(`Pre-Open option re-enrichment: checked=${reEnrichResult.checked}, replaced=${reEnrichResult.reEnriched}, errors=${reEnrichResult.errors}`, "scheduler");
        }
      } catch (reErr: any) {
        log(`Pre-Open option re-enrichment error: ${reErr.message}`, "scheduler");
      }

      await storage.updateSchedulerState({
        lastPreOpenRunTs: new Date().toISOString(),
        lastRunSummaryJson: {
          ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
          preOpen: summary,
        },
      });
      await persistNextTimes();
      log(`Pre-Open scan complete: ${JSON.stringify(summary)}`, "scheduler");
    } catch (err: any) {
      log(`Pre-Open scan error: ${err.message}`, "scheduler");
    }
  }, { timezone: CT });

  let lastOptionReEnrichMs = 0;
  const OPTION_REENRICH_INTERVAL = 60 * 60 * 1000;
  let liveMonitorRunning = false;

  liveMonitorJob = cron.schedule("* * * * *", async () => {
    if (liveMonitorRunning) {
      log("Live monitor tick skipped — previous tick still running", "scheduler");
      return;
    }
    liveMonitorRunning = true;
    try {
      const st = await storage.getSchedulerState();
      if (!st.authorModeEnabled) { liveMonitorRunning = false; return; }
      if (!isRTH()) { liveMonitorRunning = false; return; }

      try {
        const btodEnabled = (await storage.getSetting("btodEnabled")) !== "false";
        if (btodEnabled) {
          const { isSelectivePhaseOver, transitionToOpenPhase, getBtodStatus } = await import("../lib/btod");
          if (isSelectivePhaseOver()) {
            const btodStatus = await getBtodStatus();
            if (btodStatus && btodStatus.phase === "SELECTIVE" && !btodStatus.selectedSignalId) {
              await transitionToOpenPhase();
            }
          }
        }
      } catch (btodErr: any) {
        log(`BTOD phase check error: ${btodErr.message}`, "scheduler");
      }

      try {
        if (Date.now() - lastOptionReEnrichMs >= OPTION_REENRICH_INTERVAL) {
          const { reEnrichExpiredOptions } = await import("../lib/options");
          const result = await reEnrichExpiredOptions();
          lastOptionReEnrichMs = Date.now();
          if (result.checked > 0) {
            log(`Option re-enrichment: checked=${result.checked}, replaced=${result.reEnriched}, errors=${result.errors}`, "scheduler");
          }
        }
      } catch (reEnrichErr: any) {
        log(`Option re-enrichment error: ${reEnrichErr.message}`, "scheduler");
      }

      log("Live monitor tick starting...", "scheduler");
      const summary = await runLiveMonitorTick();
      await storage.updateSchedulerState({
        lastLiveMonitorRunTs: new Date().toISOString(),
        lastRunSummaryJson: {
          ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
          live: summary,
        },
      });
      log(`Live monitor tick: ${JSON.stringify(summary)}`, "scheduler");
    } catch (err: any) {
      log(`Live monitor error: ${err.message}`, "scheduler");
    } finally {
      liveMonitorRunning = false;
    }
  }, { timezone: CT });

  if (!state.authorModeEnabled) {
    afterCloseJob.stop();
    preOpenJob.stop();
    liveMonitorJob.stop();
    log("Author Mode scheduler initialized but OFF", "scheduler");
  } else {
    log("Author Mode scheduler initialized and running", "scheduler");
  }
}

export function reconfigureJobs(authorModeEnabled: boolean) {
  if (!afterCloseJob || !preOpenJob || !liveMonitorJob) return;

  if (authorModeEnabled) {
    afterCloseJob.start();
    preOpenJob.start();
    liveMonitorJob.start();
  } else {
    afterCloseJob.stop();
    preOpenJob.stop();
    liveMonitorJob.stop();
  }
}

export async function runAutoNow(): Promise<{ job: string; summary: any }> {
  const now = nowCT();
  const h = now.hour();
  const m = now.minute();
  const totalMin = h * 60 + m;

  let job: string;
  let summary: any;

  if (isRTH()) {
    job = "liveOnce";
    log("AutoNow: Running live monitor tick (within RTH)...", "scheduler");
    summary = await runLiveMonitorTick();
    await storage.updateSchedulerState({
      lastLiveMonitorRunTs: new Date().toISOString(),
      lastRunSummaryJson: {
        ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
        live: summary,
      },
    });
  } else if (totalMin >= 480 && totalMin < 510) {
    job = "preOpen";
    log("AutoNow: Running pre-open rescore (pre-open window)...", "scheduler");
    summary = await runPreOpenScan();
    await storage.updateSchedulerState({
      lastPreOpenRunTs: new Date().toISOString(),
      lastRunSummaryJson: {
        ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
        preOpen: summary,
      },
    });
    await persistNextTimes();
  } else if (totalMin >= 900) {
    job = "afterClose";
    log("AutoNow: Running after close scan (after close window)...", "scheduler");
    summary = await runAfterCloseScan();
    await storage.updateSchedulerState({
      lastAfterCloseRunTs: new Date().toISOString(),
      lastRunSummaryJson: {
        ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
        afterClose: summary,
      },
    });
    await persistNextTimes();
  } else {
    job = "afterClose";
    log("AutoNow: Running after close scan (default)...", "scheduler");
    summary = await runAfterCloseScan();
    await storage.updateSchedulerState({
      lastAfterCloseRunTs: new Date().toISOString(),
      lastRunSummaryJson: {
        ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
        afterClose: summary,
      },
    });
    await persistNextTimes();
  }

  return { job, summary };
}

export { computeNextAfterCloseTs, computeNextPreOpenTs, isRTH, nowCT };
