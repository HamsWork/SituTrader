import { log } from "../index";
import { storage } from "../storage";
import type { Signal, TradePlan, IbkrTrade } from "@shared/schema";

async function getWebhookUrl(channel: "alerts" | "swings"): Promise<string | undefined> {
  const settingKey = channel === "alerts" ? "discordGoatAlertsWebhook" : "discordGoatSwingsWebhook";
  const envKey = channel === "alerts" ? "DISCORD_GOAT_ALERTS_WEBHOOK" : "DISCORD_GOAT_SWINGS_WEBHOOK";
  const fromDb = await storage.getSetting(settingKey);
  return fromDb || process.env[envKey] || undefined;
}

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

async function sendWebhook(url: string, content: string, embeds: DiscordEmbed[]): Promise<boolean> {
  if (!url) {
    log("Discord webhook URL not configured", "discord");
    return false;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds }),
    });

    if (!res.ok) {
      const body = await res.text();
      log(`Discord webhook failed: ${res.status} ${body}`, "discord");
      return false;
    }

    log(`Discord webhook sent successfully`, "discord");
    return true;
  } catch (err: any) {
    log(`Discord webhook error: ${err.message}`, "discord");
    return false;
  }
}

const GREEN = 0x22c55e;
const RED = 0xef4444;
const BLUE = 0x3b82f6;
const ORANGE = 0xf97316;
const PURPLE = 0xa855f7;
const CYAN = 0x06b6d4;
const GOLD = 0xeab308;

function biasColor(bias: string): number {
  return bias === "BUY" ? GREEN : RED;
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null) return "\u2014";
  return `$${p.toFixed(2)}`;
}

function fmtPnl(pnl: number | null | undefined): string {
  if (pnl == null) return "\u2014";
  const prefix = pnl >= 0 ? "+" : "";
  return `${prefix}$${pnl.toFixed(2)}`;
}

function fmtPct(entry: number, target: number): string {
  if (!entry || entry === 0) return "";
  const pct = ((target - entry) / entry) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtDate(): string {
  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

export async function postOptionsAlert(signal: Signal, trade?: IbkrTrade): Promise<boolean> {
  const DISCORD_GOAT_ALERTS_URL = await getWebhookUrl("alerts");
  if (!DISCORD_GOAT_ALERTS_URL) return false;

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  const optData = signal.optionsJson as any;
  const strike = optData?.candidate?.strike ?? "?";
  const expiry = optData?.candidate?.expiry ?? "?";
  const right = optData?.candidate?.right === "C" ? "CALL" : "PUT";
  const optionPrice = signal.optionEntryMark ?? trade?.entryPrice ?? 0;

  const biasLabel = tp.bias === "BUY" ? "BULLISH" : "BEARISH";
  const entryPrice = trade?.entryPrice ?? signal.entryPriceAtActivation ?? 0;
  const stopPrice = trade?.stopPrice ?? signal.stopPrice ?? 0;

  const stopPct = entryPrice > 0 ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1) : "?";

  let desc = `\u{1F7E2} **Ticker**\u2003\u2003\u2003\u2003\u2003\u{1F4C8} **Stock Price**\n`;
  desc += `${signal.ticker}\u2003\u2003\u2003\u2003\u2003\u2003\u2003${fmtPrice(entryPrice)}\n\n`;

  desc += `\u274C **Expiration**\u2003\u2003\u{1F4B0} **Strike**\u2003\u2003\u{1F4B5} **Option Price**\n`;
  desc += `${expiry}\u2003\u2003\u2003${strike} ${right}\u2003\u2003\u2003${fmtPrice(optionPrice)}\n\n`;

  desc += `\u{1F4CB} **Trade Plan**\n`;
  desc += `\u{1F7E2} Targets: ${fmtPrice(tp.t1)} (${fmtPct(entryPrice, tp.t1)})`;
  if (tp.t2) desc += `, ${fmtPrice(tp.t2)} (${fmtPct(entryPrice, tp.t2)})`;
  desc += `\n`;
  desc += `\u{1F534} Stop Loss: ${fmtPrice(stopPrice)}(${stopPct}%)\n\n`;

  desc += `\u{1F525} **Take Profit Plan**\n`;
  desc += `Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.\n`;
  if (tp.t2) {
    desc += `Take Profit (2): At T2 take off remaining 50.0% of position.\n`;
  }

  desc += `\n\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;

  const embed: DiscordEmbed = {
    title: `\u{1F6A8} ${signal.ticker} Trade Alert`,
    description: desc,
    color: biasColor(tp.bias),
    footer: { text: "SITU GOAT Trader \u2022 Options Alert" },
    timestamp: new Date().toISOString(),
  };

  const content = `@everyone`;
  return sendWebhook(DISCORD_GOAT_ALERTS_URL, content, [embed]);
}

export async function postLetfAlert(signal: Signal, trade?: IbkrTrade): Promise<boolean> {
  const DISCORD_GOAT_SWINGS_URL = await getWebhookUrl("swings");
  if (!DISCORD_GOAT_SWINGS_URL) return false;

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  const letfData = signal.leveragedEtfJson as any;
  if (!letfData) return false;

  const biasLabel = tp.bias === "BUY" ? "BULLISH" : "BEARISH";
  const letfTicker = letfData.ticker || signal.instrumentTicker || "?";
  const leverage = letfData.leverage ?? "?";
  const direction = letfData.direction ?? "?";
  const entryPrice = signal.entryPriceAtActivation ?? 0;
  const stopPrice = signal.stopPrice ?? 0;
  const letfEntry = trade?.entryPrice ?? 0;

  const stopPct = entryPrice > 0 ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1) : "?";

  let desc = `\u{1F7E2} **Ticker**\u2003\u2003\u2003\u2003\u2003\u{1F4C8} **Stock Price**\n`;
  desc += `${signal.ticker}\u2003\u2003\u2003\u2003\u2003\u2003\u2003${fmtPrice(entryPrice)}\n\n`;

  desc += `\u{1F4B9} **LETF**\u2003\u2003\u2003\u2003\u2003\u{1F4CA} **Direction**\n`;
  desc += `${letfTicker} (${leverage}x)\u2003\u2003\u2003${direction}\n\n`;

  desc += `\u{1F4CB} **Trade Plan (Underlying)**\n`;
  desc += `\u{1F7E2} Entry: ${fmtPrice(entryPrice)}\n`;
  desc += `\u{1F7E2} T1: ${fmtPrice(tp.t1)} (${fmtPct(entryPrice, tp.t1)})\n`;
  if (tp.t2) desc += `\u{1F7E2} T2: ${fmtPrice(tp.t2)} (${fmtPct(entryPrice, tp.t2)})\n`;
  desc += `\u{1F534} Stop: ${fmtPrice(stopPrice)} (${stopPct}%)\n`;
  desc += `R:R: ${tp.riskReward?.toFixed(1) ?? "?"}\n\n`;

  if (letfEntry > 0) {
    desc += `\u{1F4B0} **LETF Entry**: ${fmtPrice(letfEntry)}\n\n`;
  }

  desc += `\u{1F525} **Take Profit Plan**\n`;
  desc += `Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.\n`;
  if (tp.t2) {
    desc += `Take Profit (2): At T2 take off remaining 50.0% of position.\n`;
  }

  desc += `\n\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;

  const embed: DiscordEmbed = {
    title: `\u{1F6A8} ${signal.ticker} \u2192 ${letfTicker} Swing Alert`,
    description: desc,
    color: biasColor(tp.bias),
    footer: { text: "SITU GOAT Trader \u2022 Swing Alert" },
    timestamp: new Date().toISOString(),
  };

  const content = `@everyone`;
  return sendWebhook(DISCORD_GOAT_SWINGS_URL, content, [embed]);
}

export async function postTradeUpdate(signal: Signal, trade: IbkrTrade, event: string): Promise<boolean> {
  const isOption = trade.instrumentType === "OPTION";
  const url = await getWebhookUrl(isOption ? "alerts" : "swings");
  if (!url) return false;

  const tp = signal.tradePlanJson as TradePlan;
  const optData = signal.optionsJson as any;
  const strike = optData?.candidate?.strike ?? "";
  const expiry = optData?.candidate?.expiry ?? "";
  const right = optData?.candidate?.right === "C" ? "CALL" : optData?.candidate?.right === "P" ? "PUT" : "";
  const instrument = trade.instrumentTicker || signal.ticker;
  const dateLabel = fmtDate();

  let color = BLUE;
  let title = "";
  let desc = "";

  switch (event) {
    case "FILLED": {
      color = GREEN;
      title = `\u2705 ${signal.ticker} Entry Filled \u2014 ${dateLabel}`;
      desc = `\u{1F4CA} **Trade Performance:**\n`;
      desc += `Ticker: ${signal.ticker}\n\n`;
      desc += `\u{1F7E2} **Status: Entry Filled** \u{1F7E2}\n\n`;
      if (trade.entryPrice) {
        desc += `\u2705 **Entry**\u2003\u2003\u{1F4B5} **Price**\n`;
        desc += `${fmtPrice(trade.entryPrice)}\u2003\u2003\u2003${fmtPrice(trade.entryPrice)}\n\n`;
      }
      if (strike && expiry) {
        desc += `\u274C **Expiration**\u2003\u{1F4B0} **Strike**\u2003\u{1F4C8} **Price**\n`;
        desc += `${expiry}\u2003\u2003\u2003${strike} ${right}\u2003\u2003${fmtPrice(trade.entryPrice)}\n\n`;
      }
      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
      break;
    }

    case "TP1_HIT": {
      color = CYAN;
      title = `\u{1F3AF} ${signal.ticker} Take Profit 1 HIT \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const profitPct = entry > 0 ? fmtPct(entry, tp1Fill) : "?";

      desc = `\u{1F4CA} **Trade Performance:**\n`;
      desc += `Ticker: ${signal.ticker}\n\n`;

      desc += `\u{1F7E9} **Entry (Stock)**\u2003\u2705 **Entry**\u2003\u2003\u{1F3AF} **TP1 Hit**\n`;
      desc += `${fmtPrice(entry)}\u2003\u2003\u2003\u2003\u2003${fmtPrice(entry)}\u2003\u2003\u2003${fmtPrice(tp1Fill)}\n\n`;

      desc += `\u{1F4B0} **Profit**\n`;
      desc += `${profitPct}\n\n`;

      desc += `\u{1F6A8} **Status: TP1 Zone Reached** \u{1F6A8}\n\n`;

      desc += `\u{1F7E3} **Position Management:**\n`;
      const tp1Qty = Math.max(1, Math.floor(trade.originalQuantity / 2));
      desc += `\u{1F534} Reduce position by 50% (lock in ${profitPct} on half)\n`;
      if (tp?.t2) {
        desc += `\u{1F7E2} Let remaining 50% ride to TP2 (${fmtPrice(tp.t2)})\n\n`;
      } else {
        desc += `\n`;
      }

      desc += `\u{1F534} **Risk Management:**\n`;
      desc += `Raising stop loss to ${fmtPrice(entry)} (break even) on final 50% runner position to secure gains while allowing room to run.\n\n`;

      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
      break;
    }

    case "TP2_HIT": {
      color = PURPLE;
      title = `\u{1F3AF} ${signal.ticker} Take Profit 2 HIT \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const tp2Fill = trade.tp2FillPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const profitPct = entry > 0 ? fmtPct(entry, tp2Fill) : "?";
      const tp1Pct = entry > 0 ? fmtPct(entry, tp1Fill) : "?";

      desc = `\u{1F4CA} **Trade Performance:**\n`;
      desc += `Ticker: ${signal.ticker}\n\n`;

      desc += `\u{1F6A8} **Status: Position Closed** \u{1F6A8}\n\n`;

      desc += `\u{1F7E2} **Strategy Executed:**\n`;
      desc += `\u2705 Full Exit (100%) : ${fmtPrice(tp2Fill)} (${profitPct})\n`;
      desc += `\u{1F534} TP1 (50%): ${fmtPrice(tp1Fill)} (${tp1Pct})\n`;
      desc += `\u{1F534} TP2 (50%): ${fmtPrice(tp2Fill)} (${profitPct})\n`;
      const avgExit = (tp1Fill + tp2Fill) / 2;
      const avgPct = entry > 0 ? fmtPct(entry, avgExit) : "?";
      desc += `Average exit: ${fmtPrice(avgExit)} (${avgPct} blended)\n\n`;

      desc += `\u{1F7E9} **Entry (Stock)**\u2003\u2705 **Entry**\u2003\u2003\u{1F3AF} **TP2 Hit**\n`;
      desc += `${fmtPrice(entry)}\u2003\u2003\u2003\u2003\u2003${fmtPrice(entry)}\u2003\u2003\u2003${fmtPrice(tp2Fill)}\n\n`;

      desc += `\u{1F4B0} **Profit**\n`;
      desc += `${profitPct}\n\n`;

      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
      break;
    }

    case "STOPPED_OUT": {
      color = RED;
      title = `\u{1F6D1} ${signal.ticker} Stop Loss HIT \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const lossPct = entry > 0 ? fmtPct(entry, exitPrice) : "?";
      const optionPrice = entry;

      desc = `\u{1F4CA} **Trade Performance:**\n`;
      desc += `Ticker: ${signal.ticker}\n\n`;

      desc += `\u{1F6A8} **Status: Stop Loss Triggered** \u{1F6A8}\n\n`;

      desc += `\u{1F7E2} **Strategy Executed:**\n`;
      desc += `\u2705 Stop Loss Exit (100%) : ${fmtPrice(exitPrice)} (${lossPct})\n`;
      desc += `\u{1F534} Average exit: ${fmtPrice(exitPrice)} (${lossPct} blended)\n\n`;

      if (strike && expiry) {
        desc += `\u274C **Expiration**\u2003\u{1F4B0} **Strike**\u2003\u{1F4C8} **Price**\n`;
        desc += `${expiry}\u2003\u2003\u2003${strike} ${right}\u2003\u2003${fmtPrice(optionPrice)}\n\n`;
      }

      desc += `\u2705 **Entry**\u2003\u2003\u{1F6D1} **Stop Loss Hit**\u2003\u{1F4B0} **Profit**\n`;
      desc += `${fmtPrice(entry)}\u2003\u2003\u2003${fmtPrice(exitPrice)}\u2003\u2003\u2003\u2003\u2003${lossPct}\n\n`;

      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
      break;
    }

    case "STOPPED_OUT_AFTER_TP": {
      color = ORANGE;
      title = `\u{1F504} ${signal.ticker} Stopped at BE \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const tp1Pct = entry > 0 ? fmtPct(entry, tp1Fill) : "?";

      desc = `\u{1F4CA} **Trade Performance:**\n`;
      desc += `Ticker: ${signal.ticker}\n\n`;

      desc += `\u{1F6A8} **Status: Stopped at Break Even (after TP1)** \u{1F6A8}\n\n`;

      desc += `\u{1F7E2} **Strategy Executed:**\n`;
      desc += `\u2705 TP1 (50%): ${fmtPrice(tp1Fill)} (${tp1Pct})\n`;
      desc += `\u{1F534} Runner stopped at BE: ${fmtPrice(exitPrice)}\n`;
      desc += `TP1 P&L (banked): ${fmtPnl(trade.tp1PnlRealized)}\n\n`;

      desc += `\u2705 **Entry**\u2003\u2003\u{1F6D1} **BE Stop**\u2003\u{1F4B0} **Profit**\n`;
      desc += `${fmtPrice(entry)}\u2003\u2003\u2003${fmtPrice(exitPrice)}\u2003\u2003\u2003\u2003${tp1Pct} (TP1 only)\n\n`;

      desc += `Stopped at break-even after taking partial profit at TP1.\n\n`;

      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
      break;
    }

    case "CLOSED": {
      color = trade.pnl && trade.pnl > 0 ? GREEN : RED;
      const emoji = trade.pnl && trade.pnl > 0 ? "\u{1F4B0}" : "\u{1F4C9}";
      title = `${emoji} ${signal.ticker} Trade Closed \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const pnlPct = entry > 0 && exitPrice > 0 ? fmtPct(entry, exitPrice) : "?";

      desc = `\u{1F4CA} **Trade Performance:**\n`;
      desc += `Ticker: ${signal.ticker}\n\n`;

      desc += `\u{1F6A8} **Status: Position Closed** \u{1F6A8}\n\n`;

      desc += `\u2705 **Entry**\u2003\u2003\u{1F3C1} **Exit**\u2003\u2003\u{1F4B0} **Profit**\n`;
      desc += `${fmtPrice(entry)}\u2003\u2003\u2003${fmtPrice(exitPrice)}\u2003\u2003\u2003${pnlPct}\n\n`;

      if (trade.pnl != null) {
        desc += `Total P&L: ${fmtPnl(trade.pnl)}\n`;
        desc += `R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}\n\n`;
      }

      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
      break;
    }

    case "BE_STOP": {
      color = GOLD;
      title = `\u{1F512} ${signal.ticker} Stop \u2192 Break Even \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;

      desc = `\u{1F4CA} **Trade Update:**\n`;
      desc += `Ticker: ${signal.ticker}\n\n`;

      desc += `\u{1F7E2} **Status: Stop Moved to Break Even** \u{1F7E2}\n\n`;

      desc += `\u{1F534} **Risk Management:**\n`;
      desc += `Stop loss raised to ${fmtPrice(entry)} (break even) to secure gains while allowing room to run.\n\n`;

      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
      break;
    }

    default: {
      title = `\u{1F4DD} ${signal.ticker} Trade Update \u2014 ${dateLabel}`;
      desc = `Event: ${event}\n`;
      desc += `Instrument: ${instrument}\n\n`;
      desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;
    }
  }

  const embed: DiscordEmbed = {
    title,
    description: desc,
    color,
    footer: { text: "SITU GOAT Trader \u2022 Trade Update" },
    timestamp: new Date().toISOString(),
  };

  const content = `@everyone`;
  return sendWebhook(url, content, [embed]);
}
