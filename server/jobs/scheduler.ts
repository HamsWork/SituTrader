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

  log("Initializing auto scheduler...", "scheduler");
  const state = await storage.ensureSchedulerState();
  await persistNextTimes();

  afterCloseJob = cron.schedule("10 15 * * 1-5", async () => {
    try {
      const st = await storage.getSchedulerState();
      if (!st.autoEnabled || !st.afterCloseEnabled) {
        log("After Close job skipped (disabled)", "scheduler");
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
      if (!st.autoEnabled || !st.preOpenEnabled) {
        log("Pre-Open job skipped (disabled)", "scheduler");
        return;
      }
      if (!isTradingDayToday()) {
        log("Pre-Open job skipped (not a trading day)", "scheduler");
        return;
      }
      log("Pre-Open scan starting (scheduled)...", "scheduler");
      const summary = await runPreOpenScan();
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

  liveMonitorJob = cron.schedule("* * * * *", async () => {
    try {
      const st = await storage.getSchedulerState();
      if (!st.autoEnabled || !st.liveMonitorEnabled) return;
      if (!isRTH()) return;
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
    }
  }, { timezone: CT });

  if (!state.autoEnabled) {
    afterCloseJob.stop();
    preOpenJob.stop();
    liveMonitorJob.stop();
    log("Scheduler initialized but auto is OFF", "scheduler");
  } else {
    log("Scheduler initialized and running", "scheduler");
  }
}

export function reconfigureJobs(state: {
  autoEnabled: boolean;
  afterCloseEnabled: boolean;
  preOpenEnabled: boolean;
  liveMonitorEnabled: boolean;
}) {
  if (!afterCloseJob || !preOpenJob || !liveMonitorJob) return;

  if (state.autoEnabled) {
    afterCloseJob.start();
    preOpenJob.start();
    liveMonitorJob.start();
  } else {
    afterCloseJob.stop();
    preOpenJob.stop();
    liveMonitorJob.stop();
  }
}

export async function runJobManually(job: "afterClose" | "preOpen" | "liveOnce"): Promise<any> {
  if (job === "afterClose") {
    log("After Close scan starting (manual)...", "scheduler");
    const summary = await runAfterCloseScan();
    await storage.updateSchedulerState({
      lastAfterCloseRunTs: new Date().toISOString(),
      lastRunSummaryJson: {
        ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
        afterClose: summary,
      },
    });
    await persistNextTimes();
    return summary;
  }
  if (job === "preOpen") {
    log("Pre-Open scan starting (manual)...", "scheduler");
    const summary = await runPreOpenScan();
    await storage.updateSchedulerState({
      lastPreOpenRunTs: new Date().toISOString(),
      lastRunSummaryJson: {
        ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
        preOpen: summary,
      },
    });
    await persistNextTimes();
    return summary;
  }
  if (job === "liveOnce") {
    log("Live monitor tick starting (manual)...", "scheduler");
    const summary = await runLiveMonitorTick();
    await storage.updateSchedulerState({
      lastLiveMonitorRunTs: new Date().toISOString(),
      lastRunSummaryJson: {
        ...((await storage.getSchedulerState()).lastRunSummaryJson as any || {}),
        live: summary,
      },
    });
    return summary;
  }
  throw new Error(`Unknown job: ${job}`);
}

export { computeNextAfterCloseTs, computeNextPreOpenTs, isRTH, nowCT };
