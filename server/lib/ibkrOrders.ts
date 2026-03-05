import { storage } from "../storage";
import {
  connectIBKR,
  isConnected,
  makeContract,
  placeMarketOrder,
  cancelOrder,
  getOrderStatus,
  getPositions,
  getAccountSummary,
} from "./ibkr";
import { fetchSnapshot, fetchOptionSnapshot } from "./polygon";
import { postOptionsAlert, postLetfAlert, postSharesAlert, postLetfOptionsAlert, postTradeUpdate } from "./discord";
import { log } from "../index";
import type { Signal, TradePlan, IbkrTrade } from "@shared/schema";

function convertStockTargetsToInstrument(
  stockEntry: number,
  instrumentEntry: number,
  stockT1: number | null,
  stockT2: number | null,
  stockStop: number | null,
  delta: number | null,
  leverage: number,
  instrumentType: string,
): { t1: number | null; t2: number | null; stop: number | null } {
  if (instrumentType === "SHARES") {
    return { t1: stockT1, t2: stockT2, stop: stockStop };
  }

  if (instrumentType === "OPTION" && delta != null && Math.abs(delta) > 0) {
    const t1 = stockT1 != null ? instrumentEntry + (stockT1 - stockEntry) * delta : null;
    const t2 = stockT2 != null ? instrumentEntry + (stockT2 - stockEntry) * delta : null;
    const stop = stockStop != null ? instrumentEntry + (stockStop - stockEntry) * delta : null;
    return {
      t1: t1 != null ? Math.max(0.01, t1) : null,
      t2: t2 != null ? Math.max(0.01, t2) : null,
      stop: stop != null ? Math.max(0.01, stop) : null,
    };
  }

  if (instrumentType === "LEVERAGED_ETF" && leverage > 0 && stockEntry > 0) {
    const t1 = stockT1 != null ? instrumentEntry * (1 + leverage * (stockT1 - stockEntry) / stockEntry) : null;
    const t2 = stockT2 != null ? instrumentEntry * (1 + leverage * (stockT2 - stockEntry) / stockEntry) : null;
    const stop = stockStop != null ? instrumentEntry * (1 + leverage * (stockStop - stockEntry) / stockEntry) : null;
    return {
      t1: t1 != null ? Math.max(0.01, t1) : null,
      t2: t2 != null ? Math.max(0.01, t2) : null,
      stop: stop != null ? Math.max(0.01, stop) : null,
    };
  }

  if (instrumentType === "LETF_OPTIONS" && delta != null && Math.abs(delta) > 0 && leverage > 0 && stockEntry > 0) {
    const effectiveDelta = leverage * delta;
    const t1 = stockT1 != null ? instrumentEntry + (stockT1 - stockEntry) * effectiveDelta : null;
    const t2 = stockT2 != null ? instrumentEntry + (stockT2 - stockEntry) * effectiveDelta : null;
    const stop = stockStop != null ? instrumentEntry + (stockStop - stockEntry) * effectiveDelta : null;
    return {
      t1: t1 != null ? Math.max(0.01, t1) : null,
      t2: t2 != null ? Math.max(0.01, t2) : null,
      stop: stop != null ? Math.max(0.01, stop) : null,
    };
  }

  return { t1: null, t2: null, stop: null };
}

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

    const stockEntry = signal.entryPriceAtActivation ?? 0;
    const stockStop = signal.stopPrice ?? 0;
    const stockT1 = tp.t1 ?? null;
    const stockT2 = tp.t2 ?? null;

    let delta: number | null = null;
    let leverage = 1;

    if ((instrumentType === "OPTION" || instrumentType === "LETF_OPTIONS") && optionTicker) {
      try {
        const underlyingForSnap = instrumentType === "LETF_OPTIONS"
          ? (signal.instrumentTicker || (signal.leveragedEtfJson as any)?.ticker || signal.ticker)
          : signal.ticker;
        const optSnap = await fetchOptionSnapshot(underlyingForSnap, optionTicker);
        delta = optSnap?.delta ?? null;
        if (delta != null) {
          log(`Option delta for ${optionTicker}: ${delta.toFixed(3)}`, "ibkr");
        }
      } catch (err: any) {
        log(`Failed to fetch option delta for ${optionTicker}: ${err.message}`, "ibkr");
      }
    }

    if (instrumentType === "LEVERAGED_ETF" || instrumentType === "LETF_OPTIONS") {
      const letfJson = signal.leveragedEtfJson as any;
      leverage = letfJson?.leverage ?? 1;
    }

    const instrTargets = convertStockTargetsToInstrument(
      stockEntry,
      entryPrice,
      stockT1,
      stockT2,
      stockStop > 0 ? stockStop : null,
      delta,
      leverage,
      instrumentType,
    );

    await storage.updateIbkrTrade(trade.id, {
      status: "FILLED",
      entryPrice,
      filledAt: new Date().toISOString(),
      stopPrice: instrTargets.stop,
      target1Price: instrTargets.t1,
      target2Price: instrTargets.t2,
    });

    log(
      `Trade executed for signal ${signalId}: ${action} ${quantity} ${contract.symbol} filled at $${entryPrice} (${instrumentType}, stock: $${stockEntry.toFixed(2)}, instrT1: $${(instrTargets.t1 ?? 0).toFixed(2)}, instrT2: $${(instrTargets.t2 ?? 0).toFixed(2)}, instrStop: $${(instrTargets.stop ?? 0).toFixed(2)}${delta != null ? `, delta: ${delta.toFixed(3)}` : ""}${leverage > 1 ? `, leverage: ${leverage}x` : ""})`,
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
  if (ibkrTrade.stopMovedToBe) return false;

  const beStopPrice = ibkrTrade.entryPrice ?? entryPrice;

  const updatedTrade = await storage.updateIbkrTrade(ibkrTrade.id, {
    stopPrice: beStopPrice,
    stopMovedToBe: true,
  });
  log(
    `applyBeStop: stop moved to BE $${beStopPrice.toFixed(2)} for trade ${ibkrTrade.id} (signal ${signal.id}) — will trigger market close on hit`,
    "ibkr",
  );

  try {
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
  const oldIbkrStop = ibkrTrade.stopPrice;
  const updatedTrade = await storage.updateIbkrTrade(ibkrTrade.id, {
    stopPrice: newUnderlyingStop,
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
    `applyTimeStop: stop tightened to $${newUnderlyingStop.toFixed(2)} for trade ${ibkrTrade.id} (signal ${signal.id}) — will trigger market close on hit`,
    "ibkr",
  );

  try {
    if (updatedTrade) {
      await postTradeUpdate(signal, updatedTrade, "RAISE_STOP");
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

export async function monitorActiveTrade(
  tradeInput: IbkrTrade,
  signal: Signal,
): Promise<{ event: string | null; updatedTrade: IbkrTrade | null }> {
  const trade = await storage.getIbkrTrade(tradeInput.id);
  if (!trade) return { event: null, updatedTrade: null };

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return { event: null, updatedTrade: null };

  if (signal.activationStatus !== "ACTIVE")
    return { event: null, updatedTrade: null };

  const closedStatuses = ["CLOSED"] as const;
  if (closedStatuses.includes(trade.status as typeof closedStatuses[number]))
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
  const isBuy = trade.side === "BUY";

  let instrumentPrice: number | null = null;

  if (instrumentType === "OPTION" && optionTicker) {
    try {
      const optSnap = await fetchOptionSnapshot(signal.ticker, optionTicker);
      if (optSnap && optSnap.bid != null && optSnap.ask != null && (optSnap.bid > 0 || optSnap.ask > 0)) {
        instrumentPrice = (optSnap.bid + optSnap.ask) / 2;
      }
    } catch {}
  } else if (instrumentType === "LEVERAGED_ETF" && instrumentTicker) {
    const letfSnap = await fetchSnapshot(instrumentTicker);
    instrumentPrice = letfSnap?.lastPrice ?? null;
  } else {
    const stockSnap = await fetchSnapshot(signal.ticker);
    instrumentPrice = stockSnap?.lastPrice ?? null;
  }

  if (instrumentPrice == null || instrumentPrice <= 0) return { event: null, updatedTrade: null };

  const stopLevel = trade.stopPrice ?? 0;
  const t1Level = trade.target1Price ?? 0;
  const t2Level = trade.target2Price ?? 0;
  const beStopInstrument = trade.entryPrice ?? 0;

  if (trade.tpHitLevel === 0 && t1Level > 0) {
    const tp1Hit = isBuy ? instrumentPrice >= t1Level : instrumentPrice <= t1Level;
    if (tp1Hit) {
      const tp1Qty = Math.max(1, Math.floor(trade.originalQuantity / 2));
      const newRemaining = trade.originalQuantity - tp1Qty;

      let tp1FillPrice = instrumentPrice;
      try {
        if (isConnected()) {
          const { orderId, promise } = await placeMarketOrder(contract, closeAction, tp1Qty);
          const result = await promise;
          if (result?.avgFillPrice > 0) tp1FillPrice = result.avgFillPrice;
          log(`TP1 market close order filled: ${tp1Qty} @ $${tp1FillPrice.toFixed(2)} (order #${orderId})`, "ibkr");
        }
      } catch (err: any) {
        log(`TP1 market close order failed for trade ${trade.id}: ${err.message}`, "ibkr");
      }

      const tp1Pnl = trade.entryPrice
        ? (isBuy ? tp1FillPrice - trade.entryPrice : trade.entryPrice - tp1FillPrice) * tp1Qty
        : 0;

      const entryPrice = trade.entryPrice ?? 0;
      const raiseStopToBe = !trade.stopMovedToBe && entryPrice > 0;
      await storage.updateIbkrTrade(trade.id, {
        tpHitLevel: 1,
        tp1FillPrice,
        tp1FilledAt: new Date().toISOString(),
        tp1PnlRealized: tp1Pnl,
        remainingQuantity: newRemaining,
        pnl: tp1Pnl,
        ...(raiseStopToBe && {
          stopPrice: entryPrice,
          stopMovedToBe: true,
        }),
      });

      log(
        `TP1 hit for trade ${trade.id}: ${instrumentType} price $${instrumentPrice.toFixed(2)} crossed T1 $${t1Level.toFixed(2)}, closed ${tp1Qty} @ $${tp1FillPrice.toFixed(2)}, P&L: $${tp1Pnl.toFixed(2)}, stop moved to BE $${beStopInstrument.toFixed(2)}`,
        "ibkr",
      );

      const updatedTrade = await storage.getIbkrTrade(trade.id);
      if (updatedTrade) {
        await postTradeUpdate(signal, updatedTrade, "TP1_HIT");
        if (raiseStopToBe) await postTradeUpdate(signal, updatedTrade, "RAISE_STOP");
      }
      return { event: "TP1_HIT", updatedTrade };
    }
  }

  if (trade.tpHitLevel === 1 && t2Level > 0) {
    const tp2Hit = isBuy ? instrumentPrice >= t2Level : instrumentPrice <= t2Level;
    if (tp2Hit) {
      const tp2Qty = trade.remainingQuantity;

      let tp2FillPrice = instrumentPrice;
      try {
        if (isConnected()) {
          const { orderId, promise } = await placeMarketOrder(contract, closeAction, tp2Qty);
          const result = await promise;
          if (result?.avgFillPrice > 0) tp2FillPrice = result.avgFillPrice;
          log(`TP2 market close order filled: ${tp2Qty} @ $${tp2FillPrice.toFixed(2)} (order #${orderId})`, "ibkr");
        }
      } catch (err: any) {
        log(`TP2 market close order failed for trade ${trade.id}: ${err.message}`, "ibkr");
      }

      const tp2Pnl = trade.entryPrice
        ? (isBuy ? tp2FillPrice - trade.entryPrice : trade.entryPrice - tp2FillPrice) * tp2Qty
        : 0;

      const totalPnl = (trade.tp1PnlRealized ?? 0) + tp2Pnl;
      const totalPnlPct = trade.entryPrice
        ? (totalPnl / (trade.entryPrice * trade.originalQuantity)) * 100
        : null;
        const instrStopDist = trade.entryPrice && stopLevel > 0
        ? Math.abs(trade.entryPrice - stopLevel)
        : (tp.stopDistance ?? 0);
      const rMultiple =
        trade.entryPrice && instrStopDist > 0
          ? totalPnl / (instrStopDist * trade.originalQuantity)
          : null;

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
        `TP2 hit for trade ${trade.id}: ${instrumentType} price $${instrumentPrice.toFixed(2)} crossed T2 $${t2Level.toFixed(2)}, all closed @ $${tp2FillPrice.toFixed(2)}, total P&L: $${totalPnl.toFixed(2)}`,
        "ibkr",
      );

      const updatedTrade = await storage.getIbkrTrade(trade.id);
      if (updatedTrade) await postTradeUpdate(signal, updatedTrade, "CLOSED");
      return { event: "CLOSED", updatedTrade };
    }
  }

  if (stopLevel > 0) {
    const stopHit = isBuy ? instrumentPrice <= stopLevel : instrumentPrice >= stopLevel;
    if (stopHit) {
      const stoppedQty = trade.remainingQuantity;

      let exitFillPrice = instrumentPrice;
      try {
        if (isConnected()) {
          const { orderId, promise } = await placeMarketOrder(contract, closeAction, stoppedQty);
          const result = await promise;
          if (result?.avgFillPrice > 0) exitFillPrice = result.avgFillPrice;
          log(`Stop market close order filled: ${stoppedQty} @ $${exitFillPrice.toFixed(2)} (order #${orderId})`, "ibkr");
        }
      } catch (err: any) {
        log(`Stop market close order failed for trade ${trade.id}: ${err.message}`, "ibkr");
      }

      const stopPnl = trade.entryPrice
        ? (isBuy ? exitFillPrice - trade.entryPrice : trade.entryPrice - exitFillPrice) * stoppedQty
        : 0;

      const totalPnl = (trade.tp1PnlRealized ?? 0) + stopPnl;
      const totalPnlPct = trade.entryPrice
        ? (totalPnl / (trade.entryPrice * trade.originalQuantity)) * 100
        : null;
        const instrStopDist2 = trade.entryPrice && stopLevel > 0
        ? Math.abs(trade.entryPrice - stopLevel)
        : (tp.stopDistance ?? 0);
      const rMultiple =
        trade.entryPrice && instrStopDist2 > 0
          ? totalPnl / (instrStopDist2 * trade.originalQuantity)
          : null;

      await storage.updateIbkrTrade(trade.id, {
        status: "CLOSED",
        exitPrice: exitFillPrice,
        remainingQuantity: 0,
        pnl: totalPnl,
        pnlPct: totalPnlPct,
        rMultiple,
        closedAt: new Date().toISOString(),
      });

      log(
        `Stop hit for trade ${trade.id}: ${instrumentType} price $${instrumentPrice.toFixed(2)} crossed stop $${stopLevel.toFixed(2)}, closed ${stoppedQty} @ $${exitFillPrice.toFixed(2)}, total P&L: $${totalPnl.toFixed(2)}`,
        "ibkr",
      );

      const eventType = trade.tpHitLevel > 0 ? "STOPPED_OUT_AFTER_TP" : "STOPPED_OUT";
      const updatedTrade = await storage.getIbkrTrade(trade.id);
      if (updatedTrade) await postTradeUpdate(signal, updatedTrade, eventType);
      return { event: eventType, updatedTrade };
    }
  }

  return { event: null, updatedTrade: null };
}

export async function monitorActiveTrades(): Promise<void> {
  const trades = await storage.getActiveIbkrTrades();
  const allSignals = await storage.getSignals(undefined, 1000);
  const closedSignalIds = new Set<number>();

  for (const trade of trades) {
    try {
      const signal = trade.signalId
        ? allSignals.find((s) => s.id === trade.signalId)
        : null;
      if (!signal) continue;

      const result = await monitorActiveTrade(trade, signal);
      if (result.event && trade.signalId && (result.updatedTrade?.status === "CLOSED" || result.updatedTrade?.status === "CANCELLED")) {
        closedSignalIds.add(trade.signalId);
      }
    } catch (err: any) {
      log(`Trade monitor error for trade ${trade.id}: ${err.message}`, "ibkr");
    }
  }

  if (closedSignalIds.size > 0) {
    try {
      const btodEnabled = (await storage.getSetting("btodEnabled")) !== "false";
      if (btodEnabled) {
        const { checkAllBtodTradesClosed, onTradeClose } = await import("./btod");
        for (const signalId of closedSignalIds) {
          const allClosed = await checkAllBtodTradesClosed(signalId);
          if (allClosed) {
            await onTradeClose();
            log(`BTOD: All trades closed for signal ${signalId}, gate check triggered`, "ibkr");
          }
        }
      }
    } catch (btodErr: any) {
      log(`BTOD onTradeClose check error: ${btodErr.message}`, "ibkr");
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
