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
const BLURPLE = 0x5865f2;

const SPACER: DiscordField = { name: "", value: "\u200b", inline: false };
const DISCLAIMER = "Disclaimer: Not financial advice. Trade at your own risk.";

function biasColor(bias: string): number {
  return bias === "BUY" ? BLURPLE : BLURPLE;
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
    { name: `\u{1F7E2} Ticker: ${signal.ticker}`, value: "", inline: false },
    { ...SPACER },
    { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
    { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
    { name: `\u{1F4B5} Price`, value: `$${optionPrice.toFixed(2)}`, inline: true },
    { ...SPACER },
    { name: `\u{1F4DD} **Game Plan**`, value: "", inline: false },
    { name: `\u{1F3AF} Targets: ${targetsStr}`, value: "", inline: false },
    { name: `\u{1F6D1} Stop Loss: ${fmtPrice(stopPrice)} (${stopPct}%)`, value: "", inline: false },
    { ...SPACER },
    { name: `\u{1F4B0} **Trade Detail**`, value: tpPlanText, inline: false },
    { ...SPACER },
    { name: `\u26A0\uFE0F Risk Management`, value: `1. Control Position Size\n2. Do your own due diligence. This is not a suggestion to buy, sell or hold`, inline: false },
  ];

  const embed: DiscordEmbed = {
    title: `\u{1F6A8} ${signal.ticker} Trade Alert`,
    color: BLURPLE,
    fields,
    footer: { text: DISCLAIMER },
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

  let targetsStr = `${fmtPrice(tp.t1)} (${fmtPct(entryPrice, tp.t1)})`;
  if (tp.t2) targetsStr += `, ${fmtPrice(tp.t2)} (${fmtPct(entryPrice, tp.t2)})`;

  let tpPlanText = `Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2) tpPlanText += `\nTake Profit (2): At T2 take off remaining 50.0% of position.`;

  const fields: DiscordField[] = [
    { name: `\u{1F7E2} Ticker: ${signal.ticker}`, value: "", inline: false },
    { name: `\u{1F4B9} LETF: ${letfTicker} (${leverage}x ${direction})`, value: "", inline: false },
    { ...SPACER },
    { name: `\u{1F4CA} Stock Price`, value: `$${entryPrice.toFixed(2)}`, inline: true },
    { name: `\u{1F4B0} LETF Entry`, value: letfEntry > 0 ? `$${letfEntry.toFixed(2)}` : "Pending", inline: true },
    { name: `\u{1F534} Stop`, value: `${fmtPrice(stopPrice)} (${stopPct}%)`, inline: true },
    { ...SPACER },
    { name: `\u{1F4DD} **Game Plan**`, value: "", inline: false },
    { name: `\u{1F3AF} Targets: ${targetsStr}`, value: "", inline: false },
    { name: `\u{1F6D1} Stop Loss: ${fmtPrice(stopPrice)} (${stopPct}%)`, value: "", inline: false },
    { ...SPACER },
    { name: `\u{1F4B0} **Trade Detail**`, value: tpPlanText, inline: false },
    { ...SPACER },
    { name: `\u26A0\uFE0F Risk Management`, value: `1. Control Position Size\n2. Do your own due diligence. This is not a suggestion to buy, sell or hold`, inline: false },
  ];

  const embed: DiscordEmbed = {
    title: `\u{1F6A8} ${signal.ticker} \u2192 ${letfTicker} Swing Alert`,
    color: BLURPLE,
    fields,
    footer: { text: DISCLAIMER },
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

  let color = BLUE;
  let title = "";
  const fields: DiscordField[] = [];

  switch (event) {
    case "FILLED": {
      color = BLURPLE;
      title = `\u{1F6A8} ${signal.ticker} Trade Alert`;

      const tpData = signal.tradePlanJson as any;
      const entryPx = trade.entryPrice ?? signal.entryPriceAtActivation ?? 0;
      const stopPx = trade.stopPrice ?? signal.stopPrice ?? 0;
      const optionPx = signal.optionEntryMark ?? trade.entryPrice ?? 0;
      const stopPctFill = entryPx > 0 ? (((stopPx - entryPx) / entryPx) * 100).toFixed(1) : "?";

      let targetsLine = "";
      if (tpData) {
        const t1 = tpData.t1 ?? 0;
        const t2 = tpData.t2 ?? 0;
        const t3 = tpData.t3 ?? 0;
        const t1Pct = entryPx > 0 ? fmtPct(entryPx, t1) : "?";
        targetsLine = `${fmtPrice(t1)} (${t1Pct})`;
        if (t2) targetsLine += `, ${fmtPrice(t2)} (${fmtPct(entryPx, t2)})`;
        if (t3) targetsLine += `, ${fmtPrice(t3)} (${fmtPct(entryPx, t3)})`;
      }

      let tpPlanText = `Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.`;
      if (tpData?.t2) tpPlanText += `\nTake Profit (2): At T2 take off 50.0% of remaining position.`;
      if (tpData?.t3) tpPlanText += `\nTake Profit (3): At T3 take off 50.0% of remaining position.`;

      fields.push(
        { name: `\u{1F7E2} Ticker: ${signal.ticker}`, value: "", inline: false },
        { ...SPACER },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} Price`, value: `$${optionPx.toFixed(2)}`, inline: true },
          { ...SPACER },
        );
      }

      fields.push(
        { name: `\u{1F4DD} **Game Plan**`, value: "", inline: false },
        { name: `\u{1F3AF} Targets: ${targetsLine}`, value: "", inline: false },
        { name: `\u{1F6D1} Stop Loss: ${fmtPrice(stopPx)} (${stopPctFill}%)`, value: "", inline: false },
        { ...SPACER },
        { name: `\u{1F4B0} **Trade Detail**`, value: tpPlanText, inline: false },
        { ...SPACER },
        { name: `\u26A0\uFE0F Risk Management`, value: `1. Control Position Size\n2. Do your own due diligence. This is not a suggestion to buy, sell or hold`, inline: false },
      );
      break;
    }

    case "TP1_HIT": {
      color = GREEN;
      title = `\u{1F3AF} ${signal.ticker} Take Profit HIT`;
      const entry = trade.entryPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const profitPct = entry > 0 ? fmtPct(entry, tp1Fill) : "?";

      fields.push(
        { name: `Ticker: ${signal.ticker}`, value: "", inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} Price`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { ...SPACER },
        { name: `\u2705 Entry`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F3AF} TP Hit`, value: `${fmtPrice(tp1Fill)}`, inline: true },
        { name: `\u{1F4B8} Profit`, value: `${profitPct}`, inline: true },
        { ...SPACER },
        { name: `\u{1F6A8} __Status: TP Reached__ \u{1F6A8}`, value: "", inline: false },
        { ...SPACER },
        { name: `\u{1F50D} Position Management:`, value: "", inline: false },
        { name: `\u2705 Reduce position by 50% (lock in profit)`, value: "", inline: false },
      );

      if (tp?.t2) {
        fields.push(
          { name: `\u{1F3AF} Let remaining 50% ride to TP2 (${fmtPrice(tp.t2)})`, value: "", inline: false },
        );
      }

      fields.push(
        { ...SPACER },
        { name: `\u{1F6E1}\uFE0F Risk Management`, value: `Raising stop loss to ${fmtPrice(entry)} (break even) on remaining position to secure gains while allowing room to run.`, inline: false },
      );
      break;
    }

    case "TP2_HIT": {
      color = GREEN;
      title = `\u{1F3AF} ${signal.ticker} Take Profit 2 HIT`;
      const entry = trade.entryPrice ?? 0;
      const tp2Fill = trade.tp2FillPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const profitPct = entry > 0 ? fmtPct(entry, tp2Fill) : "?";

      fields.push(
        { name: `Ticker: ${signal.ticker}`, value: "", inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} Price`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { ...SPACER },
        { name: `\u2705 Entry`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F3AF} TP2 Hit`, value: `${fmtPrice(tp2Fill)}`, inline: true },
        { name: `\u{1F4B8} Profit`, value: `${profitPct}`, inline: true },
        { ...SPACER },
        { name: `\u{1F6A8} __Status: TP2 Reached__ \u{1F6A8}`, value: "", inline: false },
        { ...SPACER },
        { name: `\u{1F50D} Position Management:`, value: "", inline: false },
        { name: `\u2705 Reduce position by 50% of remaining (lock in ${profitPct})`, value: "", inline: false },
        { name: `\u{1F3AF} Set trailing stop on remaining runners`, value: "", inline: false },
        { ...SPACER },
        { name: `\u{1F6E1}\uFE0F Risk Management`, value: `Raising stop loss to ${fmtPrice(tp1Fill)} (TP1 level) on remaining position. Locking in gains while allowing room to run.`, inline: false },
      );
      break;
    }

    case "TP3_HIT": {
      color = GREEN;
      title = `\u{1F3AF} ${signal.ticker} Take Profit 3 HIT`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? trade.tp2FillPrice ?? 0;
      const profitPct = entry > 0 ? fmtPct(entry, exitPrice) : "?";

      fields.push(
        { name: `Ticker: ${signal.ticker}`, value: "", inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} Price`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { ...SPACER },
        { name: `\u2705 Entry`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F3AF} TP3 Hit`, value: `${fmtPrice(exitPrice)}`, inline: true },
        { name: `\u{1F4B8} Profit`, value: `${profitPct}`, inline: true },
        { ...SPACER },
        { name: `\u{1F6A8} __Status: Position Closed__ \u{1F6A8}`, value: "", inline: false },
        { ...SPACER },
        { name: `\u{1F50D} Position Management:`, value: "", inline: false },
        { name: `\u2705 Full exit \u2014 all targets reached`, value: "", inline: false },
      );
      break;
    }

    case "STOPPED_OUT": {
      color = RED;
      title = `\u{1F6D1} ${signal.ticker} Stop Loss HIT`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const lossPct = entry > 0 ? fmtPct(entry, exitPrice) : "?";

      fields.push(
        { name: `Ticker: ${signal.ticker}`, value: "", inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} Price`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { ...SPACER },
        { name: `\u2705 Entry`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F6D1} Stop Hit`, value: `${fmtPrice(exitPrice)}`, inline: true },
        { name: `\u{1F4B8} Result`, value: `${lossPct}`, inline: true },
        { ...SPACER },
        { name: `\u{1F6A8} __Status: Position Closed__ \u{1F6A8}`, value: "\u200b", inline: false },
        { name: `\u{1F6E1}\uFE0F Discipline Matters: Following the plan keeps you in the game for winning trades`, value: "", inline: false },
      );
      break;
    }

    case "STOPPED_OUT_AFTER_TP": {
      color = ORANGE;
      title = `\u{1F504} ${signal.ticker} Stopped at BE`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const tp1Pct = entry > 0 ? fmtPct(entry, tp1Fill) : "?";

      fields.push(
        { name: `Ticker: ${signal.ticker}`, value: "", inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} Price`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { ...SPACER },
        { name: `\u2705 Entry`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F6D1} BE Stop`, value: `${fmtPrice(exitPrice)}`, inline: true },
        { name: `\u{1F4B8} Profit`, value: `${tp1Pct} (TP1 only)`, inline: true },
        { ...SPACER },
        { name: `\u{1F6A8} __Status: Stopped at BE (after TP1)__ \u{1F6A8}`, value: "\u200b", inline: false },
        { name: `\u{1F6E1}\uFE0F Discipline Matters: Following the plan keeps you in the game for winning trades`, value: "", inline: false },
      );

      if (trade.tp1PnlRealized != null) {
        fields.push(
          { name: `\u{1F4B0} TP1 P&L (banked): ${fmtPnl(trade.tp1PnlRealized)}`, value: "", inline: false },
        );
      }
      break;
    }

    case "CLOSED": {
      color = trade.pnl && trade.pnl > 0 ? GREEN : RED;
      title = trade.pnl && trade.pnl > 0 ? `\u{1F4B0} ${signal.ticker} Trade Closed` : `\u{1F4C9} ${signal.ticker} Trade Closed`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const pnlPct = entry > 0 && exitPrice > 0 ? fmtPct(entry, exitPrice) : "\u2014";

      fields.push(
        { name: `Ticker: ${signal.ticker}`, value: "", inline: false },
      );

      if (strike && expiry) {
        fields.push(
          { name: `\u274C Expiration`, value: `${expiry}`, inline: true },
          { name: `\u270D\uFE0F Strike`, value: `${strike} ${right}`, inline: true },
          { name: `\u{1F4B5} Price`, value: `${fmtPrice(entry)}`, inline: true },
        );
      }

      fields.push(
        { ...SPACER },
        { name: `\u2705 Entry`, value: `${fmtPrice(entry)}`, inline: true },
        { name: `\u{1F3C1} Exit`, value: `${fmtPrice(exitPrice)}`, inline: true },
        { name: `\u{1F4B8} Profit`, value: `${pnlPct}`, inline: true },
        { ...SPACER },
        { name: `\u{1F6A8} __Status: Position Closed__ \u{1F6A8}`, value: "\u200b", inline: false },
      );

      if (trade.pnl != null) {
        fields.push(
          { name: `Total P&L: ${fmtPnl(trade.pnl)} | R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}`, value: "", inline: false },
        );
      }
      break;
    }

    case "BE_STOP": {
      color = GOLD;
      title = `\u{1F512} ${signal.ticker} Stop \u2192 Break Even`;
      const entry = trade.entryPrice ?? 0;

      fields.push(
        { name: `Ticker: ${signal.ticker}`, value: "", inline: false },
        { ...SPACER },
        { name: `\u{1F6A8} __Status: Stop Moved to Break Even__ \u{1F6A8}`, value: "\u200b", inline: false },
        { name: `\u{1F6E1}\uFE0F Risk Management`, value: `Raising stop loss to ${fmtPrice(entry)} (break even) to secure gains while allowing room to run.`, inline: false },
      );
      break;
    }

    default: {
      title = `\u{1F4DD} ${signal.ticker} Trade Update`;
      fields.push(
        { name: `Event: ${event}`, value: `Instrument: ${trade.instrumentTicker || signal.ticker}`, inline: false },
      );
    }
  }

  const embed: DiscordEmbed = {
    title,
    color,
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: DISCLAIMER },
  };

  return sendWebhook(url, `@everyone`, [embed]);
}
