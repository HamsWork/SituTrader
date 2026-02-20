import { storage } from "../storage";
import { fetchSnapshot, fetchOptionsChain, fetchOptionSnapshot } from "./polygon";
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
      const minExpDate = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const maxExpDate = new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const chainKey = `${signal.ticker}:${right}:${minExpDate}:${maxExpDate}`;
      let contracts = chainCache.get(chainKey);
      if (!contracts) {
        contracts = await fetchOptionsChain(
          signal.ticker,
          right === "C" ? "call" : "put",
          minExpDate,
          maxExpDate,
          100
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

      const sorted = [...contracts].sort((a, b) => {
        const distA = Math.abs(a.strike_price - currentPrice!);
        const distB = Math.abs(b.strike_price - currentPrice!);
        if (distA !== distB) return distA - distB;
        return a.expiration_date.localeCompare(b.expiration_date);
      });

      const bestContract = sorted[0];
      if (!bestContract) {
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

      const contractSymbol = bestContract.ticker || buildContractSymbol(signal.ticker, bestContract.expiration_date, right, bestContract.strike_price);
      const dte = computeDTE(bestContract.expiration_date);

      const candidate: OptionsCandidate = {
        contractSymbol,
        expiry: bestContract.expiration_date.replace(/-/g, ""),
        strike: bestContract.strike_price,
        right,
        dte,
      };

      let openInterest: number | null = bestContract.open_interest ?? null;
      let bid: number | null = null;
      let ask: number | null = null;

      const snapshot = await fetchOptionSnapshot(signal.ticker, contractSymbol);
      if (snapshot) {
        if (openInterest == null) openInterest = snapshot.openInterest;
        bid = snapshot.bid;
        ask = snapshot.ask;
      }

      const oiOk = openInterest != null && openInterest >= minOI;
      let spreadOk = false;
      let spreadVal: number | null = null;
      let reasonIfFail: string | undefined;

      if (bid != null && ask != null && bid > 0) {
        spreadVal = (ask - bid) / bid;
        spreadOk = spreadVal <= maxSpread;
        if (!spreadOk) reasonIfFail = "SPREAD_TOO_WIDE";
      } else {
        reasonIfFail = "NO_QUOTE";
      }

      if (!oiOk && !reasonIfFail) {
        reasonIfFail = "OI_TOO_LOW";
      } else if (!oiOk && reasonIfFail) {
        reasonIfFail = `OI_TOO_LOW,${reasonIfFail}`;
      }

      const tradable = oiOk && spreadOk;

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
      updated++;

    } catch (err: any) {
      errors++;
      log(`Options enrichment error for signal ${signal.id} (${signal.ticker}): ${err.message}`, "options");
    }
  }

  log(`Options enrichment complete: processed=${processed}, updated=${updated}, errors=${errors}`, "options");
  return { processed, updated, errors };
}
