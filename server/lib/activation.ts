import { storage } from "../storage";
import { fetchSnapshot, fetchIntradayBars } from "./polygon";
import { log } from "../index";
import { enrichOptionData } from "./options";
import {
  checkEntryTrigger,
  runActivationCheck,
  type ActivationEvent,
  type ActivationSignal,
  type ActivationScanConfig,
  type ActivationMutation,
} from "./signalHelper";
import type { Signal, TradePlan } from "@shared/schema";

export type { ActivationEvent };
export { checkEntryTrigger };

interface StopConfig {
  stopMode: string;
  beProgressThreshold: number;
  beRThreshold: number;
  timeStopMinutes: number;
  timeStopProgressThreshold: number;
  timeStopTightenFactor: number;
}

function getStopConfig(settings: Record<string, string>): StopConfig {
  return {
    stopMode: settings.stopManagementMode || "VOLATILITY_ONLY",
    beProgressThreshold: parseFloat(settings.beProgressThreshold || "0.25"),
    beRThreshold: parseFloat(settings.beRThreshold || "0.5"),
    timeStopMinutes: parseInt(settings.timeStopMinutes || "120"),
    timeStopProgressThreshold: parseFloat(
      settings.timeStopProgressThreshold || "0.15",
    ),
    timeStopTightenFactor: parseFloat(settings.timeStopTightenFactor || "0.5"),
  };
}

function signalToActivationSignal(sig: Signal): ActivationSignal | null {
  const tp = sig.tradePlanJson as TradePlan | null;
  if (!tp) return null;
  return {
    id: sig.id,
    ticker: sig.ticker,
    setupType: sig.setupType,
    targetDate: sig.targetDate,
    activationStatus: sig.activationStatus,
    status: sig.status,
    entryPrice: sig.entryPriceAtActivation ?? null,
    stopPrice: sig.stopPrice ?? null,
    stopStage: sig.stopStage ?? "INITIAL",
    activatedTs: sig.activatedTs ?? null,
    tier: sig.tier,
    qualityScore: sig.qualityScore,
    tradePlan: tp,
    timeStopTriggeredTs: sig.timeStopTriggeredTs ?? null,
  };
}

async function applyMutationsToDb(mutations: ActivationMutation[]): Promise<void> {
  for (const mut of mutations) {
    switch (mut.type) {
      case "invalidated":
        await storage.updateSignalInvalidation(mut.signalId, new Date().toISOString());
        break;
      case "stop_to_be":
        if (mut.stopPrice != null) {
          await storage.updateSignalStopStage(mut.signalId, "BE", mut.stopPrice, new Date().toISOString());
        }
        break;
      case "time_stop":
        if (mut.stopPrice != null) {
          await storage.updateSignalStopStage(mut.signalId, "TIME_TIGHTENED", mut.stopPrice, undefined, new Date().toISOString());
        }
        break;
      case "activated":
        await storage.updateSignalActivation(
          mut.signalId,
          "ACTIVE",
          mut.activatedTs,
          mut.entryPrice,
          mut.stopPrice,
          mut.entryTriggerPrice,
        );
        break;
    }
  }
}

async function handlePostActivation(
  sig: Signal,
  tp: TradePlan,
  mut: ActivationMutation,
): Promise<void> {
  const entryPrice = mut.entryPrice!;

  const instrumentTypeForExecution = await enrichOptionData(
    sig.ticker,
    sig,
    tp,
    mut.activatedTs,
  );

  let btodActive = false;
  let btodAllowed = true;
  try {
    const btodEnabled =
      (await storage.getSetting("btodEnabled")) !== "false";
    if (btodEnabled) {
      btodActive = true;
      const { shouldExecuteActivation } = await import("./btod");
      const btodDecision = await shouldExecuteActivation(sig.id, new Date());
      if (!btodDecision.execute) {
        btodAllowed = false;
        log(
          `BTOD: passed over signal ${sig.id} (${sig.ticker} QS=${sig.qualityScore ?? 0}) — reason: ${btodDecision.reason}`,
          "activation",
        );
      }
    }
  } catch (btodErr: any) {
    log(
      `BTOD: error checking signal ${sig.id}, allowing execution as fallback: ${btodErr.message}`,
      "activation",
    );
  }

  if (btodActive && btodAllowed) {
    try {
      const { executeBtodMultiInstrument, onBtodTradeExecuted, shouldExecuteActivation } = await import("./btod");
      const recheck = await shouldExecuteActivation(sig.id, new Date());
      if (!recheck.execute) {
        log(
          `BTOD: Re-check blocked signal ${sig.id} (${sig.ticker}) — reason: ${recheck.reason} (race prevented)`,
          "activation",
        );
      } else {
        const qty =
          parseInt(
            (await storage.getSetting("ibkrDefaultQuantity")) || "1",
          ) || 1;
        const results = await executeBtodMultiInstrument(sig.id, qty);
        const successCount = results.filter((r) => r.success).length;
        log(
          `BTOD: Multi-instrument execution for signal ${sig.id}: ${successCount}/${results.length} instruments spawned`,
          "activation",
        );

        await onBtodTradeExecuted(sig.id);
      }
    } catch (btodExecErr: any) {
      log(
        `BTOD: Multi-instrument execution failed for signal ${sig.id}: ${btodExecErr.message}`,
        "activation",
      );
    }
  } else if (!btodActive) {
    // Non-BTOD path (commented out in original)
  } else {
    log(
      `Skip execution for signal ${sig.id}: BTOD gate blocked`,
      "activation",
    );
  }
}

export async function runActivationScan(): Promise<ActivationEvent[]> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const settings = await storage.getAllSettings();
  const entryMode = settings.entryMode || "conservative";
  const timeframe = settings.intradayTimeframe || "5";
  const stopCfg = getStopConfig(settings);

  const activeSignals = await storage.getActiveSignals();
  if (activeSignals.length === 0) return [];

  const currentPriceByTicker = new Map<string, number | null>();
  const tickerSet = new Set(activeSignals.map((s) => s.ticker));
  for (const ticker of tickerSet) {
    try {
      const snap = await fetchSnapshot(ticker);
      const currentPrice = snap && snap.lastPrice > 0 ? snap.lastPrice : null;
      currentPriceByTicker.set(ticker, currentPrice);
    } catch (err: any) {
      log(
        `Activation: failed to get snapshot for ${ticker}: ${err.message}`,
        "activation",
      );
    }
  }

  const pendingTodayTickers = new Set<string>();
  for (const sig of activeSignals) {
    if (sig.targetDate === today && sig.activationStatus === "NOT_ACTIVE") {
      pendingTodayTickers.add(sig.ticker);
    }
  }
  if (pendingTodayTickers.size > 0) {
    log(`Activation: Fetching fresh bars for ${pendingTodayTickers.size} ticker(s)`, "activation");
    for (const ticker of pendingTodayTickers) {
      try {
        const freshBars = await fetchIntradayBars(ticker, today, today, timeframe);
        for (const bar of freshBars) {
          const ts = new Date(bar.t).toISOString();
          await storage.upsertIntradayBar({
            ticker, ts, open: bar.o, high: bar.h, low: bar.l, close: bar.c,
            volume: bar.v, timeframe, source: "polygon",
          });
        }
      } catch (err: any) {
        log(`Activation: fresh bar fetch failed for ${ticker}: ${err.message}`, "activation");
      }
    }
  }

  const activationSignals: ActivationSignal[] = [];
  for (const sig of activeSignals) {
    const mapped = signalToActivationSignal(sig);
    if (mapped) activationSignals.push(mapped);
  }

  const intradayBarCache = new Map<string, Array<{ ts: string; open: number; high: number; low: number; close: number; volume: number }>>();
  for (const sig of activationSignals) {
    if (sig.activationStatus === "ACTIVE" || sig.activationStatus === "INVALIDATED") continue;
    if (sig.status !== "pending") continue;
    const key = `${sig.ticker}:${sig.targetDate}`;
    if (intradayBarCache.has(key)) continue;
    try {
      const polygonBars = await fetchIntradayBars(sig.ticker, sig.targetDate, sig.targetDate, timeframe);
      intradayBarCache.set(key, polygonBars.map((b) => ({
        ts: new Date(b.t).toISOString(), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
      })));
    } catch {}
  }

  const scanConfig: ActivationScanConfig = {
    entryMode,
    ...stopCfg,
    now,
    today,
  };

  const { events, mutations } = runActivationCheck(
    activationSignals,
    (ticker) => currentPriceByTicker.get(ticker) ?? null,
    (ticker, targetDate) => intradayBarCache.get(`${ticker}:${targetDate}`) ?? [],
    scanConfig,
  );

  await applyMutationsToDb(mutations);

  const signalById = new Map(activeSignals.map((s) => [s.id, s]));
  for (const mut of mutations) {
    if (mut.type === "activated") {
      const sig = signalById.get(mut.signalId);
      if (sig) {
        const tp = sig.tradePlanJson as TradePlan | null;
        if (tp) {
          await handlePostActivation(sig, tp, mut);
        }
      }
    }
  }

  log(`Activation scan complete: ${events.length} events`, "activation");
  return events;
}

import { hasLeveragedEtfMapping, selectBestLeveragedEtf, fetchStockNbbo } from "./leveragedEtf";

export async function ensureLetfForSignal(signal: Signal): Promise<Signal | null> {
  const letfData = signal.leveragedEtfJson as any;
  if (letfData?.ticker || signal.instrumentTicker) {
    const fresh = await storage.getSignals(undefined, 5000);
    const s = fresh.find((s: any) => s.id === signal.id);
    return s ?? signal;
  }
  const ticker = signal.ticker;
  if (!hasLeveragedEtfMapping(ticker)) return null;
  const tp = signal.tradePlanJson as TradePlan | null;
  if (!tp) return null;
  try {
    const suggestion = await selectBestLeveragedEtf(ticker, tp.bias);
    if (!suggestion) return null;
    const letfQuote = await fetchStockNbbo(suggestion.ticker);
    const letfEntry = letfQuote?.mid ?? null;
    await storage.updateSignalLeveragedEtf(signal.id, suggestion);
    await storage.updateSignalInstrument(signal.id, "LEVERAGED_ETF", suggestion.ticker, letfEntry);
    const fresh = await storage.getSignals(undefined, 5000);
    const s = fresh.find((s: any) => s.id === signal.id);
    return s ?? signal;
  } catch (err: any) {
    log(`ensureLetfForSignal error for signal ${signal.id}: ${err.message}`, "activation");
    return null;
  }
}
