import { storage } from "../storage";
import { filterRTHBars, timestampToET } from "./validate";
import {
  fetchSnapshot,
  fetchOptionMark,
  fetchOptionMarkAtTime,
  fetchStockPriceAtTime,
} from "./polygon";
import {
  selectBestLeveragedEtf,
  fetchStockNbbo,
  hasLeveragedEtfMapping,
} from "./leveragedEtf";
import { log } from "../index";
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

function checkEntryTrigger(
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

export async function runActivationScan(): Promise<ActivationEvent[]> {
  const events: ActivationEvent[] = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const today = now.toISOString().slice(0, 10);

  const settings = await storage.getAllSettings();
  const entryMode = settings.entryMode || "conservative";
  const timeframe = settings.intradayTimeframe || "5";
  const stopCfg = getStopConfig(settings);

  const activeSignals = await storage.getActiveSignals();
  if (activeSignals.length === 0) return events;

  let allIbkrTrades: Awaited<ReturnType<typeof storage.getActiveIbkrTrades>> =
    [];
  try {
    allIbkrTrades = await storage.getActiveIbkrTrades();
  } catch {}

  const todayEt = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  let tradesCreatedToday: Awaited<
    ReturnType<typeof storage.getIbkrTradesCreatedOnEtDate>
  > = [];
  try {
    tradesCreatedToday = await storage.getIbkrTradesCreatedOnEtDate(todayEt);
  } catch {}

  /** At most 1 IBKR trade per instrument type per day (ET); track same-run so we don't post twice in one scan. */
  const hasOptionToday = tradesCreatedToday.some(
    (t) => t.instrumentType === "OPTION",
  );
  const hasLetfToday = tradesCreatedToday.some(
    (t) => t.instrumentType === "LEVERAGED_ETF",
  );
  const hasSharesToday = tradesCreatedToday.some(
    (t) => t.instrumentType === "SHARES",
  );
  let executedOptionThisRun = false;
  let executedLetfThisRun = false;
  let executedSharesThisRun = false;

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
      log(
        `Activation: failed to get snapshot for ${ticker}: ${err.message}`,
        "activation",
      );
      continue;
    }

    for (const sig of sigs) {
      const tp = sig.tradePlanJson as TradePlan | null;
      if (!tp) continue;

      if (sig.activationStatus === "ACTIVE") {
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
          const activeMinutes = sig.activatedTs
            ? Math.floor(
                (now.getTime() - new Date(sig.activatedTs).getTime()) / 60000,
              )
            : 0;

          if (shouldApplyBE(stopCfg.stopMode) && sig.stopStage === "INITIAL") {
            const beEarned =
              rNow >= stopCfg.beRThreshold ||
              progress >= stopCfg.beProgressThreshold;
            if (beEarned) {
              try {
                const ibkrTrade = allIbkrTrades.find(
                  (t) => t.signalId === sig.id && t.status === "FILLED",
                );
                if (ibkrTrade) {
                  const { applyBeStop } = await import("./ibkrOrders");
                  const success = await applyBeStop(
                    ibkrTrade,
                    sig,
                    entryPrice,
                    isSell,
                  );
                  if (success) {
                    log(
                      `Activation BE: IBKR stop updated for trade ${ibkrTrade.id} (signal ${sig.id})`,
                      "activation",
                    );
                  } else {
                    log(
                      `Activation BE: IBKR not connected or trade not eligible for signal ${sig.id}`,
                      "activation",
                    );
                  }
                }
              } catch (beErr: any) {
                log(
                  `Activation BE: IBKR update failed for signal ${sig.id}: ${beErr.message}`,
                  "activation",
                );
              }

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

              try {
                const ibkrTrade = allIbkrTrades.find(
                  (t) => t.signalId === sig.id && t.status === "FILLED",
                );
                if (ibkrTrade) {
                  const { applyTimeStop } = await import("./ibkrOrders");
                  const success = await applyTimeStop(
                    ibkrTrade,
                    sig,
                    entryPrice,
                    isSell,
                    newStop,
                    tightenedDist,
                    stopCfg.timeStopTightenFactor,
                    nowIso,
                  );
                  if (success) {
                    log(
                      `Activation TIME_STOP: IBKR stop updated for trade ${ibkrTrade.id} (signal ${sig.id})`,
                      "activation",
                    );
                  } else {
                    log(
                      `Activation TIME_STOP: IBKR not connected or trade not eligible for signal ${sig.id}`,
                      "activation",
                    );
                  }
                }
              } catch (tsErr: any) {
                log(
                  `Activation TIME_STOP: IBKR update failed for signal ${sig.id}: ${tsErr.message}`,
                  "activation",
                );
              }

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

        try {
          const sigTrades = allIbkrTrades.filter(
            (t) => t.signalId === sig.id && t.status === "FILLED",
          );
          if (sigTrades.length > 0) {
            const { isConnected } = await import("./ibkr");
            if (isConnected()) {
              const { monitorActiveTrade } = await import("./ibkrOrders");
              for (const ibkrTrade of sigTrades) {
                try {
                  const result = await monitorActiveTrade(ibkrTrade, sig);
                  if (result.event) {
                    log(
                      `Activation monitor: trade ${ibkrTrade.id} event=${result.event} for ${ticker} signal ${sig.id}`,
                      "activation",
                    );
                  }
                } catch (monErr: any) {
                  log(
                    `Activation monitor: error monitoring trade ${ibkrTrade.id} for signal ${sig.id}: ${monErr.message}`,
                    "activation",
                  );
                }
              }
            }
          }
        } catch (tradeMonErr: any) {
          log(
            `Activation monitor: failed to monitor trades for signal ${sig.id}: ${tradeMonErr.message}`,
            "activation",
          );
        }

        continue;
      }

      if (sig.activationStatus === "INVALIDATED") continue;

      const targetDate = sig.targetDate;
      const intradayBars = await storage.getIntradayBars(
        ticker,
        targetDate,
        timeframe,
      );
      if (intradayBars.length === 0) {
        if (targetDate === today && currentPrice) {
          continue;
        }
        continue;
      }

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

      if (result.triggered && result.entryPrice) {
        /** Effective instrument type for this signal (may be updated to LEVERAGED_ETF below). */
        let instrumentTypeForExecution: "OPTION" | "SHARES" | "LEVERAGED_ETF" =
          (sig.instrumentType as "OPTION" | "SHARES" | "LEVERAGED_ETF") ||
          "OPTION";

        let stopPrice: number | undefined;
        if (tp.stopDistance && tp.stopDistance > 0) {
          stopPrice =
            tp.bias === "SELL"
              ? result.entryPrice + tp.stopDistance
              : result.entryPrice - tp.stopDistance;
        }
        await storage.updateSignalActivation(
          sig.id,
          "ACTIVE",
          result.triggerTs,
          result.entryPrice,
          stopPrice,
          result.entryTriggerPrice,
        );

        const opts = sig.optionsJson as OptionsData | null;
        const contractTicker =
          sig.optionContractTicker || opts?.candidate?.contractSymbol;
        if (contractTicker) {
          try {
            const triggerMs = result.triggerTs
              ? new Date(result.triggerTs).getTime()
              : Date.now();
            let entryMarkPrice = await fetchOptionMarkAtTime(
              contractTicker,
              triggerMs,
            );
            if (entryMarkPrice == null) {
              const liveQuote = await fetchOptionMark(contractTicker, ticker);
              if (liveQuote && liveQuote.mark != null)
                entryMarkPrice = liveQuote.mark;
            }
            if (entryMarkPrice != null) {
              await storage.updateSignalOptionTracking(sig.id, {
                optionContractTicker: contractTicker,
                optionEntryMark: entryMarkPrice,
              });
              log(
                `Option entry mark captured at activation for ${ticker} signal ${sig.id}: $${entryMarkPrice.toFixed(2)} @ ${result.triggerTs} (${contractTicker})`,
                "activation",
              );
            }
          } catch (err: any) {
            log(
              `Failed to capture option entry mark at activation for signal ${sig.id}: ${err.message}`,
              "activation",
            );
          }
        }

        if (
          hasLeveragedEtfMapping(ticker) &&
          (!sig.instrumentType || sig.instrumentType === "OPTION") &&
          !sig.instrumentTicker
        ) {
          try {
            const suggestion = await selectBestLeveragedEtf(ticker, tp.bias);
            if (suggestion) {
              const triggerMs = result.triggerTs
                ? new Date(result.triggerTs).getTime()
                : Date.now();
              let letfEntry = await fetchStockPriceAtTime(
                suggestion.ticker,
                triggerMs,
              );
              if (letfEntry == null) {
                const letfQuote = await fetchStockNbbo(suggestion.ticker);
                letfEntry = letfQuote?.mid ?? null;
              }
              await storage.updateSignalLeveragedEtf(sig.id, suggestion);
              await storage.updateSignalInstrument(
                sig.id,
                "LEVERAGED_ETF",
                suggestion.ticker,
                letfEntry,
              );
              instrumentTypeForExecution = "LEVERAGED_ETF";
              log(
                `Auto-selected LETF ${suggestion.ticker} (${suggestion.leverage}x) for ${ticker} signal ${sig.id}, entry $${letfEntry?.toFixed(2) ?? "n/a"} @ ${result.triggerTs}`,
                "activation",
              );
            }
          } catch (err: any) {
            log(
              `Failed to auto-select LETF for signal ${sig.id}: ${err.message}`,
              "activation",
            );
          }
        }

        events.push({
          signalId: sig.id,
          ticker,
          type: "activated",
          tier: sig.tier,
          qualityScore: sig.qualityScore,
          entryPrice: result.entryPrice,
          message: `ACTIVATED (${tp.bias}) ${ticker} ${sig.setupType} - Entry: $${result.entryPrice.toFixed(2)}, Target: $${tp.t1.toFixed(2)}${stopPrice ? `, Stop: $${stopPrice.toFixed(2)}` : ""}`,
          timestamp: nowIso,
        });

        try {
          const qualityOk = (sig.qualityScore ?? 0) >= 55;
          const wouldExceedOption =
            instrumentTypeForExecution === "OPTION" &&
            (hasOptionToday || executedOptionThisRun);
          const wouldExceedLetf =
            instrumentTypeForExecution === "LEVERAGED_ETF" &&
            (hasLetfToday || executedLetfThisRun);
          const wouldExceedShares =
            instrumentTypeForExecution === "SHARES" &&
            (hasSharesToday || executedSharesThisRun);

          if (!qualityOk) {
            log(
              `Skip IBKR execute for signal ${sig.id}: quality score ${sig.qualityScore ?? 0} < 70`,
              "activation",
            );
          } else if (
            wouldExceedOption ||
            wouldExceedLetf ||
            wouldExceedShares
          ) {
            log(
              `Skip IBKR execute for signal ${sig.id}: already 1 ${instrumentTypeForExecution} trade today (ET)`,
              "activation",
            );
          } else {
            const { isConnected } = await import("./ibkr");
            if (!isConnected()) {
              log(
                `Skip IBKR execute for signal ${sig.id}: IBKR not connected`,
                "activation",
              );
            } else {
              const { executeTradeForSignal } = await import("./ibkrOrders");
              const qty =
                parseInt(
                  (await storage.getSetting("ibkrDefaultQuantity")) || "1",
                ) || 1;
              await executeTradeForSignal(sig.id, qty);
              if (instrumentTypeForExecution === "OPTION")
                executedOptionThisRun = true;
              else if (instrumentTypeForExecution === "LEVERAGED_ETF")
                executedLetfThisRun = true;
              else if (instrumentTypeForExecution === "SHARES")
                executedSharesThisRun = true;
              log(
                `Auto-executed IBKR bracket order for signal ${sig.id} on activation (qty: ${qty}, type: ${instrumentTypeForExecution})`,
                "activation",
              );
            }
          }
        } catch (autoErr: any) {
          log(
            `Auto-execute IBKR failed for signal ${sig.id}: ${autoErr.message}`,
            "activation",
          );
        }
      }
    }
  }

  log(`Activation scan complete: ${events.length} events`, "activation");
  return events;
}
