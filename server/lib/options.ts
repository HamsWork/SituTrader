import { storage } from "../storage";
import {
  fetchSnapshot,
  fetchOptionsChain,
  fetchOptionSnapshot,
  fetchOptionMark,
  fetchOptionMarkAtTime,
  fetchStockPriceAtTime,
  fetchStockPrice,
  fetchOptionsChainAtTime,
} from "./polygon";
import {
  selectBestLeveragedEtf,
  fetchStockNbbo,
  hasLeveragedEtfMapping,
} from "./leveragedEtf";
import { log } from "../index";
import type { Signal, TradePlan, OptionsData, OptionsCandidate, OptionsChecks } from "@shared/schema";
import { SimDayContext } from "server/simulation";
import { inferBias } from "./signalHelper";

interface EnrichParams {
  minOI?: number;
  maxSpread?: number;
  force?: boolean;
}

interface EnrichResult {
  processed: number;
  updated: number;
  errors: number;
}



function buildContractSymbol(ticker: string, expDate: string, right: "C" | "P", strike: number): string {
  const yymmdd = expDate.replace(/-/g, "").slice(2);
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker}${yymmdd}${right}${strikePadded}`;
}

function computeDTE(expDate: string): number {
  const now = new Date();
  const exp = new Date(expDate + "T16:00:00");
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}


function isOptionContractExpired(contractTicker: string): boolean {
  const m = contractTicker.match(/(\d{6})[PC]/);
  if (!m) return false;
  const raw = m[1];
  const expiry = new Date(`20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}T23:59:59`);
  return expiry.getTime() < Date.now();
}

function getSignalContractTicker(signal: Signal): string | null {
  if (signal.optionContractTicker) return signal.optionContractTicker;
  const opts = signal.optionsJson as OptionsData | null;
  if (opts?.candidate?.contractSymbol) return opts.candidate.contractSymbol;
  return null;
}

export async function reEnrichExpiredOptions(): Promise<{ checked: number; reEnriched: number; errors: number }> {
  let checked = 0;
  let reEnriched = 0;
  let errors = 0;

  try {
    const pendingSignals = await storage.getPendingSignalsForEnrichment();
    const minOI = 500;
    const maxSpread = 0.05;
    const priceCache = new Map<string, number>();
    const chainCache = new Map<string, any[]>();

    for (const signal of pendingSignals) {
      const ct = getSignalContractTicker(signal);
      if (!ct) continue;
      if (!isOptionContractExpired(ct)) continue;

      checked++;

      try {
        const bias = inferBias(signal);
        const right: "C" | "P" = bias === "BUY" ? "C" : "P";

        let currentPrice = priceCache.get(signal.ticker);
        if (currentPrice == null) {
          try {
            const snap = await fetchSnapshot(signal.ticker);
            if (snap && snap.lastPrice > 0) currentPrice = snap.lastPrice;
          } catch {}
          if (currentPrice == null) {
            const ts = await storage.getTickerStats(signal.ticker);
            if (ts?.lastPrice && ts.lastPrice > 0) currentPrice = ts.lastPrice;
          }
          if (currentPrice != null) priceCache.set(signal.ticker, currentPrice);
        }

        if (currentPrice == null) continue;

        const now = new Date();
        const minExpDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const maxExpDate = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const chainKey = `${signal.ticker}:${right}:${minExpDate}:${maxExpDate}`;
        let contracts = chainCache.get(chainKey);
        if (!contracts) {
          contracts = await fetchOptionsChain(signal.ticker, right === "C" ? "call" : "put", minExpDate, maxExpDate, 250);
          chainCache.set(chainKey, contracts);
        }

        if (!contracts || contracts.length === 0) continue;

        const nearATM = [...contracts]
          .filter(c => Math.abs(c.strike_price - currentPrice!) / currentPrice! < 0.03)
          .sort((a, b) => {
            const distA = Math.abs(a.strike_price - currentPrice!);
            const distB = Math.abs(b.strike_price - currentPrice!);
            if (distA !== distB) return distA - distB;
            return a.expiration_date.localeCompare(b.expiration_date);
          });

        if (nearATM.length === 0) {
          nearATM.push(...[...contracts].sort((a, b) => {
            return Math.abs(a.strike_price - currentPrice!) - Math.abs(b.strike_price - currentPrice!);
          }).slice(0, 1));
        }

        if (nearATM.length === 0) continue;

        const uniqueExpiries = Array.from(new Set(nearATM.map(c => c.expiration_date))).sort();
        const uniqueStrikes = Array.from(new Set(nearATM.map(c => c.strike_price)))
          .sort((a, b) => Math.abs(a - currentPrice!) - Math.abs(b - currentPrice!))
          .slice(0, 3);

        const candidateContracts: typeof nearATM = [];
        for (const exp of uniqueExpiries) {
          for (const strike of uniqueStrikes) {
            const match = nearATM.find(c => c.expiration_date === exp && c.strike_price === strike);
            if (match) candidateContracts.push(match);
          }
        }
        if (candidateContracts.length === 0) candidateContracts.push(nearATM[0]);

        let bestResult: {
          contract: typeof nearATM[0];
          contractSymbol: string;
          dte: number;
          openInterest: number | null;
          bid: number | null;
          ask: number | null;
          oiOk: boolean;
          spreadOk: boolean;
          spreadVal: number | null;
          tradable: boolean;
          reasonIfFail?: string;
        } | null = null;

        for (const contract of candidateContracts) {
          const sym = contract.ticker || buildContractSymbol(signal.ticker, contract.expiration_date, right, contract.strike_price);
          const cdte = computeDTE(contract.expiration_date);
          let oi: number | null = contract.open_interest ?? null;
          let cbid: number | null = null;
          let cask: number | null = null;

          const snap = await fetchOptionSnapshot(signal.ticker, sym);
          if (snap) {
            if (oi == null) oi = snap.openInterest;
            cbid = snap.bid;
            cask = snap.ask;
          }

          const coiOk = oi != null && oi >= minOI;
          let cspreadOk = false;
          let cspreadVal: number | null = null;
          let creason: string | undefined;

          if (cbid != null && cask != null && cbid > 0) {
            cspreadVal = (cask - cbid) / cbid;
            cspreadOk = cspreadVal <= maxSpread;
            if (!cspreadOk) creason = "SPREAD_TOO_WIDE";
          } else {
            creason = "NO_QUOTE";
          }

          if (!coiOk && !creason) creason = "OI_TOO_LOW";
          else if (!coiOk && creason) creason = `OI_TOO_LOW,${creason}`;

          const ctradable = coiOk && cspreadOk;
          const result = { contract, contractSymbol: sym, dte: cdte, openInterest: oi, bid: cbid, ask: cask, oiOk: coiOk, spreadOk: cspreadOk, spreadVal: cspreadVal, tradable: ctradable, reasonIfFail: ctradable ? undefined : creason };

          if (ctradable) { bestResult = result; break; }
          if (!bestResult || (oi ?? 0) > (bestResult.openInterest ?? 0)) bestResult = result;
        }

        if (!bestResult) continue;

        const candidate: OptionsCandidate = {
          contractSymbol: bestResult.contractSymbol,
          expiry: bestResult.contract.expiration_date.replace(/-/g, ""),
          strike: bestResult.contract.strike_price,
          right,
          dte: bestResult.dte,
        };

        const checks: OptionsChecks = {
          oiOk: bestResult.oiOk,
          spreadOk: bestResult.spreadOk,
          openInterest: bestResult.openInterest,
          spread: bestResult.spreadVal,
          bid: bestResult.bid,
          ask: bestResult.ask,
          checkedAt: new Date().toISOString(),
          reasonIfFail: bestResult.tradable ? undefined : bestResult.reasonIfFail,
        };

        const optionsData: OptionsData = { mode: "AUTO", candidate, checks, tradable: bestResult.tradable };
        await storage.updateSignalOptions(signal.id, optionsData);
        await storage.updateSignalOptionTracking(signal.id, { optionContractTicker: bestResult.contractSymbol });

        reEnriched++;
        log(`Option re-enriched: signal ${signal.id} (${signal.ticker}) ${ct} → ${bestResult.contractSymbol} (DTE ${bestResult.dte}, tradable=${bestResult.tradable})`, "options");
      } catch (err: any) {
        errors++;
        log(`Option re-enrichment error for signal ${signal.id} (${signal.ticker}): ${err.message}`, "options");
      }
    }

    if (checked > 0) {
      log(`Option re-enrichment complete: checked=${checked}, replaced=${reEnriched}, errors=${errors}`, "options");
    }
  } catch (err: any) {
    log(`Option re-enrichment failed: ${err.message}`, "options");
  }

  return { checked, reEnriched, errors };
}

export { isOptionContractExpired };

export async function enrichOptionsJsonForTicker(
  params: EnrichParams, 
  ticker: string, 
  pendingSignals: Signal[], 
  ctx: SimDayContext
): Promise<void> {

  const minOI = params.minOI ?? 500;
  const maxSpread = params.maxSpread ?? 0.05;
  const force = params.force ?? false;

  const now = ctx ? new Date(Date.parse(ctx.today) + ctx.currentMin * 60 * 1000) : new Date();

  const currentTickerPrice = ctx
    ? await fetchStockPriceAtTime(ticker, now.valueOf())
    : await fetchStockPrice(ticker);


  for (const signal of pendingSignals) {
    if (signal.ticker !== ticker) continue;
    try {
      const oldOptionJson = signal.optionsJson as OptionsData | null;
      if (oldOptionJson?.mode === "AUTO" && !force) {
        continue;
      }

      const bias = inferBias(signal);
      const right: "C" | "P" = bias === "BUY" ? "C" : "P";

      if (currentTickerPrice == null) {
        const optionsData: OptionsData = {
          mode: "AUTO",
          tradable: false,
          checks: {
            oiOk: false,
            spreadOk: false,
            openInterest: null,
            spread: null,
            bid: null,
            ask: null,
            checkedAt: ctx ? ctx.today + " " + ctx.currentMin : new Date().toISOString(),
            reasonIfFail: "NO_PRICE",
          },
        };
        if (ctx){
          signal.optionsJson = optionsData
          ctx.allSignals.set(signal.id, signal);
          ctx.onDeckSignals.set(signal.id, signal);
        } else {
          await storage.updateSignalOptions(signal.id, optionsData);
        }
        continue;
      }
      
      const minExpDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const maxExpDate = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const chain = await fetchOptionsChainAtTime(
        ticker, 
        now.valueOf(), 
        right === "C" ? "call" : "put", 
        minExpDate, 
        maxExpDate, 
        250,
      );
      if (!chain || chain.length === 0) {
        const optionsData: OptionsData = { mode: "AUTO", tradable: false, checks: { oiOk: false, spreadOk: false, openInterest: null, spread: null, bid: null, ask: null, checkedAt: ctx ? ctx.today + " " + ctx.currentMin : new Date().toISOString(), reasonIfFail: "NO_CONTRACTS" } };
        if (ctx) {
          signal.optionsJson = optionsData;
          ctx.allSignals.set(signal.id, signal);
          ctx.onDeckSignals.set(signal.id, signal);
        } else {
          await storage.updateSignalOptions(signal.id, optionsData);
        }
        continue;
      }

      log(`Options chain for ${ticker} at ${new Date(now.valueOf()).toISOString()}: ${chain.length} contracts`, "options");
      const nearATM = [...chain]
        .filter(c => Math.abs(c.strike_price - currentTickerPrice!) / currentTickerPrice! < 0.03)
        .sort((a, b) => {
          const distA = Math.abs(a.strike_price - currentTickerPrice!);
          const distB = Math.abs(b.strike_price - currentTickerPrice!);
          if (distA !== distB) return distA - distB;
          return a.expiration_date.localeCompare(b.expiration_date);
        });

      if (nearATM.length === 0) {
        nearATM.push(...[...chain].sort((a, b) => {
          const distA = Math.abs(a.strike_price - currentTickerPrice!);
          const distB = Math.abs(b.strike_price - currentTickerPrice!);
          return distA - distB;
        }).slice(0, 1));
      }

      if (nearATM.length === 0) {
        const optionsData: OptionsData = {
          mode: "AUTO",
          tradable: false,
          checks: {
            oiOk: false,
            spreadOk: false,
            openInterest: null,
            spread: null,
            bid: null,
            ask: null,
            checkedAt: ctx ? ctx.today + " " + ctx.currentMin : new Date().toISOString(),
            reasonIfFail: "NO_ATM_CONTRACT",
          },
        };
        if (ctx) {
          signal.optionsJson = optionsData;
          ctx.allSignals.set(signal.id, signal);
          ctx.onDeckSignals.set(signal.id, signal);
        } else {
          await storage.updateSignalOptions(signal.id, optionsData);
        }
        continue;
      }

      const best = nearATM[0];
      const oi = best.open_interest ?? 0;
      const bid = best.bid ?? 0;
      const ask = best.ask ?? 0;
      const spread = ask > 0 ? (ask - bid) / ask : 1;
      const oiOk = oi >= minOI;
      const spreadOk = spread <= maxSpread;
      const tradable = oiOk && spreadOk;

      const optionsData: OptionsData = {
        mode: "AUTO",
        tradable,
        contract: {
          ticker: best.ticker,
          strike: best.strike_price,
          expiration: best.expiration_date,
          right,
          bid,
          ask,
          mark: (bid + ask) / 2,
          openInterest: oi,
          impliedVol: best.implied_volatility ?? null,
          delta: best.delta ?? null,
          gamma: best.gamma ?? null,
          theta: best.theta ?? null,
          vega: best.vega ?? null,
        },
        checks: {
          oiOk,
          spreadOk,
          openInterest: oi,
          spread,
          bid,
          ask,
          checkedAt: ctx ? ctx.today + " " + ctx.currentMin : new Date().toISOString(),
          reasonIfFail: !oiOk ? "LOW_OI" : !spreadOk ? "WIDE_SPREAD" : null,
        },
      };

      if (ctx) {
        signal.optionsJson = optionsData;
        signal.optionContractTicker = best.ticker;
        signal.optionEntryMark = (bid + ask) / 2;
        ctx.allSignals.set(signal.id, signal);
        ctx.onDeckSignals.set(signal.id, signal);
      } else {
        await storage.updateSignalOptions(signal.id, optionsData);
      }
    } catch (err: any) {
      log(`enrichOptionsJsonForTicker error for ${signal.ticker}/${signal.id}: ${err.message}`, "options");
    }
  }
}

export async function enrichPendingSignalsWithOptions(params: EnrichParams = {}): Promise<EnrichResult> {
  const minOI = params.minOI ?? 500;
  const maxSpread = params.maxSpread ?? 0.05;
  const force = params.force ?? false;

  const pendingSignals = await storage.getPendingSignalsForEnrichment();
  let processed = 0;
  let updated = 0;
  let errors = 0;

  const priceCache = new Map<string, number>();
  const chainCache = new Map<string, any[]>();

  for (const signal of pendingSignals) {
    try {
      const existing = signal.optionsJson as OptionsData | null;
      if (existing?.mode === "AUTO" && !force) {
        continue;
      }

      processed++;

      const bias = inferBias(signal);
      const right: "C" | "P" = bias === "BUY" ? "C" : "P";

      let currentPrice = priceCache.get(signal.ticker);
      if (currentPrice == null) {
        try {
          const snap = await fetchSnapshot(signal.ticker);
          if (snap && snap.lastPrice > 0) {
            currentPrice = snap.lastPrice;
          }
        } catch {}

        if (currentPrice == null) {
          const ts = await storage.getTickerStats(signal.ticker);
          if (ts?.lastPrice && ts.lastPrice > 0) {
            currentPrice = ts.lastPrice;
          }
        }

        if (currentPrice != null) {
          priceCache.set(signal.ticker, currentPrice);
        }
      }

      if (currentPrice == null) {
        const optionsData: OptionsData = {
          mode: "AUTO",
          tradable: false,
          checks: {
            oiOk: false,
            spreadOk: false,
            openInterest: null,
            spread: null,
            bid: null,
            ask: null,
            checkedAt: new Date().toISOString(),
            reasonIfFail: "NO_PRICE",
          },
        };
        await storage.updateSignalOptions(signal.id, optionsData);
        updated++;
        continue;
      }

      const now = new Date();
      const minExpDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const maxExpDate = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const chainKey = `${signal.ticker}:${right}:${minExpDate}:${maxExpDate}`;
      let contracts = chainCache.get(chainKey);
      if (!contracts) {
        contracts = await fetchOptionsChain(
          signal.ticker,
          right === "C" ? "call" : "put",
          minExpDate,
          maxExpDate,
          250
        );
        chainCache.set(chainKey, contracts);
      }

      if (!contracts || contracts.length === 0) {
        const optionsData: OptionsData = {
          mode: "AUTO",
          tradable: false,
          checks: {
            oiOk: false,
            spreadOk: false,
            openInterest: null,
            spread: null,
            bid: null,
            ask: null,
            checkedAt: new Date().toISOString(),
            reasonIfFail: "NO_CONTRACTS",
          },
        };
        await storage.updateSignalOptions(signal.id, optionsData);
        updated++;
        continue;
      }

      const nearATM = [...contracts]
        .filter(c => Math.abs(c.strike_price - currentPrice!) / currentPrice! < 0.03)
        .sort((a, b) => {
          const distA = Math.abs(a.strike_price - currentPrice!);
          const distB = Math.abs(b.strike_price - currentPrice!);
          if (distA !== distB) return distA - distB;
          return a.expiration_date.localeCompare(b.expiration_date);
        });

      if (nearATM.length === 0) {
        nearATM.push(...[...contracts].sort((a, b) => {
          const distA = Math.abs(a.strike_price - currentPrice!);
          const distB = Math.abs(b.strike_price - currentPrice!);
          return distA - distB;
        }).slice(0, 1));
      }

      if (nearATM.length === 0) {
        const optionsData: OptionsData = {
          mode: "AUTO",
          tradable: false,
          checks: {
            oiOk: false,
            spreadOk: false,
            openInterest: null,
            spread: null,
            bid: null,
            ask: null,
            checkedAt: new Date().toISOString(),
            reasonIfFail: "NO_ATM_CONTRACT",
          },
        };
        await storage.updateSignalOptions(signal.id, optionsData);
        updated++;
        continue;
      }

      const uniqueExpiries = Array.from(new Set(nearATM.map(c => c.expiration_date))).sort();
      const uniqueStrikes = Array.from(new Set(nearATM.map(c => c.strike_price)))
        .sort((a, b) => Math.abs(a - currentPrice!) - Math.abs(b - currentPrice!))
        .slice(0, 3);

      const candidateContracts: typeof nearATM = [];
      for (const exp of uniqueExpiries) {
        for (const strike of uniqueStrikes) {
          const match = nearATM.find(c => c.expiration_date === exp && c.strike_price === strike);
          if (match) candidateContracts.push(match);
        }
      }
      if (candidateContracts.length === 0) candidateContracts.push(nearATM[0]);

      let bestResult: {
        contract: typeof nearATM[0];
        contractSymbol: string;
        dte: number;
        openInterest: number | null;
        bid: number | null;
        ask: number | null;
        oiOk: boolean;
        spreadOk: boolean;
        spreadVal: number | null;
        tradable: boolean;
        reasonIfFail?: string;
      } | null = null;

      for (const contract of candidateContracts) {
        const sym = contract.ticker || buildContractSymbol(signal.ticker, contract.expiration_date, right, contract.strike_price);
        const cdte = computeDTE(contract.expiration_date);

        let oi: number | null = contract.open_interest ?? null;
        let cbid: number | null = null;
        let cask: number | null = null;

        const snap = await fetchOptionSnapshot(signal.ticker, sym);
        if (snap) {
          if (oi == null) oi = snap.openInterest;
          cbid = snap.bid;
          cask = snap.ask;
        }

        const coiOk = oi != null && oi >= minOI;
        let cspreadOk = false;
        let cspreadVal: number | null = null;
        let creason: string | undefined;

        if (cbid != null && cask != null && cbid > 0) {
          cspreadVal = (cask - cbid) / cbid;
          cspreadOk = cspreadVal <= maxSpread;
          if (!cspreadOk) creason = "SPREAD_TOO_WIDE";
        } else {
          creason = "NO_QUOTE";
        }

        if (!coiOk && !creason) creason = "OI_TOO_LOW";
        else if (!coiOk && creason) creason = `OI_TOO_LOW,${creason}`;

        const ctradable = coiOk && cspreadOk;

        const result = {
          contract,
          contractSymbol: sym,
          dte: cdte,
          openInterest: oi,
          bid: cbid,
          ask: cask,
          oiOk: coiOk,
          spreadOk: cspreadOk,
          spreadVal: cspreadVal,
          tradable: ctradable,
          reasonIfFail: ctradable ? undefined : creason,
        };

        if (ctradable) {
          bestResult = result;
          break;
        }

        if (!bestResult || (oi ?? 0) > (bestResult.openInterest ?? 0)) {
          bestResult = result;
        }
      }

      if (!bestResult) {
        bestResult = {
          contract: candidateContracts[0],
          contractSymbol: candidateContracts[0].ticker || buildContractSymbol(signal.ticker, candidateContracts[0].expiration_date, right, candidateContracts[0].strike_price),
          dte: computeDTE(candidateContracts[0].expiration_date),
          openInterest: null,
          bid: null,
          ask: null,
          oiOk: false,
          spreadOk: false,
          spreadVal: null,
          tradable: false,
          reasonIfFail: "NO_QUOTE",
        };
      }

      const candidate: OptionsCandidate = {
        contractSymbol: bestResult.contractSymbol,
        expiry: bestResult.contract.expiration_date.replace(/-/g, ""),
        strike: bestResult.contract.strike_price,
        right,
        dte: bestResult.dte,
      };

      const { openInterest, bid, ask, oiOk, spreadOk, tradable } = bestResult;
      const spreadVal = bestResult.spreadVal;
      let reasonIfFail = bestResult.reasonIfFail;

      const checks: OptionsChecks = {
        oiOk,
        spreadOk,
        openInterest,
        spread: spreadVal,
        bid,
        ask,
        checkedAt: new Date().toISOString(),
        reasonIfFail: tradable ? undefined : reasonIfFail,
      };

      const optionsData: OptionsData = {
        mode: "AUTO",
        candidate,
        checks,
        tradable,
      };

      await storage.updateSignalOptions(signal.id, optionsData);
      await storage.updateSignalOptionTracking(signal.id, { optionContractTicker: bestResult.contractSymbol });
      updated++;

    } catch (err: any) {
      errors++;
      log(`Options enrichment error for signal ${signal.id} (${signal.ticker}): ${err.message}`, "options");
    }
  }

  log(`Options enrichment complete: processed=${processed}, updated=${updated}, errors=${errors}`, "options");
  return { processed, updated, errors };
}

async function selectOptionContractForSignal(
  signal: Signal,
  params: {
    minOI?: number;
    maxSpread?: number;
    priceCache?: Map<string, number>;
    chainCache?: Map<string, any[]>;
  } = {},
): Promise<{ contractSymbol: string; tradable: boolean } | null> {
  const minOI = params.minOI ?? 500;
  const maxSpread = params.maxSpread ?? 0.05;
  const priceCache = params.priceCache ?? new Map<string, number>();
  const chainCache = params.chainCache ?? new Map<string, any[]>();

  const bias = inferBias(signal);
  const right: "C" | "P" = bias === "BUY" ? "C" : "P";

  let currentPrice = priceCache.get(signal.ticker) ?? null;
  if (currentPrice == null) {
    try {
      const snap = await fetchSnapshot(signal.ticker);
      if (snap && snap.lastPrice > 0) currentPrice = snap.lastPrice;
    } catch {}
    if (currentPrice == null) {
      const ts = await storage.getTickerStats(signal.ticker);
      if (ts?.lastPrice && ts.lastPrice > 0) currentPrice = ts.lastPrice;
    }
    if (currentPrice != null) priceCache.set(signal.ticker, currentPrice);
  }

  if (currentPrice == null) {
    const optionsData: OptionsData = {
      mode: "AUTO",
      tradable: false,
      checks: { oiOk: false, spreadOk: false, openInterest: null, spread: null, bid: null, ask: null, checkedAt: new Date().toISOString(), reasonIfFail: "NO_PRICE" },
    };
    await storage.updateSignalOptions(signal.id, optionsData);
    return null;
  }

  const now = new Date();
  const minExpDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const maxExpDate = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chainKey = `${signal.ticker}:${right}:${minExpDate}:${maxExpDate}`;
  let contracts = chainCache.get(chainKey);
  if (!contracts) {
    contracts = await fetchOptionsChain(signal.ticker, right === "C" ? "call" : "put", minExpDate, maxExpDate, 250);
    chainCache.set(chainKey, contracts);
  }

  if (!contracts || contracts.length === 0) {
    const optionsData: OptionsData = {
      mode: "AUTO",
      tradable: false,
      checks: { oiOk: false, spreadOk: false, openInterest: null, spread: null, bid: null, ask: null, checkedAt: new Date().toISOString(), reasonIfFail: "NO_CONTRACTS" },
    };
    await storage.updateSignalOptions(signal.id, optionsData);
    return null;
  }

  const nearATM = [...contracts]
    .filter(c => Math.abs(c.strike_price - currentPrice!) / currentPrice! < 0.03)
    .sort((a, b) => {
      const distA = Math.abs(a.strike_price - currentPrice!);
      const distB = Math.abs(b.strike_price - currentPrice!);
      if (distA !== distB) return distA - distB;
      return a.expiration_date.localeCompare(b.expiration_date);
    });
  if (nearATM.length === 0) {
    nearATM.push(...[...contracts].sort((a, b) => Math.abs(a.strike_price - currentPrice!) - Math.abs(b.strike_price - currentPrice!)).slice(0, 1));
  }
  if (nearATM.length === 0) {
    const optionsData: OptionsData = {
      mode: "AUTO",
      tradable: false,
      checks: { oiOk: false, spreadOk: false, openInterest: null, spread: null, bid: null, ask: null, checkedAt: new Date().toISOString(), reasonIfFail: "NO_ATM_CONTRACT" },
    };
    await storage.updateSignalOptions(signal.id, optionsData);
    return null;
  }

  const uniqueExpiries = Array.from(new Set(nearATM.map(c => c.expiration_date))).sort();
  const uniqueStrikes = Array.from(new Set(nearATM.map(c => c.strike_price)))
    .sort((a, b) => Math.abs(a - currentPrice!) - Math.abs(b - currentPrice!))
    .slice(0, 3);
  const candidateContracts: typeof nearATM = [];
  for (const exp of uniqueExpiries) {
    for (const strike of uniqueStrikes) {
      const match = nearATM.find(c => c.expiration_date === exp && c.strike_price === strike);
      if (match) candidateContracts.push(match);
    }
  }
  if (candidateContracts.length === 0) candidateContracts.push(nearATM[0]);

  let bestResult: {
    contract: (typeof nearATM)[0];
    contractSymbol: string;
    dte: number;
    openInterest: number | null;
    bid: number | null;
    ask: number | null;
    oiOk: boolean;
    spreadOk: boolean;
    spreadVal: number | null;
    tradable: boolean;
    reasonIfFail?: string;
  } | null = null;

  for (const contract of candidateContracts) {
    const sym = contract.ticker || buildContractSymbol(signal.ticker, contract.expiration_date, right, contract.strike_price);
    const cdte = computeDTE(contract.expiration_date);
    let oi: number | null = contract.open_interest ?? null;
    let cbid: number | null = null;
    let cask: number | null = null;
    const snap = await fetchOptionSnapshot(signal.ticker, sym);
    if (snap) {
      if (oi == null) oi = snap.openInterest;
      cbid = snap.bid;
      cask = snap.ask;
    }
    const coiOk = oi != null && oi >= minOI;
    let cspreadOk = false;
    let cspreadVal: number | null = null;
    let creason: string | undefined;
    if (cbid != null && cask != null && cbid > 0) {
      cspreadVal = (cask - cbid) / cbid;
      cspreadOk = cspreadVal <= maxSpread;
      if (!cspreadOk) creason = "SPREAD_TOO_WIDE";
    } else creason = "NO_QUOTE";
    if (!coiOk && !creason) creason = "OI_TOO_LOW";
    else if (!coiOk && creason) creason = `OI_TOO_LOW,${creason}`;
    const ctradable = coiOk && cspreadOk;
    const result = {
      contract,
      contractSymbol: sym,
      dte: cdte,
      openInterest: oi,
      bid: cbid,
      ask: cask,
      oiOk: coiOk,
      spreadOk: cspreadOk,
      spreadVal: cspreadVal,
      tradable: ctradable,
      reasonIfFail: ctradable ? undefined : creason,
    };
    if (ctradable) {
      bestResult = result;
      break;
    }
    if (!bestResult || (oi ?? 0) > (bestResult.openInterest ?? 0)) bestResult = result;
  }

  if (!bestResult) {
    bestResult = {
      contract: candidateContracts[0],
      contractSymbol: candidateContracts[0].ticker || buildContractSymbol(signal.ticker, candidateContracts[0].expiration_date, right, candidateContracts[0].strike_price),
      dte: computeDTE(candidateContracts[0].expiration_date),
      openInterest: null,
      bid: null,
      ask: null,
      oiOk: false,
      spreadOk: false,
      spreadVal: null,
      tradable: false,
      reasonIfFail: "NO_QUOTE",
    };
  }

  const candidate: OptionsCandidate = {
    contractSymbol: bestResult.contractSymbol,
    expiry: bestResult.contract.expiration_date.replace(/-/g, ""),
    strike: bestResult.contract.strike_price,
    right,
    dte: bestResult.dte,
  };
  const checks: OptionsChecks = {
    oiOk: bestResult.oiOk,
    spreadOk: bestResult.spreadOk,
    openInterest: bestResult.openInterest,
    spread: bestResult.spreadVal,
    bid: bestResult.bid,
    ask: bestResult.ask,
    checkedAt: new Date().toISOString(),
    reasonIfFail: bestResult.tradable ? undefined : bestResult.reasonIfFail,
  };
  const optionsData: OptionsData = { mode: "AUTO", candidate, checks, tradable: bestResult.tradable };
  await storage.updateSignalOptions(signal.id, optionsData);
  await storage.updateSignalOptionTracking(signal.id, { optionContractTicker: bestResult.contractSymbol });

  return { contractSymbol: bestResult.contractSymbol, tradable: bestResult.tradable };
}

/**
 * Enrich a single signal with options data (any status). Use before sending options Discord alert when optionsJson is missing.
 */
export async function enrichSignalWithOptions(
  signal: Signal,
  params: { force?: boolean; minOI?: number; maxSpread?: number } = {},
): Promise<boolean> {
  const force = params.force ?? true;

  try {
    const existing = signal.optionsJson as OptionsData | null;
    if (existing?.mode === "AUTO" && !force) return false;

    const result = await selectOptionContractForSignal(signal, {
      minOI: params.minOI,
      maxSpread: params.maxSpread,
    });
    return result != null;
  } catch (err: any) {
    log(`enrichSignalWithOptions error for signal ${signal.id} (${signal.ticker}): ${err.message}`, "options");
    return false;
  }
}

export async function enrichOptionData(
  ticker: string,
  sig: Signal,
  tp: TradePlan,
  triggerTs: string | undefined,
): Promise<"OPTION" | "SHARES" | "LEVERAGED_ETF"> {
  let instrumentType: "OPTION" | "SHARES" | "LEVERAGED_ETF" =
    (sig.instrumentType as "OPTION" | "SHARES" | "LEVERAGED_ETF") ||
    "OPTION";

  const opts = sig.optionsJson as OptionsData | null;
  let contractTicker =
    sig.optionContractTicker || opts?.candidate?.contractSymbol;

  if (!contractTicker) {
    try {
      const selected = await selectOptionContractForSignal(sig);
      if (selected) {
        contractTicker = selected.contractSymbol;
        log(
          `Options enriched at activation for ${ticker} signal ${sig.id}: ${contractTicker} (tradable=${selected.tradable})`,
          "activation",
        );
      }
    } catch (err: any) {
      log(
        `Failed to enrich options at activation for signal ${sig.id}: ${err.message}`,
        "activation",
      );
    }
  }

  if (contractTicker) {
    try {
      const triggerMs = triggerTs
        ? new Date(triggerTs).getTime()
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
          `Option entry mark captured at activation for ${ticker} signal ${sig.id}: $${entryMarkPrice.toFixed(2)} @ ${triggerTs} (${contractTicker})`,
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
        const triggerMs = triggerTs
          ? new Date(triggerTs).getTime()
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
        instrumentType = "LEVERAGED_ETF";
        log(
          `Auto-selected LETF ${suggestion.ticker} (${suggestion.leverage}x) for ${ticker} signal ${sig.id}, entry $${letfEntry?.toFixed(2) ?? "n/a"} @ ${triggerTs}`,
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

  return instrumentType;
}
