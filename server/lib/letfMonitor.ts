import { storage } from "../storage";
import { fetchStockPriceAtTime, fetchSnapshot } from "./polygon";
import { fetchStockNbbo } from "./leveragedEtf";
import { log } from "../index";
import { isRTH } from "../jobs/scheduler";
import type { Signal, InstrumentLive, LeveragedEtfSuggestion } from "@shared/schema";

const letfLiveCache = new Map<number, InstrumentLive>();
const entryValidated = new Set<number>();
const letfEntryPriceCache = new Map<number, number>();

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let lastTickMs = 0;
const RTH_INTERVAL = 30_000;
const OFF_HOURS_INTERVAL = 5 * 60_000;

export async function refreshLetfQuotesForActiveSignals(): Promise<number> {
  let updated = 0;
  try {
    const activeSignals = await storage.getActivatedSignals();
    if (activeSignals.length === 0) return 0;

    const letfSignals = activeSignals.filter(s => {
      if (s.instrumentType === "LEVERAGED_ETF" && s.instrumentTicker) return true;
      const letfJson = s.leveragedEtfJson as LeveragedEtfSuggestion | null;
      return letfJson && letfJson.ticker;
    });

    if (letfSignals.length === 0) return 0;

    const getLetfTicker = (s: Signal): string => {
      if (s.instrumentType === "LEVERAGED_ETF" && s.instrumentTicker) return s.instrumentTicker;
      const letfJson = s.leveragedEtfJson as LeveragedEtfSuggestion | null;
      return letfJson!.ticker;
    };

    const uniqueTickers = Array.from(new Set(letfSignals.map(s => getLetfTicker(s))));
    const snapshotMap = new Map<string, { lastPrice: number }>();
    const quoteMap = new Map<string, any>();

    await Promise.all(uniqueTickers.map(async (ticker) => {
      try {
        const [snap, nbbo] = await Promise.all([
          fetchSnapshot(ticker),
          fetchStockNbbo(ticker),
        ]);
        if (snap && snap.lastPrice > 0) snapshotMap.set(ticker, snap);
        if (nbbo) quoteMap.set(ticker, nbbo);
      } catch {}
    }));

    for (const sig of letfSignals) {
      try {
        const instrTicker = getLetfTicker(sig);
        const snap = snapshotMap.get(instrTicker);
        const quote = quoteMap.get(instrTicker);
        const livePrice = snap?.lastPrice ?? quote?.mid ?? null;
        if (livePrice == null || livePrice <= 0) continue;

        let entryPrice: number | null = null;

        if (sig.instrumentType === "LEVERAGED_ETF" && sig.instrumentEntryPrice != null) {
          entryPrice = sig.instrumentEntryPrice;
        } else if (letfEntryPriceCache.has(sig.id)) {
          entryPrice = letfEntryPriceCache.get(sig.id)!;
        }

        if (!entryValidated.has(sig.id) && sig.activatedTs) {
          const activationMs = new Date(sig.activatedTs).getTime();
          const historicalPrice = await fetchStockPriceAtTime(instrTicker, activationMs);
          if (historicalPrice != null) {
            if (entryPrice == null || Math.abs(entryPrice - historicalPrice) > 0.01) {
              entryPrice = historicalPrice;
              if (sig.instrumentType === "LEVERAGED_ETF") {
                await storage.updateSignalInstrument(sig.id, sig.instrumentType!, instrTicker, entryPrice);
              }
            }
          } else if (entryPrice == null) {
            entryPrice = livePrice;
            if (sig.instrumentType === "LEVERAGED_ETF") {
              await storage.updateSignalInstrument(sig.id, sig.instrumentType!, instrTicker, entryPrice);
            }
          }
          if (entryPrice != null) {
            letfEntryPriceCache.set(sig.id, entryPrice);
          }
          entryValidated.add(sig.id);
        }

        const changeAbs = entryPrice != null
          ? Math.round((livePrice - entryPrice) * 100) / 100
          : null;
        const changePct = entryPrice != null && entryPrice > 0
          ? Math.round(((livePrice - entryPrice) / entryPrice) * 10000) / 100
          : null;

        const hasSnap = snap != null && snap.lastPrice > 0;
        const staleQuote = !hasSnap && (quote?.stale ?? true);
        const quoteTs = quote?.ts ?? Date.now();

        const instrLive: InstrumentLive = {
          priceNow: livePrice,
          entryPrice,
          changeAbs,
          changePct,
          bid: quote?.bid ?? null,
          ask: quote?.ask ?? null,
          spread: quote?.spread ?? null,
          spreadPct: quote?.spreadPct != null ? Math.round(quote.spreadPct * 10000) / 10000 : null,
          ts: quoteTs,
          stale: staleQuote,
          wideSpread: quote?.wideSpread ?? false,
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
