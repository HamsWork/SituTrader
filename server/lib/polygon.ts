import { log } from "../index";

const POLYGON_BASE = "https://api.polygon.io";
const API_KEY = process.env.POLYGON_API_KEY;

const requestCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

async function polygonGet(path: string, params: Record<string, string> = {}): Promise<any> {
  if (!API_KEY) throw new Error("POLYGON_API_KEY not set");

  const url = new URL(`${POLYGON_BASE}${path}`);
  url.searchParams.set("apiKey", API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const cacheKey = url.toString();
  const cached = requestCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polygon API ${res.status}: ${text}`);
  }

  const data = await res.json();
  requestCache.set(cacheKey, { data, ts: Date.now() });
  return data;
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

export async function fetchOptionSnapshot(contractSymbol: string): Promise<{
  openInterest: number | null;
  bid: number | null;
  ask: number | null;
} | null> {
  try {
    const encoded = encodeURIComponent(contractSymbol);
    const data = await polygonGet(`/v3/snapshot/options/${encoded}`);
    const r = data.results;
    if (!r) return null;
    return {
      openInterest: r.open_interest ?? null,
      bid: r.last_quote?.bid ?? null,
      ask: r.last_quote?.ask ?? null,
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
