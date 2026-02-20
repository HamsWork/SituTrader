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

  const trade = await storage.createIbkrTrade({
    signalId: signal.id,
    ticker: signal.ticker,
    instrumentType,
    instrumentTicker: instrumentType === "OPTION" ? optionTicker : instrumentTicker,
    side: action,
    quantity,
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
      try {
        let stopContractPrice: number;
        if (instrumentType === "OPTION") {
          const riskPct = 0.50;
          stopContractPrice = Math.max(0.01, Math.round(entryPrice * (1 - riskPct) * 100) / 100);
        } else {
          stopContractPrice = signal.stopPrice ?? (tp.bias === "BUY"
            ? entryPrice - (tp.stopDistance ?? entryPrice * 0.02)
            : entryPrice + (tp.stopDistance ?? entryPrice * 0.02));
        }

        const stopResult = await placeStopOrder(contract, closeAction, quantity, stopContractPrice);
        await storage.updateIbkrTrade(trade.id, {
          ibkrStopOrderId: stopResult.orderId,
          stopPrice: stopContractPrice,
        });
      } catch (err: any) {
        log(`Failed to place stop order for trade ${trade.id}: ${err.message}`, "ibkr");
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

export async function monitorActiveTrades(): Promise<void> {
  const trades = await storage.getActiveIbkrTrades();

  for (const trade of trades) {
    try {
      const signal = trade.signalId ? (await storage.getSignals(undefined, 1000)).find(s => s.id === trade.signalId) : null;
      if (!signal) continue;

      const tp = signal.tradePlanJson as TradePlan;
      if (!tp) continue;

      if (trade.ibkrStopOrderId) {
        const stopStatus = getOrderStatus(trade.ibkrStopOrderId);
        if (stopStatus?.status === "Filled") {
          const exitPrice = stopStatus.avgFillPrice;
          const pnl = trade.entryPrice ? (trade.side === "BUY" ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice) * trade.quantity : null;
          const rMultiple = trade.entryPrice && tp.stopDistance ? (pnl ?? 0) / (tp.stopDistance * trade.quantity) : null;

          await storage.updateIbkrTrade(trade.id, {
            status: "CLOSED",
            exitPrice,
            pnl,
            pnlPct: trade.entryPrice ? ((pnl ?? 0) / (trade.entryPrice * trade.quantity)) * 100 : null,
            rMultiple,
            closedAt: new Date().toISOString(),
          });

          if (signal) {
            await postTradeUpdate(signal, { ...trade, exitPrice, pnl, rMultiple, status: "CLOSED" } as IbkrTrade, "STOPPED_OUT");
          }
          continue;
        }
      }

      if (signal.stopStage === "BE" && trade.ibkrStopOrderId && trade.entryPrice) {
        const currentStop = getOrderStatus(trade.ibkrStopOrderId);
        if (currentStop && currentStop.status !== "Filled") {
          const instrumentType = trade.instrumentType || "OPTION";
          const contract = makeContract(instrumentType, trade.ticker, trade.instrumentTicker, trade.instrumentTicker);
          const closeAction: "BUY" | "SELL" = trade.side === "BUY" ? "SELL" : "BUY";
          await modifyStopPrice(trade.ibkrStopOrderId, contract, closeAction, trade.quantity, trade.entryPrice);
          await storage.updateIbkrTrade(trade.id, { stopPrice: trade.entryPrice });

          if (signal) {
            await postTradeUpdate(signal, trade, "BE_STOP");
          }
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
  if (trade.ibkrTp1OrderId) {
    try { await cancelOrder(trade.ibkrTp1OrderId); } catch {}
  }

  const { orderId, promise } = await placeMarketOrder(contract, closeAction, trade.quantity);
  const result = await promise as any;
  const exitPrice = result.avgFillPrice > 0 ? result.avgFillPrice : null;
  const pnl = trade.entryPrice && exitPrice ? (trade.side === "BUY" ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice) * trade.quantity : null;

  await storage.updateIbkrTrade(trade.id, {
    status: "CLOSED",
    exitPrice,
    pnl,
    closedAt: new Date().toISOString(),
  });

  const signal = trade.signalId ? (await storage.getSignals(undefined, 1000)).find(s => s.id === trade.signalId) : null;
  if (signal) {
    await postTradeUpdate(signal, { ...trade, exitPrice, pnl, status: "CLOSED" } as IbkrTrade, "CLOSED");
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
