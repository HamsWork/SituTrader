import { storage } from "../storage";
import { fetchSnapshot, fetchIntradayBars, fetchIntradayBarsCached, fetchStockPriceAtTime, fetchStockPrice } from "./polygon";
import { log } from "../index";
import { enrichOptionData } from "./options";
import {
  checkEntryTrigger,
  runActivationCheck,
  type ActivationEvent,
  type ActivationScanConfig,
  type ActivationMutation,
  checkActivationForTicker,
  monitorActivatedSignalsForTicker,
  refreshAndValidateSignal,
} from "./signalHelper";
import type { Signal, TradePlan, IntradayBar } from "@shared/schema";

export type { ActivationEvent };
export { checkEntryTrigger };

let btodMutexLocked = false;
const btodMutexQueue: Array<() => void> = [];

async function acquireBtodMutex(): Promise<void> {
  if (!btodMutexLocked) {
    btodMutexLocked = true;
    return;
  }
  return new Promise<void>((resolve) => {
    btodMutexQueue.push(() => {
      btodMutexLocked = true;
      resolve();
    });
  });
}

function releaseBtodMutex(): void {
  if (btodMutexQueue.length > 0) {
    const next = btodMutexQueue.shift()!;
    next();
  } else {
    btodMutexLocked = false;
  }
}

export interface StopConfig {
  stopMode: string;
  beProgressThreshold: number;
  beRThreshold: number;
  timeStopMinutes: number;
  timeStopProgressThreshold: number;
  timeStopTightenFactor: number;
}

export function getStopConfig(settings: Record<string, string>): StopConfig {
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

async function persistActivationToDb(mut: ActivationMutation): Promise<void> {
  await storage.updateSignalActivation(
    mut.signalId,
    "ACTIVE",
    mut.activatedTs,
    mut.entryPrice,
    mut.stopPrice,
    mut.entryTriggerPrice,
  );
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

  await acquireBtodMutex();
  try {
    const btodEnabled =
      (await storage.getSetting("btodEnabled")) !== "false";
    if (btodEnabled) {
      btodActive = true;
      const { shouldExecuteActivation } = await import("./btod");
      const btodDecision = await shouldExecuteActivation(sig.id, mut.activatedTs);
      if (!btodDecision.execute) {
        btodAllowed = false;
        log(
          `BTOD: passed over signal ${sig.id} (${sig.ticker} QS=${sig.qualityScore ?? 0}) — reason: ${btodDecision.reason}`,
          "activation",
        );
      }
    }

    await persistActivationToDb(mut);

    if (btodActive && btodAllowed) {
      try {
        const refreshResult = await refreshAndValidateSignal(sig);
        const refreshedSig = refreshResult.signal;

        if (refreshResult.invalidated) {
          log(
            `BTOD: Signal ${sig.id} invalidated during refresh: ${refreshResult.invalidationReason} — skipping execution`,
            "activation",
          );
        } else {
          if (refreshResult.warnings.length > 0) {
            log(`BTOD: Refresh warnings for signal ${sig.id}: ${refreshResult.warnings.join("; ")}`, "activation");
          }
          if (refreshResult.tradePlanRegenerated) {
            log(`BTOD: Trade plan regenerated for signal ${sig.id} during refresh`, "activation");
          }

          const { executeBtodMultiInstrument, onBtodTradeExecuted } = await import("./btod");

          const qty =
            parseInt(
              (await storage.getSetting("ibkrDefaultQuantity")) || "1",
            ) || 1;
          const results = await executeBtodMultiInstrument(refreshedSig, qty);
          const successCount = results.filter((r) => r.success).length;
          log(
            `BTOD: Multi-instrument execution for signal ${sig.id}: ${successCount}/${results.length} instruments spawned`,
            "activation",
          );

          if (results.length > 0 && successCount > 0) {
            await onBtodTradeExecuted(sig.id);
          } else {
            log(
              `BTOD: No successful instruments for signal ${sig.id} — skipping onBtodTradeExecuted`,
              "activation",
            );
          }
        }
      } catch (btodExecErr: any) {
        log(
          `BTOD: Multi-instrument execution failed for signal ${sig.id}: ${btodExecErr.message}`,
          "activation",
        );
      }
    } else if (!btodActive) {
      // Non-BTOD path
    } else {
      log(
        `Skip execution for signal ${sig.id}: BTOD gate blocked`,
        "activation",
      );
    }
  } catch (err: any) {
    log(
      `BTOD: error in handlePostActivation for signal ${sig.id}: ${err.message}`,
      "activation",
    );
    await persistActivationToDb(mut);
  } finally {
    releaseBtodMutex();
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
  for (const ticker of Array.from(tickerSet.values())) {
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
    for (const ticker of Array.from(pendingTodayTickers.values())) {
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

  const validSignals = activeSignals.filter((sig) => sig.tradePlanJson != null);

  const intradayBarCache = new Map<string, IntradayBar[]>();
  for (const sig of validSignals) {
    if (sig.activationStatus === "ACTIVE" || sig.activationStatus === "INVALIDATED") continue;
    if (sig.status !== "pending") continue;
    const key = `${sig.ticker}:${sig.targetDate}`;
    if (intradayBarCache.has(key)) continue;
    try {
      const polygonBars = await fetchIntradayBars(sig.ticker, sig.targetDate, sig.targetDate, timeframe);
      intradayBarCache.set(key, polygonBars.map((b, i) => ({
        id: i,
        ticker: sig.ticker,
        ts: new Date(b.t).toISOString(),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
        timeframe,
        source: "polygon",
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
    validSignals,
    (ticker) => currentPriceByTicker.get(ticker) ?? null,
    (ticker, targetDate) => intradayBarCache.get(`${ticker}:${targetDate}`) ?? [],
    scanConfig,
  );

  const nonActivationMutations = mutations.filter((m) => m.type !== "activated");
  const activationMutations = mutations.filter((m) => m.type === "activated");

  await applyMutationsToDb(nonActivationMutations);

  const signalById = new Map(activeSignals.map((s) => [s.id, s]));
  for (const mut of activationMutations) {
    const sig = signalById.get(mut.signalId);
    if (sig) {
      const tp = sig.tradePlanJson as TradePlan | null;
      if (tp) {
        await handlePostActivation(sig, tp, mut);
      } else {
        await persistActivationToDb(mut);
      }
    } else {
      await persistActivationToDb(mut);
    }
  }

  log(`Activation scan complete: ${events.length} events`, "activation");
  return events;
}

import { hasLeveragedEtfMapping, selectBestLeveragedEtf, fetchStockNbbo } from "./leveragedEtf";
import { SimDayContext, applyMutationsToCtx, handlePostActivationSim } from "server/simulation";

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

export async function runActivationScanForTicker(
  ticker: string, 
  pendingSignals: Signal[], 
  activeSignals: Signal[], 
  now: Date,
  today: string,
  entryMode: string,
  timeframe: string ,
  stopCfg: StopConfig,
  ctx?: SimDayContext,
): Promise<{ events: ActivationEvent[]; mutations: ActivationMutation[] }> {

  const nowMs = now.getTime();

  let currentPrice: number | null;

  const prefetched = ctx?.prefetchedBars?.get(ticker);
  if (ctx && prefetched) {
    const barsUpToNow = prefetched.filter((b) => b.t <= nowMs);
    if (barsUpToNow.length > 0) {
      const lastBar = barsUpToNow[barsUpToNow.length - 1];
      currentPrice = lastBar.vw ?? (lastBar.h + lastBar.l) / 2;
      currentPrice = Math.round(currentPrice * 100) / 100;
    } else {
      currentPrice = await fetchStockPriceAtTime(ticker, nowMs);
    }
  } else if (ctx) {
    currentPrice = await fetchStockPriceAtTime(ticker, nowMs);
  } else {
    currentPrice = await fetchStockPrice(ticker);
  }

  const allSignals = [...pendingSignals, ...activeSignals];


  const freshBarsRaw = prefetched ? prefetched : await fetchIntradayBars(ticker, Date.parse(today), nowMs, timeframe);
  const filteredBars = freshBarsRaw.filter((b) => b.t <= nowMs);
  const freshBars: IntradayBar[] = filteredBars.map((b, i) => ({
    id: i,
    ticker,
    ts: new Date(b.t).toISOString(),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
    timeframe,
    source: prefetched ? "prefetched" : "polygon",
  }));

  const activationScanConfig: ActivationScanConfig = {
    entryMode,
    ...stopCfg,
    now,
    today,
  };

  const { events: activationEvents, mutations: activationMutations } = checkActivationForTicker(
    ticker,
    allSignals,
    currentPrice,
    freshBars,
    activationScanConfig,
  );

  const { events: monitorEvents, mutations: monitorMutations } = monitorActivatedSignalsForTicker(
    ticker,
    allSignals,
    currentPrice,
    freshBars,
    activationScanConfig,
  );

  const events = [...activationEvents, ...monitorEvents];
  const mutations = [...activationMutations, ...monitorMutations];

  if (ctx) {
    const nonActivationMutsSim = mutations.filter((m) => m.type !== "activated");
    applyMutationsToCtx(ctx, nonActivationMutsSim, now);
    await handlePostActivationSim(ctx, mutations);
  } else {
    const nonActivationMuts = mutations.filter((m) => m.type !== "activated");
    const activationMuts = mutations.filter((m) => m.type === "activated");

    await applyMutationsToDb(nonActivationMuts);

    const signalById = new Map(allSignals.map((s) => [s.id, s]));
    for (const mut of activationMuts) {
      const sig = signalById.get(mut.signalId);
      if (sig) {
        const tp = sig.tradePlanJson as TradePlan | null;
        if (tp) {
          await handlePostActivation(sig, tp, mut);
        } else {
          await persistActivationToDb(mut);
        }
      } else {
        await persistActivationToDb(mut);
      }
    }
  }

  return { events, mutations };
}
