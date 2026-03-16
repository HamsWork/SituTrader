import { storage } from "../storage";
import { log } from "../index";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import type { Signal, BtodState } from "@shared/schema";

dayjs.extend(utc);
dayjs.extend(timezone);

const ET = "America/New_York";

export interface RankedSignalEntry {
  signalId: number;
  ticker: string;
  setupType: string;
  qualityScore: number;
  rank: number;
}

export interface BtodDecision {
  execute: boolean;
  reason: string;
  rank?: number;
}

function nowET() {
  return dayjs().tz(ET);
}

function todayET(): string {
  return nowET().format("YYYY-MM-DD");
}

function minutesSinceMidnightET(): number {
  const now = nowET();
  return now.hour() * 60 + now.minute();
}

const SELECTIVE_END_MINUTES = 11 * 60;

export function rankOnDeckSignals(signals: Signal[]): RankedSignalEntry[] {
  const eligible = signals.filter(
    (s) =>
      s.status === "pending" &&
      s.activationStatus === "NOT_ACTIVE" &&
      (s.setupType === "A" || s.setupType === "B" || s.setupType === "C") &&
      (s.qualityScore ?? 0) >= 62,
  );

  eligible.sort((a, b) => {
    const qsDiff = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
    if (qsDiff !== 0) return qsDiff;
    const setupOrder: Record<string, number> = { A: 0, B: 1, C: 2 };
    const setupDiff = (setupOrder[a.setupType] ?? 99) - (setupOrder[b.setupType] ?? 99);
    if (setupDiff !== 0) return setupDiff;
    return a.ticker.localeCompare(b.ticker);
  });

  return eligible.map((s, i) => ({
    signalId: s.id,
    ticker: s.ticker,
    setupType: s.setupType,
    qualityScore: s.qualityScore ?? 0,
    rank: i + 1,
  }));
}

export async function initializeBtodForDay(date?: string): Promise<BtodState> {
  const tradeDate = date || todayET();

  const existing = await storage.getBtodState(tradeDate);
  if (existing && (existing.rankedQueue as any[]).length > 0) {
    log(`BTOD: Already initialized for ${tradeDate} with ${(existing.rankedQueue as any[]).length} signals`, "btod");
    return existing;
  }

  const allSignals = await storage.getSignals(undefined, 5000);
  const ranked = rankOnDeckSignals(allSignals);

  const top3Ids = ranked.slice(0, 3).map((r) => r.signalId);

  const state = await storage.upsertBtodState({
    tradeDate,
    phase: "SELECTIVE",
    rankedQueue: ranked as any,
    top3Ids: top3Ids as any,
    selectedSignalId: null,
    secondSignalId: null,
    gateOpen: true,
    tradesExecuted: 0,
    phaseChangedAt: null,
  });

  log(
    `BTOD: Initialized for ${tradeDate} — ${ranked.length} eligible signals, top 3: [${ranked.slice(0, 3).map((r) => `${r.ticker}(QS=${r.qualityScore})`).join(", ")}]`,
    "btod",
  );

  return state;
}

export async function shouldExecuteActivation(signalId: number, activationTs?: Date | string): Promise<BtodDecision> {
  const tradeDate = todayET();
  const state = await storage.getBtodState(tradeDate);

  if (!state) {
    log(`BTOD: No state for ${tradeDate}, rejecting execution`, "btod");
    return { execute: false, reason: "no_btod_state" };
  }

  if (!state.gateOpen) {
    return { execute: false, reason: "gate_closed" };
  }

  if (state.tradesExecuted >= 2) {
    return { execute: false, reason: "max_trades_reached" };
  }

  const top3 = state.top3Ids as number[];
  const ranked = state.rankedQueue as RankedSignalEntry[];
  const entry = ranked.find((r) => r.signalId === signalId);
  const rank = entry?.rank;

  if (state.phase === "SELECTIVE") {
    if (top3.includes(signalId)) {
      log(
        `BTOD: Top-3 signal ${signalId} (${entry?.ticker ?? "?"} rank #${rank}) activated — EXECUTING`,
        "btod",
      );
      return { execute: true, reason: "top3_priority", rank };
    }
    return {
      execute: false,
      reason: `not_in_top3_during_selective_phase`,
      rank,
    };
  }

  if (state.phase === "OPEN") {
    if (activationTs) {
      const triggerTime = dayjs(activationTs).tz(ET);
      const triggerMinutes = triggerTime.hour() * 60 + triggerTime.minute();
      if (triggerMinutes < SELECTIVE_END_MINUTES) {
        log(
          `BTOD: Rejecting stale activation for signal ${signalId} (${entry?.ticker ?? "?"}) — activated at ${triggerTime.format("HH:mm")} ET (before 11am)`,
          "btod",
        );
        return { execute: false, reason: "stale_activation_before_11am", rank };
      }
    }

    if (state.selectedSignalId && !state.secondSignalId && state.tradesExecuted < 2) {
      log(
        `BTOD: Gate reopened after first trade closed — EXECUTING second trade signal ${signalId} (${entry?.ticker ?? "?"})`,
        "btod",
      );
      return { execute: true, reason: "second_trade_after_close", rank };
    }

    if (!state.selectedSignalId) {
      log(
        `BTOD: Open phase, first fresh activation signal ${signalId} (${entry?.ticker ?? "?"}) — EXECUTING`,
        "btod",
      );
      return { execute: true, reason: "first_fresh_after_open_phase", rank };
    }

    return { execute: false, reason: "gate_closed_trade_active" };
  }

  return { execute: false, reason: "unknown_phase" };
}

export async function onBtodTradeExecuted(signalId: number): Promise<void> {
  const tradeDate = todayET();
  const state = await storage.getBtodState(tradeDate);
  if (!state) return;

  const updates: any = {
    tradeDate,
    gateOpen: false,
    tradesExecuted: state.tradesExecuted + 1,
    updatedAt: new Date(),
  };

  if (!state.selectedSignalId) {
    updates.selectedSignalId = signalId;
  } else {
    updates.secondSignalId = signalId;
  }

  await storage.upsertBtodState(updates);

  const ranked = state.rankedQueue as RankedSignalEntry[];
  const entry = ranked.find((r) => r.signalId === signalId);
  log(
    `BTOD: Trade #${state.tradesExecuted + 1} executed — signal ${signalId} (${entry?.ticker ?? "?"} rank #${entry?.rank ?? "?"})`,
    "btod",
  );
}

export async function transitionToOpenPhase(): Promise<void> {
  const tradeDate = todayET();
  const state = await storage.getBtodState(tradeDate);
  if (!state) {
    log("BTOD: No state found for transition to OPEN phase", "btod");
    return;
  }

  if (state.selectedSignalId) {
    log("BTOD: Trade already selected before 11am, skipping transition", "btod");
    return;
  }

  if (state.phase === "OPEN") {
    log("BTOD: Already in OPEN phase", "btod");
    return;
  }

  await storage.upsertBtodState({
    tradeDate,
    phase: "OPEN",
    phaseChangedAt: new Date(),
  });

  log(
    "BTOD: Transitioned to OPEN phase at 11:00am ET — waiting for first fresh activation",
    "btod",
  );
}

export async function onTradeClose(): Promise<void> {
  const tradeDate = todayET();
  const state = await storage.getBtodState(tradeDate);
  if (!state) return;

  if (state.tradesExecuted >= 2) {
    log("BTOD: Max 2 trades reached, gate stays closed", "btod");
    return;
  }

  await storage.upsertBtodState({
    tradeDate,
    gateOpen: true,
    phase: "OPEN",
  });

  log(
    `BTOD: Trade closed — gate reopened for trade #${state.tradesExecuted + 1}`,
    "btod",
  );
}

export function isSelectivePhaseOver(): boolean {
  return minutesSinceMidnightET() >= SELECTIVE_END_MINUTES;
}

export async function getBtodStatus(): Promise<BtodState | null> {
  return storage.getBtodState(todayET());
}

export interface LetfOptionContractResult {
  contractTicker: string;
  strike: number;
  expiry: string;
  right: "C" | "P";
  delta: number | null;
  markPrice: number;
}

export async function findLetfOptionContract(
  letfTicker: string,
  bias: "BUY" | "SELL",
  currentLetfPrice: number,
): Promise<LetfOptionContractResult | null> {
  try {
    const { fetchOptionsChain, fetchOptionSnapshot } = await import("./polygon");

    const contractType: "call" | "put" = bias === "BUY" ? "call" : "put";
    const right: "C" | "P" = bias === "BUY" ? "C" : "P";

    const now = new Date();
    const minExpDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const maxExpDate = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const chain = await fetchOptionsChain(
      letfTicker,
      contractType,
      minExpDate,
      maxExpDate,
      50,
    );

    if (chain.length === 0) {
      log(`BTOD: No ${contractType} options chain found for LETF ${letfTicker}`, "btod");
      return null;
    }

    let candidates = chain.filter(
      (c) => Math.abs(c.strike_price - currentLetfPrice) / currentLetfPrice < 0.03,
    );

    if (candidates.length === 0) {
      candidates = [...chain]
        .sort((a, b) => Math.abs(a.strike_price - currentLetfPrice) - Math.abs(b.strike_price - currentLetfPrice))
        .slice(0, 1);
    }

    candidates.sort(
      (a, b) => Math.abs(a.strike_price - currentLetfPrice) - Math.abs(b.strike_price - currentLetfPrice),
    );

    const uniqueExpiries = [...new Set(candidates.map((c) => c.expiration_date))];
    const closestStrikes = [...new Set(candidates.map((c) => c.strike_price))].slice(0, 3);
    const pool = candidates.filter(
      (c) => closestStrikes.includes(c.strike_price) && uniqueExpiries.includes(c.expiration_date),
    );

    const MIN_OI = 500;
    const MAX_SPREAD = 0.05;

    let bestByOI: { contract: typeof pool[0]; snapshot: any } | null = null;

    for (const contract of pool) {
      try {
        const snapshot = await fetchOptionSnapshot(letfTicker, contract.ticker);
        if (!snapshot) continue;

        const oi = snapshot.openInterest ?? 0;
        const bid = snapshot.bid ?? 0;
        const ask = snapshot.ask ?? 0;
        const spread = bid > 0 ? (ask - bid) / bid : 999;

        if (!bestByOI || oi > (bestByOI.snapshot.openInterest ?? 0)) {
          bestByOI = { contract, snapshot };
        }

        if (oi >= MIN_OI && spread <= MAX_SPREAD) {
          const mark = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
          log(
            `BTOD: Found LETF option contract ${contract.ticker} — strike ${contract.strike_price}, OI ${oi}, spread ${(spread * 100).toFixed(1)}%, delta ${snapshot.delta?.toFixed(3) ?? "?"}`,
            "btod",
          );
          return {
            contractTicker: contract.ticker,
            strike: contract.strike_price,
            expiry: contract.expiration_date,
            right,
            delta: snapshot.delta,
            markPrice: mark,
          };
        }
      } catch (err: any) {
        log(`BTOD: Error checking LETF option ${contract.ticker}: ${err.message}`, "btod");
      }
    }

    if (bestByOI) {
      const s = bestByOI.snapshot;
      const bid = s.bid ?? 0;
      const ask = s.ask ?? 0;
      const mark = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
      log(
        `BTOD: Using best-available LETF option ${bestByOI.contract.ticker} (OI ${s.openInterest ?? 0}, fallback)`,
        "btod",
      );
      return {
        contractTicker: bestByOI.contract.ticker,
        strike: bestByOI.contract.strike_price,
        expiry: bestByOI.contract.expiration_date,
        right,
        delta: s.delta,
        markPrice: mark,
      };
    }

    log(`BTOD: No valid LETF option contract found for ${letfTicker}`, "btod");
    return null;
  } catch (err: any) {
    log(`BTOD: Error in findLetfOptionContract for ${letfTicker}: ${err.message}`, "btod");
    return null;
  }
}

export interface BtodInstrumentResult {
  instrumentType: string;
  success: boolean;
  tradeId?: number;
  error?: string;
}

export async function executeBtodMultiInstrument(signalId: number, qty: number = 1): Promise<BtodInstrumentResult[]> {
  const results: BtodInstrumentResult[] = [];
  const sigs = await storage.getSignals(undefined, 5000);
  const signal = sigs.find((s) => s.id === signalId);
  if (!signal) {
    log(`BTOD multi-instrument: signal ${signalId} not found`, "btod");
    return results;
  }

  const tp = signal.tradePlanJson as any;
  if (!tp) {
    log(`BTOD multi-instrument: signal ${signalId} has no trade plan`, "btod");
    return results;
  }

  const isBuy = tp.bias === "BUY";
  const action: "BUY" | "SELL" = isBuy ? "BUY" : "SELL";

  let optionTicker = signal.optionContractTicker || (signal.optionsJson as any)?.candidate?.contractSymbol;
  const optionsJson = signal.optionsJson as any;
  const optionHadNoQuote = optionsJson?.checks?.reasonIfFail?.includes("NO_QUOTE") || (optionsJson?.checks?.bid === 0 && optionsJson?.checks?.ask === 0);

  if (optionTicker && optionHadNoQuote) {
    try {
      const { fetchOptionSnapshot } = await import("./polygon");
      const liveSnap = await fetchOptionSnapshot(signal.ticker, optionTicker);
      if (liveSnap && liveSnap.bid != null && liveSnap.bid > 0 && liveSnap.ask != null && liveSnap.ask > 0) {
        log(`BTOD: Live option quote found for ${optionTicker} — bid=${liveSnap.bid} ask=${liveSnap.ask}, including OPTION`, "btod");
      } else {
        log(`BTOD: Live option quote still unavailable for ${optionTicker}, skipping OPTION`, "btod");
        optionTicker = null;
      }
    } catch (err: any) {
      log(`BTOD: Failed to re-check option quote for ${optionTicker}: ${err.message}`, "btod");
      optionTicker = null;
    }
  }

  const letfJson = signal.leveragedEtfJson as any;
  const letfTicker = signal.instrumentTicker || letfJson?.ticker;

  const instrumentsToExecute: Array<{
    type: string;
    ticker: string | null;
    discordFn: string;
  }> = [];

  instrumentsToExecute.push({
    type: "SHARES",
    ticker: signal.ticker,
    discordFn: "postSharesAlert",
  });

  if (optionTicker) {
    instrumentsToExecute.push({
      type: "OPTION",
      ticker: optionTicker,
      discordFn: "postOptionsAlert",
    });
  }

  if (letfTicker) {
    instrumentsToExecute.push({
      type: "LEVERAGED_ETF",
      ticker: letfTicker,
      discordFn: "postLetfAlert",
    });
  }

  let letfOptionContract: LetfOptionContractResult | null = null;
  if (letfTicker) {
    try {
      const { fetchSnapshot } = await import("./polygon");
      const letfSnap = await fetchSnapshot(letfTicker);
      const letfPrice = letfSnap?.lastPrice ?? signal.instrumentEntryPrice ?? 0;
      if (letfPrice > 0) {
        letfOptionContract = await findLetfOptionContract(letfTicker, action, letfPrice);
        if (letfOptionContract && letfOptionContract.markPrice > 0) {
          instrumentsToExecute.push({
            type: "LETF_OPTIONS",
            ticker: letfOptionContract.contractTicker,
            discordFn: "postLetfOptionsAlert",
          });
        } else if (letfOptionContract && letfOptionContract.markPrice <= 0) {
          log(`BTOD: Skipping LETF_OPTIONS for ${letfTicker} — markPrice is ${letfOptionContract.markPrice} (no valid quote)`, "btod");
          letfOptionContract = null;
        }
      }
    } catch (err: any) {
      log(`BTOD: Failed to find LETF option contract for ${letfTicker}: ${err.message}`, "btod");
    }
  }

  log(
    `BTOD: Spawning ${instrumentsToExecute.length} instrument trades for signal ${signalId} (${signal.ticker}): [${instrumentsToExecute.map((i) => i.type).join(", ")}]`,
    "btod",
  );

  const stockEntry = signal.entryPriceAtActivation ?? 0;
  const stockT1 = tp.t1 ?? null;
  const stockT2 = tp.t2 ?? null;
  const stockStop = signal.stopPrice ?? null;

  for (const inst of instrumentsToExecute) {
    try {
      const { convertStockTargetsToInstrument } = await import("./ibkrOrders");
      let instrumentEntry = 0;
      let delta: number | null = null;
      let leverage = 1;

      if (inst.type === "SHARES") {
        instrumentEntry = stockEntry;
      } else if (inst.type === "OPTION" && inst.ticker) {
        instrumentEntry = signal.optionEntryMark ?? 0;
        try {
          const { fetchOptionSnapshot } = await import("./polygon");
          const optSnap = await fetchOptionSnapshot(signal.ticker, inst.ticker);
          delta = optSnap?.delta ?? null;
        } catch {
          delta = isBuy ? 0.5 : -0.5;
        }
      } else if (inst.type === "LEVERAGED_ETF") {
        instrumentEntry = signal.instrumentEntryPrice ?? 0;
        leverage = (signal.leveragedEtfJson as any)?.leverage ?? 1;
      } else if (inst.type === "LETF_OPTIONS" && letfOptionContract) {
        instrumentEntry = letfOptionContract.markPrice;
        delta = letfOptionContract.delta ?? (letfOptionContract.right === "P" ? -0.5 : 0.5);
        leverage = (signal.leveragedEtfJson as any)?.leverage ?? 1;
      }

      const converted = convertStockTargetsToInstrument(
        stockEntry,
        instrumentEntry,
        stockT1,
        stockT2,
        stockStop,
        delta,
        leverage,
        inst.type,
      );
      const tradeStopPrice = converted.stop;
      const tradeTarget1 = converted.t1;
      const tradeTarget2 = converted.t2;

      const trade = await storage.createIbkrTrade({
        signalId: signal.id,
        ticker: signal.ticker,
        instrumentType: inst.type,
        instrumentTicker: inst.type === "SHARES" ? null : inst.ticker,
        side: action,
        quantity: qty,
        originalQuantity: qty,
        remainingQuantity: qty,
        tpHitLevel: 0,
        entryPrice: instrumentEntry > 0 ? instrumentEntry : undefined,
        stopPrice: tradeStopPrice,
        target1Price: tradeTarget1,
        target2Price: tradeTarget2,
        status: "PENDING",
      });

      try {
        const freshSigs = await storage.getSignals(undefined, 5000);
        const freshSig = freshSigs.find((s) => s.id === signalId) ?? signal;
        const { postOptionsAlert, postLetfAlert, postSharesAlert, postLetfOptionsAlert } = await import("./discord");

        if (inst.type === "OPTION") {
          await postOptionsAlert(freshSig, { ...trade, entryPrice: signal.optionEntryMark, status: "PENDING" } as any);
        } else if (inst.type === "LEVERAGED_ETF") {
          await postLetfAlert(freshSig, { ...trade, entryPrice: signal.instrumentEntryPrice, status: "PENDING" } as any);
        } else if (inst.type === "LETF_OPTIONS") {
          await postLetfOptionsAlert(
            freshSig,
            { ...trade, entryPrice: letfOptionContract?.markPrice ?? 0, status: "PENDING" } as any,
            undefined,
            letfOptionContract,
          );
        } else if (inst.type === "SHARES") {
          await postSharesAlert(freshSig, { ...trade, entryPrice: signal.entryPriceAtActivation, status: "PENDING" } as any);
        }

        await storage.updateIbkrTrade(trade.id, { discordAlertSent: true });
      } catch (discErr: any) {
        log(`BTOD: Discord alert failed for ${inst.type} trade ${trade.id}: ${discErr.message}`, "btod");
      }

      try {
        const { isConnected, connectIBKR, placeMarketOrder, makeContract } = await import("./ibkrOrders") as any;

        let ibkrConnected = false;
        try {
          ibkrConnected = isConnected ? isConnected() : false;
          if (!ibkrConnected && connectIBKR) {
            ibkrConnected = await connectIBKR();
          }
        } catch {}

        if (ibkrConnected && placeMarketOrder && makeContract) {
          const isOptionType = inst.type === "OPTION" || inst.type === "LETF_OPTIONS";
          const contract = makeContract(
            isOptionType ? "OPTION" : inst.type,
            inst.type === "LETF_OPTIONS" ? (letfTicker ?? signal.ticker) : signal.ticker,
            inst.ticker,
            isOptionType ? inst.ticker : undefined,
          );
          const { orderId, promise } = await placeMarketOrder(contract, action, qty);
          await storage.updateIbkrTrade(trade.id, { ibkrOrderId: orderId, status: "SUBMITTED" });

          try {
            const fillResult = await promise;
            const entryPrice = fillResult?.avgFillPrice > 0 ? fillResult.avgFillPrice : null;
            if (entryPrice) {
              await storage.updateIbkrTrade(trade.id, {
                status: "FILLED",
                entryPrice,
                filledAt: new Date().toISOString(),
              });
            }
          } catch (fillErr: any) {
            const fallbackEntry = instrumentEntry > 0 ? instrumentEntry : null;
            if (fallbackEntry != null) {
              await storage.updateIbkrTrade(trade.id, {
                status: "FILLED",
                entryPrice: fallbackEntry,
                filledAt: new Date().toISOString(),
                notes: `Order rejected; filled from signal price. Reject: ${fillErr.message}`,
              });
            } else {
              await storage.updateIbkrTrade(trade.id, { status: "REJECTED", notes: `Order rejected: ${fillErr.message}` });
            }
          }
        } else {
          await storage.updateIbkrTrade(trade.id, {
            status: "PENDING",
            notes: "IBKR not connected; Discord alert sent",
          });
        }
      } catch (ibkrErr: any) {
        log(`BTOD: IBKR execution failed for ${inst.type} trade: ${ibkrErr.message}`, "btod");
      }

      results.push({ instrumentType: inst.type, success: true, tradeId: trade.id });
      log(`BTOD: ${inst.type} trade created (ID: ${trade.id}) for signal ${signalId}`, "btod");
    } catch (err: any) {
      results.push({ instrumentType: inst.type, success: false, error: err.message });
      log(`BTOD: Failed to create ${inst.type} trade for signal ${signalId}: ${err.message}`, "btod");
    }
  }

  return results;
}

export async function checkAllBtodTradesClosed(signalId: number): Promise<boolean> {
  const allTrades = await storage.getAllIbkrTrades();
  const btodTrades = allTrades.filter(
    (t) => t.signalId === signalId && t.status !== "REJECTED" && t.status !== "NOT_FILLED",
  );

  if (btodTrades.length === 0) return true;

  const allClosed = btodTrades.every(
    (t) => t.status === "CLOSED" || t.status === "CANCELLED",
  );

  return allClosed;
}
