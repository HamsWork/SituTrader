import { storage } from "../storage";
import { fetchStockPriceAtTime } from "./polygon";
import { fetchStockNbbo } from "./leveragedEtf";
import { log } from "../index";
import { isRTH } from "../jobs/scheduler";
import type { Signal, InstrumentLive, LeveragedEtfSuggestion } from "@shared/schema";

const letfLiveCache = new Map<number, InstrumentLive>();

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastTickMs = 0;
const RTH_INTERVAL = 30_000;
const OFF_HOURS_INTERVAL = 5 * 60_000;

export async function refreshLetfQuotesForActiveSignals(): Promise<number> {
  let updated = 0;
  try {
    const activeSignals = await storage.getActivatedSignals();
    if (activeSignals.length === 0) return 0;

    const letfSignals = activeSignals.filter(s =>
      s.instrumentType === "LEVERAGED_ETF" && s.instrumentTicker
    );

    if (letfSignals.length === 0) return 0;

    const uniqueTickers = Array.from(new Set(letfSignals.map(s => s.instrumentTicker!)));
    const quoteMap = new Map<string, any>();

    await Promise.all(uniqueTickers.map(async (ticker) => {
      try {
        const q = await fetchStockNbbo(ticker);
        if (q) quoteMap.set(ticker, q);
      } catch {}
    }));

    for (const sig of letfSignals) {
      try {
        const instrTicker = sig.instrumentTicker!;
        const quote = quoteMap.get(instrTicker);
        if (!quote || quote.mid == null) continue;

        let entryPrice = sig.instrumentEntryPrice;

        if (entryPrice == null) {
          if (sig.activatedTs) {
            const activationMs = new Date(sig.activatedTs).getTime();
            const historicalPrice = await fetchStockPriceAtTime(instrTicker, activationMs);
            if (historicalPrice != null) {
              entryPrice = historicalPrice;
              log(`LETF entry price backfilled from historical data for signal ${sig.id} (${instrTicker}): $${entryPrice} @ ${sig.activatedTs}`, "letfMonitor");
            }
          }
          if (entryPrice == null) {
            entryPrice = quote.mid;
            log(`LETF entry price fallback to current for signal ${sig.id} (${instrTicker}): $${entryPrice}`, "letfMonitor");
          }
          await storage.updateSignalInstrument(sig.id, sig.instrumentType!, instrTicker, entryPrice);
        }

        const changeAbs = entryPrice != null && quote.mid != null
          ? Math.round((quote.mid - entryPrice) * 100) / 100
          : null;
        const changePct = entryPrice != null && entryPrice > 0 && quote.mid != null
          ? Math.round(((quote.mid - entryPrice) / entryPrice) * 10000) / 100
          : null;

        const instrLive: InstrumentLive = {
          priceNow: quote.mid,
          entryPrice,
          changeAbs,
          changePct,
          bid: quote.bid,
          ask: quote.ask,
          spread: quote.spread,
          spreadPct: quote.spreadPct != null ? Math.round(quote.spreadPct * 10000) / 10000 : null,
          ts: quote.ts,
          stale: quote.stale,
          wideSpread: quote.wideSpread,
        };

        letfLiveCache.set(sig.id, instrLive);
        updated++;
      } catch (err: any) {
        log(`LETF monitor error for signal ${sig.id}: ${err.message}`, "letfMonitor");
      }
    }

    if (updated > 0) {
      log(`LETF monitor updated ${updated}/${letfSignals.length} signals`, "letfMonitor");
    }
  } catch (err: any) {
    log(`LETF monitor tick error: ${err.message}`, "letfMonitor");
  }
  return updated;
}

export function getLetfLiveData(signalId: number): InstrumentLive | undefined {
  return letfLiveCache.get(signalId);
}

export function startLetfMonitor() {
  if (monitorInterval) return;

  log("Starting LETF price monitor...", "letfMonitor");

  async function tick() {
    const now = Date.now();
    const rth = isRTH();
    const interval = rth ? RTH_INTERVAL : OFF_HOURS_INTERVAL;

    if (now - lastTickMs < interval) return;
    lastTickMs = now;

    await refreshLetfQuotesForActiveSignals();
  }

  monitorInterval = setInterval(tick, 15_000);
  setTimeout(tick, 5_000);
}

export function stopLetfMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
