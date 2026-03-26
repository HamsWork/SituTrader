import { DailyBar } from "@shared/schema";
import { log } from "../index";
import { getBars } from "./barCache";
import type { Bar } from "./barCache";
import { formatDate } from "./calendar";

const POLYGON_BASE = "https://api.polygon.io";
const API_KEY = process.env.POLYGON_API_KEY;

const requestCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const LIVE_CACHE_TTL = 15 * 1000;

let lastRequestTs = 0;
const MIN_REQUEST_INTERVAL_MS = 250;
const MAX_RETRIES = 3;

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTs;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTs = Date.now();
}

async function polygonGet(
  path: string,
  params: Record<string, string> = {},
  cacheTtl: number = CACHE_TTL,
): Promise<any> {
  if (!API_KEY) throw new Error("POLYGON_API_KEY not set");

  const url = new URL(`${POLYGON_BASE}${path}`);
  url.searchParams.set("apiKey", API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }


  const cacheKey = url.toString();
  const cached = requestCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cacheTtl) {
    return cached.data;
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await rateLimitWait();
    const res = await fetch(url.toString());

    if (res.status === 429) {
      const backoff = Math.min(1000 * Math.pow(2, attempt + 1), 30000);
      log(
        `Polygon rate limited, backing off ${backoff}ms (attempt ${attempt + 1})`,
        "polygon",
      );
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
      const backoff = 2000 * (attempt + 1);
      log(
        `Polygon server error ${res.status}, retrying in ${backoff}ms`,
        "polygon",
      );
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Polygon API ${res.status}: ${text}`);
    }

    const data = await res.json();
    requestCache.set(cacheKey, { data, ts: Date.now() });
    return data;
  }

  throw new Error(`Polygon API failed after ${MAX_RETRIES} retries`);
}

export interface PolygonBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  t: number;
  n?: number;
}

export async function fetchDailyBars(
  ticker: string,
  from: string,
  to: string,
): Promise<PolygonBar[]> {
  try {
    const data = await polygonGet(
      `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}`,
      { adjusted: "true", sort: "asc", limit: "5000" },
    );
    return data.results ?? [];
  } catch (err: any) {
    log(`Error fetching daily bars for ${ticker}: ${err.message}`, "polygon");
    return [];
  }
}

export async function fetchIntradayBars(
  ticker: string,
  from: string,
  to: string,
  timeframe: string = "5",
): Promise<PolygonBar[]> {
  try {
    const data = await polygonGet(
      `/v2/aggs/ticker/${ticker}/range/${timeframe}/minute/${from}/${to}`,
      { adjusted: "true", sort: "asc", limit: "50000" },
    );
    return data.results ?? [];
  } catch (err: any) {
    log(
      `Error fetching intraday bars for ${ticker}: ${err.message}`,
      "polygon",
    );
    return [];
  }
}

export interface GroupedBar extends PolygonBar {
  T: string;
}

export async function fetchGroupedDaily(date: string): Promise<GroupedBar[]> {
  try {
    const data = await polygonGet(
      `/v2/aggs/grouped/locale/us/market/stocks/${date}`,
      { adjusted: "true" },
    );
    return (data.results ?? []).map((r: any) => ({
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
      vw: r.vw,
      t: r.t,
      n: r.n,
      T: r.T,
    }));
  } catch (err: any) {
    log(`Error fetching grouped daily for ${date}: ${err.message}`, "polygon");
    return [];
  }
}

export interface OptionsContract {
  ticker: string;
  strike_price: number;
  expiration_date: string;
  contract_type: "call" | "put";
  open_interest?: number;
  bid?: number;
  ask?: number;
  mark?: number;
  implied_volatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

export interface OptionsQuote {
  bid: number | null;
  ask: number | null;
}

export async function fetchOptionsChain(
  ticker: string,
  contractType: "call" | "put",
  minExpDate: string,
  maxExpDate: string,
  limit: number = 50,
): Promise<OptionsContract[]> {
  try {
    const data = await polygonGet(`/v3/reference/options/contracts`, {
      underlying_ticker: ticker,
      contract_type: contractType,
      "expiration_date.gte": minExpDate,
      "expiration_date.lte": maxExpDate,
      order: "asc",
      sort: "expiration_date",
      limit: String(limit),
    });
    return (data.results ?? []).map((r: any) => ({
      ticker: r.ticker,
      strike_price: r.strike_price,
      expiration_date: r.expiration_date,
      contract_type: r.contract_type,
      open_interest: r.open_interest ?? undefined,
    }));
  } catch (err: any) {
    log(
      `Error fetching options chain for ${ticker}: ${err.message}`,
      "polygon",
    );
    return [];
  }
}

export async function fetchOptionsChainAtTime(
  ticker: string,
  timestampMs: number = Date.now(),
  contractType: "call" | "put",
  minExpDate: string,
  maxExpDate: string,
  limit: number = 50,
): Promise<OptionsContract[]> {
  const stockPrice = await fetchStockPriceAtTime(ticker, timestampMs);
  if (stockPrice == null) {
    log(
      `fetchOptionsChainAtTime: no stock price for ${ticker} at ${new Date(timestampMs).toISOString()}`,
      "polygon",
    );
    return [];
  }

  const allContracts = await fetchOptionsChainManually(
    ticker,
    contractType,
    minExpDate,
    maxExpDate,
    limit,
    stockPrice,
  );

  if (allContracts.length === 0) return [];

  const atmCandidates = [...allContracts]
    .sort((a, b) => Math.abs(a.strike_price - stockPrice) - Math.abs(b.strike_price - stockPrice))
    .slice(0, 5);

  const enriched: OptionsContract[] = [];
  for (const contract of atmCandidates) {
    const mark = await fetchOptionMarkAtTime(contract.ticker, timestampMs);
    if (mark != null && mark > 0) {
      const spread = mark * 0.05;
      enriched.push({
        ...contract,
        bid: Math.max(0.01, mark - spread / 2),
        ask: mark + spread / 2,
        mark,
      });
    }
  }

  if (enriched.length > 0) {
    enriched.sort(
      (a, b) => Math.abs(a.strike_price - stockPrice) - Math.abs(b.strike_price - stockPrice),
    );
    return enriched;
  }

  const best = atmCandidates[0];
  const dist = Math.abs(best.strike_price - stockPrice);
  const intrinsic = contractType === "call"
    ? Math.max(0, stockPrice - best.strike_price)
    : Math.max(0, best.strike_price - stockPrice);
  const estimatedMark = Math.max(0.10, intrinsic + stockPrice * 0.02);
  const estSpread = estimatedMark * 0.10;

  log(`fetchOptionsChainAtTime: no real marks found for ${ticker}, using estimate $${estimatedMark.toFixed(2)} for ${best.ticker}`, "polygon");

  return [{
    ...best,
    bid: Math.max(0.01, estimatedMark - estSpread / 2),
    ask: estimatedMark + estSpread / 2,
    mark: Math.round(estimatedMark * 100) / 100,
  }];
}

export function buildOccSymbol(
  ticker: string,
  expDate: string,
  right: "C" | "P",
  strike: number,
): string {
  const yy = expDate.slice(2, 4);
  const mm = expDate.slice(5, 7);
  const dd = expDate.slice(8, 10);
  const strikeInt = Math.round(strike * 1000);
  const strikePad = String(strikeInt).padStart(8, "0");
  return `O:${ticker}${yy}${mm}${dd}${right}${strikePad}`;
}

export function getStrikeIncrement(price: number): number {
  if (price <= 5) return 0.5;
  if (price <= 25) return 1;
  if (price <= 100) return 2.5;
  if (price <= 250) return 5;
  return 10;
}

export function generateFridaysBetween(minDate: string, maxDate: string): string[] {
  const dates: string[] = [];
  const start = new Date(minDate + "T00:00:00Z");
  const end = new Date(maxDate + "T00:00:00Z");
  const d = new Date(start);
  const dow = d.getUTCDay();
  const daysToFri = (5 - dow + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysToFri);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return dates;
}

export async function fetchOptionsChainManually(
  ticker: string,
  contractType: "call" | "put",
  minExpDate: string,
  maxExpDate: string,
  limit: number = 50,
  stockPrice?: number | null,
): Promise<OptionsContract[]> {
  const price = stockPrice ?? (await fetchStockPrice(ticker));
  if (price == null || price <= 0) {
    log(
      `fetchOptionsChain: no stock price for ${ticker}, can't generate symbols`,
      "polygon",
    );
    return [];
  }

  const right: "C" | "P" = contractType === "call" ? "C" : "P";
  const inc = getStrikeIncrement(price);

  const tolerance = price * 0.1;
  const minStrike = Math.floor((price - tolerance) / inc) * inc;
  const maxStrike = Math.ceil((price + tolerance) / inc) * inc;

  const strikes: number[] = [];
  for (let s = minStrike; s <= maxStrike; s += inc) {
    if (s > 0) strikes.push(Math.round(s * 100) / 100);
  }

  const expirations = generateFridaysBetween(minExpDate, maxExpDate);
  if (expirations.length === 0) {
    log(
      `fetchOptionsChain: no fridays between ${minExpDate} and ${maxExpDate}`,
      "polygon",
    );
    return [];
  }

  const contracts: OptionsContract[] = [];
  for (const exp of expirations) {
    for (const strike of strikes) {
      const sym = buildOccSymbol(ticker, exp, right, strike);
      contracts.push({
        ticker: sym,
        strike_price: strike,
        expiration_date: exp,
        contract_type: contractType,
      });
      if (contracts.length >= limit) break;
    }
    if (contracts.length >= limit) break;
  }

  log(
    `fetchOptionsChain: generated ${contracts.length} symbols for ${ticker} (${contractType}) ${minExpDate}..${maxExpDate}, price=$${price.toFixed(2)}, inc=$${inc}`,
    "polygon",
  );
  return contracts;
}

export async function fetchOptionContractDetails(
  contractSymbol: string,
): Promise<{
  openInterest: number | null;
} | null> {
  try {
    const data = await polygonGet(
      `/v3/reference/options/contracts/${contractSymbol}`,
    );
    const r = data.results;
    if (!r) return null;
    return { openInterest: r.open_interest ?? null };
  } catch (err: any) {
    log(
      `Error fetching option contract details for ${contractSymbol}: ${err.message}`,
      "polygon",
    );
    return null;
  }
}

export async function fetchOptionQuote(
  contractSymbol: string,
): Promise<OptionsQuote | null> {
  try {
    const data = await polygonGet(`/v3/quotes/${contractSymbol}`, {
      limit: "1",
      order: "desc",
      sort: "timestamp",
    });
    const results = data.results ?? [];
    if (results.length === 0) return null;
    const q = results[0];
    return {
      bid: q.bid_price ?? null,
      ask: q.ask_price ?? null,
    };
  } catch (err: any) {
    log(
      `Error fetching option quote for ${contractSymbol}: ${err.message}`,
      "polygon",
    );
    return null;
  }
}

export async function fetchOptionSnapshot(
  underlyingTicker: string,
  contractSymbol: string,
): Promise<{
  openInterest: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  impliedVol: number | null;
  delta: number | null;
} | null> {
  try {
    const encoded = encodeURIComponent(contractSymbol);
    const data = await polygonGet(
      `/v3/snapshot/options/${underlyingTicker}/${encoded}`,
    );
    const r = data.results;
    if (!r) return null;
    return {
      openInterest: r.open_interest ?? null,
      bid: r.last_quote?.bid ?? null,
      ask: r.last_quote?.ask ?? null,
      volume: r.day?.volume ?? null,
      impliedVol: r.implied_volatility ?? null,
      delta: r.greeks?.delta ?? null,
    };
  } catch (err: any) {
    log(
      `Error fetching option snapshot for ${contractSymbol}: ${err.message}`,
      "polygon",
    );
    return null;
  }
}

export async function fetchStockPrice(ticker: string): Promise<number | null> {
  try {
    const data = await polygonGet(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`,
    );
    const t = data.ticker;
    if (t) {
      const price = t.lastTrade?.p ?? t.day?.c ?? t.prevDay?.c ?? null;
      if (price != null && price > 0) return price;
    }
  } catch (err: any) {
    log(`Snapshot error for ${ticker}: ${err.message}`, "polygon");
  }

  try {
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    const from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await polygonGet(
      `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}`,
      { adjusted: "true", sort: "desc", limit: "1" },
    );
    if (data?.results?.length > 0) {
      return data.results[0].c ?? null;
    }
  } catch (err: any) {
    log(`Daily bar fallback error for ${ticker}: ${err.message}`, "polygon");
  }

  return null;
}

export async function fetchSnapshot(ticker: string): Promise<{
  lastPrice: number;
  change: number;
  changePercent: number;
} | null> {
  try {
    const data = await polygonGet(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`,
    );
    const t = data.ticker;
    if (!t) return null;
    return {
      lastPrice: t.lastTrade?.p ?? t.day?.c ?? 0,
      change: t.todaysChange ?? 0,
      changePercent: t.todaysChangePerc ?? 0,
    };
  } catch {
    return null;
  }
}

export interface OptionMarkResult {
  bid: number | null;
  ask: number | null;
  mark: number | null;
  spread: number | null;
  ts: number;
  stale: boolean;
  openInterest: number | null;
  volume: number | null;
  impliedVol: number | null;
  delta: number | null;
}

export async function fetchOptionNbbo(
  contractTicker: string,
): Promise<OptionMarkResult | null> {
  try {
    const normalized = contractTicker.startsWith("o:")
      ? "O:" + contractTicker.slice(2)
      : contractTicker;
    const data = await polygonGet(
      `/v3/quotes/${encodeURIComponent(normalized)}`,
      { limit: "1", order: "desc", sort: "timestamp" },
      LIVE_CACHE_TTL,
    );
    const results = data.results ?? [];
    if (results.length === 0) return null;
    const q = results[0];
    const bid = q.bid_price ?? null;
    const ask = q.ask_price ?? null;

    let mark: number | null = null;
    let stale = false;
    if (bid != null && bid > 0 && ask != null && ask > 0) {
      mark = Math.round(((bid + ask) / 2) * 100) / 100;
    } else if (ask != null && ask > 0) {
      mark = ask;
      stale = true;
    } else if (bid != null && bid > 0) {
      mark = bid;
      stale = true;
    }

    const spread =
      bid != null && ask != null && bid > 0
        ? Math.round((ask - bid) * 100) / 100
        : null;

    return {
      bid,
      ask,
      mark,
      spread,
      ts: q.sip_timestamp ? Math.floor(q.sip_timestamp / 1e6) : Date.now(),
      stale,
      openInterest: null,
      volume: null,
      impliedVol: null,
      delta: null,
    };
  } catch (err: any) {
    log(`NBBO fetch error for ${contractTicker}: ${err.message}`, "polygon");
    return null;
  }
}

export async function fetchOptionLastTrade(
  contractTicker: string,
): Promise<OptionMarkResult | null> {
  try {
    const normalized = contractTicker.startsWith("o:")
      ? "O:" + contractTicker.slice(2)
      : contractTicker;
    const data = await polygonGet(
      `/v2/last/trade/${encodeURIComponent(normalized)}`,
      {},
      LIVE_CACHE_TTL,
    );
    const r = data.results;
    if (!r || !r.p) return null;
    return {
      bid: null,
      ask: null,
      mark: r.p,
      spread: null,
      ts: r.t ? Math.floor(r.t / 1e6) : Date.now(),
      stale: true,
      openInterest: null,
      volume: null,
      impliedVol: null,
      delta: null,
    };
  } catch (err: any) {
    log(
      `Last trade fetch error for ${contractTicker}: ${err.message}`,
      "polygon",
    );
    return null;
  }
}

export async function fetchOptionMarkAtTime(
  contractTicker: string,
  timestampMs: number,
): Promise<number | null> {
  try {
    const date = new Date(timestampMs).toISOString().slice(0, 10);
    const apiKey = API_KEY;
    const normalized = contractTicker.startsWith("o:") ? "O:" + contractTicker.slice(2) : contractTicker;
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${normalized}/range/1/second/${date}/${date}?adjusted=true&sort=asc&limit=50000&apiKey=${apiKey}`;

    await rateLimitWait();
    const resp = await fetch(url);
    if (!resp.ok) {
      log(`fetchOptionMarkAtTime HTTP ${resp.status} for ${normalized} on ${date}`, "polygon");
      return null;
    }
    const data = await resp.json();

    if (data?.results && data.results.length > 0) {
      let closest = data.results[0];
      let minDist = Math.abs(closest.t - timestampMs);
      for (const bar of data.results) {
        const dist = Math.abs(bar.t - timestampMs);
        if (dist < minDist) {
          closest = bar;
          minDist = dist;
        }
      }
      const vwap = closest.vw ?? (closest.h + closest.l) / 2;
      return Math.round(vwap * 100) / 100;
    }

    return null;
  } catch (err: any) {
    log(
      `fetchOptionMarkAtTime error for ${contractTicker}: ${err.message}`,
      "polygon",
    );
    return null;
  }
}

export async function fetchStockPriceAtTime(
  ticker: string,
  timestampMs: number,
): Promise<number | null> {
  try {
    const windowStart = timestampMs - 5 * 60 * 1000;
    const windowEnd = timestampMs + 5 * 60 * 1000;
    const data = await polygonGet(
      `/v2/aggs/ticker/${ticker}/range/1/minute/${windowStart}/${windowEnd}`,
      {
        adjusted: "true",
        sort: "asc",
        limit: "20",
      },
    );
    if (data?.results && data.results.length > 0) {
      const inWindow = data.results.filter(
        (b: any) => b.t >= windowStart && b.t <= windowEnd,
      );
      if (inWindow.length > 0) {
        let closest = inWindow[0];
        let minDist = Math.abs(closest.t - timestampMs);
        for (const bar of inWindow) {
          const dist = Math.abs(bar.t - timestampMs);
          if (dist < minDist) {
            closest = bar;
            minDist = dist;
          }
        }
        const vwap = closest.vw ?? (closest.h + closest.l) / 2;
        return Math.round(vwap * 100) / 100;
      }
    }
  } catch (err: any) {
    log(`fetchStockPriceAtTime 1m error for ${ticker}: ${err.message}`, "polygon");
  }

  try {
    const dateStr = new Date(timestampMs).toISOString().slice(0, 10);
    const from = new Date(timestampMs - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await polygonGet(
      `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${dateStr}`,
      { adjusted: "true", sort: "desc", limit: "1" },
    );
    if (data?.results?.length > 0) {
      return data.results[0].c ?? null;
    }
  } catch (err: any) {
    log(`fetchStockPriceAtTime daily fallback error for ${ticker}: ${err.message}`, "polygon");
  }

  return null;
}

export async function fetchOptionMark(
  contractTicker: string,
  underlyingTicker?: string,
): Promise<OptionMarkResult | null> {
  let result = await fetchOptionNbbo(contractTicker);
  if (result && result.mark != null) {
    if (underlyingTicker) {
      try {
        const snap = await fetchOptionSnapshot(
          underlyingTicker,
          contractTicker,
        );
        if (snap) {
          result.openInterest = snap.openInterest;
          result.volume = snap.volume;
          result.impliedVol = snap.impliedVol;
          result.delta = snap.delta;
        }
      } catch {}
    }
    return result;
  }

  const fallback = await fetchOptionLastTrade(contractTicker);
  if (fallback) {
    if (underlyingTicker) {
      try {
        const snap = await fetchOptionSnapshot(
          underlyingTicker,
          contractTicker,
        );
        if (snap) {
          fallback.openInterest = snap.openInterest;
          fallback.volume = snap.volume;
          fallback.impliedVol = snap.impliedVol;
          fallback.delta = snap.delta;
        }
      } catch {}
    }
    return fallback;
  }

  if (underlyingTicker) {
    try {
      const snap = await fetchOptionSnapshot(underlyingTicker, contractTicker);
      if (snap) {
        const bid = snap.bid;
        const ask = snap.ask;
        let mark: number | null = null;
        let stale = false;
        if (bid != null && bid > 0 && ask != null && ask > 0) {
          mark = Math.round(((bid + ask) / 2) * 100) / 100;
        } else if (ask != null && ask > 0) {
          mark = ask;
          stale = true;
        } else if (bid != null && bid > 0) {
          mark = bid;
          stale = true;
        }
        if (mark != null) {
          return {
            bid,
            ask,
            mark,
            spread:
              bid != null && ask != null && bid > 0
                ? Math.round((ask - bid) * 100) / 100
                : null,
            ts: Date.now(),
            stale,
            openInterest: snap.openInterest,
            volume: snap.volume,
            impliedVol: snap.impliedVol,
            delta: snap.delta,
          };
        }
      }
    } catch {}
  }

  return null;
}

function dateStrToMs(dateStr: string): number {
  return new Date(dateStr + "T00:00:00Z").getTime();
}

function dateStrToEndMs(dateStr: string): number {
  return new Date(dateStr + "T23:59:59.999Z").getTime();
}

function polygonBarToBar(pb: PolygonBar): Bar {
  return {
    timestamp: pb.t,
    open: pb.o,
    high: pb.h,
    low: pb.l,
    close: pb.c,
    volume: pb.v,
  };
}

function barToPolygonBar(b: Bar): PolygonBar {
  return {
    o: b.open,
    h: b.high,
    l: b.low,
    c: b.close,
    v: b.volume,
    t: b.timestamp,
  };
}

export async function fetchDailyBarsFromPolygon(
  ticker: string,
  from: string,
  to: string,
): Promise<DailyBar[]> {
  const fromDate = new Date(from).toISOString().slice(0, 10);
  const toDate = new Date(to).toISOString().slice(0, 10);
  const raw = await fetchDailyBars(ticker, fromDate, toDate);
  return raw.map(
    (bar) =>
      ({
        id: 0,
        ticker,
        date: formatDate(new Date(bar.t)),
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        vwap: bar.vw ?? null,
        source: "polygon",
      }) as DailyBar,
  );
}

export async function fetchDailyBarsCached(
  ticker: string,
  from: string,
  to: string,
): Promise<PolygonBar[]> {
  const bars = await getBars({
    symbol: ticker,
    timeframe: "1d",
    adjusted: true,
    startTs: dateStrToMs(from),
    endTs: dateStrToEndMs(to),
    fetcher: async (p) => {
      const fromDate = new Date(p.startTs).toISOString().slice(0, 10);
      const toDate = new Date(p.endTs).toISOString().slice(0, 10);
      const raw = await fetchDailyBars(ticker, fromDate, toDate);
      return raw.map(polygonBarToBar);
    },
  });
  return bars.map(barToPolygonBar);
}

export async function fetchIntradayBarsCached(
  ticker: string,
  from: string,
  to: string,
  timeframe: string = "5",
): Promise<PolygonBar[]> {
  const tfKey = `${timeframe}m`;
  const bars = await getBars({
    symbol: ticker,
    timeframe: tfKey,
    adjusted: true,
    startTs: dateStrToMs(from),
    endTs: dateStrToEndMs(to),
    fetcher: async (p) => {
      const fromDate = new Date(p.startTs).toISOString().slice(0, 10);
      const toDate = new Date(p.endTs).toISOString().slice(0, 10);
      const raw = await fetchIntradayBars(ticker, fromDate, toDate, timeframe);
      return raw.map(polygonBarToBar);
    },
  });
  return bars.map(barToPolygonBar);
}
