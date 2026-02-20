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
  if (p == null) return "—";
  return `$${p.toFixed(2)}`;
}

function fmtPnl(pnl: number | null | undefined): string {
  if (pnl == null) return "—";
  const prefix = pnl >= 0 ? "+" : "";
  return `${prefix}$${pnl.toFixed(2)}`;
}

function fmtPct(entry: number, target: number): string {
  if (!entry || entry === 0) return "";
  const pct = ((target - entry) / entry) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `(${sign}${pct.toFixed(1)}%)`;
}

export async function postOptionsAlert(signal: Signal, trade?: IbkrTrade): Promise<boolean> {
  const DISCORD_GOAT_ALERTS_URL = await getWebhookUrl("alerts");
  if (!DISCORD_GOAT_ALERTS_URL) return false;

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  const optData = signal.optionsJson as any;
  const contractSymbol = optData?.candidate?.contractSymbol || signal.optionContractTicker || "N/A";
  const strike = optData?.candidate?.strike ?? "?";
  const expiry = optData?.candidate?.expiry ?? "?";
  const right = optData?.candidate?.right === "C" ? "CALL" : "PUT";

  const biasLabel = tp.bias === "BUY" ? "BULLISH" : "BEARISH";
  const entryPrice = trade?.entryPrice ?? signal.entryPriceAtActivation ?? 0;
  const stopPrice = trade?.stopPrice ?? signal.stopPrice ?? 0;
  const optionPrice = signal.optionEntryMark ?? (trade?.entryPrice) ?? 0;
  const tierLabel = signal.tier === "APLUS" ? "A+" : signal.tier;

  const stopPct = entryPrice > 0 ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1) : "?";

  let desc = `**${signal.ticker} Trade Alert**\n\n`;
  desc += `\u{1F7E2} **Ticker**\u2003\u2003\u2003\u2003\u2003\u{1F4C8} **Stock Price**\n`;
  desc += `${signal.ticker}\u2003\u2003\u2003\u2003\u2003\u2003\u2003${fmtPrice(entryPrice)}\n\n`;
  desc += `\u274C **Expiration**\u2003\u2003\u{1F4B0} **Strike**\u2003\u2003\u{1F4B5} **Option Price**\n`;
  desc += `${expiry}\u2003\u2003\u2003${strike} ${right}\u2003\u2003\u2003${fmtPrice(optionPrice)}\n\n`;
  desc += `\u{1F4CB} **Trade Plan**\n`;
  desc += `\u{1F7E2} Targets: ${fmtPrice(tp.t1)} ${fmtPct(entryPrice, tp.t1)}`;
  if (tp.t2) desc += `, ${fmtPrice(tp.t2)} ${fmtPct(entryPrice, tp.t2)}`;
  desc += `\n`;
  desc += `\u{1F534} Stop Loss: ${fmtPrice(stopPrice)} (${stopPct}%)\n\n`;
  desc += `\u{1F525} **Take Profit Plan**\n`;
  desc += `Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.\n`;
  if (tp.t2) {
    desc += `Take Profit (2): At T2 take off remaining 50.0% of position.\n`;
  }
  desc += `\n`;
  desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;

  const embed: DiscordEmbed = {
    title: `\u{1F410} ${signal.ticker} — ${biasLabel} ${right}`,
    description: desc,
    color: biasColor(tp.bias),
    fields: [
      { name: "Setup", value: signal.setupType, inline: true },
      { name: "Tier", value: tierLabel, inline: true },
      { name: "Quality", value: `${signal.qualityScore}/100`, inline: true },
    ],
    footer: { text: "SITU GOAT Trader \u2022 Options Alert" },
    timestamp: new Date().toISOString(),
  };

  if (trade) {
    embed.fields!.push(
      { name: "IBKR Order", value: `#${trade.ibkrOrderId ?? "pending"}`, inline: true },
      { name: "Qty", value: `${trade.quantity}`, inline: true },
    );
  }

  const content = `**\u{1F410} GOAT Alert \u2014 ${signal.ticker}** ${tp.bias === "BUY" ? "\u{1F7E2}" : "\u{1F534}"}`;
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
  const tierLabel = signal.tier === "APLUS" ? "A+" : signal.tier;
  const entryPrice = signal.entryPriceAtActivation ?? 0;
  const stopPrice = signal.stopPrice ?? 0;
  const letfEntry = trade?.entryPrice ?? 0;

  const stopPct = entryPrice > 0 ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1) : "?";

  let desc = `**${signal.ticker} \u2192 ${letfTicker} Swing Trade**\n`;
  desc += `${biasLabel} via ${leverage}x Leveraged ETF\n\n`;
  desc += `\u{1F7E2} **Underlying**\u2003\u2003\u{1F4B9} **LETF**\u2003\u2003\u{1F4CA} **Direction**\n`;
  desc += `${signal.ticker}\u2003\u2003\u2003\u2003\u2003\u2003${letfTicker} (${leverage}x)\u2003\u2003${direction}\n\n`;
  desc += `\u{1F4CB} **Trade Plan (Underlying)**\n`;
  desc += `\u{1F7E2} Entry: ${fmtPrice(entryPrice)}\n`;
  desc += `\u{1F7E2} T1: ${fmtPrice(tp.t1)} ${fmtPct(entryPrice, tp.t1)}\n`;
  if (tp.t2) desc += `\u{1F7E2} T2: ${fmtPrice(tp.t2)} ${fmtPct(entryPrice, tp.t2)}\n`;
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
  desc += `\n`;
  desc += `\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;

  const embed: DiscordEmbed = {
    title: `\u{1F410} ${signal.ticker} \u2192 ${letfTicker} (${leverage}x ${direction})`,
    description: desc,
    color: biasColor(tp.bias),
    fields: [
      { name: "Setup", value: signal.setupType, inline: true },
      { name: "Tier", value: tierLabel, inline: true },
      { name: "Quality", value: `${signal.qualityScore}/100`, inline: true },
    ],
    footer: { text: "SITU GOAT Trader \u2022 Swing Alert" },
    timestamp: new Date().toISOString(),
  };

  if (trade) {
    embed.fields!.push(
      { name: "IBKR Order", value: `#${trade.ibkrOrderId ?? "pending"}`, inline: true },
      { name: "Qty", value: `${trade.quantity}`, inline: true },
    );
  }

  const content = `**\u{1F410} GOAT Swing \u2014 ${signal.ticker} \u2192 ${letfTicker}** ${tp.bias === "BUY" ? "\u{1F7E2}" : "\u{1F534}"}`;
  return sendWebhook(DISCORD_GOAT_SWINGS_URL, content, [embed]);
}

export async function postTradeUpdate(signal: Signal, trade: IbkrTrade, event: string): Promise<boolean> {
  const isOption = trade.instrumentType === "OPTION";
  const url = await getWebhookUrl(isOption ? "alerts" : "swings");
  if (!url) return false;

  const tp = signal.tradePlanJson as TradePlan;

  let color = BLUE;
  let headerEmoji = "\u{1F4DD}";
  let title = "";

  switch (event) {
    case "FILLED":
      color = GREEN;
      headerEmoji = "\u2705";
      title = `Entry Filled \u2014 ${signal.ticker}`;
      break;
    case "TP1_HIT":
      color = CYAN;
      headerEmoji = "\u{1F3AF}";
      title = `TP1 Hit \u2014 ${signal.ticker} (Partial Close)`;
      break;
    case "TP2_HIT":
      color = PURPLE;
      headerEmoji = "\u{1F3C6}";
      title = `TP2 Hit \u2014 ${signal.ticker} (Full Close)`;
      break;
    case "STOPPED_OUT":
      color = RED;
      headerEmoji = "\u{1F6D1}";
      title = `Stopped Out \u2014 ${signal.ticker}`;
      break;
    case "STOPPED_OUT_AFTER_TP":
      color = ORANGE;
      headerEmoji = "\u{1F504}";
      title = `Stopped at BE \u2014 ${signal.ticker} (After TP1)`;
      break;
    case "CLOSED":
      color = trade.pnl && trade.pnl > 0 ? GREEN : RED;
      headerEmoji = trade.pnl && trade.pnl > 0 ? "\u{1F4B0}" : "\u{1F4C9}";
      title = `Trade Closed \u2014 ${signal.ticker}`;
      break;
    case "BE_STOP":
      color = GOLD;
      headerEmoji = "\u{1F512}";
      title = `Stop \u2192 Break Even \u2014 ${signal.ticker}`;
      break;
  }

  const instrument = trade.instrumentTicker || signal.ticker;
  let desc = `**${title}**\n\n`;
  desc += `\u{1F4CA} **Instrument**\u2003${instrument}\n`;
  desc += `\u{1F4CD} **Side**\u2003${trade.side}\u2003\u2003**Qty**\u2003${trade.originalQuantity}\n`;

  if (trade.entryPrice) {
    desc += `\u{1F4B5} **Entry**\u2003${fmtPrice(trade.entryPrice)}\n`;
  }

  if (event === "TP1_HIT") {
    const tp1Qty = Math.max(1, Math.floor(trade.originalQuantity / 2));
    desc += `\n\u{1F3AF} **TP1 Details**\n`;
    desc += `Fill Price: ${fmtPrice(trade.tp1FillPrice)}\n`;
    desc += `Qty Closed: ${tp1Qty}\n`;
    desc += `TP1 P&L: ${fmtPnl(trade.tp1PnlRealized)}\n`;
    desc += `Remaining: ${trade.remainingQuantity}\n`;
    desc += `Stop Moved: \u2192 BE (${fmtPrice(trade.entryPrice)})\n`;
    if (tp?.t2) {
      desc += `Next Target: TP2 ${fmtPrice(tp.t2)}\n`;
    }
  }

  if (event === "TP2_HIT") {
    desc += `\n\u{1F3C6} **TP2 Details**\n`;
    desc += `Fill Price: ${fmtPrice(trade.tp2FillPrice)}\n`;
    desc += `Total P&L: ${fmtPnl(trade.pnl)}\n`;
    desc += `R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}\n`;
    if (trade.pnl && trade.pnl > 0) {
      desc += `\n\u{1F7E2} Full target achieved!\n`;
    }
  }

  if (event === "STOPPED_OUT" || event === "STOPPED_OUT_AFTER_TP") {
    desc += `\n\u{1F6D1} **Exit Details**\n`;
    desc += `Exit Price: ${fmtPrice(trade.exitPrice)}\n`;
    desc += `Total P&L: ${fmtPnl(trade.pnl)}\n`;
    desc += `R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}\n`;
    if (event === "STOPPED_OUT_AFTER_TP") {
      desc += `TP1 P&L (banked): ${fmtPnl(trade.tp1PnlRealized)}\n`;
      desc += `\nStopped at break-even after taking partial profit at TP1.\n`;
    }
  }

  if (event === "CLOSED") {
    desc += `\n\u{1F4B0} **Close Details**\n`;
    if (trade.exitPrice) {
      desc += `Exit Price: ${fmtPrice(trade.exitPrice)}\n`;
    }
    if (trade.pnl != null) {
      desc += `Total P&L: ${fmtPnl(trade.pnl)}\n`;
      desc += `R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}\n`;
    }
  }

  desc += `\n\u26A0\uFE0F Disclaimer: Not financial advice. Trade at your own risk.`;

  const embed: DiscordEmbed = {
    title: `${headerEmoji} ${title}`,
    description: desc,
    color,
    footer: { text: "SITU GOAT Trader \u2022 Trade Update" },
    timestamp: new Date().toISOString(),
  };

  const channelLabel = isOption ? "GOAT Alert" : "GOAT Swing";
  const content = `**${headerEmoji} ${event.replace(/_/g, " ")}** \u2014 ${signal.ticker} | ${channelLabel}`;
  return sendWebhook(url, content, [embed]);
}
