import { log } from "../index";
import { storage } from "../storage";
import type { Signal, TradePlan, IbkrTrade } from "@shared/schema";

async function getWebhookUrl(channel: "alerts" | "swings"): Promise<string | undefined> {
  const settingKey = channel === "alerts" ? "discordGoatAlertsWebhook" : "discordGoatSwingsWebhook";
  const envKey = channel === "alerts" ? "DISCORD_GOAT_ALERTS_WEBHOOK" : "DISCORD_GOAT_SWINGS_WEBHOOK";
  const fromDb = await storage.getSetting(settingKey);
  return fromDb || process.env[envKey] || undefined;
}

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: DiscordField[];
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
  const entryPrice = trade?.entryPrice ?? signal.entryPriceAtActivation ?? 0;
  const stopPrice = trade?.stopPrice ?? signal.stopPrice ?? 0;

  const t1Pct = fmtPct(entryPrice, tp.t1);
  const stopPct = entryPrice > 0 ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1) : "?";

  let targetsStr = `${fmtPrice(tp.t1)} (${t1Pct})`;
  if (tp.t2) targetsStr += `, ${fmtPrice(tp.t2)} (${fmtPct(entryPrice, tp.t2)})`;

  let tpPlanText = `Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2) {
    tpPlanText += `\nTake Profit (2): At T2 take off remaining 50.0% of position.`;
  }

  const fields: DiscordField[] = [
    { name: `\u{1F7E2} **Ticker**`, value: `${signal.ticker}`, inline: true },
    { name: `\u{1F4CA} **Stock Price**`, value: `$ ${entryPrice.toFixed(2)}`, inline: true },
    { name: `\u2716\uFE0F **Expiration**`, value: `${expiry}`, inline: true },
    { name: `\u270D\uFE0F **Strike**`, value: `${strike} ${right}`, inline: true },
    { name: `\u{1F4B5} **Option Price**`, value: `$ ${optionPrice.toFixed(2)}`, inline: true },
    { name: `\u{1F4DD} **Trade Plan**`, value: `\u{1F3AF} Targets: ${targetsStr}\n\u{1F534} Stop Loss: ${fmtPrice(stopPrice)}(${stopPct}%)`, inline: false },
    { name: `\u{1F525} **Take Profit Plan**`, value: `${tpPlanText}\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
  ];

  const embed: DiscordEmbed = {
    title: `\u{1F6A8} ${signal.ticker} Trade Alert`,
    color: biasColor(tp.bias),
    fields,
    footer: { text: "SITU GOAT Trader \u2022 Options Alert" },
    timestamp: new Date().toISOString(),
  };

  return sendWebhook(DISCORD_GOAT_ALERTS_URL, `@everyone`, [embed]);
}

export async function postLetfAlert(signal: Signal, trade?: IbkrTrade): Promise<boolean> {
  const DISCORD_GOAT_SWINGS_URL = await getWebhookUrl("swings");
  if (!DISCORD_GOAT_SWINGS_URL) return false;

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  const letfData = signal.leveragedEtfJson as any;
  if (!letfData) return false;

  const letfTicker = letfData.ticker || signal.instrumentTicker || "?";
  const leverage = letfData.leverage ?? "?";
  const direction = letfData.direction ?? "?";
  const entryPrice = signal.entryPriceAtActivation ?? 0;
  const stopPrice = signal.stopPrice ?? 0;
  const letfEntry = trade?.entryPrice ?? 0;
  const stopPct = entryPrice > 0 ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1) : "?";

  let planText = `\u{1F7E2} Entry: ${fmtPrice(entryPrice)}\n`;
  planText += `\u{1F3AF} T1: ${fmtPrice(tp.t1)} (${fmtPct(entryPrice, tp.t1)})\n`;
  if (tp.t2) planText += `\u{1F3AF} T2: ${fmtPrice(tp.t2)} (${fmtPct(entryPrice, tp.t2)})\n`;
  planText += `\u{1F534} Stop: ${fmtPrice(stopPrice)} (${stopPct}%)\nR:R: ${tp.riskReward?.toFixed(1) ?? "?"}`;
  if (letfEntry > 0) planText += `\n\u{1F4B0} LETF Entry: ${fmtPrice(letfEntry)}`;

  let tpText = `Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2) tpText += `\nTake Profit (2): At T2 take off remaining 50.0% of position.`;
  tpText += `\n\nDisclaimer: Not financial advice. Trade at your own risk.`;

  const fields: DiscordField[] = [
    { name: `\u{1F7E2} **Ticker**`, value: `${signal.ticker}`, inline: true },
    { name: `\u{1F4CA} **Stock Price**`, value: `$ ${entryPrice.toFixed(2)}`, inline: true },
    { name: `\u{1F4B9} **LETF**`, value: `${letfTicker} (${leverage}x)`, inline: true },
    { name: `\u{1F4CA} **Direction**`, value: `${direction}`, inline: true },
    { name: `\u{1F4DD} **Trade Plan (Underlying)**`, value: planText, inline: false },
    { name: `\u{1F525} **Take Profit Plan**`, value: tpText, inline: false },
  ];

  const embed: DiscordEmbed = {
    title: `\u{1F6A8} ${signal.ticker} \u2192 ${letfTicker} Swing Alert`,
    color: biasColor(tp.bias),
    fields,
    footer: { text: "SITU GOAT Trader \u2022 Swing Alert" },
    timestamp: new Date().toISOString(),
  };

  return sendWebhook(DISCORD_GOAT_SWINGS_URL, `@everyone`, [embed]);
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
  const dateLabel = fmtDate();

  let color = BLUE;
  let title = "";
  const fields: DiscordField[] = [];

  switch (event) {
    case "FILLED": {
      color = GREEN;
      title = `\u2705 ${signal.ticker} Entry Filled \u2014 ${dateLabel}`;

      fields.push(
        { name: `\u{1F7E2} Trade Performance:`, value: `Ticker: ${signal.ticker}`, inline: false },
        { name: `\u{1F7E2} Status: Entry Filled \u{1F7E2}`, value: `\u200b`, inline: false },
      );

      if (trade.entryPrice && strike && expiry) {
        fields.push(
          { name: `\u2716\uFE0F **Expiration**`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F **Strike**`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} **Price**`, value: `${fmtPrice(trade.entryPrice)}`, inline: true },
        );
      }

      fields.push(
        { name: `\u200b`, value: `Disclaimer: Not financial advice. Trade at your own risk.`, inline: false },
      );
      break;
    }

    case "TP1_HIT": {
      color = CYAN;
      title = `\u{1F3AF} ${signal.ticker} Take Profit 1 HIT \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const profitPct = entry > 0 ? fmtPct(entry, tp1Fill) : "?";

      fields.push(
        { name: `\u{1F7E2} Trade Performance:`, value: `Ticker: ${signal.ticker}`, inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u2716\uFE0F **Expiration**`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F **Strike**`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} **Price**`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { name: `\u2705 **Entry**`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F3AF} **TP1 Hit**`, value: `${fmtPrice(tp1Fill)}`, inline: true },
        { name: `\u{1F4B0} **Profit**`, value: `${profitPct}`, inline: true },
      );

      fields.push(
        { name: `\u{1F6A8} Status: TP1 Zone Reached \u{1F6A8}`, value: `\u200b`, inline: false },
      );

      let posMgmt = `\u2705 Reduce position by 50% (lock in ${profitPct} on half)`;
      if (tp?.t2) {
        posMgmt += `\n\u{1F3AF} Let remaining 50% ride to TP2 (${fmtPrice(tp.t2)})`;
      }
      fields.push(
        { name: `\u{1F50D} Position Management:`, value: posMgmt, inline: false },
        { name: `\u{1F6E1}\uFE0F Risk Management:`, value: `Raising stop loss to ${fmtPrice(entry)} (break even) on final 50% runner position to secure gains while allowing room to run.\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
      );
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
      const avgExit = (tp1Fill + tp2Fill) / 2;
      const avgPct = entry > 0 ? fmtPct(entry, avgExit) : "?";

      fields.push(
        { name: `\u{1F7E2} Trade Performance:`, value: `Ticker: ${signal.ticker}`, inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u2716\uFE0F **Expiration**`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F **Strike**`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} **Price**`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { name: `\u2705 **Entry**`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F3AF} **TP2 Hit**`, value: `${fmtPrice(tp2Fill)}`, inline: true },
        { name: `\u{1F4B0} **Profit**`, value: `${profitPct}`, inline: true },
        { name: `\u{1F6A8} Status: Position Closed \u{1F6A8}`, value: `\u200b`, inline: false },
        { name: `\u{1F7E2} Strategy Executed:`, value: `\u2705 Full Exit (100%): ${fmtPrice(tp2Fill)} (${profitPct})\n\u{1F534} TP1 (50%): ${fmtPrice(tp1Fill)} (${tp1Pct})\n\u{1F534} TP2 (50%): ${fmtPrice(tp2Fill)} (${profitPct})\nAverage exit: ${fmtPrice(avgExit)} (${avgPct} blended)\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
      );
      break;
    }

    case "STOPPED_OUT": {
      color = RED;
      title = `\u{1F6D1} ${signal.ticker} Stop Loss HIT \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const lossPct = entry > 0 ? fmtPct(entry, exitPrice) : "?";

      fields.push(
        { name: `\u{1F7E2} Trade Performance:`, value: `Ticker: ${signal.ticker}`, inline: false },
        { name: `\u{1F6A8} Status: Stop Loss Triggered \u{1F6A8}`, value: `\u200b`, inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u2716\uFE0F **Expiration**`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F **Strike**`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} **Price**`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { name: `\u2705 **Entry**`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F6D1} **Stop Loss Hit**`, value: `${fmtPrice(exitPrice)}`, inline: true },
        { name: `\u{1F4B0} **Profit**`, value: `${lossPct}`, inline: true },
        { name: `\u{1F7E2} Strategy Executed:`, value: `\u2705 Stop Loss Exit (100%): ${fmtPrice(exitPrice)} (${lossPct})\n\u{1F534} Average exit: ${fmtPrice(exitPrice)} (${lossPct} blended)\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
      );
      break;
    }

    case "STOPPED_OUT_AFTER_TP": {
      color = ORANGE;
      title = `\u{1F504} ${signal.ticker} Stopped at BE \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const tp1Pct = entry > 0 ? fmtPct(entry, tp1Fill) : "?";

      fields.push(
        { name: `\u{1F7E2} Trade Performance:`, value: `Ticker: ${signal.ticker}`, inline: false },
        { name: `\u{1F6A8} Status: Stopped at BE (after TP1) \u{1F6A8}`, value: `\u200b`, inline: false },
        { name: `\u2705 **Entry**`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F6D1} **BE Stop**`, value: `${fmtPrice(exitPrice)}`, inline: true },
        { name: `\u{1F4B0} **Profit**`, value: `${tp1Pct} (TP1 only)`, inline: true },
        { name: `\u{1F7E2} Strategy Executed:`, value: `\u2705 TP1 (50%): ${fmtPrice(tp1Fill)} (${tp1Pct})\n\u{1F534} Runner stopped at BE: ${fmtPrice(exitPrice)}\nTP1 P&L (banked): ${fmtPnl(trade.tp1PnlRealized)}\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
      );
      break;
    }

    case "CLOSED": {
      color = trade.pnl && trade.pnl > 0 ? GREEN : RED;
      const emoji = trade.pnl && trade.pnl > 0 ? "\u{1F4B0}" : "\u{1F4C9}";
      title = `${emoji} ${signal.ticker} Trade Closed \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const pnlPct = entry > 0 && exitPrice > 0 ? fmtPct(entry, exitPrice) : "\u2014";

      fields.push(
        { name: `\u{1F7E2} Trade Performance:`, value: `Ticker: ${signal.ticker}`, inline: false },
        { name: `\u{1F6A8} Status: Position Closed \u{1F6A8}`, value: `\u200b`, inline: false },
        { name: `\u2705 **Entry**`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F3C1} **Exit**`, value: `${fmtPrice(exitPrice)}`, inline: true },
        { name: `\u{1F4B0} **Profit**`, value: `${pnlPct}`, inline: true },
      );

      if (trade.pnl != null) {
        fields.push(
          { name: `Total P&L: ${fmtPnl(trade.pnl)}`, value: `R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
        );
      } else {
        fields.push(
          { name: `\u200b`, value: `Disclaimer: Not financial advice. Trade at your own risk.`, inline: false },
        );
      }
      break;
    }

    case "BE_STOP": {
      color = GOLD;
      title = `\u{1F512} ${signal.ticker} Stop \u2192 Break Even \u2014 ${dateLabel}`;
      const entry = trade.entryPrice ?? 0;

      fields.push(
        { name: `\u{1F7E2} Trade Update:`, value: `Ticker: ${signal.ticker}`, inline: false },
        { name: `\u{1F7E2} Status: Stop Moved to Break Even \u{1F7E2}`, value: `\u200b`, inline: false },
        { name: `\u{1F534} Risk Management:`, value: `Raising stop loss to ${fmtPrice(entry)} (break even) to secure gains while allowing room to run.\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
      );
      break;
    }

    default: {
      title = `\u{1F4DD} ${signal.ticker} Trade Update \u2014 ${dateLabel}`;
      fields.push(
        { name: `Event: ${event}`, value: `Instrument: ${trade.instrumentTicker || signal.ticker}\n\nDisclaimer: Not financial advice. Trade at your own risk.`, inline: false },
      );
    }
  }

  const embed: DiscordEmbed = {
    title,
    color,
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: "SITU GOAT Trader \u2022 Trade Update" },
    timestamp: new Date().toISOString(),
  };

  return sendWebhook(url, `@everyone`, [embed]);
}
