import { storage } from "../storage";
import { filterRTHBars, timestampToET } from "./validate";
import { fetchSnapshot, fetchIntradayBars } from "./polygon";
import { log } from "../index";
import { enrichOptionData } from "./options";
import type { Signal, TradePlan, OptionsData } from "@shared/schema";

export interface ActivationEvent {
  signalId: number;
  ticker: string;
  type: "activated" | "invalidated" | "stop_to_be" | "time_stop";
  tier: string;
  qualityScore: number;
  entryPrice: number;
  message: string;
  timestamp: string;
}

function computeEntryTriggerPrice(
  bars: Array<{ high: number; low: number; close: number }>,
  tradePlan: TradePlan,
): number | null {
  if (bars.length < 2) return null;
  const isSell = tradePlan.bias === "SELL";
  const prevBar = bars[bars.length - 2];
  return isSell ? prevBar.low : prevBar.high;
}

export function checkEntryTrigger(
  bars: Array<{
    ts: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>,
  tradePlan: TradePlan,
  entryMode: string,
): {
  triggered: boolean;
  triggerTs?: string;
  entryPrice?: number;
  entryTriggerPrice?: number;
  invalidated?: boolean;
} {
  const rthBars = filterRTHBars(bars);
  if (rthBars.length === 0) return { triggered: false };

  const isSell = tradePlan.bias === "SELL";
  const magnetPrice = tradePlan.t1;
  const firstClose = rthBars[0]?.close;
  const stopDistance =
    tradePlan.stopDistance ??
    ((firstClose != null ? Math.abs(magnetPrice - firstClose) * 0.5 : 1) || 1);

  if (entryMode === "aggressive") {
    for (const bar of rthBars) {
      const barET = timestampToET(bar.ts);
      const totalMin = barET.getHours() * 60 + barET.getMinutes();
      if (totalMin < 575) continue;

      if (isSell && bar.close < bar.open) {
        return {
          triggered: true,
          triggerTs: bar.ts,
          entryPrice: bar.close,
          entryTriggerPrice: bar.open,
        };
      }
      if (!isSell && bar.close > bar.open) {
        return {
          triggered: true,
          triggerTs: bar.ts,
          entryPrice: bar.close,
          entryTriggerPrice: bar.open,
        };
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
            return {
              triggered: true,
              triggerTs: bar.ts,
              entryPrice: bar.close,
              entryTriggerPrice: breakoutPrice,
            };
          }
          if (bar.close > breakoutPrice + stopDistance) {
            breakoutSeen = false;
          }
        } else {
          if (bar.low <= breakoutPrice && bar.close >= breakoutPrice) {
            return {
              triggered: true,
              triggerTs: bar.ts,
              entryPrice: bar.close,
              entryTriggerPrice: breakoutPrice,
            };
          }
          if (bar.close < breakoutPrice - stopDistance) {
            breakoutSeen = false;
          }
        }
      }
    }
  }

  return { triggered: false };
}

function checkInvalidation(
  currentPrice: number,
  tradePlan: TradePlan,
  entryPrice: number,
  stopPrice: number | null,
): boolean {
  const effectiveStop = stopPrice;
  if (effectiveStop == null) {
    const stopDistance = tradePlan.stopDistance;
    if (!stopDistance || stopDistance <= 0) return false;
    if (tradePlan.bias === "SELL") {
      return currentPrice > entryPrice + stopDistance * 1.5;
    } else {
      return currentPrice < entryPrice - stopDistance * 1.5;
    }
  }
  if (tradePlan.bias === "SELL") {
    return currentPrice > effectiveStop;
  } else {
    return currentPrice < effectiveStop;
  }
}

function computeRNow(
  currentPrice: number,
  entryPrice: number,
  stopPrice: number,
  isSell: boolean,
): number {
  const stopDist = Math.abs(entryPrice - stopPrice);
  if (stopDist === 0) return 0;
  return isSell
    ? (entryPrice - currentPrice) / stopDist
    : (currentPrice - entryPrice) / stopDist;
}

function computeProgressToTarget(
  currentPrice: number,
  entryPrice: number,
  targetPrice: number,
  isSell: boolean,
): number {
  let progress: number;
  if (isSell) {
    progress =
      entryPrice - targetPrice !== 0
        ? (entryPrice - currentPrice) / (entryPrice - targetPrice)
        : 0;
  } else {
    progress =
      targetPrice - entryPrice !== 0
        ? (currentPrice - entryPrice) / (targetPrice - entryPrice)
        : 0;
  }
  return Math.max(0, Math.min(1, progress));
}

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

function shouldApplyBE(stopMode: string): boolean {
  return stopMode === "VOLATILITY_BE" || stopMode === "FULL";
}

function shouldApplyTimeStop(stopMode: string): boolean {
  return stopMode === "VOLATILITY_TIME" || stopMode === "FULL";
}

interface ScanContext {
  events: ActivationEvent[];
  now: Date;
  nowIso: string;
  today: string;
  entryMode: string;
  timeframe: string;
  stopCfg: StopConfig;
}

async function checkActivatedSignalsForTicker(
  ctx: ScanContext,
  ticker: string,
  sigs: Signal[],
  currentPrice: number | null,
) {
  const { events, now, nowIso, stopCfg } = ctx;
  for (const sig of sigs) {
    const tp = sig.tradePlanJson as TradePlan | null;
    if (!tp) continue;
    if (sig.activationStatus !== "ACTIVE") continue;

    const entryPrice = sig.entryPriceAtActivation ?? 0;
    const isSell = tp.bias === "SELL";

    if (
      currentPrice &&
      checkInvalidation(currentPrice, tp, entryPrice, sig.stopPrice)
    ) {
      await storage.updateSignalInvalidation(sig.id, nowIso);
      events.push({
        signalId: sig.id,
        ticker,
        type: "invalidated",
        tier: sig.tier,
        qualityScore: sig.qualityScore,
        entryPrice,
        message: `INVALIDATED: ${ticker} ${sig.setupType} entry at ${entryPrice.toFixed(2)} stopped out at ${currentPrice?.toFixed(2)}`,
        timestamp: nowIso,
      });
      continue;
    }

    if (currentPrice && entryPrice > 0 && sig.stopPrice != null) {
      const rNow = computeRNow(
        currentPrice,
        entryPrice,
        sig.stopPrice,
        isSell,
      );
      const progress = computeProgressToTarget(
        currentPrice,
        entryPrice,
        tp.t1,
        isSell,
      );
      const timingAnchor = sig.activatedTs
        ? new Date(sig.activatedTs).getTime()
        : 0;
      const activeMinutes = timingAnchor > 0
        ? Math.floor((now.getTime() - timingAnchor) / 60000)
        : 0;

      if (shouldApplyBE(stopCfg.stopMode) && sig.stopStage === "INITIAL") {
        const beEarned =
          rNow >= stopCfg.beRThreshold ||
          progress >= stopCfg.beProgressThreshold;
        if (beEarned) {
          await storage.updateSignalStopStage(
            sig.id,
            "BE",
            entryPrice,
            nowIso,
          );

          events.push({
            signalId: sig.id,
            ticker,
            type: "stop_to_be",
            tier: sig.tier,
            qualityScore: sig.qualityScore,
            entryPrice,
            message: `STOP→BE: ${ticker} ${sig.setupType} stop moved to breakeven at $${entryPrice.toFixed(2)} (R=${rNow.toFixed(2)}, progress=${(progress * 100).toFixed(0)}%)`,
            timestamp: nowIso,
          });
          continue;
        }
      }

      if (
        shouldApplyTimeStop(stopCfg.stopMode) &&
        sig.stopStage !== "TIME_TIGHTENED" &&
        !sig.timeStopTriggeredTs
      ) {
        if (
          activeMinutes >= stopCfg.timeStopMinutes &&
          progress < stopCfg.timeStopProgressThreshold
        ) {
          const stopDist = Math.abs(entryPrice - sig.stopPrice);
          const tightenedDist = stopDist * stopCfg.timeStopTightenFactor;
          const newStop = isSell
            ? entryPrice + tightenedDist
            : entryPrice - tightenedDist;

          await storage.updateSignalStopStage(
            sig.id,
            "TIME_TIGHTENED",
            newStop,
            undefined,
            nowIso,
          );

          events.push({
            signalId: sig.id,
            ticker,
            type: "time_stop",
            tier: sig.tier,
            qualityScore: sig.qualityScore,
            entryPrice,
            message: `TIME STOP: ${ticker} ${sig.setupType} stop tightened to $${newStop.toFixed(2)} after ${activeMinutes}min with ${(progress * 100).toFixed(0)}% progress`,
            timestamp: nowIso,
          });
          continue;
        }
      }
    }
  }
}

interface EntryTriggerResult {
  triggered: boolean;
  triggerTs?: string;
  entryPrice?: number;
  entryTriggerPrice?: number;
  invalidated?: boolean;
}

async function processTriggeredSignal(
  ctx: ScanContext,
  ticker: string,
  sig: Signal,
  tp: TradePlan,
  result: EntryTriggerResult,
) {
  const { events, nowIso } = ctx;
  const entryPrice = result.entryPrice!;

  const instrumentTypeForExecution = await enrichOptionData(
    ticker,
    sig,
    tp,
    result.triggerTs,
  );

  let stopPrice: number | undefined;
  if (tp.stopDistance && tp.stopDistance > 0) {
    stopPrice =
      tp.bias === "SELL"
        ? entryPrice + tp.stopDistance
        : entryPrice - tp.stopDistance;
  }
  await storage.updateSignalActivation(
    sig.id,
    "ACTIVE",
    result.triggerTs,
    entryPrice,
    stopPrice,
    result.entryTriggerPrice,
  );

  events.push({
    signalId: sig.id,
    ticker,
    type: "activated",
    tier: sig.tier,
    qualityScore: sig.qualityScore,
    entryPrice,
    message: `ACTIVATED (${tp.bias}) ${ticker} ${sig.setupType} - Entry: $${entryPrice.toFixed(2)}, Target: $${tp.t1.toFixed(2)}${stopPrice ? `, Stop: $${stopPrice.toFixed(2)}` : ""}`,
    timestamp: nowIso,
  });

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
          `BTOD: passed over signal ${sig.id} (${ticker} QS=${sig.qualityScore ?? 0}) — reason: ${btodDecision.reason}`,
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
      const { executeBtodMultiInstrument, onBtodTradeExecuted } = await import("./btod");
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
    } catch (btodExecErr: any) {
      log(
        `BTOD: Multi-instrument execution failed for signal ${sig.id}: ${btodExecErr.message}`,
        "activation",
      );
    }
  } else if (!btodActive) {
    // const qualityOk = (sig.qualityScore ?? 0) >= 80;

    // let activeProfileCheck: any = null;
    // try {
    //   activeProfileCheck = await storage.getActiveProfile();
    // } catch {}
    // const profileOk = activeProfileCheck
    //   ? activeProfileCheck.allowedSetups.includes(sig.setupType)
    //   : true;

    // if (qualityOk && profileOk) {
    //   try {
    //     const freshSigs = await storage.getSignals(undefined, 5000);
    //     const freshSig = freshSigs.find((s: any) => s.id === sig.id);
    //     const discordSig = freshSig || sig;
    //     const { postOptionsAlert, postLetfAlert, postSharesAlert } = await import("./discord");
    //     let discordOk = false;
    //     if (instrumentTypeForExecution === "OPTION") {
    //       discordOk = await postOptionsAlert(discordSig);
    //     } else if (instrumentTypeForExecution === "SHARES") {
    //       discordOk = await postSharesAlert(discordSig);
    //     } else {
    //       discordOk = await postLetfAlert(discordSig);
    //     }
    //     if (discordOk) {
    //       log(
    //         `Discord alert sent for signal ${sig.id} on activation (${instrumentTypeForExecution})`,
    //         "activation",
    //       );
    //     } else {
    //       log(
    //         `Discord alert failed or no webhook configured for signal ${sig.id} (${instrumentTypeForExecution})`,
    //         "activation",
    //       );
    //     }
    //   } catch (discordErr: any) {
    //     log(
    //       `Discord alert error for signal ${sig.id}: ${discordErr.message}`,
    //       "activation",
    //     );
    //   }
    // }
  } else {
    log(
      `Skip execution for signal ${sig.id}: BTOD gate blocked`,
      "activation",
    );
  }
}

async function checkPendingSignalsForTicker(
  ctx: ScanContext,
  ticker: string,
  sigs: Signal[],
  currentPrice: number | null,
) {
  const { events, nowIso, today, entryMode, timeframe } = ctx;
  console.log(`[activation] ${ticker}: ${sigs.length} pending signal(s) to check`);

  for (const sig of sigs) {
    const tp = sig.tradePlanJson as TradePlan | null;
    if (!tp) continue;
    if (sig.activationStatus === "ACTIVE") continue;
    if (sig.activationStatus === "INVALIDATED") continue;

    const targetDate = sig.targetDate;
    const intradayBars = await storage.getIntradayBars(
      ticker,
      targetDate,
      timeframe,
    );
    if (intradayBars.length === 0) continue;

    const result = checkEntryTrigger(
      intradayBars.map((b) => ({
        ts: b.ts,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      tp,
      entryMode,
    );

    if (!result.triggered || !result.entryPrice) continue;

    await processTriggeredSignal(ctx, ticker, sig, tp, result);
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
  const stopCfg = getStopConfig(settings);

  const ctx: ScanContext = { events, now, nowIso, today, entryMode, timeframe, stopCfg };

  const activeSignals = await storage.getActiveSignals();
  if (activeSignals.length === 0) return events;

  const tickerGroups = new Map<string, Signal[]>();
  for (const sig of activeSignals) {
    if (!tickerGroups.has(sig.ticker)) tickerGroups.set(sig.ticker, []);
    tickerGroups.get(sig.ticker)!.push(sig);
  }

  // 1) Fetch snapshots once per ticker.
  // If snapshot fails for a ticker, we skip both activated and pending processing for it (same behavior as before).
  const currentPriceByTicker = new Map<string, number | null>();
  for (const ticker of Array.from(tickerGroups.keys())) {
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

  // 2) Pass A: handle activated signals (invalidation + stop management).
  for (const ticker of Array.from(currentPriceByTicker.keys())) {
    const currentPrice = currentPriceByTicker.get(ticker) ?? null;
    await checkActivatedSignalsForTicker(
      ctx,
      ticker,
      tickerGroups.get(ticker)!,
      currentPrice,
    );
  }

  // 2b) Fetch fresh intraday bars from Polygon for today's pending signals.
  const pendingTodayTickers = new Set<string>();
  for (const [ticker, tickerSigs] of tickerGroups) {
    if (tickerSigs.some((s) => s.targetDate === today && s.activationStatus === "NOT_ACTIVE")) {
      pendingTodayTickers.add(ticker);
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

  // 3) Pass B: handle pending signals (entry trigger + activation).
  console.log(`[activation] currentPriceByTicker: ${currentPriceByTicker.size} ticker(s)`);
  for (const ticker of Array.from(currentPriceByTicker.keys())) {
    const currentPrice = currentPriceByTicker.get(ticker) ?? null;
    await checkPendingSignalsForTicker(
      ctx,
      ticker,
      tickerGroups.get(ticker)!,
      currentPrice,
    );
  }

  log(`Activation scan complete: ${events.length} events`, "activation");
  return events;
}

/**
 * Ensure a signal has LETF data (leveragedEtfJson, instrumentTicker, etc.) for Discord/alert. Fetches and stores if missing and ticker has mapping.
 */
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
