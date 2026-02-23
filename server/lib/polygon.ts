import { log } from "../index";

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
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTs = Date.now();
}

async function polygonGet(path: string, params: Record<string, string> = {}, cacheTtl: number = CACHE_TTL): Promise<any> {
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
      log(`Polygon rate limited, backing off ${backoff}ms (attempt ${attempt + 1})`, "polygon");
      await new Promise(r => setTimeout(r, backoff));
      continue;
    }

    if (res.status >= 500 && attempt < MAX_RETRIES - 1) {
      const backoff = 2000 * (attempt + 1);
      log(`Polygon server error ${res.status}, retrying in ${backoff}ms`, "polygon");
      await new Promise(r => setTimeout(r, backoff));
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
  to: string
): Promise<PolygonBar[]> {
  try {
    const data = await polygonGet(
      `/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}`,
      { adjusted: "true", sort: "asc", limit: "5000" }
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
  timeframe: string = "5"
): Promise<PolygonBar[]> {
  try {
    const data = await polygonGet(
      `/v2/aggs/ticker/${ticker}/range/${timeframe}/minute/${from}/${to}`,
      { adjusted: "true", sort: "asc", limit: "50000" }
    );
    return data.results ?? [];
  } catch (err: any) {
    log(`Error fetching intraday bars for ${ticker}: ${err.message}`, "polygon");
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
      { adjusted: "true" }
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
  limit: number = 50
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
    log(`Error fetching options chain for ${ticker}: ${err.message}`, "polygon");
    return [];
  }
}

export async function fetchOptionContractDetails(contractSymbol: string): Promise<{
  openInterest: number | null;
} | null> {
  try {
    const data = await polygonGet(`/v3/reference/options/contracts/${contractSymbol}`);
    const r = data.results;
    if (!r) return null;
    return { openInterest: r.open_interest ?? null };
  } catch (err: any) {
    log(`Error fetching option contract details for ${contractSymbol}: ${err.message}`, "polygon");
    return null;
  }
}

export async function fetchOptionQuote(contractSymbol: string): Promise<OptionsQuote | null> {
  try {
    const data = await polygonGet(`/v3/quotes/${contractSymbol}`, { limit: "1", order: "desc", sort: "timestamp" });
    const results = data.results ?? [];
    if (results.length === 0) return null;
    const q = results[0];
    return {
      bid: q.bid_price ?? null,
      ask: q.ask_price ?? null,
    };
  } catch (err: any) {
    log(`Error fetching option quote for ${contractSymbol}: ${err.message}`, "polygon");
    return null;
  }
}

export async function fetchOptionSnapshot(underlyingTicker: string, contractSymbol: string): Promise<{
  openInterest: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  impliedVol: number | null;
  delta: number | null;
} | null> {
  try {
    const encoded = encodeURIComponent(contractSymbol);
    const data = await polygonGet(`/v3/snapshot/options/${underlyingTicker}/${encoded}`);
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
    log(`Error fetching option snapshot for ${contractSymbol}: ${err.message}`, "polygon");
    return null;
  }
}

export async function fetchSnapshot(ticker: string): Promise<{
  lastPrice: number;
  change: number;
  changePercent: number;
} | null> {
  try {
    const data = await polygonGet(`/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`);
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

export async function fetchOptionNbbo(contractTicker: string): Promise<OptionMarkResult | null> {
  try {
    const normalized = contractTicker.startsWith("o:") ? "O:" + contractTicker.slice(2) : contractTicker;
    const data = await polygonGet(`/v3/quotes/${encodeURIComponent(normalized)}`, { limit: "1", order: "desc", sort: "timestamp" }, LIVE_CACHE_TTL);
    const results = data.results ?? [];
    if (results.length === 0) return null;
    const q = results[0];
    const bid = q.bid_price ?? null;
    const ask = q.ask_price ?? null;

    let mark: number | null = null;
    let stale = false;
    if (bid != null && bid > 0 && ask != null && ask > 0) {
      mark = Math.round((bid + ask) / 2 * 100) / 100;
    } else if (ask != null && ask > 0) {
      mark = ask;
      stale = true;
    } else if (bid != null && bid > 0) {
      mark = bid;
      stale = true;
    }

    const spread = (bid != null && ask != null && bid > 0) ? Math.round((ask - bid) * 100) / 100 : null;

    return {
      bid, ask, mark, spread,
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

export async function fetchOptionLastTrade(contractTicker: string): Promise<OptionMarkResult | null> {
  try {
    const normalized = contractTicker.startsWith("o:") ? "O:" + contractTicker.slice(2) : contractTicker;
    const data = await polygonGet(`/v2/last/trade/${encodeURIComponent(normalized)}`, {}, LIVE_CACHE_TTL);
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
    log(`Last trade fetch error for ${contractTicker}: ${err.message}`, "polygon");
    return null;
  }
}

export async function fetchOptionMarkAtTime(contractTicker: string, timestampMs: number): Promise<number | null> {
  try {
    const windowStart = timestampMs - 5 * 60 * 1000;
    const windowEnd = timestampMs + 5 * 60 * 1000;
    const data = await polygonGet(`/v2/aggs/ticker/${contractTicker}/range/1/minute/${windowStart}/${windowEnd}`, {
      adjusted: "true",
      sort: "asc",
      limit: "20",
    });
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
      const vwap = closest.vw ?? ((closest.h + closest.l) / 2);
      return Math.round(vwap * 100) / 100;
    }

    const tradesData = await polygonGet(`/v3/trades/${contractTicker}`, {
      "timestamp.gte": new Date(windowStart).toISOString(),
      "timestamp.lte": new Date(windowEnd).toISOString(),
      limit: "10",
      sort: "timestamp",
      order: "desc",
    });
    if (tradesData?.results && tradesData.results.length > 0) {
      return tradesData.results[0].price;
    }
    return null;
  } catch (err: any) {
    log(`fetchOptionMarkAtTime error for ${contractTicker}: ${err.message}`, "polygon");
    return null;
  }
}

export async function fetchStockPriceAtTime(ticker: string, timestampMs: number): Promise<number | null> {
  try {
    const windowStart = timestampMs - 5 * 60 * 1000;
    const windowEnd = timestampMs + 5 * 60 * 1000;
    const data = await polygonGet(`/v2/aggs/ticker/${ticker}/range/1/minute/${windowStart}/${windowEnd}`, {
      adjusted: "true",
      sort: "asc",
      limit: "20",
    });
    if (data?.results && data.results.length > 0) {
      const inWindow = data.results.filter((b: any) => b.t >= windowStart && b.t <= windowEnd);
      if (inWindow.length === 0) return null;
      let closest = inWindow[0];
      let minDist = Math.abs(closest.t - timestampMs);
      for (const bar of inWindow) {
        const dist = Math.abs(bar.t - timestampMs);
        if (dist < minDist) {
          closest = bar;
          minDist = dist;
        }
      }
      const vwap = closest.vw ?? ((closest.h + closest.l) / 2);
      return Math.round(vwap * 100) / 100;
    }
    return null;
  } catch (err: any) {
    log(`fetchStockPriceAtTime error for ${ticker}: ${err.message}`, "polygon");
    return null;
  }
}

export async function fetchOptionMark(contractTicker: string, underlyingTicker?: string): Promise<OptionMarkResult | null> {
  let result = await fetchOptionNbbo(contractTicker);
  if (result && result.mark != null) {
    if (underlyingTicker) {
      try {
        const snap = await fetchOptionSnapshot(underlyingTicker, contractTicker);
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
        const snap = await fetchOptionSnapshot(underlyingTicker, contractTicker);
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
          mark = Math.round((bid + ask) / 2 * 100) / 100;
        } else if (ask != null && ask > 0) {
          mark = ask;
          stale = true;
        } else if (bid != null && bid > 0) {
          mark = bid;
          stale = true;
        }
        if (mark != null) {
          return {
            bid, ask, mark,
            spread: (bid != null && ask != null && bid > 0) ? Math.round((ask - bid) * 100) / 100 : null,
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
