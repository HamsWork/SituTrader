import { log } from "../index";
import type { LeveragedEtfSuggestion } from "@shared/schema";

const POLYGON_BASE = "https://api.polygon.io";
const API_KEY = process.env.POLYGON_API_KEY;
const LIVE_CACHE_TTL = 15_000;

const nbboCache = new Map<string, { data: any; ts: number }>();

interface EtfCandidate {
  ticker: string;
  leverage: 1 | 2 | 3;
  direction: "BULL" | "BEAR";
}

const LEVERAGED_ETF_MAP: Record<string, EtfCandidate[]> = {

  // ── Major Index ETFs ──────────────────────────────────────────────
  SPY: [
    { ticker: "UPRO", leverage: 3, direction: "BULL" },
    { ticker: "SPXL", leverage: 3, direction: "BULL" },
    { ticker: "SPXU", leverage: 3, direction: "BEAR" },
    { ticker: "SPXS", leverage: 3, direction: "BEAR" },
    { ticker: "SSO",  leverage: 2, direction: "BULL" },
    { ticker: "SDS",  leverage: 2, direction: "BEAR" },
  ],
  QQQ: [
    { ticker: "TQQQ", leverage: 3, direction: "BULL" },
    { ticker: "SQQQ", leverage: 3, direction: "BEAR" },
    { ticker: "QLD",  leverage: 2, direction: "BULL" },
    { ticker: "QID",  leverage: 2, direction: "BEAR" },
  ],
  IWM: [
    { ticker: "TNA",  leverage: 3, direction: "BULL" },
    { ticker: "TZA",  leverage: 3, direction: "BEAR" },
    { ticker: "UWM",  leverage: 2, direction: "BULL" },
    { ticker: "TWM",  leverage: 2, direction: "BEAR" },
  ],
  DIA: [
    { ticker: "UDOW", leverage: 3, direction: "BULL" },
    { ticker: "SDOW", leverage: 3, direction: "BEAR" },
  ],

  // ── MAG7 Single-Stock (Direxion 2x Bull / 1x Bear) ───────────────
  AAPL: [
    { ticker: "AAPU", leverage: 2, direction: "BULL" },
    { ticker: "AAPD", leverage: 1, direction: "BEAR" },
  ],
  MSFT: [
    { ticker: "MSFU", leverage: 2, direction: "BULL" },
    { ticker: "MSFL", leverage: 2, direction: "BULL" },
    { ticker: "MSFD", leverage: 1, direction: "BEAR" },
  ],
  AMZN: [
    { ticker: "AMZU", leverage: 2, direction: "BULL" },
    { ticker: "AMZD", leverage: 1, direction: "BEAR" },
  ],
  NVDA: [
    { ticker: "NVDL", leverage: 2, direction: "BULL" },
    { ticker: "NVDU", leverage: 2, direction: "BULL" },
    { ticker: "NVDD", leverage: 1, direction: "BEAR" },
    { ticker: "NVD",  leverage: 2, direction: "BEAR" },
  ],
  TSLA: [
    { ticker: "TSLL", leverage: 2, direction: "BULL" },
    { ticker: "TSLS", leverage: 1, direction: "BEAR" },
    { ticker: "TSDD", leverage: 2, direction: "BEAR" },
  ],
  GOOGL: [
    { ticker: "GGLL", leverage: 2, direction: "BULL" },
    { ticker: "GGLS", leverage: 1, direction: "BEAR" },
  ],
  META: [
    { ticker: "METU", leverage: 2, direction: "BULL" },
    { ticker: "METD", leverage: 1, direction: "BEAR" },
  ],

  // ── Other Single-Stock (Direxion + GraniteShares + REX) ───────────
  AMD: [
    { ticker: "AMDU", leverage: 2, direction: "BULL" },
    { ticker: "AMDL", leverage: 2, direction: "BULL" },
    { ticker: "AMDD", leverage: 1, direction: "BEAR" },
  ],
  NFLX: [
    { ticker: "NFXL", leverage: 2, direction: "BULL" },
    { ticker: "NFXS", leverage: 1, direction: "BEAR" },
  ],
  PLTR: [
    { ticker: "PLTL", leverage: 2, direction: "BULL" },
    { ticker: "PLTS", leverage: 1, direction: "BEAR" },
    { ticker: "PTIR", leverage: 2, direction: "BULL" },
  ],
  COIN: [
    { ticker: "CONL", leverage: 2, direction: "BULL" },
    { ticker: "CONX", leverage: 2, direction: "BULL" },
    { ticker: "COND", leverage: 1, direction: "BEAR" },
  ],
  BABA: [
    { ticker: "BABU", leverage: 2, direction: "BULL" },
  ],
  AVGO: [
    { ticker: "AVGW", leverage: 2, direction: "BULL" },
    { ticker: "AVGU", leverage: 2, direction: "BULL" },
    { ticker: "AVGS", leverage: 1, direction: "BEAR" },
  ],
  BA: [
    { ticker: "BOEU", leverage: 2, direction: "BULL" },
    { ticker: "BOED", leverage: 1, direction: "BEAR" },
  ],
  MU: [
    { ticker: "MUU",  leverage: 2, direction: "BULL" },
    { ticker: "MULL", leverage: 2, direction: "BULL" },
    { ticker: "MUD",  leverage: 1, direction: "BEAR" },
  ],
  MSTR: [
    { ticker: "MSTU", leverage: 2, direction: "BULL" },
    { ticker: "MSTZ", leverage: 2, direction: "BEAR" },
  ],
  HOOD: [
    { ticker: "HODU", leverage: 2, direction: "BULL" },
    { ticker: "HODD", leverage: 1, direction: "BEAR" },
  ],
  SHOP: [
    { ticker: "SHPU", leverage: 2, direction: "BULL" },
  ],
  SOFI: [
    { ticker: "SOFA", leverage: 2, direction: "BULL" },
  ],
  ASML: [
    { ticker: "ASMU", leverage: 2, direction: "BULL" },
  ],
  INTC: [
    { ticker: "INTL", leverage: 2, direction: "BULL" },
  ],
  TSM: [
    { ticker: "TSML", leverage: 2, direction: "BULL" },
  ],
  CRWD: [
    { ticker: "CRWL", leverage: 2, direction: "BULL" },
  ],
  NOW: [
    { ticker: "NOWL", leverage: 2, direction: "BULL" },
  ],
  UBER: [
    { ticker: "UBRL", leverage: 2, direction: "BULL" },
  ],
  XOM: [
    { ticker: "XOMX", leverage: 2, direction: "BULL" },
    { ticker: "XOMZ", leverage: 1, direction: "BEAR" },
  ],
  JPM: [
    { ticker: "JPX",  leverage: 2, direction: "BULL" },
  ],
  BKNG: [
    { ticker: "BKNU", leverage: 2, direction: "BULL" },
  ],
  IBIT: [
    { ticker: "BITX", leverage: 2, direction: "BULL" },
    { ticker: "BITU", leverage: 2, direction: "BULL" },
    { ticker: "BTCL", leverage: 2, direction: "BULL" },
  ],

  // ── Sector ETFs (Direxion 3x / 2x) ───────────────────────────────
  XLK: [
    { ticker: "TECL", leverage: 3, direction: "BULL" },
    { ticker: "TECS", leverage: 3, direction: "BEAR" },
  ],
  XLE: [
    { ticker: "ERX",  leverage: 2, direction: "BULL" },
    { ticker: "ERY",  leverage: 2, direction: "BEAR" },
  ],
  XLF: [
    { ticker: "FAS",  leverage: 3, direction: "BULL" },
    { ticker: "FAZ",  leverage: 3, direction: "BEAR" },
  ],
  XLV: [
    { ticker: "CURE", leverage: 3, direction: "BULL" },
  ],
  XLI: [
    { ticker: "DUSL", leverage: 3, direction: "BULL" },
  ],
  SMH: [
    { ticker: "SOXL", leverage: 3, direction: "BULL" },
    { ticker: "SOXS", leverage: 3, direction: "BEAR" },
  ],
  KRE: [
    { ticker: "DPST", leverage: 3, direction: "BULL" },
  ],

  // ── Commodity / Fixed Income / International ──────────────────────
  GLD: [
    { ticker: "UGL",  leverage: 2, direction: "BULL" },
    { ticker: "GLL",  leverage: 2, direction: "BEAR" },
  ],
  GDX: [
    { ticker: "NUGT", leverage: 2, direction: "BULL" },
    { ticker: "DUST", leverage: 2, direction: "BEAR" },
  ],
  SLV: [
    { ticker: "AGQ",  leverage: 2, direction: "BULL" },
    { ticker: "ZSL",  leverage: 2, direction: "BEAR" },
  ],
  TLT: [
    { ticker: "TMF",  leverage: 3, direction: "BULL" },
    { ticker: "TMV",  leverage: 3, direction: "BEAR" },
    { ticker: "UBT",  leverage: 2, direction: "BULL" },
    { ticker: "TBT",  leverage: 2, direction: "BEAR" },
  ],
  EEM: [
    { ticker: "EDC",  leverage: 3, direction: "BULL" },
    { ticker: "EDZ",  leverage: 3, direction: "BEAR" },
    { ticker: "EET",  leverage: 2, direction: "BULL" },
    { ticker: "EEV",  leverage: 2, direction: "BEAR" },
  ],
  FXI: [
    { ticker: "YINN", leverage: 3, direction: "BULL" },
    { ticker: "YANG", leverage: 3, direction: "BEAR" },
  ],
};

const UNDERLYING_ALIASES: Record<string, string> = {
  SPX: "SPY", ES: "SPY",
  NQ: "QQQ", NDX: "QQQ",
  QQQM: "QQQ",
  RTY: "IWM",
  GOOG: "GOOGL",
  MAG7: "QQQ",
  SOXX: "SMH",
  VOO: "SPY", IVV: "SPY", ITOT: "SPY", VTI: "SPY",
  IWF: "QQQ",
  IEMG: "EEM", VEA: "EEM",
  EWZ: "EEM", EWY: "EEM", EWJ: "EEM",
  NEM: "GDX",
};

function resolveUnderlying(ticker: string): string {
  return UNDERLYING_ALIASES[ticker] ?? ticker;
}

export function getCandidates(underlyingTicker: string, bias: "BUY" | "SELL"): EtfCandidate[] {
  const resolved = resolveUnderlying(underlyingTicker);
  const all = LEVERAGED_ETF_MAP[resolved];
  if (!all) return [];
  const direction = bias === "BUY" ? "BULL" : "BEAR";
  return all.filter(c => c.direction === direction);
}

export interface StockQuoteResult {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  spreadPct: number | null;
  volume: number | null;
  ts: number;
  stale: boolean;
  wideSpread: boolean;
}

export async function fetchStockNbbo(ticker: string): Promise<StockQuoteResult | null> {
  if (!API_KEY) return null;
  try {
    const cacheKey = `stock_nbbo_${ticker}`;
    const cached = nbboCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < LIVE_CACHE_TTL) return cached.data;

    const url = new URL(`${POLYGON_BASE}/v3/quotes/${ticker}`);
    url.searchParams.set("apiKey", API_KEY);
    url.searchParams.set("limit", "1");
    url.searchParams.set("order", "desc");
    url.searchParams.set("sort", "timestamp");

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results ?? [];
    if (results.length === 0) return null;

    const q = results[0];
    const bid = q.bid_price ?? null;
    const ask = q.ask_price ?? null;

    let mid: number | null = null;
    let stale = false;
    if (bid != null && bid > 0 && ask != null && ask > 0) {
      mid = Math.round((bid + ask) / 2 * 100) / 100;
    } else if (ask != null && ask > 0) {
      mid = ask; stale = true;
    } else if (bid != null && bid > 0) {
      mid = bid; stale = true;
    }
    const quoteTs = q.sip_timestamp ? Math.floor(q.sip_timestamp / 1e6) : 0;
    if (quoteTs > 0 && Date.now() - quoteTs > 30 * 60 * 1000) {
      stale = true;
    }

    const spread = (bid != null && ask != null && bid > 0) ? Math.round((ask - bid) * 100) / 100 : null;
    const spreadPct = (spread != null && mid != null && mid > 0) ? spread / mid : null;
    const wideSpread = spreadPct != null && spreadPct > 0.0075;

    const result: StockQuoteResult = {
      bid, ask, mid, spread, spreadPct,
      volume: null,
      ts: q.sip_timestamp ? Math.floor(q.sip_timestamp / 1e6) : Date.now(),
      stale, wideSpread,
    };
    nbboCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch (err: any) {
    log(`NBBO fetch error for stock ${ticker}: ${err.message}`, "leveragedEtf");
    return null;
  }
}

async function scoreLiquidity(ticker: string): Promise<{ score: number; spreadPct: number | null; mid: number | null; stale: boolean; reject: boolean }> {
  const quote = await fetchStockNbbo(ticker);
  if (!quote || quote.mid == null || quote.mid <= 0) {
    return { score: -100, spreadPct: null, mid: null, stale: true, reject: true };
  }

  let score = 0;
  const spreadPct = quote.spreadPct;

  if (spreadPct != null) {
    if (spreadPct > 0.01) {
      return { score: -100, spreadPct, mid: quote.mid, stale: quote.stale, reject: true };
    }
    score += Math.max(-10, Math.min(10, (0.003 - spreadPct) * 2000));
  }

  if (quote.stale) score -= 5;
  if (spreadPct != null && spreadPct > 0.0075) score -= 3;

  return { score, spreadPct, mid: quote.mid, stale: quote.stale, reject: false };
}

export async function selectBestLeveragedEtf(
  underlyingTicker: string,
  bias: "BUY" | "SELL"
): Promise<LeveragedEtfSuggestion | null> {
  const candidates = getCandidates(underlyingTicker, bias);
  if (candidates.length === 0) return null;

  const tier3 = candidates.filter(c => c.leverage === 3);
  const tier2 = candidates.filter(c => c.leverage === 2);
  const tier1 = candidates.filter(c => c.leverage === 1);

  for (const tier of [tier3, tier2, tier1]) {
    if (tier.length === 0) continue;

    const scored = await Promise.all(
      tier.map(async (c) => {
        const liq = await scoreLiquidity(c.ticker);
        return { ...c, ...liq };
      })
    );

    const viable = scored.filter(s => !s.reject);
    if (viable.length === 0) continue;

    viable.sort((a, b) => b.score - a.score);
    const best = viable[0];

    return {
      ticker: best.ticker,
      leverage: best.leverage,
      direction: best.direction,
      liquidityScore: Math.round(best.score * 10) / 10,
      reason: `Best ${best.leverage}x ${best.direction} ETF (spread ${best.spreadPct != null ? (best.spreadPct * 100).toFixed(2) + "%" : "n/a"})`,
    };
  }

  return null;
}

export function hasLeveragedEtfMapping(ticker: string): boolean {
  const resolved = resolveUnderlying(ticker);
  return resolved in LEVERAGED_ETF_MAP;
}
