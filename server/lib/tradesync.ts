import { log } from "../index";
import type { Signal, TradePlan } from "@shared/schema";

const TRADESYNC_BASE_URL = process.env.TRADESYNC_BASE_URL || "";
const TRADESYNC_API_KEY = process.env.TRADESYNC_API_KEY || "";

export interface SignalTargetEntry {
  price?: number;
  percentage?: number;
  take_off_percent?: number;
  raise_stop_loss?: { price?: number; trailing_stop_percent?: number };
}

export interface TradeSyncSignalData {
  ticker: string;
  instrument_type: string;
  direction: string;
  entry_price: number | null;
  expiration?: string;
  strike?: number;
  targets?: Record<string, SignalTargetEntry>;
  stop_loss?: number;
  auto_track?: boolean;
  underlying_price_based?: boolean;
  time_stop?: string;
  discord_webhook_url?: string | null;
  option_type?: string;
  stop_loss_percentage?: number;
  trade_type?: string;
  entry_option_price?: number | null;
  entry_underlying_price?: number | null;
  entry_letf_price?: number | null;
  underlying_ticker?: string | null;
  leverage?: number;
  tradesync_id?: number;
  alert_mode?: "normal" | "ten_percent";
}

export interface TradeSyncResult {
  ok: boolean;
  data?: any;
  error?: string;
}

function isConfigured(): boolean {
  return !!(TRADESYNC_BASE_URL && TRADESYNC_API_KEY);
}

export function isTradeSyncEnabled(): boolean {
  return isConfigured();
}

function toApiPayload(signal: TradeSyncSignalData): Record<string, any> {
  const apiTargets: Record<string, any> = {};
  if (signal.targets) {
    for (const [key, t] of Object.entries(signal.targets)) {
      const target: Record<string, any> = {};
      if (t.price != null) target.price = t.price;
      if (t.take_off_percent != null)
        target.take_off_percent = t.take_off_percent;
      if (t.raise_stop_loss) {
        const rsl: Record<string, any> = {};
        if (t.raise_stop_loss.price != null)
          rsl.price = t.raise_stop_loss.price;
        if (t.raise_stop_loss.trailing_stop_percent != null)
          rsl.trailing_stop_percent = t.raise_stop_loss.trailing_stop_percent;
        target.raise_stop_loss = rsl;
      }
      apiTargets[key] = target;
    }
  }

  const payload: Record<string, any> = {
    ticker: signal.ticker,
    instrumentType: signal.instrument_type,
    direction: signal.direction,
    entryPrice: signal.entry_price ?? 0,
  };

  if (signal.expiration) payload.expiration = signal.expiration;
  if (signal.strike != null) payload.strike = signal.strike;
  if (signal.stop_loss != null) payload.stop_loss = signal.stop_loss;
  if (signal.stop_loss_percentage != null)
    payload.stop_loss_percentage = signal.stop_loss_percentage;
  if (signal.auto_track != null) payload.auto_track = signal.auto_track;
  if (signal.underlying_price_based != null)
    payload.underlying_price_based = signal.underlying_price_based;
  if (signal.time_stop) payload.time_stop = signal.time_stop;
  if (signal.trade_type) payload.tradeType = signal.trade_type;
  if (signal.underlying_ticker)
    payload.underlying_ticker = signal.underlying_ticker;
  if (Object.keys(apiTargets).length > 0) payload.targets = apiTargets;
  if (signal.discord_webhook_url)
    payload.discord_webhook_url = signal.discord_webhook_url;
  if (signal.option_type) payload.option_type = signal.option_type;
  if (signal.entry_option_price != null)
    payload.entry_option_price = signal.entry_option_price;
  if (signal.entry_underlying_price != null)
    payload.entry_underlying_price = signal.entry_underlying_price;
  if (signal.entry_letf_price != null)
    payload.entry_letf_price = signal.entry_letf_price;
  if (signal.leverage != null) payload.leverage = signal.leverage;
  if (signal.alert_mode) payload.alert_mode = signal.alert_mode;

  payload.trade_type = "Swing";
  return payload;
}

async function sendOnce(
  payload: Record<string, any>,
  ticker: string,
): Promise<TradeSyncResult> {
  let res: Response;
  try {
    res = await fetch(`${TRADESYNC_BASE_URL}/api/ingest/signals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TRADESYNC_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (fetchErr: any) {
    return { ok: false, error: fetchErr.message || "Network error" };
  }

  

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = body?.message || `TradeSync API error (${res.status})`;
    return { ok: false, error: msg };
  }
  
  const tradeSyncId = body?.id || body?.signal?.id || body?.signalId;
  log(
    `TradeSync: Signal accepted for ${ticker}, id=${tradeSyncId}`,
    "tradesync",
  );
  return { ok: true, data: body };
}

export async function sendToTradeSync(
  signal: TradeSyncSignalData,
): Promise<TradeSyncResult> {
  if (!isConfigured()) {
    return {
      ok: false,
      error: "TradeSync not configured (missing BASE_URL or API_KEY)",
    };
  }

  const payload = toApiPayload(signal);
  log(
    `TradeSync: Sending signal for ${signal.ticker} (${signal.instrument_type})`,
    "tradesync",
  );

  try {
    const result = await sendOnce(payload, signal.ticker);
    if (!result.ok) {
      log(
        `TradeSync: Failed for ${signal.ticker}: ${result.error}`,
        "tradesync",
      );
    }
    return result;
  } catch (err: any) {
    const result: TradeSyncResult = {
      ok: false,
      error: err.message || "Failed to reach TradeSync API",
    };
    log(
      `TradeSync: Error for ${signal.ticker}: ${result.error}`,
      "tradesync",
    );
    return result;
  }
}

export async function fetchDiscordTemplates(): Promise<TradeSyncResult> {
  if (!isConfigured()) {
    return { ok: false, error: "TradeSync not configured" };
  }

  try {
    const res = await fetch(
      `${TRADESYNC_BASE_URL}/api/discord-templates/var-templates`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${TRADESYNC_API_KEY}`,
        },
      },
    );

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = body?.message || `TradeSync API error (${res.status})`;
      return { ok: false, error: msg };
    }

    return { ok: true, data: body };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to reach TradeSync API" };
  }
}

export async function stopAutoTrack(
  tradeSyncSignalId: string | number,
): Promise<TradeSyncResult> {
  if (!isConfigured()) {
    return { ok: false, error: "TradeSync not configured" };
  }
  const idSegment = encodeURIComponent(String(tradeSyncSignalId));
  try {
    const res = await fetch(
      `${TRADESYNC_BASE_URL}/api/signals/${idSegment}/stop-auto-track`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TRADESYNC_API_KEY}`,
        },
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.message || `TradeSync API error (${res.status})`;
      return { ok: false, error: msg };
    }
    return { ok: true, data: body };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Failed to reach TradeSync API",
    };
  }
}

export async function markTargetHit(
  tradeSyncSignalId: string | number,
): Promise<TradeSyncResult> {
  if (!isConfigured()) {
    return { ok: false, error: "TradeSync not configured" };
  }
  const idSegment = encodeURIComponent(String(tradeSyncSignalId));
  try {
    const res = await fetch(
      `${TRADESYNC_BASE_URL}/api/signals/${idSegment}/target-hit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TRADESYNC_API_KEY}`,
        },
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.message || `TradeSync API error (${res.status})`;
      return { ok: false, error: msg };
    }
    return { ok: true, data: body };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Failed to reach TradeSync API",
    };
  }
}

export async function markStopLossHit(
  tradeSyncSignalId: string | number,
): Promise<TradeSyncResult> {
  if (!isConfigured()) {
    return { ok: false, error: "TradeSync not configured" };
  }
  const idSegment = encodeURIComponent(String(tradeSyncSignalId));
  try {
    const res = await fetch(
      `${TRADESYNC_BASE_URL}/api/signals/${idSegment}/stop-loss-hit`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TRADESYNC_API_KEY}`,
        },
      },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.message || `TradeSync API error (${res.status})`;
      return { ok: false, error: msg };
    }
    return { ok: true, data: body };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || "Failed to reach TradeSync API",
    };
  }
}

export function buildTradeSyncPayloadFromSignal(
  signal: Signal,
  instrumentType: string,
  instrumentEntry: number,
  instrumentTicker: string | null,
  targets: { t1: number | null; t2: number | null; stop: number | null },
  extras?: {
    delta?: number | null;
    leverage?: number;
    optionExpiry?: string;
    optionStrike?: number;
    optionRight?: string;
    letfTicker?: string;
    webhookUrl?: string;
  },
): TradeSyncSignalData {
  const tp = signal.tradePlanJson as TradePlan;
  const isBuy = tp?.bias === "BUY";
  const stockEntry = signal.entryPriceAtActivation ?? 0;

  const targetMap: Record<string, SignalTargetEntry> = {};
  if (targets.t1 != null) {
    targetMap.tp1 = {
      price: parseFloat(targets.t1.toFixed(2)),
      take_off_percent: 50,
      raise_stop_loss: { price: parseFloat(instrumentEntry.toFixed(2)) },
    };
  }
  if (targets.t2 != null) {
    targetMap.tp2 = {
      price: parseFloat(targets.t2.toFixed(2)),
      take_off_percent: 100,
    };
  }

  const instrumentTypeMap: Record<string, string> = {
    SHARES: "Shares",
    OPTION: "Options",
    LEVERAGED_ETF: "LETF",
    LETF_OPTIONS: "LETF Option",
  };
  const mappedInstrument = instrumentTypeMap[instrumentType] || instrumentType;

  let direction: string;
  if (instrumentType === "OPTION") {
    direction = isBuy ? "Call" : "Put";
  } else if (instrumentType === "LETF_OPTIONS") {
    direction = "Call";
  } else if (instrumentType === "LEVERAGED_ETF") {
    direction = "Long";
  } else {
    direction = isBuy ? "Long" : "Short";
  }

  let payloadTicker: string;
  if (instrumentType === "OPTION") {
    payloadTicker = signal.ticker;
  } else if (
    instrumentType === "LEVERAGED_ETF" ||
    instrumentType === "LETF_OPTIONS"
  ) {
    payloadTicker = extras?.letfTicker || instrumentTicker || signal.ticker;
  } else {
    payloadTicker = signal.ticker;
  }

  const payload: TradeSyncSignalData = {
    ticker: payloadTicker,
    instrument_type: mappedInstrument,
    direction,
    entry_price:
      instrumentEntry > 0 ? parseFloat(instrumentEntry.toFixed(2)) : null,
    stop_loss:
      targets.stop != null ? parseFloat(targets.stop.toFixed(2)) : undefined,
    auto_track: true,
    underlying_price_based: false,
    trade_type: "Swing",
    targets: Object.keys(targetMap).length > 0 ? targetMap : undefined,
  };

  if (stockEntry > 0) {
    payload.entry_underlying_price = parseFloat(stockEntry.toFixed(2));
  }

  if (instrumentType === "OPTION" && extras?.optionExpiry) {
    payload.expiration = extras.optionExpiry;
    payload.strike = extras.optionStrike;
    payload.option_type = extras.optionRight || (isBuy ? "CALL" : "PUT");
    payload.entry_option_price =
      instrumentEntry > 0 ? parseFloat(instrumentEntry.toFixed(2)) : null;
    payload.underlying_ticker = signal.ticker;
  }

  if (instrumentType === "LETF_OPTIONS" && extras?.optionExpiry) {
    payload.expiration = extras.optionExpiry;
    payload.strike = extras.optionStrike;
    payload.option_type = extras.optionRight || (isBuy ? "CALL" : "PUT");
    payload.entry_option_price =
      instrumentEntry > 0 ? parseFloat(instrumentEntry.toFixed(2)) : null;
    payload.underlying_ticker = signal.ticker;
    payload.leverage = extras.leverage;
    const letfEntryPrice = signal.instrumentEntryPrice ?? 0;
    payload.entry_letf_price =
      letfEntryPrice > 0 ? parseFloat(letfEntryPrice.toFixed(2)) : null;
  }

  if (instrumentType === "LEVERAGED_ETF") {
    payload.underlying_ticker = signal.ticker;
    payload.leverage = extras?.leverage;
    payload.entry_letf_price =
      instrumentEntry > 0 ? parseFloat(instrumentEntry.toFixed(2)) : null;
  }

  if (instrumentType === "SHARES") {
    payload.entry_underlying_price =
      instrumentEntry > 0 ? parseFloat(instrumentEntry.toFixed(2)) : null;
  }

  if (extras?.webhookUrl) {
    payload.discord_webhook_url = extras.webhookUrl;
  }

  payload.alert_mode = "ten_percent";

  return payload;
}

export async function fetchTradeHistory(
  limit: number = 100,
  status?: string,
): Promise<TradeSyncResult> {
  if (!isConfigured()) {
    return { ok: false, error: "TradeSync not configured" };
  }

  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (status) params.set("status", status);

    const res = await fetch(
      `${TRADESYNC_BASE_URL}/api/signals?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${TRADESYNC_API_KEY}`,
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = body?.message || `TradeSync API error (${res.status})`;
      return { ok: false, error: msg };
    }

    return { ok: true, data: body };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to reach TradeSync API" };
  }
}

export async function getTradesyncStatus(): Promise<{
  configured: boolean;
  reachable: boolean;
  error?: string;
}> {
  if (!isConfigured()) {
    return {
      configured: false,
      reachable: false,
      error: "TRADESYNC_BASE_URL or TRADESYNC_API_KEY not set",
    };
  }

  try {
    const res = await fetch(`${TRADESYNC_BASE_URL}/api/signals?limit=1`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TRADESYNC_API_KEY}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      return { configured: true, reachable: true };
    }
    return { configured: true, reachable: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { configured: true, reachable: false, error: err.message };
  }
}
