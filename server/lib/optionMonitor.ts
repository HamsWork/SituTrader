import { storage } from "../storage";
import { fetchOptionMark, fetchOptionMarkAtTime } from "./polygon";
import { log } from "../index";
import { isRTH } from "../jobs/scheduler";
import type { Signal, OptionsData, OptionLive } from "@shared/schema";

const optionLiveCache = new Map<number, OptionLive>();

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastTickMs = 0;
const RTH_INTERVAL = 10_000;
const OFF_HOURS_INTERVAL = 5 * 60_000;

function getContractTicker(signal: Signal): string | null {
  if (signal.optionContractTicker) return signal.optionContractTicker;
  const opts = signal.optionsJson as OptionsData | null;
  if (opts?.candidate?.contractSymbol) return opts.candidate.contractSymbol;
  return null;
}

export async function refreshOptionQuotesForActiveSignals(): Promise<number> {
  let updated = 0;
  try {
    const activeSignals = await storage.getActivatedSignals();
    if (activeSignals.length === 0) return 0;

    const signalsWithOptions = activeSignals.filter(s => {
      const ct = getContractTicker(s);
      return ct != null;
    });

    if (signalsWithOptions.length === 0) return 0;

    await Promise.all(signalsWithOptions.map(async (sig) => {
      try {
        const contractTicker = getContractTicker(sig)!;

        if (!sig.optionContractTicker && contractTicker) {
          await storage.updateSignalOptionTracking(sig.id, { optionContractTicker: contractTicker });
        }

        const result = await fetchOptionMark(contractTicker, sig.ticker);
        if (!result || result.mark == null) return;

        let entryMark = sig.optionEntryMark;
        if (entryMark == null) {
          if (sig.activatedTs) {
            const activationMs = new Date(sig.activatedTs).getTime();
            const historicalMark = await fetchOptionMarkAtTime(contractTicker, activationMs);
            if (historicalMark != null) {
              entryMark = historicalMark;
              log(`Option entry mark backfilled from historical data for signal ${sig.id} (${sig.ticker}): $${entryMark} @ ${sig.activatedTs}`, "optionMonitor");
            }
          }
          if (entryMark == null) {
            entryMark = result.mark;
            log(`Option entry mark fallback to current for signal ${sig.id} (${sig.ticker}): $${entryMark}`, "optionMonitor");
          }
          await storage.updateSignalOptionTracking(sig.id, { optionEntryMark: entryMark });
        }

        const changeAbs = entryMark != null ? Math.round((result.mark - entryMark) * 100) / 100 : null;
        const changePct = entryMark != null && entryMark > 0 ? Math.round(((result.mark - entryMark) / entryMark) * 10000) / 100 : null;

        const optionLive: OptionLive = {
          bid: result.bid,
          ask: result.ask,
          mid: result.mark,
          openInterest: result.openInterest,
          volume: result.volume,
          impliedVol: result.impliedVol,
          delta: result.delta,
          lastUpdated: new Date().toISOString(),
          stale: result.stale,
          optionMarkNow: result.mark,
          optionBidNow: result.bid,
          optionAskNow: result.ask,
          optionSpreadNow: result.spread,
          optionNowTs: result.ts,
          optionEntryMark: entryMark,
          optionChangeAbs: changeAbs,
          optionChangePct: changePct,
        };

        optionLiveCache.set(sig.id, optionLive);
        updated++;
      } catch (err: any) {
        log(`Option monitor error for signal ${sig.id}: ${err.message}`, "optionMonitor");
      }
    }));

    if (updated > 0) {
      log(`Option monitor updated ${updated}/${signalsWithOptions.length} signals`, "optionMonitor");
    }
  } catch (err: any) {
    log(`Option monitor tick error: ${err.message}`, "optionMonitor");
  }
  return updated;
}

export function getOptionLiveData(signalId: number): OptionLive | undefined {
  return optionLiveCache.get(signalId);
}

export function startOptionMonitor() {
  if (monitorInterval) return;

  log("Starting option price monitor...", "optionMonitor");

  async function tick() {
    try {
      const now = Date.now();
      const rth = isRTH();
      const interval = rth ? RTH_INTERVAL : OFF_HOURS_INTERVAL;

      if (now - lastTickMs < interval) return;
      lastTickMs = now;

      await refreshOptionQuotesForActiveSignals();
    } catch (err: any) {
      log(`Option monitor tick error: ${err.message}`, "optionMonitor");
    }
  }

  monitorInterval = setInterval(tick, 15_000);
  setTimeout(tick, 5_000);
}

export function stopOptionMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
