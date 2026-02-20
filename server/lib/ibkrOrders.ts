import { storage } from "../storage";
import { connectIBKR, isConnected, makeContract, placeMarketOrder, placeStopOrder, placeLimitOrder, cancelOrder, modifyStopPrice, getOrderStatus, getPositions, getAccountSummary } from "./ibkr";
import { postOptionsAlert, postLetfAlert, postTradeUpdate } from "./discord";
import { log } from "../index";
import type { Signal, TradePlan, IbkrTrade } from "@shared/schema";

export async function executeTradeForSignal(signalId: number, quantity: number = 1): Promise<IbkrTrade | null> {
  const sigs = await storage.getSignals(undefined, 1000);
  const signal = sigs.find(s => s.id === signalId);
  if (!signal) throw new Error(`Signal ${signalId} not found`);

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) throw new Error(`Signal ${signalId} has no trade plan`);

  if (!isConnected()) {
    const ok = await connectIBKR();
    if (!ok) throw new Error("Cannot connect to IBKR");
  }

  const isBuy = tp.bias === "BUY";
  const action: "BUY" | "SELL" = isBuy ? "BUY" : "SELL";
  const closeAction: "BUY" | "SELL" = isBuy ? "SELL" : "BUY";

  const instrumentType = signal.instrumentType || "OPTION";
  const optionTicker = signal.optionContractTicker || (signal.optionsJson as any)?.candidate?.contractSymbol;
  const instrumentTicker = signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker;

  const contract = makeContract(instrumentType, signal.ticker, instrumentTicker, optionTicker);

  const tp1Qty = Math.max(1, Math.floor(quantity / 2));
  const tp2Qty = quantity - tp1Qty;

  const trade = await storage.createIbkrTrade({
    signalId: signal.id,
    ticker: signal.ticker,
    instrumentType,
    instrumentTicker: instrumentType === "OPTION" ? optionTicker : instrumentTicker,
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
    const { orderId, promise } = await placeMarketOrder(contract, action, quantity);

    await storage.updateIbkrTrade(trade.id, {
      ibkrOrderId: orderId,
      status: "SUBMITTED",
    });

    const result = await promise as any;

    const entryPrice = result.avgFillPrice > 0 ? result.avgFillPrice : null;
    await storage.updateIbkrTrade(trade.id, {
      status: "FILLED",
      entryPrice,
      filledAt: new Date().toISOString(),
    });

    if (entryPrice) {
      let stopContractPrice: number;
      if (instrumentType === "OPTION") {
        const riskPct = 0.50;
        stopContractPrice = Math.max(0.01, Math.round(entryPrice * (1 - riskPct) * 100) / 100);
      } else if (instrumentType === "LEVERAGED_ETF") {
        stopContractPrice = signal.stopPrice
          ? calculateLetfStopPrice(entryPrice, signal.entryPriceAtActivation, signal.stopPrice, isBuy)
          : (isBuy ? entryPrice * 0.97 : entryPrice * 1.03);
      } else {
        stopContractPrice = signal.stopPrice ?? (isBuy
          ? entryPrice - (tp.stopDistance ?? entryPrice * 0.02)
          : entryPrice + (tp.stopDistance ?? entryPrice * 0.02));
      }

      try {
        const stopResult = await placeStopOrder(contract, closeAction, quantity, stopContractPrice);
        await storage.updateIbkrTrade(trade.id, {
          ibkrStopOrderId: stopResult.orderId,
          stopPrice: stopContractPrice,
        });
        log(`Bracket: stop placed at $${stopContractPrice.toFixed(2)} (order #${stopResult.orderId})`, "ibkr");
      } catch (err: any) {
        log(`Failed to place stop order for trade ${trade.id}: ${err.message}`, "ibkr");
      }

      if (tp.t1 && tp1Qty > 0) {
        try {
          let tp1Price: number;
          if (instrumentType === "OPTION") {
            const targetMove = Math.abs(tp.t1 - (signal.entryPriceAtActivation ?? entryPrice));
            const stopDist = tp.stopDistance ?? targetMove;
            const rr = targetMove / stopDist;
            tp1Price = Math.round(entryPrice * (1 + rr * 0.5) * 100) / 100;
          } else if (instrumentType === "LEVERAGED_ETF") {
            tp1Price = calculateLetfTargetPrice(entryPrice, signal.entryPriceAtActivation, tp.t1, isBuy);
          } else {
            tp1Price = tp.t1;
          }

          const tp1Result = await placeLimitOrder(contract, closeAction, tp1Qty, tp1Price);
          await storage.updateIbkrTrade(trade.id, {
            ibkrTp1OrderId: tp1Result.orderId,
          });
          log(`Bracket: TP1 limit placed for ${tp1Qty} @ $${tp1Price.toFixed(2)} (order #${tp1Result.orderId})`, "ibkr");
        } catch (err: any) {
          log(`Failed to place TP1 order for trade ${trade.id}: ${err.message}`, "ibkr");
        }
      }

      if (tp.t2 && tp2Qty > 0) {
        try {
          let tp2Price: number;
          if (instrumentType === "OPTION") {
            const targetMove2 = Math.abs(tp.t2 - (signal.entryPriceAtActivation ?? entryPrice));
            const stopDist2 = tp.stopDistance ?? targetMove2;
            const rr2 = targetMove2 / stopDist2;
            tp2Price = Math.round(entryPrice * (1 + rr2 * 0.5) * 100) / 100;
          } else if (instrumentType === "LEVERAGED_ETF") {
            tp2Price = calculateLetfTargetPrice(entryPrice, signal.entryPriceAtActivation, tp.t2, isBuy);
          } else {
            tp2Price = tp.t2;
          }

          const tp2Result = await placeLimitOrder(contract, closeAction, tp2Qty, tp2Price);
          await storage.updateIbkrTrade(trade.id, {
            ibkrTp2OrderId: tp2Result.orderId,
          });
          log(`Bracket: TP2 limit placed for ${tp2Qty} @ $${tp2Price.toFixed(2)} (order #${tp2Result.orderId})`, "ibkr");
        } catch (err: any) {
          log(`Failed to place TP2 order for trade ${trade.id}: ${err.message}`, "ibkr");
        }
      }
    }

    if (instrumentType === "OPTION") {
      await postOptionsAlert(signal, { ...trade, ibkrOrderId: orderId, entryPrice, status: "FILLED" } as IbkrTrade);
    } else if (instrumentType === "LEVERAGED_ETF") {
      await postLetfAlert(signal, { ...trade, ibkrOrderId: orderId, entryPrice, status: "FILLED" } as IbkrTrade);
    } else {
      await postOptionsAlert(signal, { ...trade, ibkrOrderId: orderId, entryPrice, status: "FILLED" } as IbkrTrade);
    }

    await storage.updateIbkrTrade(trade.id, { discordAlertSent: true });

    log(`Trade executed for signal ${signalId}: ${action} ${quantity} ${contract.symbol} filled at $${entryPrice}`, "ibkr");

    return await storage.getIbkrTrade(trade.id);
  } catch (err: any) {
    await storage.updateIbkrTrade(trade.id, { status: "ERROR", notes: err.message });
    log(`Trade execution error for signal ${signalId}: ${err.message}`, "ibkr");
    throw err;
  }
}

function calculateLetfStopPrice(letfEntry: number, underlyingEntry: number | null, underlyingStop: number, isBuy: boolean): number {
  if (!underlyingEntry || underlyingEntry === 0) return isBuy ? letfEntry * 0.97 : letfEntry * 1.03;
  const underlyingMovePct = (underlyingStop - underlyingEntry) / underlyingEntry;
  const letfStopEstimate = letfEntry * (1 + underlyingMovePct * 3);
  return Math.round(Math.max(0.01, letfStopEstimate) * 100) / 100;
}

function calculateLetfTargetPrice(letfEntry: number, underlyingEntry: number | null, underlyingTarget: number, isBuy: boolean): number {
  if (!underlyingEntry || underlyingEntry === 0) return isBuy ? letfEntry * 1.05 : letfEntry * 0.95;
  const underlyingMovePct = (underlyingTarget - underlyingEntry) / underlyingEntry;
  const letfTargetEstimate = letfEntry * (1 + underlyingMovePct * 3);
  return Math.round(Math.max(0.01, letfTargetEstimate) * 100) / 100;
}

export async function monitorActiveTrades(): Promise<void> {
  const trades = await storage.getActiveIbkrTrades();

  for (const trade of trades) {
    try {
      const signal = trade.signalId ? (await storage.getSignals(undefined, 1000)).find(s => s.id === trade.signalId) : null;
      if (!signal) continue;

      const tp = signal.tradePlanJson as TradePlan;
      if (!tp) continue;

      const instrumentType = trade.instrumentType || "OPTION";
      const optionTicker = signal.optionContractTicker || (signal.optionsJson as any)?.candidate?.contractSymbol;
      const instrumentTicker = signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker;
      const contract = makeContract(instrumentType, signal.ticker, instrumentTicker, optionTicker);
      const closeAction: "BUY" | "SELL" = trade.side === "BUY" ? "SELL" : "BUY";

      if (trade.ibkrTp1OrderId && trade.tpHitLevel === 0) {
        const tp1Status = getOrderStatus(trade.ibkrTp1OrderId);
        if (tp1Status?.status === "Filled") {
          const tp1FillPrice = tp1Status.avgFillPrice;
          const tp1Qty = Math.max(1, Math.floor(trade.originalQuantity / 2));
          const tp1Pnl = trade.entryPrice
            ? (trade.side === "BUY" ? tp1FillPrice - trade.entryPrice : trade.entryPrice - tp1FillPrice) * tp1Qty
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

          log(`TP1 filled for trade ${trade.id}: ${tp1Qty} @ $${tp1FillPrice.toFixed(2)}, P&L: $${tp1Pnl.toFixed(2)}`, "ibkr");

          if (trade.ibkrStopOrderId && trade.entryPrice && !trade.stopMovedToBe) {
            try {
              await modifyStopPrice(trade.ibkrStopOrderId, contract, closeAction, newRemaining, trade.entryPrice);
              await storage.updateIbkrTrade(trade.id, {
                stopPrice: trade.entryPrice,
                stopMovedToBe: true,
              });
              log(`Stop moved to BE ($${trade.entryPrice.toFixed(2)}) for trade ${trade.id} after TP1 fill`, "ibkr");
            } catch (err: any) {
              log(`Failed to move stop to BE for trade ${trade.id}: ${err.message}`, "ibkr");
            }
          }

          const updatedTrade = await storage.getIbkrTrade(trade.id);
          if (updatedTrade && signal) {
            await postTradeUpdate(signal, updatedTrade, "TP1_HIT");
          }
          continue;
        }
      }

      if (trade.ibkrTp2OrderId && trade.tpHitLevel === 1) {
        const tp2Status = getOrderStatus(trade.ibkrTp2OrderId);
        if (tp2Status?.status === "Filled") {
          const tp2FillPrice = tp2Status.avgFillPrice;
          const tp2Qty = trade.remainingQuantity;
          const tp2Pnl = trade.entryPrice
            ? (trade.side === "BUY" ? tp2FillPrice - trade.entryPrice : trade.entryPrice - tp2FillPrice) * tp2Qty
            : 0;

          const totalPnl = (trade.tp1PnlRealized ?? 0) + tp2Pnl;
          const totalPnlPct = trade.entryPrice ? (totalPnl / (trade.entryPrice * trade.originalQuantity)) * 100 : null;
          const rMultiple = trade.entryPrice && tp.stopDistance ? totalPnl / (tp.stopDistance * trade.originalQuantity) : null;

          if (trade.ibkrStopOrderId) {
            try { await cancelOrder(trade.ibkrStopOrderId); } catch {}
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

          log(`TP2 filled for trade ${trade.id}: all closed @ $${tp2FillPrice.toFixed(2)}, total P&L: $${totalPnl.toFixed(2)}`, "ibkr");

          const updatedTrade = await storage.getIbkrTrade(trade.id);
          if (updatedTrade && signal) {
            await postTradeUpdate(signal, updatedTrade, "TP2_HIT");
          }
          continue;
        }
      }

      if (trade.ibkrStopOrderId) {
        const stopStatus = getOrderStatus(trade.ibkrStopOrderId);
        if (stopStatus?.status === "Filled") {
          const exitPrice = stopStatus.avgFillPrice;
          const stoppedQty = trade.remainingQuantity;
          const stopPnl = trade.entryPrice
            ? (trade.side === "BUY" ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice) * stoppedQty
            : 0;

          const totalPnl = (trade.tp1PnlRealized ?? 0) + stopPnl;
          const totalPnlPct = trade.entryPrice ? (totalPnl / (trade.entryPrice * trade.originalQuantity)) * 100 : null;
          const rMultiple = trade.entryPrice && tp.stopDistance ? totalPnl / (tp.stopDistance * trade.originalQuantity) : null;

          if (trade.ibkrTp1OrderId && trade.tpHitLevel === 0) {
            try { await cancelOrder(trade.ibkrTp1OrderId); } catch {}
          }
          if (trade.ibkrTp2OrderId && trade.tpHitLevel < 2) {
            try { await cancelOrder(trade.ibkrTp2OrderId); } catch {}
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

          log(`Stop filled for trade ${trade.id}: closed ${stoppedQty} @ $${exitPrice.toFixed(2)}, total P&L: $${totalPnl.toFixed(2)}`, "ibkr");

          const updatedTrade = await storage.getIbkrTrade(trade.id);
          if (updatedTrade && signal) {
            await postTradeUpdate(signal, updatedTrade, trade.tpHitLevel > 0 ? "STOPPED_OUT_AFTER_TP" : "STOPPED_OUT");
          }
          continue;
        }
      }
    } catch (err: any) {
      log(`Trade monitor error for trade ${trade.id}: ${err.message}`, "ibkr");
    }
  }
}

export async function closeTradeManually(tradeId: number): Promise<IbkrTrade | null> {
  const trade = await storage.getIbkrTrade(tradeId);
  if (!trade || trade.status !== "FILLED") throw new Error("Trade not found or not in FILLED status");

  if (!isConnected()) throw new Error("IBKR not connected");

  const contract = makeContract(trade.instrumentType, trade.ticker, trade.instrumentTicker, trade.instrumentTicker);
  const closeAction: "BUY" | "SELL" = trade.side === "BUY" ? "SELL" : "BUY";

  if (trade.ibkrStopOrderId) {
    try { await cancelOrder(trade.ibkrStopOrderId); } catch {}
  }
  if (trade.ibkrTp1OrderId && trade.tpHitLevel === 0) {
    try { await cancelOrder(trade.ibkrTp1OrderId); } catch {}
  }
  if (trade.ibkrTp2OrderId && trade.tpHitLevel < 2) {
    try { await cancelOrder(trade.ibkrTp2OrderId); } catch {}
  }

  const closeQty = trade.remainingQuantity;
  const { orderId, promise } = await placeMarketOrder(contract, closeAction, closeQty);
  const result = await promise as any;
  const exitPrice = result.avgFillPrice > 0 ? result.avgFillPrice : null;

  const closePnl = trade.entryPrice && exitPrice
    ? (trade.side === "BUY" ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice) * closeQty
    : 0;
  const totalPnl = (trade.tp1PnlRealized ?? 0) + closePnl;

  await storage.updateIbkrTrade(trade.id, {
    status: "CLOSED",
    exitPrice,
    remainingQuantity: 0,
    pnl: totalPnl,
    closedAt: new Date().toISOString(),
  });

  const signal = trade.signalId ? (await storage.getSignals(undefined, 1000)).find(s => s.id === trade.signalId) : null;
  if (signal) {
    await postTradeUpdate(signal, { ...trade, exitPrice, pnl: totalPnl, status: "CLOSED" } as IbkrTrade, "CLOSED");
  }

  return await storage.getIbkrTrade(trade.id);
}

export async function getIbkrDashboardData() {
  const trades = await storage.getAllIbkrTrades();
  const positions = getPositions();
  const account = getAccountSummary();
  const connStatus = isConnected();

  const activeTrades = trades.filter(t => t.status === "FILLED");
  const closedTrades = trades.filter(t => t.status === "CLOSED");

  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const winCount = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;

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
