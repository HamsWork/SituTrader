import { IBApi, EventName, Contract, Order, OrderAction, OrderType, SecType, TimeInForce, OptionType, ErrorCode } from "@stoqey/ib";
import { log } from "../index";
import { storage } from "../storage";

let ibApi: IBApi | null = null;
let connected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let nextOrderId = 1;
let connecting = false;

const IBKR_CLIENT_ID = parseInt(process.env.IBKR_CLIENT_ID || "1");

async function getIbkrHost(): Promise<string> {
  const fromDb = await storage.getSetting("ibkrHost");
  return fromDb || process.env.IBKR_HOST || "127.0.0.1";
}

async function getIbkrPort(): Promise<number> {
  const fromDb = await storage.getSetting("ibkrPort");
  return fromDb ? parseInt(fromDb) : parseInt(process.env.IBKR_PORT || "4003");
}

export interface IbkrPosition {
  account: string;
  symbol: string;
  secType: string;
  exchange: string;
  position: number;
  avgCost: number;
}

export interface IbkrAccountSummary {
  netLiquidation?: number;
  buyingPower?: number;
  totalCashValue?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
}

const positions: Map<string, IbkrPosition> = new Map();
const accountSummary: IbkrAccountSummary = {};
const orderStatuses: Map<number, { status: string; filled: number; remaining: number; avgFillPrice: number; lastFillPrice: number }> = new Map();
const orderCallbacks: Map<number, { resolve: (data: any) => void; reject: (err: Error) => void }> = new Map();

export function isConnected(): boolean {
  return connected;
}

export function getPositions(): IbkrPosition[] {
  return Array.from(positions.values());
}

export function getAccountSummary(): IbkrAccountSummary {
  return { ...accountSummary };
}

export function getOrderStatus(orderId: number) {
  return orderStatuses.get(orderId) ?? null;
}

export function getNextOrderId(): number {
  return nextOrderId++;
}

function setupEventHandlers() {
  if (!ibApi) return;

  ibApi.on(EventName.connected, () => {
    connected = true;
    log(`IBKR connected`, "ibkr");
    ibApi!.reqPositions();
    ibApi!.reqAccountSummary(9001, "All", "$LEDGER");
  });

  ibApi.on(EventName.disconnected, () => {
    connected = false;
    log("IBKR disconnected", "ibkr");
    if (!connecting) {
      scheduleReconnect();
    }
  });

  ibApi.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
    if (code === ErrorCode.NOT_CONNECTED) {
      connected = false;
      scheduleReconnect();
    }
    const codeNum = typeof code === 'number' ? code : parseInt(String(code));
    if (codeNum !== 2104 && codeNum !== 2106 && codeNum !== 2158) {
      log(`IBKR error: ${err.message} (code: ${code}, reqId: ${reqId})`, "ibkr");
    }
  });

  ibApi.on(EventName.nextValidId, (orderId: number) => {
    nextOrderId = orderId;
    log(`IBKR next valid order ID: ${orderId}`, "ibkr");
  });

  ibApi.on(EventName.position, (account: string, contract: Contract, pos: number, avgCost?: number) => {
    const key = `${account}_${contract.symbol}_${contract.secType}`;
    if (pos === 0) {
      positions.delete(key);
    } else {
      positions.set(key, {
        account,
        symbol: contract.symbol || "",
        secType: contract.secType?.toString() || "",
        exchange: contract.exchange || "SMART",
        position: pos,
        avgCost: avgCost ?? 0,
      });
    }
  });

  ibApi.on(EventName.accountSummary, (_reqId: number, account: string, tag: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    switch (tag) {
      case "NetLiquidation": accountSummary.netLiquidation = num; break;
      case "BuyingPower": accountSummary.buyingPower = num; break;
      case "TotalCashValue": accountSummary.totalCashValue = num; break;
      case "UnrealizedPnL": accountSummary.unrealizedPnl = num; break;
      case "RealizedPnL": accountSummary.realizedPnl = num; break;
    }
  });

  (ibApi as any).on(EventName.orderStatus, (
    orderId: number, status: string, filled: number, remaining: number,
    avgFillPrice: number, _permId: number, _parentId: number,
    lastFillPrice: number
  ) => {
    orderStatuses.set(orderId, { status, filled, remaining, avgFillPrice, lastFillPrice });

    if (status === "Filled") {
      const cb = orderCallbacks.get(orderId);
      if (cb) {
        cb.resolve({ orderId, status, filled, avgFillPrice });
        orderCallbacks.delete(orderId);
      }
    } else if (status === "Cancelled" || status === "ApiCancelled") {
      const cb = orderCallbacks.get(orderId);
      if (cb) {
        cb.reject(new Error(`Order ${orderId} cancelled`));
        orderCallbacks.delete(orderId);
      }
    }
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectIBKR().catch(() => {});
  }, 10000);
}

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (!connected || !ibApi) return;
    try {
      ibApi.reqPositions();
      ibApi.reqAccountSummary(9001, "All", "$LEDGER");
    } catch (err: any) {
      log(`Keep-alive poll error: ${err.message}`, "ibkr");
    }
  }, 30000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

export async function connectIBKR(): Promise<boolean> {
  try {
    if (connected && ibApi) return true;
    if (connecting) {
      log("IBKR connection attempt already in progress, skipping", "ibkr");
      return false;
    }

    connecting = true;

    if (ibApi) {
      try {
        ibApi.removeAllListeners();
        ibApi.disconnect();
      } catch {}
      ibApi = null;
    }

    const host = await getIbkrHost();
    const port = await getIbkrPort();

    ibApi = new IBApi({
      host,
      port,
      clientId: IBKR_CLIENT_ID,
    });

    log(`IBKR connecting to ${host}:${port}...`, "ibkr");

    setupEventHandlers();

    return new Promise((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) return;
        settled = true;
      };

      const timeout = setTimeout(() => {
        cleanup();
        log("IBKR connection timeout after 15s", "ibkr");
        if (ibApi) {
          try {
            ibApi.removeAllListeners();
            ibApi.disconnect();
          } catch {}
          ibApi = null;
        }
        connecting = false;
        scheduleReconnect();
        resolve(false);
      }, 15000);

      ibApi!.once(EventName.connected, () => {
        if (settled) return;
        cleanup();
        clearTimeout(timeout);
        connecting = false;
        startKeepAlive();
        resolve(true);
      });

      ibApi!.once(EventName.error, () => {
        if (settled) return;
        cleanup();
        clearTimeout(timeout);
        connecting = false;
        resolve(false);
      });

      ibApi!.connect();
    });
  } catch (err: any) {
    log(`IBKR connect error: ${err.message}`, "ibkr");
    connecting = false;
    scheduleReconnect();
    return false;
  }
}

export function disconnectIBKR() {
  stopKeepAlive();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ibApi) {
    try { ibApi.disconnect(); } catch {}
    ibApi = null;
  }
  connected = false;
}

function makeStockContract(symbol: string): Contract {
  return {
    symbol,
    secType: SecType.STK,
    exchange: "SMART",
    currency: "USD",
  };
}

function makeOptionContract(optionTicker: string): Contract {
  const match = optionTicker.match(/^O:(\w+?)(\d{6})([CP])(\d{8})$/);
  if (!match) {
    throw new Error(`Invalid option ticker format: ${optionTicker}`);
  }
  const [, symbol, dateStr, right, strikeRaw] = match;
  const strike = parseInt(strikeRaw) / 1000;
  const year = "20" + dateStr.slice(0, 2);
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  return {
    symbol,
    secType: SecType.OPT,
    exchange: "SMART",
    currency: "USD",
    lastTradeDateOrContractMonth: `${year}${month}${day}`,
    strike,
    right: right === "C" ? OptionType.Call : OptionType.Put,
    multiplier: 100,
  };
}

export function makeContract(instrumentType: string, ticker: string, instrumentTicker?: string | null, optionTicker?: string | null): Contract {
  if (instrumentType === "OPTION" && optionTicker) {
    return makeOptionContract(optionTicker);
  }
  if (instrumentType === "LEVERAGED_ETF" && instrumentTicker) {
    return makeStockContract(instrumentTicker);
  }
  return makeStockContract(ticker);
}

export async function placeMarketOrder(
  contract: Contract,
  action: "BUY" | "SELL",
  quantity: number
): Promise<{ orderId: number; promise: Promise<any> }> {
  if (!ibApi || !connected) throw new Error("IBKR not connected");

  const orderId = getNextOrderId();
  const order: Order = {
    action: action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
    orderType: OrderType.MKT,
    totalQuantity: quantity,
    tif: TimeInForce.DAY,
    transmit: true,
  };

  const promise = new Promise((resolve, reject) => {
    orderCallbacks.set(orderId, { resolve, reject });
    setTimeout(() => {
      if (orderCallbacks.has(orderId)) {
        orderCallbacks.delete(orderId);
        resolve({ orderId, status: "Submitted", filled: 0, avgFillPrice: 0 });
      }
    }, 30000);
  });

  ibApi.placeOrder(orderId, contract, order);
  log(`IBKR placed MKT ${action} ${quantity} ${contract.symbol} (orderId: ${orderId})`, "ibkr");

  return { orderId, promise };
}

export async function placeLimitOrder(
  contract: Contract,
  action: "BUY" | "SELL",
  quantity: number,
  price: number
): Promise<{ orderId: number; promise: Promise<any> }> {
  if (!ibApi || !connected) throw new Error("IBKR not connected");

  const orderId = getNextOrderId();
  const order: Order = {
    action: action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
    orderType: OrderType.LMT,
    totalQuantity: quantity,
    lmtPrice: price,
    tif: TimeInForce.DAY,
    transmit: true,
  };

  const promise = new Promise((resolve, reject) => {
    orderCallbacks.set(orderId, { resolve, reject });
    setTimeout(() => {
      if (orderCallbacks.has(orderId)) {
        orderCallbacks.delete(orderId);
        resolve({ orderId, status: "Submitted", filled: 0, avgFillPrice: 0 });
      }
    }, 60000);
  });

  ibApi.placeOrder(orderId, contract, order);
  log(`IBKR placed LMT ${action} ${quantity} ${contract.symbol} @ $${price} (orderId: ${orderId})`, "ibkr");

  return { orderId, promise };
}

export async function placeStopOrder(
  contract: Contract,
  action: "BUY" | "SELL",
  quantity: number,
  stopPrice: number
): Promise<{ orderId: number }> {
  if (!ibApi || !connected) throw new Error("IBKR not connected");

  const orderId = getNextOrderId();
  const order: Order = {
    action: action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
    orderType: OrderType.STP,
    totalQuantity: quantity,
    auxPrice: stopPrice,
    tif: TimeInForce.GTC,
    transmit: true,
  };

  ibApi.placeOrder(orderId, contract, order);
  log(`IBKR placed STP ${action} ${quantity} ${contract.symbol} @ $${stopPrice} (orderId: ${orderId})`, "ibkr");

  return { orderId };
}

export async function cancelOrder(orderId: number): Promise<void> {
  if (!ibApi || !connected) throw new Error("IBKR not connected");
  ibApi.cancelOrder(orderId);
  log(`IBKR cancelled order ${orderId}`, "ibkr");
}

export async function modifyStopPrice(
  orderId: number,
  contract: Contract,
  action: "BUY" | "SELL",
  quantity: number,
  newStopPrice: number
): Promise<void> {
  if (!ibApi || !connected) throw new Error("IBKR not connected");

  const order: Order = {
    action: action === "BUY" ? OrderAction.BUY : OrderAction.SELL,
    orderType: OrderType.STP,
    totalQuantity: quantity,
    auxPrice: newStopPrice,
    tif: TimeInForce.GTC,
    transmit: true,
  };

  ibApi.placeOrder(orderId, contract, order);
  log(`IBKR modified stop order ${orderId} to $${newStopPrice}`, "ibkr");
}

export function getIBApi(): IBApi | null {
  return ibApi;
}
