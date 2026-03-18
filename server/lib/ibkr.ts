/**
 * IBKR connection disabled. This module stubs all exports so callers
 * behave as if IBKR is never connected (no TWS/Gateway connection).
 */

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

const NOT_CONNECTED = "IBKR connection is disabled";

export function isConnected(): boolean {
  return false;
}

export function getPositions(): IbkrPosition[] {
  return [];
}

export function getAccountSummary(): IbkrAccountSummary {
  return {};
}

export function getOrderStatus(_orderId: number) {
  return null;
}

let stubOrderId = 1;
export function getNextOrderId(): number {
  return stubOrderId++;
}

export async function connectIBKR(): Promise<boolean> {
  return false;
}

export function disconnectIBKR(): void {
  // no-op
}

export function makeContract(
  _instrumentType: string,
  ticker: string,
  _instrumentTicker?: string | null,
  _optionTicker?: string | null
): { symbol: string; secType: string; exchange: string; currency: string; [k: string]: unknown } {
  return { symbol: ticker, secType: "STK", exchange: "SMART", currency: "USD" };
}

export async function placeMarketOrder(
  _contract: unknown,
  _action: "BUY" | "SELL",
  _quantity: number
): Promise<{ orderId: number; promise: Promise<unknown> }> {
  throw new Error(NOT_CONNECTED);
}

export async function placeLimitOrder(
  _contract: unknown,
  _action: "BUY" | "SELL",
  _quantity: number,
  _price: number
): Promise<{ orderId: number; promise: Promise<unknown> }> {
  throw new Error(NOT_CONNECTED);
}

export async function placeStopOrder(
  _contract: unknown,
  _action: "BUY" | "SELL",
  _quantity: number,
  _stopPrice: number
): Promise<{ orderId: number }> {
  throw new Error(NOT_CONNECTED);
}

export async function cancelOrder(_orderId: number): Promise<void> {
  throw new Error(NOT_CONNECTED);
}

export async function modifyStopPrice(
  _orderId: number,
  _contract: unknown,
  _action: "BUY" | "SELL",
  _quantity: number,
  _newStopPrice: number
): Promise<void> {
  throw new Error(NOT_CONNECTED);
}

export function getIBApi(): null {
  return null;
}
