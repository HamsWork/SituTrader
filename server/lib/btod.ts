import { storage } from "../storage";
import { log } from "../index";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import type {BtodState } from "@shared/schema";
import type { SimDayContext } from "../simulation";

dayjs.extend(utc);
dayjs.extend(timezone);

const CT = "America/Chicago";



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

export type RankableSignalLike = {
  id: number;
  ticker: string;
  setupType: string;
  qualityScore?: number | null;
  status?: string;
  activationStatus?: string;
};

function nowCT() {
  return dayjs().tz(CT);
}

function todayCT(): string {
  return nowCT().format("YYYY-MM-DD");
}

function minutesSinceMidnightCT(): number {
  const now = nowCT();
  return now.hour() * 60 + now.minute();
}

const SELECTIVE_END_MINUTES = 10 * 60;

/** Highest-ranked signals allowed during BTOD SELECTIVE phase (persisted as `top3Ids` in schema). */
export const BTOD_TOP_N = 15;

/** Max BTOD auto-trades per session (`selectedSignalId` / `secondSignalId` support up to two). */
export const BTOD_MAX_TRADES = 3;

export function rankOnDeckSignals(
  signals: RankableSignalLike[],
  allowedSetups: string[] = ["A", "B", "C"],
): RankedSignalEntry[] {
  const setupSet = new Set(allowedSetups);
  const eligible = signals.filter(
    (s) =>
      s.status === "pending" &&
      s.activationStatus === "NOT_ACTIVE" &&
      setupSet.has(s.setupType) &&
      (s.qualityScore ?? 0) >= 62,
  );

  const setupOrder: Record<string, number> = {};
  allowedSetups.forEach((t, i) => (setupOrder[t] = i));

  eligible.sort((a, b) => {
    const qsDiff = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
    if (qsDiff !== 0) return qsDiff;
    const setupDiff =
      (setupOrder[a.setupType] ?? 99) - (setupOrder[b.setupType] ?? 99);
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

export function getBtodRankedQueueAndTopNIds(
  signals: RankableSignalLike[],
  allowedSetups?: string[],
): {
  rankedQueue: RankedSignalEntry[];
  topNIds: number[];
} {
  const rankedQueue = rankOnDeckSignals(signals, allowedSetups);
  const topNIds = rankedQueue.slice(0, BTOD_TOP_N).map((r) => r.signalId);
  return { rankedQueue, topNIds };
}


export async function initializeBtodForDay(ctx?: SimDayContext): Promise<BtodState> {
  const tradeDate = ctx?.today || todayCT();
  const allowedSetups = ctx?.config?.btodSetupTypes;

  if (!ctx) {
    const existing = await storage.getBtodState(tradeDate);
    if (existing && (existing.rankedQueue as any[]).length > 0) {
      log(
        `BTOD: Already initialized for ${tradeDate} with ${(existing.rankedQueue as any[]).length} signals`,
        "btod",
      );
      return existing;
    }
  }

  const onDeck = ctx ? Array.from(ctx.onDeckSignals.values()) : await storage.getOnDeckSignals();

  const { rankedQueue: ranked, topNIds } = getBtodRankedQueueAndTopNIds(
    onDeck,
    allowedSetups,
  );

  if (!ctx) {
    const state = await storage.upsertBtodState({
      tradeDate,
      phase: "SELECTIVE",
      rankedQueue: ranked as any,
      top3Ids: topNIds as any,
      selectedSignalId: null,
      secondSignalId: null,
      gateOpen: true,
      tradesExecuted: 0,
      phaseChangedAt: null,
    });
    log(
      `BTOD: Initialized for ${tradeDate} — ${ranked.length} eligible signals, top ${BTOD_TOP_N}: [${ranked
        .slice(0, BTOD_TOP_N)
        .map((r) => `${r.ticker}(QS=${r.qualityScore})`)
        .join(", ")}]`,
      "btod",
    );
    return state;
  } else {
    return {
      phase: topNIds.length > 0 ? "SELECTIVE" : "CLOSED",
      rankedQueue: ranked as any,
      top3Ids: topNIds as any,
      selectedSignalId: null,
      secondSignalId: null,
      gateOpen: topNIds.length > 0,
      tradesExecuted: 0,
      phaseChangedAt: null,
    } as BtodState;
  }
}


export async function shouldExecuteActivation(
  signalId: number,
  activationTs?: Date | string,
): Promise<BtodDecision> {
  const tradeDate = todayCT();
  const state = await storage.getBtodState(tradeDate);

  if (!state) {
    log(`BTOD: No state for ${tradeDate}, rejecting execution`, "btod");
    return { execute: false, reason: "no_btod_state" };
  }

  if (state.tradesExecuted >= BTOD_MAX_TRADES) {
    return { execute: false, reason: "max_trades_reached" };
  }

  const topN = state.top3Ids as number[];
  const ranked = state.rankedQueue as RankedSignalEntry[];
  const entry = ranked.find((r) => r.signalId === signalId);
  const rank = entry?.rank;

  if (state.phase === "SELECTIVE") {
    if (topN.includes(signalId)) {
      log(
        `BTOD: Top-${BTOD_TOP_N} signal ${signalId} (${entry?.ticker ?? "?"} rank #${rank}) activated — EXECUTING (trade ${state.tradesExecuted + 1}/${BTOD_MAX_TRADES})`,
        "btod",
      );
      return { execute: true, reason: "top_n_priority", rank };
    }
    return {
      execute: false,
      reason: `not_in_top_n_during_selective_phase`,
      rank,
    };
  }

  if (state.phase === "OPEN") {
    if (activationTs) {
      const triggerTime = dayjs(activationTs).tz(CT);
      const triggerMinutes = triggerTime.hour() * 60 + triggerTime.minute();
      if (triggerMinutes < SELECTIVE_END_MINUTES) {
        log(
          `BTOD: Rejecting stale activation for signal ${signalId} (${entry?.ticker ?? "?"}) — activated at ${triggerTime.format("HH:mm")} CT (before 10am)`,
          "btod",
        );
        return { execute: false, reason: "stale_activation_before_10am_ct", rank };
      }
    }

    log(
      `BTOD: Open phase signal ${signalId} (${entry?.ticker ?? "?"}) — EXECUTING (trade ${state.tradesExecuted + 1}/${BTOD_MAX_TRADES})`,
      "btod",
    );
    return { execute: true, reason: "open_phase_under_max", rank };
  }

  return { execute: false, reason: "unknown_phase" };
}

export async function onBtodTradeExecuted(signalId: number): Promise<void> {
  const tradeDate = todayCT();
  const state = await storage.getBtodState(tradeDate);
  if (!state) return;

  const newCount = state.tradesExecuted + 1;
  const updates: any = {
    tradeDate,
    tradesExecuted: newCount,
    gateOpen: newCount < BTOD_MAX_TRADES,
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
    `BTOD: Trade #${newCount}/${BTOD_MAX_TRADES} executed — signal ${signalId} (${entry?.ticker ?? "?"} rank #${entry?.rank ?? "?"})`,
    "btod",
  );
}

export async function transitionToOpenPhase(): Promise<void> {
  const tradeDate = todayCT();
  const state = await storage.getBtodState(tradeDate);
  if (!state) {
    log("BTOD: No state found for transition to OPEN phase", "btod");
    return;
  }

  if (state.selectedSignalId) {
    log(
      "BTOD: Trade already selected before 10am CT, skipping transition",
      "btod",
    );
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
    "BTOD: Transitioned to OPEN phase at 10:00am CT — waiting for first fresh activation",
    "btod",
  );
}

export async function onTradeClose(): Promise<void> {
  const tradeDate = todayCT();
  const state = await storage.getBtodState(tradeDate);
  if (!state) return;

  if (state.tradesExecuted >= BTOD_MAX_TRADES) {
    log(
      `BTOD: Max ${BTOD_MAX_TRADES} trades reached — no more trades today`,
      "btod",
    );
    return;
  }

  log(
    `BTOD: Trade closed — ${state.tradesExecuted}/${BTOD_MAX_TRADES} trades used today`,
    "btod",
  );
}

export function isSelectivePhaseOver(): boolean {
  return minutesSinceMidnightCT() >= SELECTIVE_END_MINUTES;
}

export async function getBtodStatus(): Promise<BtodState | null> {
  return storage.getBtodState(todayCT());
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
    const { fetchOptionsChain, fetchOptionSnapshot } = await import(
      "./polygon"
    );

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
      log(
        `BTOD: No ${contractType} options chain found for LETF ${letfTicker}`,
        "btod",
      );
      return null;
    }

    let candidates = chain.filter(
      (c) =>
        Math.abs(c.strike_price - currentLetfPrice) / currentLetfPrice < 0.03,
    );

    if (candidates.length === 0) {
      candidates = [...chain]
        .sort(
          (a, b) =>
            Math.abs(a.strike_price - currentLetfPrice) -
            Math.abs(b.strike_price - currentLetfPrice),
        )
        .slice(0, 1);
    }

    candidates.sort(
      (a, b) =>
        Math.abs(a.strike_price - currentLetfPrice) -
        Math.abs(b.strike_price - currentLetfPrice),
    );

    const uniqueExpiries = Array.from(
      new Set(candidates.map((c) => c.expiration_date)),
    );
    const closestStrikes = Array.from(
      new Set(candidates.map((c) => c.strike_price)),
    ).slice(0, 3);
    const pool = candidates.filter(
      (c) =>
        closestStrikes.includes(c.strike_price) &&
        uniqueExpiries.includes(c.expiration_date),
    );

    const MIN_OI = 500;
    const MAX_SPREAD = 0.05;

    let bestByOI: { contract: (typeof pool)[0]; snapshot: any } | null = null;

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
        log(
          `BTOD: Error checking LETF option ${contract.ticker}: ${err.message}`,
          "btod",
        );
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
    log(
      `BTOD: Error in findLetfOptionContract for ${letfTicker}: ${err.message}`,
      "btod",
    );
    return null;
  }
}

export interface BtodInstrumentResult {
  instrumentType: string;
  success: boolean;
  tradeId?: number;
  tradesyncSignalId?: number;
  error?: string;
}

export async function executeBtodMultiInstrument(
  signalId: number,
  qty: number = 1,
): Promise<BtodInstrumentResult[]> {
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

  if (!signal.optionContractTicker && !(signal.optionsJson as any)?.candidate?.contractSymbol) {
    try {
      const { enrichOptionData } = await import("./options");
      await enrichOptionData(signal.ticker, signal, tp, signal.activatedTs ?? undefined);
      const refreshed = (await storage.getSignals(undefined, 5000)).find(s => s.id === signalId);
      if (refreshed) {
        Object.assign(signal, refreshed);
      }
      log(`BTOD: Re-enriched option/LETF data for signal ${signalId}`, "btod");
    } catch (err: any) {
      log(`BTOD: Re-enrichment failed for signal ${signalId}: ${err.message}`, "btod");
    }
  }

  let optionTicker =
    signal.optionContractTicker ||
    (signal.optionsJson as any)?.candidate?.contractSymbol;
  const optionsJson = signal.optionsJson as any;
  const optionHadNoQuote =
    optionsJson?.checks?.reasonIfFail?.includes("NO_QUOTE") ||
    (optionsJson?.checks?.bid === 0 && optionsJson?.checks?.ask === 0);

  if (optionTicker && optionHadNoQuote) {
    try {
      const { fetchOptionSnapshot } = await import("./polygon");
      const liveSnap = await fetchOptionSnapshot(signal.ticker, optionTicker);
      if (
        liveSnap &&
        liveSnap.bid != null &&
        liveSnap.bid > 0 &&
        liveSnap.ask != null &&
        liveSnap.ask > 0
      ) {
        log(
          `BTOD: Live option quote found for ${optionTicker} — bid=${liveSnap.bid} ask=${liveSnap.ask}, including OPTION`,
          "btod",
        );
      } else {
        log(
          `BTOD: Live option quote still unavailable for ${optionTicker}, skipping OPTION`,
          "btod",
        );
        optionTicker = null;
      }
    } catch (err: any) {
      log(
        `BTOD: Failed to re-check option quote for ${optionTicker}: ${err.message}`,
        "btod",
      );
      optionTicker = null;
    }
  }

  const letfJson = signal.leveragedEtfJson as any;
  const letfTicker = signal.instrumentTicker || letfJson?.ticker;

  const instrumentsToExecute: Array<{
    type: string;
    ticker: string | null;
  }> = [];

  instrumentsToExecute.push({
    type: "SHARES",
    ticker: signal.ticker,
  });

  if (optionTicker) {
    instrumentsToExecute.push({
      type: "OPTION",
      ticker: optionTicker,
    });
  }

  if (letfTicker) {
    instrumentsToExecute.push({
      type: "LEVERAGED_ETF",
      ticker: letfTicker,
    });
  }

  let letfOptionContract: LetfOptionContractResult | null = null;
  if (letfTicker) {
    try {
      const { fetchSnapshot } = await import("./polygon");
      const letfSnap = await fetchSnapshot(letfTicker);
      const letfPrice = letfSnap?.lastPrice ?? signal.instrumentEntryPrice ?? 0;
      if (letfPrice > 0) {
        letfOptionContract = await findLetfOptionContract(
          letfTicker,
          action,
          letfPrice,
        );
        if (letfOptionContract && letfOptionContract.markPrice > 0) {
          instrumentsToExecute.push({
            type: "LETF_OPTIONS",
            ticker: letfOptionContract.contractTicker,
          });
        } else if (letfOptionContract && letfOptionContract.markPrice <= 0) {
          log(
            `BTOD: Skipping LETF_OPTIONS for ${letfTicker} — markPrice is ${letfOptionContract.markPrice} (no valid quote)`,
            "btod",
          );
          letfOptionContract = null;
        }
      }
    } catch (err: any) {
      log(
        `BTOD: Failed to find LETF option contract for ${letfTicker}: ${err.message}`,
        "btod",
      );
    }
  }

  log(
    `BTOD: Spawning ${instrumentsToExecute.length} instrument trades for signal ${signalId} (${signal.ticker}): [${instrumentsToExecute.map((i) => i.type).join(", ")}]`,
    "btod",
  );

  let stockEntry = signal.entryPriceAtActivation ?? 0;
  const staleEntry = stockEntry;
  try {
    const { fetchSnapshot } = await import("./polygon");
    const snap = await fetchSnapshot(signal.ticker);
    if (snap?.lastPrice && snap.lastPrice > 0) {
      stockEntry = snap.lastPrice;
      log(`BTOD: Live stock price for ${signal.ticker}: $${stockEntry.toFixed(2)} (was $${staleEntry.toFixed(2)})`, "btod");
      await storage.updateSignalActivation(signal.id, signal.activationStatus ?? "ACTIVE", undefined, stockEntry);
    } else {
      log(`BTOD: No live stock price for ${signal.ticker}, keeping activation price $${stockEntry}`, "btod");
    }
  } catch (err: any) {
    log(`BTOD: Error fetching live stock price for ${signal.ticker}: ${err.message}, keeping $${stockEntry}`, "btod");
  }

  let freshOptionMark: number | null = null;
  const optTickerForFresh = optionTicker;
  if (optTickerForFresh) {
    const cachedMark = signal.optionEntryMark ?? 0;
    const fetchStart = Date.now();
    try {
      const { fetchOptionLastTrade, fetchOptionMark } = await import("./polygon");
      const MAX_LAST_TRADE_AGE_MS = 5 * 60 * 1000;
      const lastTrade = await fetchOptionLastTrade(optTickerForFresh);
      const tradeIsRecent = lastTrade && lastTrade.mark != null && lastTrade.mark > 0 &&
        lastTrade.ts != null && (Date.now() - lastTrade.ts) < MAX_LAST_TRADE_AGE_MS;
      if (tradeIsRecent) {
        freshOptionMark = lastTrade!.mark!;
        const ageMs = Date.now() - lastTrade!.ts!;
        log(`BTOD: Option last trade for ${optTickerForFresh}: $${freshOptionMark} (age ${Math.round(ageMs / 1000)}s, fetched in ${Date.now() - fetchStart}ms)`, "btod");
      } else {
        const liveQuote = await fetchOptionMark(optTickerForFresh, signal.ticker);
        if (liveQuote && liveQuote.mark != null && liveQuote.mark > 0) {
          freshOptionMark = liveQuote.mark;
          log(`BTOD: Option NBBO mark for ${optTickerForFresh}: $${freshOptionMark} (fetched in ${Date.now() - fetchStart}ms)`, "btod");
        } else {
          freshOptionMark = cachedMark > 0 ? cachedMark : null;
          log(`BTOD: ⚠ No live option price for ${optTickerForFresh}, using cached $${freshOptionMark ?? 0} (fetched in ${Date.now() - fetchStart}ms)`, "btod");
        }
      }
      if (freshOptionMark != null && freshOptionMark > 0) {
        await storage.updateSignalOptionTracking(signal.id, { optionEntryMark: freshOptionMark });
        log(`BTOD: Updated optionEntryMark for signal ${signalId}: $${freshOptionMark} (was $${cachedMark})`, "btod");
      }
    } catch (err: any) {
      freshOptionMark = cachedMark > 0 ? cachedMark : null;
      log(`BTOD: Error fetching option price for ${optTickerForFresh}: ${err.message} — using cached $${freshOptionMark ?? 0}`, "btod");
    }
  }

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
        instrumentEntry = freshOptionMark ?? signal.optionEntryMark ?? 0;
        try {
          const { fetchOptionSnapshot } = await import("./polygon");
          const optSnap = await fetchOptionSnapshot(signal.ticker, inst.ticker);
          delta = optSnap?.delta ?? null;
          log(`BTOD: Option delta for ${inst.ticker}: ${delta?.toFixed(3) ?? "null"} | entry=$${instrumentEntry}`, "btod");
        } catch (err: any) {
          log(`BTOD: Error fetching option delta for ${inst.ticker}: ${err.message}`, "btod");
          delta = isBuy ? 0.5 : -0.5;
        }
      } else if (inst.type === "LEVERAGED_ETF") {
        instrumentEntry = signal.instrumentEntryPrice ?? 0;
        leverage = (signal.leveragedEtfJson as any)?.leverage ?? 1;
        try {
          const { fetchSnapshot } = await import("./polygon");
          const letfSnap = await fetchSnapshot(inst.ticker!);
          if (letfSnap?.lastPrice && letfSnap.lastPrice > 0) {
            instrumentEntry = letfSnap.lastPrice;
            log(`BTOD: Fresh LETF price for ${inst.ticker}: $${instrumentEntry.toFixed(2)}`, "btod");
            await storage.updateSignalInstrument(signal.id, "LEVERAGED_ETF", inst.ticker!, instrumentEntry);
          } else {
            log(`BTOD: No fresh LETF price for ${inst.ticker}, using cached $${instrumentEntry}`, "btod");
          }
        } catch (err: any) {
          log(`BTOD: Error fetching fresh LETF price for ${inst.ticker}: ${err.message}`, "btod");
        }
      } else if (inst.type === "LETF_OPTIONS" && letfOptionContract) {
        const cachedLetfOptMark = letfOptionContract.markPrice;
        instrumentEntry = 0;
        const fetchStart = Date.now();
        try {
          const { fetchOptionLastTrade, fetchOptionMark } = await import("./polygon");
          const MAX_LAST_TRADE_AGE_MS = 5 * 60 * 1000;
          const ltContract = letfOptionContract.contractTicker;
          const lastTrade = await fetchOptionLastTrade(ltContract);
          const tradeIsRecent = lastTrade && lastTrade.mark != null && lastTrade.mark > 0 &&
            lastTrade.ts != null && (Date.now() - lastTrade.ts) < MAX_LAST_TRADE_AGE_MS;
          if (tradeIsRecent) {
            instrumentEntry = lastTrade!.mark!;
            const ageMs = Date.now() - lastTrade!.ts!;
            log(`BTOD: LETF option last trade for ${ltContract}: $${instrumentEntry} (age ${Math.round(ageMs / 1000)}s, fetched in ${Date.now() - fetchStart}ms)`, "btod");
          } else {
            const liveQuote = await fetchOptionMark(ltContract);
            if (liveQuote && liveQuote.mark != null && liveQuote.mark > 0) {
              instrumentEntry = liveQuote.mark;
              log(`BTOD: LETF option NBBO mark for ${ltContract}: $${instrumentEntry} (fetched in ${Date.now() - fetchStart}ms)`, "btod");
            } else {
              instrumentEntry = cachedLetfOptMark;
              log(`BTOD: ⚠ No live LETF option price for ${ltContract}, falling back to cached mark $${instrumentEntry} (fetched in ${Date.now() - fetchStart}ms)`, "btod");
            }
          }
        } catch (err: any) {
          instrumentEntry = cachedLetfOptMark;
          log(`BTOD: Error fetching LETF option price for ${letfOptionContract.contractTicker}: ${err.message} — using cached $${instrumentEntry}`, "btod");
        }
        delta =
          letfOptionContract.delta ??
          (letfOptionContract.right === "P" ? -0.5 : 0.5);
        leverage = (signal.leveragedEtfJson as any)?.leverage ?? 1;
        log(`BTOD: LETF option delta: ${delta?.toFixed(3)} | entry=$${instrumentEntry} (cached was $${cachedLetfOptMark})`, "btod");
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

      let optionExpiry: string | undefined;
      let optionStrike: number | undefined;
      let optionRight: string | undefined;

      if (inst.type === "OPTION" && inst.ticker) {
        const optData = signal.optionsJson as any;
        optionExpiry = optData?.candidate?.expiry;
        optionStrike = optData?.candidate?.strike;
        optionRight = optData?.candidate?.right === "P" ? "PUT" : "CALL";
      } else if (inst.type === "LETF_OPTIONS" && letfOptionContract) {
        optionExpiry = letfOptionContract.expiry;
        optionStrike = letfOptionContract.strike;
        optionRight = letfOptionContract.right === "P" ? "PUT" : "CALL";
      }

      const {
        isTradeSyncEnabled,
        sendToTradeSync,
        buildTradeSyncPayloadFromSignal,
      } = await import("./tradesync");

      if (!isTradeSyncEnabled()) {
        // throw new Error("TradeSync disabled");
        console.log(
          `TradeSync disabled, skipping BTOD execution for signal ${signalId}`,
        );
      }

      log(
        `BTOD: TradeSync call for ${inst.type} ${inst.ticker ?? signal.ticker} — entry=$${instrumentEntry.toFixed(2)} stop=$${tradeStopPrice?.toFixed(2) ?? "null"} t1=$${tradeTarget1?.toFixed(2) ?? "null"} delta=${delta?.toFixed(3) ?? "null"}`,
        "btod",
      );

      const tsPayload = buildTradeSyncPayloadFromSignal(
        signal,
        inst.type,
        instrumentEntry,
        inst.ticker,
        { t1: tradeTarget1, t2: tradeTarget2, stop: tradeStopPrice },
        {
          delta,
          leverage,
          optionExpiry,
          optionStrike,
          optionRight,
          letfTicker: letfTicker ?? undefined,
        },
      );

      const tsSendStart = Date.now();
      const tsResult = await sendToTradeSync(tsPayload);
      if (!tsResult.ok) {
        throw new Error(`TradeSync send failed: ${tsResult.error}`);
      }

      const tradeSyncId =
        tsResult.data?.id ||
        tsResult.data?.signal?.id ||
        tsResult.data?.signalId;
      log(
        `BTOD: ${inst.type} signal sent to TradeSync (ts_id: ${tradeSyncId}, ${Date.now() - tsSendStart}ms)`,
        "btod",
      );

      results.push({
        instrumentType: inst.type,
        success: true,
        tradesyncSignalId: tradeSyncId ? Number(tradeSyncId) : undefined,
      });
    } catch (err: any) {
      results.push({
        instrumentType: inst.type,
        success: false,
        error: err.message,
      });
      log(
        `BTOD: Failed to send ${inst.type} to TradeSync for signal ${signalId}: ${err.message}`,
        "btod",
      );
    }
  }

  return results;
}

export async function checkAllBtodTradesClosed(
  signalId: number,
): Promise<boolean> {
  // BTOD execution is delegated to TradeSync; this service no longer creates local ibkr_trades rows.
  // Trade lifecycle/closure is tracked by TradeSync.
  void signalId;
  return true;
}
