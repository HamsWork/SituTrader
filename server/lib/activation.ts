import { storage } from "../storage";
import { filterRTHBars, timestampToET } from "./validate";
import { fetchSnapshot } from "./polygon";
import { log } from "../index";
import type { Signal, TradePlan } from "@shared/schema";

export interface ActivationEvent {
  signalId: number;
  ticker: string;
  type: "activated" | "invalidated";
  tier: string;
  qualityScore: number;
  entryPrice: number;
  message: string;
  timestamp: string;
}

function checkEntryTrigger(
  bars: Array<{ ts: string; open: number; high: number; low: number; close: number; volume: number }>,
  tradePlan: TradePlan,
  entryMode: string
): { triggered: boolean; triggerTs?: string; entryPrice?: number; invalidated?: boolean } {
  const rthBars = filterRTHBars(bars);
  if (rthBars.length === 0) return { triggered: false };

  const isSell = tradePlan.bias === "SELL";
  const magnetPrice = tradePlan.t1;
  const stopDistance = tradePlan.stopDistance ?? (Math.abs(magnetPrice - rthBars[0]?.close ?? magnetPrice) * 0.5 || 1);

  if (entryMode === "aggressive") {
    for (const bar of rthBars) {
      const barET = timestampToET(bar.ts);
      const totalMin = barET.getHours() * 60 + barET.getMinutes();
      if (totalMin < 575) continue;

      if (isSell && bar.close < bar.open) {
        return { triggered: true, triggerTs: bar.ts, entryPrice: bar.close };
      }
      if (!isSell && bar.close > bar.open) {
        return { triggered: true, triggerTs: bar.ts, entryPrice: bar.close };
      }
    }
  } else {
    let breakoutSeen = false;
    let breakoutPrice = 0;
    let breakoutTs = "";

    for (let i = 1; i < rthBars.length; i++) {
      const bar = rthBars[i];
      const prevBar = rthBars[i - 1];

      if (!breakoutSeen) {
        if (isSell && bar.close < prevBar.low) {
          breakoutSeen = true;
          breakoutPrice = bar.close;
          breakoutTs = bar.ts;
        } else if (!isSell && bar.close > prevBar.high) {
          breakoutSeen = true;
          breakoutPrice = bar.close;
          breakoutTs = bar.ts;
        }
      } else {
        if (isSell) {
          if (bar.high >= breakoutPrice && bar.close <= breakoutPrice) {
            return { triggered: true, triggerTs: bar.ts, entryPrice: bar.close };
          }
          if (bar.close > breakoutPrice + stopDistance) {
            breakoutSeen = false;
          }
        } else {
          if (bar.low <= breakoutPrice && bar.close >= breakoutPrice) {
            return { triggered: true, triggerTs: bar.ts, entryPrice: bar.close };
          }
          if (bar.close < breakoutPrice - stopDistance) {
            breakoutSeen = false;
          }
        }
      }
    }

    if (breakoutSeen) {
      return { triggered: true, triggerTs: breakoutTs, entryPrice: breakoutPrice };
    }
  }

  return { triggered: false };
}

function checkInvalidation(
  currentPrice: number,
  tradePlan: TradePlan,
  entryPrice: number
): boolean {
  const stopDistance = tradePlan.stopDistance;
  if (!stopDistance || stopDistance <= 0) return false;
  if (tradePlan.bias === "SELL") {
    return currentPrice > entryPrice + stopDistance * 1.5;
  } else {
    return currentPrice < entryPrice - stopDistance * 1.5;
  }
}

export async function runActivationScan(): Promise<ActivationEvent[]> {
  const events: ActivationEvent[] = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const today = now.toISOString().slice(0, 10);

  const settings = await storage.getAllSettings();
  const entryMode = settings.entryMode || "conservative";
  const timeframe = settings.intradayTimeframe || "5";

  const activeSignals = await storage.getActiveSignals();
  if (activeSignals.length === 0) return events;

  const tickerGroups = new Map<string, Signal[]>();
  for (const sig of activeSignals) {
    if (!tickerGroups.has(sig.ticker)) tickerGroups.set(sig.ticker, []);
    tickerGroups.get(sig.ticker)!.push(sig);
  }

  for (const ticker of Array.from(tickerGroups.keys())) {
    const sigs = tickerGroups.get(ticker)!;

    let currentPrice: number | null = null;
    try {
      const snap = await fetchSnapshot(ticker);
      if (snap && snap.lastPrice > 0) currentPrice = snap.lastPrice;
    } catch (err: any) {
      log(`Activation: failed to get snapshot for ${ticker}: ${err.message}`, "activation");
      continue;
    }

    for (const sig of sigs) {
      const tp = sig.tradePlanJson as TradePlan | null;
      if (!tp) continue;

      if (sig.activationStatus === "ACTIVE") {
        if (currentPrice && checkInvalidation(currentPrice, tp, sig.entryPriceAtActivation ?? currentPrice)) {
          await storage.updateSignalActivation(sig.id, "INVALIDATED");
          events.push({
            signalId: sig.id,
            ticker,
            type: "invalidated",
            tier: sig.tier,
            qualityScore: sig.qualityScore,
            entryPrice: sig.entryPriceAtActivation ?? 0,
            message: `INVALIDATED: ${ticker} ${sig.setupType} entry at ${(sig.entryPriceAtActivation ?? 0).toFixed(2)} stopped out at ${currentPrice?.toFixed(2)}`,
            timestamp: nowIso,
          });
        }
        continue;
      }

      if (sig.activationStatus === "INVALIDATED") continue;

      const targetDate = sig.targetDate;
      const intradayBars = await storage.getIntradayBars(ticker, targetDate, timeframe);
      if (intradayBars.length === 0) {
        if (targetDate === today && currentPrice) {
          continue;
        }
        continue;
      }

      const result = checkEntryTrigger(
        intradayBars.map(b => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
        tp,
        entryMode
      );

      if (result.triggered && result.entryPrice) {
        await storage.updateSignalActivation(sig.id, "ACTIVE", result.triggerTs, result.entryPrice);
        events.push({
          signalId: sig.id,
          ticker,
          type: "activated",
          tier: sig.tier,
          qualityScore: sig.qualityScore,
          entryPrice: result.entryPrice,
          message: `ACTIVATED (${tp.bias}) ${ticker} ${sig.setupType} - Entry: $${result.entryPrice.toFixed(2)}, Target: $${tp.t1.toFixed(2)}, Stop: ${tp.invalidation}`,
          timestamp: nowIso,
        });
      }
    }
  }

  log(`Activation scan complete: ${events.length} events`, "activation");
  return events;
}
