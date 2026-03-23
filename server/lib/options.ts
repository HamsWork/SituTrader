import { storage } from "../storage";
import {
  fetchSnapshot,
  fetchOptionsChain,
  fetchOptionSnapshot,
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
import type { Signal, TradePlan, OptionsData, OptionsCandidate, OptionsChecks } from "@shared/schema";

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

function inferBias(signal: Signal): "BUY" | "SELL" {
  const tp = signal.tradePlanJson as TradePlan | null;
  if (tp?.bias) return tp.bias;
  const dir = signal.direction.toLowerCase();
  if (dir.includes("down") || dir === "sell") return "SELL";
  return "BUY";
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

/**
 * Enrich a single signal with options data (any status). Use before sending options Discord alert when optionsJson is missing.
 */
export async function enrichSignalWithOptions(
  signal: Signal,
  params: { force?: boolean; minOI?: number; maxSpread?: number } = {},
): Promise<boolean> {
  const minOI = params.minOI ?? 500;
  const maxSpread = params.maxSpread ?? 0.05;
  const force = params.force ?? true;
  const priceCache = new Map<string, number>();
  const chainCache = new Map<string, any[]>();

  try {
    const existing = signal.optionsJson as OptionsData | null;
    if (existing?.mode === "AUTO" && !force) return false;

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
      return false;
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
      return false;
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
      return false;
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
    return true;
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
  const contractTicker =
    sig.optionContractTicker || opts?.candidate?.contractSymbol;

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
