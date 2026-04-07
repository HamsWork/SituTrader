import type { TradePlan, DailyBar } from "@shared/schema";
import { computeATR } from "./confidence";

export function generateTradePlan(
  lastClose: number,
  magnetPrice: number,
  dailyBars: DailyBar[],
  entryMode: string = "conservative",
  stopMode: string = "atr",
  atrMultiplier: number = 0.25,
  signalDirection?: string,
): TradePlan {
  const atr = computeATR(dailyBars);
  //TODO we need to check
  // const bias: "BUY" | "SELL" = signalDirection
  //   ? (signalDirection.toLowerCase().includes("up") ? "BUY" : "SELL")
  //   : (lastClose > magnetPrice ? "SELL" : "BUY");
  const bias = lastClose > magnetPrice ? "SELL" : "BUY";
  const direction = bias === "SELL" ? "down-to-magnet" : "up-to-magnet";
  

  let entryTrigger: string;
  if (entryMode === "aggressive") {
    entryTrigger = `Enter on first 5-min close ${bias === "SELL" ? "below" : "above"} prior bar after 08:35 CT`;
  } else {
    entryTrigger = `Enter after 5-min close breaks ${bias === "SELL" ? "below support" : "above resistance"} in magnet direction AND retests without reclaiming`;
  }

  let stopDistance: number;
  if (stopMode === "fixed") {
    stopDistance = lastClose * 0.0015;
  } else {
    stopDistance = Math.max(atrMultiplier * atr, lastClose * 0.0015);
  }

  const t1 = magnetPrice;
  const t2Buffer = 0.15 * atr;
  const t2 = bias === "SELL" ? magnetPrice - t2Buffer : magnetPrice + t2Buffer;

  const reward = Math.abs(lastClose - t1);
  const riskReward = stopDistance > 0 ? reward / stopDistance : 0;

  const invalidation = bias === "SELL"
    ? `Stop at $${(lastClose + stopDistance).toFixed(2)} (${stopDistance.toFixed(2)} above entry)`
    : `Stop at $${(lastClose - stopDistance).toFixed(2)} (${stopDistance.toFixed(2)} below entry)`;

  return {
    bias,
    entryTrigger,
    invalidation,
    t1,
    t2: Math.round(t2 * 100) / 100,
    riskReward: Math.round(riskReward * 10) / 10,
    stopDistance: Math.round(stopDistance * 100) / 100,
    notes: `${direction} | ATR(14)=$${atr.toFixed(2)}`,
  };
}
