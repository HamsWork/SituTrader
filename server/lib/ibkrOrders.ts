import { storage } from "../storage";
import {
  connectIBKR,
  isConnected,
  makeContract,
  placeMarketOrder,
  placeStopOrder,
  placeLimitOrder,
  cancelOrder,
  modifyStopPrice,
  getOrderStatus,
  getPositions,
  getAccountSummary,
} from "./ibkr";
import { postOptionsAlert, postLetfAlert, postSharesAlert, postTradeUpdate } from "./discord";
import { log } from "../index";
import type { Signal, TradePlan, IbkrTrade } from "@shared/schema";

export async function executeTradeForSignal(
  signalId: number,
  quantity: number = 1,
): Promise<IbkrTrade | null> {
  const sigs = await storage.getSignals(undefined, 1000);
  const signal = sigs.find((s) => s.id === signalId);
  if (!signal) throw new Error(`Signal ${signalId} not found`);

  const qualityScore = signal.qualityScore ?? 0;
  if (qualityScore <= 80) {
    throw new Error(`Signal ${signalId} quality score ${qualityScore} must be > 80 to execute IBKR trade`);
  }

  const instrumentType = signal.instrumentType || "OPTION";

  const todayEt = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const tradesCreatedToday = await storage.getIbkrTradesCreatedOnEtDate(todayEt);
  const hasOptionToday = tradesCreatedToday.some((t) => t.instrumentType === "OPTION");
  const hasLetfToday = tradesCreatedToday.some((t) => t.instrumentType === "LEVERAGED_ETF");
  const hasSharesToday = tradesCreatedToday.some((t) => t.instrumentType === "SHARES");
  if (instrumentType === "OPTION" && hasOptionToday) {
    throw new Error(`Already 1 OPTION trade created today (ET); only one IBKR option trade per day`);
  }
  if (instrumentType === "LEVERAGED_ETF" && hasLetfToday) {
    throw new Error(`Already 1 LEVERAGED_ETF trade created today (ET); only one IBKR LETF trade per day`);
  }
  if (instrumentType === "SHARES" && hasSharesToday) {
    throw new Error(`Already 1 SHARES trade created today (ET); only one IBKR shares trade per day`);
  }

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) throw new Error(`Signal ${signalId} has no trade plan`);

  const isBuy = tp.bias === "BUY";
  const action: "BUY" | "SELL" = isBuy ? "BUY" : "SELL";
  const closeAction: "BUY" | "SELL" = isBuy ? "SELL" : "BUY";

  const optionTicker =
    signal.optionContractTicker ||
    (signal.optionsJson as any)?.candidate?.contractSymbol;
  const instrumentTicker =
    signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker;

  const tp1Qty = Math.max(1, Math.floor(quantity / 2));
  const tp2Qty = quantity - tp1Qty;

  const trade = await storage.createIbkrTrade({
    signalId: signal.id,
    ticker: signal.ticker,
    instrumentType,
    instrumentTicker:
      instrumentType === "OPTION" ? optionTicker : instrumentTicker,
    side: action,
    quantity,
    originalQuantity: quantity,
    remainingQuantity: quantity,
    tpHitLevel: 0,
    stopPrice: signal.stopPrice ?? null,
    target1Price: tp.t1 ?? null,
    target2Price: tp.t2 ?? null,
    status: "PENDING",
  });

  try {
    const freshSigs = await storage.getSignals(undefined, 1000);
    const freshSignal = freshSigs.find((s) => s.id === signalId) ?? signal;

    const optionEntry = freshSignal.optionEntryMark ?? null;
    const letfEntry = freshSignal.instrumentEntryPrice ?? null;
    const sharesEntry = freshSignal.entryPriceAtActivation ?? null;

    if (instrumentType === "OPTION") {
      await postOptionsAlert(freshSignal, {
        ...trade,
        entryPrice: optionEntry,
        status: "PENDING",
      } as IbkrTrade);
    } else if (instrumentType === "LEVERAGED_ETF") {
      await postLetfAlert(freshSignal, {
        ...trade,
        entryPrice: letfEntry,
        status: "PENDING",
      } as IbkrTrade);
    } else if (instrumentType === "SHARES") {
      await postSharesAlert(freshSignal, {
        ...trade,
        entryPrice: sharesEntry,
        status: "PENDING",
      } as IbkrTrade);
    } else {
      await postOptionsAlert(freshSignal, {
        ...trade,
        entryPrice: optionEntry,
        status: "PENDING",
      } as IbkrTrade);
    }
    await storage.updateIbkrTrade(trade.id, { discordAlertSent: true });
    log(`Discord alert sent for signal ${signalId} (${signal.ticker} ${instrumentType})`, "discord");
  } catch (discErr: any) {
    log(`Discord alert failed for signal ${signalId}: ${discErr.message}`, "discord");
  }

  let ibkrConnected = false;
  try {
    if (!isConnected()) {
      ibkrConnected = await connectIBKR();
    } else {
      ibkrConnected = true;
    }
  } catch (connErr: any) {
    log(`IBKR connection attempt failed for signal ${signalId}: ${connErr.message}`, "ibkr");
  }

  if (!ibkrConnected) {
    log(`IBKR not connected — trade ${trade.id} created as PENDING (Discord alert already sent)`, "ibkr");
    await storage.updateIbkrTrade(trade.id, {
      status: "PENDING",
      notes: "IBKR not connected at time of execution; Discord alert sent",
    });
    return await storage.getIbkrTrade(trade.id);
  }

  const contract = makeContract(
    instrumentType,
    signal.ticker,
    instrumentTicker,
    optionTicker,
  );

  try {
    const { orderId, promise } = await placeMarketOrder(
      contract,
      action,
      quantity,
    );

    await storage.updateIbkrTrade(trade.id, {
      ibkrOrderId: orderId,
      status: "SUBMITTED",
    });

    let result: any;
    try {
      result = await promise;
    } catch (fillErr: any) {
      log(
        `Order ${orderId} for signal ${signalId} rejected/failed: ${fillErr.message}`,
        "ibkr",
      );
      await storage.updateIbkrTrade(trade.id, {
        status: "REJECTED",
        notes: `Order rejected: ${fillErr.message}`,
      });
      return await storage.getIbkrTrade(trade.id);
    }

    const entryPrice = result?.avgFillPrice > 0 ? result.avgFillPrice : null;

    if (!entryPrice) {
      log(
        `Order ${orderId} for signal ${signalId} did not fill (no avgFillPrice)`,
        "ibkr",
      );
      await storage.updateIbkrTrade(trade.id, {
        status: "NOT_FILLED",
        notes: "Order submitted but no fill price received",
      });
      return await storage.getIbkrTrade(trade.id);
    }

    await storage.updateIbkrTrade(trade.id, {
      status: "FILLED",
      entryPrice,
      filledAt: new Date().toISOString(),
    });

    if (entryPrice) {
      let stopContractPrice: number;
      const underlyingEntry = signal.entryPriceAtActivation ?? 0;
      const underlyingStop = signal.stopPrice ?? 0;
      const stopDist = tp.stopDistance ?? Math.abs(underlyingStop - underlyingEntry);

      if (instrumentType === "OPTION") {
        const underlyingRiskPct =
          underlyingEntry > 0
            ? Math.abs(underlyingStop - underlyingEntry) / underlyingEntry
            : 0.025;
        const delta = Math.min(Math.abs((signal.optionsJson as any)?.checks?.delta ?? 0.5), 1);
        const optionStopMove = entryPrice * underlyingRiskPct * (delta > 0 ? 1 / delta : 2);
        stopContractPrice = isBuy
          ? Math.max(0.01, Math.round((entryPrice - optionStopMove) * 100) / 100)
          : Math.max(0.01, Math.round((entryPrice + optionStopMove) * 100) / 100);
      } else if (instrumentType === "LEVERAGED_ETF") {
        const letfJson = signal.leveragedEtfJson as any;
        const leverage = letfJson?.leverage ?? 3;
        stopContractPrice =
          underlyingEntry > 0 && underlyingStop > 0
            ? calculateLetfStopPrice(
                entryPrice,
                underlyingEntry,
                underlyingStop,
                isBuy,
                leverage,
              )
            : isBuy
              ? entryPrice * (1 - 0.01 * (letfJson?.leverage ?? 3))
              : entryPrice * (1 + 0.01 * (letfJson?.leverage ?? 3));
      } else {
        stopContractPrice =
          underlyingStop > 0
            ? underlyingStop
            : isBuy
              ? entryPrice - (stopDist > 0 ? stopDist : entryPrice * 0.02)
              : entryPrice + (stopDist > 0 ? stopDist : entryPrice * 0.02);
      }

      try {
        const stopResult = await placeStopOrder(
          contract,
          closeAction,
          quantity,
          stopContractPrice,
        );
        await storage.updateIbkrTrade(trade.id, {
          ibkrStopOrderId: stopResult.orderId,
          stopPrice: stopContractPrice,
        });
        log(
          `Bracket: stop placed at $${stopContractPrice.toFixed(2)} (order #${stopResult.orderId})`,
          "ibkr",
        );
      } catch (err: any) {
        log(
          `Failed to place stop order for trade ${trade.id}: ${err.message}`,
          "ibkr",
        );
      }

      if (tp.t1 && tp1Qty > 0) {
        try {
          let tp1Price: number;
          if (instrumentType === "OPTION") {
            const t1MovePct =
              underlyingEntry > 0
                ? Math.abs(tp.t1 - underlyingEntry) / underlyingEntry
                : 0.05;
            const delta = Math.min(Math.abs((signal.optionsJson as any)?.checks?.delta ?? 0.5), 1);
            const optionTp1Move = entryPrice * t1MovePct * (delta > 0 ? 1 / delta : 2);
            tp1Price = isBuy
              ? Math.round((entryPrice + optionTp1Move) * 100) / 100
              : Math.max(0.01, Math.round((entryPrice - optionTp1Move) * 100) / 100);
          } else if (instrumentType === "LEVERAGED_ETF") {
            const letfJson = signal.leveragedEtfJson as any;
            tp1Price = calculateLetfTargetPrice(
              entryPrice,
              underlyingEntry || null,
              tp.t1,
              isBuy,
              letfJson?.leverage ?? 3,
            );
          } else {
            tp1Price = tp.t1;
          }

          const tp1Result = await placeLimitOrder(
            contract,
            closeAction,
            tp1Qty,
            tp1Price,
          );
          tp1Result.promise.catch((err: any) => {
            log(`TP1 order ${tp1Result.orderId} rejected by broker: ${err.message}`, "ibkr");
          });
          await storage.updateIbkrTrade(trade.id, {
            ibkrTp1OrderId: tp1Result.orderId,
          });
          log(
            `Bracket: TP1 limit placed for ${tp1Qty} @ $${tp1Price.toFixed(2)} (order #${tp1Result.orderId})`,
            "ibkr",
          );
        } catch (err: any) {
          log(
            `Failed to place TP1 order for trade ${trade.id}: ${err.message}`,
            "ibkr",
          );
        }
      }

      if (tp.t2 && tp2Qty > 0) {
        try {
          let tp2Price: number;
          if (instrumentType === "OPTION") {
            const t2MovePct =
              underlyingEntry > 0
                ? Math.abs(tp.t2 - underlyingEntry) / underlyingEntry
                : 0.10;
            const delta = Math.min(Math.abs((signal.optionsJson as any)?.checks?.delta ?? 0.5), 1);
            const optionTp2Move = entryPrice * t2MovePct * (delta > 0 ? 1 / delta : 2);
            tp2Price = isBuy
              ? Math.round((entryPrice + optionTp2Move) * 100) / 100
              : Math.max(0.01, Math.round((entryPrice - optionTp2Move) * 100) / 100);
          } else if (instrumentType === "LEVERAGED_ETF") {
            const letfJson = signal.leveragedEtfJson as any;
            tp2Price = calculateLetfTargetPrice(
              entryPrice,
              underlyingEntry || null,
              tp.t2,
              isBuy,
              letfJson?.leverage ?? 3,
            );
          } else {
            tp2Price = tp.t2;
          }

          const tp2Result = await placeLimitOrder(
            contract,
            closeAction,
            tp2Qty,
            tp2Price,
          );
          tp2Result.promise.catch((err: any) => {
            log(`TP2 order ${tp2Result.orderId} rejected by broker: ${err.message}`, "ibkr");
          });
          await storage.updateIbkrTrade(trade.id, {
            ibkrTp2OrderId: tp2Result.orderId,
          });
          log(
            `Bracket: TP2 limit placed for ${tp2Qty} @ $${tp2Price.toFixed(2)} (order #${tp2Result.orderId})`,
            "ibkr",
          );
        } catch (err: any) {
          log(
            `Failed to place TP2 order for trade ${trade.id}: ${err.message}`,
            "ibkr",
          );
        }
      }
    }

    log(
      `Trade executed for signal ${signalId}: ${action} ${quantity} ${contract.symbol} filled at $${entryPrice}`,
      "ibkr",
    );

    return await storage.getIbkrTrade(trade.id);
  } catch (err: any) {
    await storage.updateIbkrTrade(trade.id, {
      status: "ERROR",
      notes: err.message,
    });
    log(`IBKR execution error for signal ${signalId}: ${err.message} (Discord alert was already sent)`, "ibkr");
    return await storage.getIbkrTrade(trade.id);
  }
}

export async function applyBeStop(
  ibkrTrade: IbkrTrade,
  signal: Signal,
  entryPrice: number,
  isSell: boolean,
): Promise<boolean> {
  if (!ibkrTrade.ibkrStopOrderId || ibkrTrade.stopMovedToBe) return false;
  if (!isConnected()) return false;

  const instrumentType = ibkrTrade.instrumentType || "OPTION";
  const optionTicker =
    signal.optionContractTicker ||
    (signal.optionsJson as any)?.candidate?.contractSymbol;
  const instrumentTicker =
    signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker;
  const contract = makeContract(
    instrumentType,
    signal.ticker,
    instrumentTicker,
    optionTicker,
  );
  const closeAction: "BUY" | "SELL" = isSell ? "BUY" : "SELL";

  let beStopPrice = entryPrice;
  if (
    (instrumentType === "OPTION" || instrumentType === "LEVERAGED_ETF") &&
    ibkrTrade.entryPrice
  ) {
    beStopPrice = ibkrTrade.entryPrice;
  }

  await modifyStopPrice(
    ibkrTrade.ibkrStopOrderId,
    contract,
    closeAction,
    ibkrTrade.remainingQuantity,
    beStopPrice,
  );
  await storage.updateIbkrTrade(ibkrTrade.id, {
    stopPrice: beStopPrice,
    stopMovedToBe: true,
  });
  log(
    `applyBeStop: IBKR stop modified to $${beStopPrice.toFixed(2)} for trade ${ibkrTrade.id} (signal ${signal.id})`,
    "ibkr",
  );

  try {
    const updatedTrade = await storage.getIbkrTrade(ibkrTrade.id);
    if (updatedTrade) {
      await postTradeUpdate(signal, updatedTrade, "RAISE_STOP");
      log(
        `applyBeStop: RAISE_STOP Discord alert sent for ${signal.ticker} signal ${signal.id}`,
        "ibkr",
      );
    }
  } catch (discErr: any) {
    log(
      `applyBeStop: Discord alert failed for signal ${signal.id}: ${discErr.message}`,
      "ibkr",
    );
  }

  return true;
}

export async function applyTimeStop(
  ibkrTrade: IbkrTrade,
  signal: Signal,
  entryPrice: number,
  isSell: boolean,
  newUnderlyingStop: number,
  tightenedDist: number,
  tightenFactor: number,
  nowIso: string,
): Promise<boolean> {
  if (!ibkrTrade.ibkrStopOrderId) return false;
  if (!isConnected()) return false;

  const instrumentType = ibkrTrade.instrumentType || "OPTION";
  const optionTicker =
    signal.optionContractTicker ||
    (signal.optionsJson as any)?.candidate?.contractSymbol;
  const instrumentTicker =
    signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker;
  const contract = makeContract(
    instrumentType,
    signal.ticker,
    instrumentTicker,
    optionTicker,
  );
  const closeAction: "BUY" | "SELL" = isSell ? "BUY" : "SELL";

  let ibkrNewStop = newUnderlyingStop;
  if (instrumentType === "OPTION" && ibkrTrade.entryPrice) {
    const underlyingEntry = signal.entryPriceAtActivation ?? entryPrice;
    const riskPct =
      underlyingEntry > 0 ? tightenedDist / underlyingEntry : 0.025;
    ibkrNewStop = isSell
      ? Math.round(Math.max(0.01, ibkrTrade.entryPrice * (1 + riskPct)) * 100) /
        100
      : Math.round(Math.max(0.01, ibkrTrade.entryPrice * (1 - riskPct)) * 100) /
        100;
  } else if (instrumentType === "LEVERAGED_ETF" && ibkrTrade.entryPrice) {
    const underlyingEntry = signal.entryPriceAtActivation ?? entryPrice;
    if (underlyingEntry > 0) {
      const underlyingMovePct =
        (newUnderlyingStop - underlyingEntry) / underlyingEntry;
      ibkrNewStop =
        Math.round(
          Math.max(0.01, ibkrTrade.entryPrice * (1 + underlyingMovePct * 3)) *
            100,
        ) / 100;
    }
  }

  await modifyStopPrice(
    ibkrTrade.ibkrStopOrderId,
    contract,
    closeAction,
    ibkrTrade.remainingQuantity,
    ibkrNewStop,
  );

  const oldIbkrStop = ibkrTrade.stopPrice;
  await storage.updateIbkrTrade(ibkrTrade.id, {
    stopPrice: ibkrNewStop,
    detailsJson: {
      ...((ibkrTrade.detailsJson as any) ?? {}),
      oldStopPrice: oldIbkrStop,
      underlyingNewStop: newUnderlyingStop,
      underlyingOldStop: signal.stopPrice,
      timeStopTightenFactor: tightenFactor,
      timeStopAppliedAt: nowIso,
    },
  });
  log(
    `applyTimeStop: IBKR stop tightened to $${ibkrNewStop.toFixed(2)} for trade ${ibkrTrade.id} (signal ${signal.id}, underlying stop $${newUnderlyingStop.toFixed(2)})`,
    "ibkr",
  );

  try {
    const updatedTrade = await storage.getIbkrTrade(ibkrTrade.id);
    if (updatedTrade) {
      await postTradeUpdate(signal, updatedTrade, "TIME_STOP");
      log(
        `applyTimeStop: TIME_STOP Discord alert sent for ${signal.ticker} signal ${signal.id}`,
        "ibkr",
      );
    }
  } catch (discErr: any) {
    log(
      `applyTimeStop: Discord alert failed for signal ${signal.id}: ${discErr.message}`,
      "ibkr",
    );
  }

  return true;
}

function calculateLetfStopPrice(
  letfEntry: number,
  underlyingEntry: number | null,
  underlyingStop: number,
  isBuy: boolean,
  leverage: number = 3,
): number {
  if (!underlyingEntry || underlyingEntry === 0)
    return isBuy ? letfEntry * (1 - 0.01 * leverage) : letfEntry * (1 + 0.01 * leverage);
  const underlyingMovePct =
    (underlyingStop - underlyingEntry) / underlyingEntry;
  const letfStopEstimate = letfEntry * (1 + underlyingMovePct * leverage);
  return Math.round(Math.max(0.01, letfStopEstimate) * 100) / 100;
}

function calculateLetfTargetPrice(
  letfEntry: number,
  underlyingEntry: number | null,
  underlyingTarget: number,
  isBuy: boolean,
  leverage: number = 3,
): number {
  if (!underlyingEntry || underlyingEntry === 0)
    return isBuy ? letfEntry * (1 + 0.02 * leverage) : letfEntry * (1 - 0.02 * leverage);
  const underlyingMovePct =
    (underlyingTarget - underlyingEntry) / underlyingEntry;
  const letfTargetEstimate = letfEntry * (1 + underlyingMovePct * leverage);
  return Math.round(Math.max(0.01, letfTargetEstimate) * 100) / 100;
}

export async function monitorActiveTrade(
  tradeInput: IbkrTrade,
  signal: Signal,
): Promise<{ event: string | null; updatedTrade: IbkrTrade | null }> {
  const trade = await storage.getIbkrTrade(tradeInput.id);
  if (!trade) return { event: null, updatedTrade: null };

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return { event: null, updatedTrade: null };

  if (trade.status !== "FILLED")
    return { event: null, updatedTrade: null };

  const instrumentType = trade.instrumentType || "OPTION";
  const optionTicker =
    signal.optionContractTicker ||
    (signal.optionsJson as any)?.candidate?.contractSymbol;
  const instrumentTicker =
    signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker;
  const contract = makeContract(
    instrumentType,
    signal.ticker,
    instrumentTicker,
    optionTicker,
  );
  const closeAction: "BUY" | "SELL" = trade.side === "BUY" ? "SELL" : "BUY";

  if (trade.ibkrTp1OrderId && trade.tpHitLevel === 0) {
    const tp1Status = getOrderStatus(trade.ibkrTp1OrderId);
    if (tp1Status?.status === "Filled") {
      const tp1FillPrice = tp1Status.avgFillPrice;
      const tp1Qty = Math.max(1, Math.floor(trade.originalQuantity / 2));
      const tp1Pnl = trade.entryPrice
        ? (trade.side === "BUY"
            ? tp1FillPrice - trade.entryPrice
            : trade.entryPrice - tp1FillPrice) * tp1Qty
        : 0;

      const newRemaining = trade.originalQuantity - tp1Qty;

      await storage.updateIbkrTrade(trade.id, {
        tpHitLevel: 1,
        tp1FillPrice,
        tp1FilledAt: new Date().toISOString(),
        tp1PnlRealized: tp1Pnl,
        remainingQuantity: newRemaining,
        pnl: tp1Pnl,
      });

      log(
        `TP1 filled for trade ${trade.id}: ${tp1Qty} @ $${tp1FillPrice.toFixed(2)}, P&L: $${tp1Pnl.toFixed(2)}`,
        "ibkr",
      );

      if (trade.ibkrStopOrderId && trade.entryPrice && !trade.stopMovedToBe) {
        try {
          await modifyStopPrice(
            trade.ibkrStopOrderId,
            contract,
            closeAction,
            newRemaining,
            trade.entryPrice,
          );
          await storage.updateIbkrTrade(trade.id, {
            stopPrice: trade.entryPrice,
            stopMovedToBe: true,
          });
          log(
            `Stop moved to BE ($${trade.entryPrice.toFixed(2)}) for trade ${trade.id} after TP1 fill`,
            "ibkr",
          );
        } catch (err: any) {
          log(
            `Failed to move stop to BE for trade ${trade.id}: ${err.message}`,
            "ibkr",
          );
        }
      }

      const updatedTrade = await storage.getIbkrTrade(trade.id);
      if (updatedTrade) {
        await postTradeUpdate(signal, updatedTrade, "TP1_HIT");
      }
      return { event: "TP1_HIT", updatedTrade };
    }
  }

  if (trade.ibkrTp2OrderId && trade.tpHitLevel === 1) {
    const tp2Status = getOrderStatus(trade.ibkrTp2OrderId);
    if (tp2Status?.status === "Filled") {
      const tp2FillPrice = tp2Status.avgFillPrice;
      const tp2Qty = trade.remainingQuantity;
      const tp2Pnl = trade.entryPrice
        ? (trade.side === "BUY"
            ? tp2FillPrice - trade.entryPrice
            : trade.entryPrice - tp2FillPrice) * tp2Qty
        : 0;

      const totalPnl = (trade.tp1PnlRealized ?? 0) + tp2Pnl;
      const totalPnlPct = trade.entryPrice
        ? (totalPnl / (trade.entryPrice * trade.originalQuantity)) * 100
        : null;
      const rMultiple =
        trade.entryPrice && tp.stopDistance
          ? totalPnl / (tp.stopDistance * trade.originalQuantity)
          : null;

      if (trade.ibkrStopOrderId) {
        try {
          await cancelOrder(trade.ibkrStopOrderId);
        } catch {}
      }

      await storage.updateIbkrTrade(trade.id, {
        tpHitLevel: 2,
        tp2FillPrice,
        tp2FilledAt: new Date().toISOString(),
        remainingQuantity: 0,
        status: "CLOSED",
        exitPrice: tp2FillPrice,
        pnl: totalPnl,
        pnlPct: totalPnlPct,
        rMultiple,
        closedAt: new Date().toISOString(),
      });

      log(
        `TP2 filled for trade ${trade.id}: all closed @ $${tp2FillPrice.toFixed(2)}, total P&L: $${totalPnl.toFixed(2)}`,
        "ibkr",
      );

      const updatedTrade = await storage.getIbkrTrade(trade.id);
      if (updatedTrade) {
        await postTradeUpdate(signal, updatedTrade, "TP2_HIT");
      }
      return { event: "TP2_HIT", updatedTrade };
    }
  }

  if (trade.ibkrStopOrderId) {
    const stopStatus = getOrderStatus(trade.ibkrStopOrderId);
    if (stopStatus?.status === "Filled") {
      const exitPrice = stopStatus.avgFillPrice;
      const stoppedQty = trade.remainingQuantity;
      const stopPnl = trade.entryPrice
        ? (trade.side === "BUY"
            ? exitPrice - trade.entryPrice
            : trade.entryPrice - exitPrice) * stoppedQty
        : 0;

      const totalPnl = (trade.tp1PnlRealized ?? 0) + stopPnl;
      const totalPnlPct = trade.entryPrice
        ? (totalPnl / (trade.entryPrice * trade.originalQuantity)) * 100
        : null;
      const rMultiple =
        trade.entryPrice && tp.stopDistance
          ? totalPnl / (tp.stopDistance * trade.originalQuantity)
          : null;

      if (trade.ibkrTp1OrderId && trade.tpHitLevel === 0) {
        try {
          await cancelOrder(trade.ibkrTp1OrderId);
        } catch {}
      }
      if (trade.ibkrTp2OrderId && trade.tpHitLevel < 2) {
        try {
          await cancelOrder(trade.ibkrTp2OrderId);
        } catch {}
      }

      await storage.updateIbkrTrade(trade.id, {
        status: "CLOSED",
        exitPrice,
        remainingQuantity: 0,
        pnl: totalPnl,
        pnlPct: totalPnlPct,
        rMultiple,
        closedAt: new Date().toISOString(),
      });

      log(
        `Stop filled for trade ${trade.id}: closed ${stoppedQty} @ $${exitPrice.toFixed(2)}, total P&L: $${totalPnl.toFixed(2)}`,
        "ibkr",
      );

      const eventType =
        trade.tpHitLevel > 0 ? "STOPPED_OUT_AFTER_TP" : "STOPPED_OUT";
      const updatedTrade = await storage.getIbkrTrade(trade.id);
      if (updatedTrade) {
        await postTradeUpdate(signal, updatedTrade, eventType);
      }
      return { event: eventType, updatedTrade };
    }
  }

  return { event: null, updatedTrade: null };
}

export async function monitorActiveTrades(): Promise<void> {
  const trades = await storage.getActiveIbkrTrades();
  const allSignals = await storage.getSignals(undefined, 1000);

  for (const trade of trades) {
    try {
      const signal = trade.signalId
        ? allSignals.find((s) => s.id === trade.signalId)
        : null;
      if (!signal) continue;

      await monitorActiveTrade(trade, signal);
    } catch (err: any) {
      log(`Trade monitor error for trade ${trade.id}: ${err.message}`, "ibkr");
    }
  }
}

export async function closeTradeManually(
  tradeId: number,
): Promise<IbkrTrade | null> {
  const trade = await storage.getIbkrTrade(tradeId);
  if (!trade || trade.status !== "FILLED")
    throw new Error("Trade not found or not in FILLED status");

  if (!isConnected()) throw new Error("IBKR not connected");

  const signal = trade.signalId
    ? (await storage.getSignals(undefined, 1000)).find(
        (s) => s.id === trade.signalId,
      )
    : null;

  const optionTicker = signal
    ? signal.optionContractTicker ||
      (signal.optionsJson as any)?.candidate?.contractSymbol
    : trade.instrumentTicker;
  const instrTicker = signal
    ? signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker
    : trade.instrumentTicker;

  const contract = makeContract(
    trade.instrumentType,
    trade.ticker,
    instrTicker,
    optionTicker,
  );
  const closeAction: "BUY" | "SELL" = trade.side === "BUY" ? "SELL" : "BUY";

  if (trade.ibkrStopOrderId) {
    try {
      await cancelOrder(trade.ibkrStopOrderId);
    } catch {}
  }
  if (trade.ibkrTp1OrderId && trade.tpHitLevel === 0) {
    try {
      await cancelOrder(trade.ibkrTp1OrderId);
    } catch {}
  }
  if (trade.ibkrTp2OrderId && trade.tpHitLevel < 2) {
    try {
      await cancelOrder(trade.ibkrTp2OrderId);
    } catch {}
  }

  const closeQty = trade.remainingQuantity;
  const { orderId, promise } = await placeMarketOrder(
    contract,
    closeAction,
    closeQty,
  );
  const result = (await promise) as any;
  const exitPrice = result.avgFillPrice > 0 ? result.avgFillPrice : null;

  const closePnl =
    trade.entryPrice && exitPrice
      ? (trade.side === "BUY"
          ? exitPrice - trade.entryPrice
          : trade.entryPrice - exitPrice) * closeQty
      : 0;
  const totalPnl = (trade.tp1PnlRealized ?? 0) + closePnl;
  const totalPnlPct = trade.entryPrice
    ? (totalPnl / (trade.entryPrice * trade.originalQuantity)) * 100
    : null;
  const tp = signal?.tradePlanJson as TradePlan | undefined;
  const rMultiple =
    trade.entryPrice && tp?.stopDistance
      ? totalPnl / (tp.stopDistance * trade.originalQuantity)
      : null;

  await storage.updateIbkrTrade(trade.id, {
    status: "CLOSED",
    exitPrice,
    remainingQuantity: 0,
    pnl: totalPnl,
    pnlPct: totalPnlPct,
    rMultiple,
    closedAt: new Date().toISOString(),
  });

  if (signal) {
    const closedTrade = await storage.getIbkrTrade(trade.id);
    if (closedTrade) {
      await postTradeUpdate(signal, closedTrade, "CLOSED");
    }
  }

  return await storage.getIbkrTrade(trade.id);
}

export async function getIbkrDashboardData() {
  const trades = await storage.getAllIbkrTrades();
  const positions = getPositions();
  const account = getAccountSummary();
  const connStatus = isConnected();

  const activeTrades = trades.filter((t) => t.status === "FILLED");
  const closedTrades = trades.filter((t) => t.status === "CLOSED");

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const winCount = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length;
  const winRate =
    closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;

  return {
    connected: connStatus,
    account,
    positions,
    activeTrades,
    closedTrades,
    stats: {
      totalTrades: closedTrades.length,
      totalPnl,
      winRate,
      winCount,
      lossCount: closedTrades.length - winCount,
    },
  };
}
