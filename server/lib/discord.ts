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
  fields: Array<{ name: string; value: string; inline?: boolean }>;
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

function biasColor(bias: string): number {
  return bias === "BUY" ? GREEN : RED;
}

function tierEmoji(tier: string): string {
  switch (tier) {
    case "APLUS": return "🔥";
    case "A": return "⭐";
    case "B": return "✅";
    default: return "📊";
  }
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

  const emoji = tierEmoji(signal.tier);
  const biasLabel = tp.bias === "BUY" ? "BULLISH" : "BEARISH";

  const embed: DiscordEmbed = {
    title: `${emoji} ${signal.ticker} — ${biasLabel} ${right}`,
    color: biasColor(tp.bias),
    fields: [
      { name: "Setup", value: signal.setupType, inline: true },
      { name: "Tier", value: signal.tier === "APLUS" ? "A+" : signal.tier, inline: true },
      { name: "Quality", value: `${signal.qualityScore}/100`, inline: true },
      { name: "Contract", value: contractSymbol, inline: false },
      { name: "Strike / Expiry", value: `$${strike} ${right} — ${expiry}`, inline: false },
      { name: "Entry", value: `$${signal.entryPriceAtActivation?.toFixed(2) ?? "MKT"}`, inline: true },
      { name: "Stop", value: `$${tp.stopDistance ? (signal.entryPriceAtActivation ? (tp.bias === "BUY" ? signal.entryPriceAtActivation - tp.stopDistance : signal.entryPriceAtActivation + tp.stopDistance) : "?").toString() : "?"}`, inline: true },
      { name: "T1", value: `$${tp.t1?.toFixed(2)}`, inline: true },
      { name: "T2", value: tp.t2 ? `$${tp.t2.toFixed(2)}` : "—", inline: true },
      { name: "R:R", value: tp.riskReward?.toFixed(1) ?? "?", inline: true },
    ],
    footer: { text: "SITU GOAT Trader • Options Alert" },
    timestamp: new Date().toISOString(),
  };

  if (trade) {
    embed.fields.push(
      { name: "IBKR Order", value: `#${trade.ibkrOrderId ?? "pending"}`, inline: true },
      { name: "Qty", value: `${trade.quantity}`, inline: true },
    );
  }

  const content = `**🐐 GOAT Alert — ${signal.ticker}** ${tp.bias === "BUY" ? "🟢" : "🔴"}`;
  return sendWebhook(DISCORD_GOAT_ALERTS_URL, content, [embed]);
}

export async function postLetfAlert(signal: Signal, trade?: IbkrTrade): Promise<boolean> {
  const DISCORD_GOAT_SWINGS_URL = await getWebhookUrl("swings");
  if (!DISCORD_GOAT_SWINGS_URL) return false;

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  const letfData = signal.leveragedEtfJson as any;
  if (!letfData) return false;

  const emoji = tierEmoji(signal.tier);
  const biasLabel = tp.bias === "BUY" ? "BULLISH" : "BEARISH";
  const letfTicker = letfData.ticker || signal.instrumentTicker || "?";
  const leverage = letfData.leverage ?? "?";
  const direction = letfData.direction ?? "?";

  const embed: DiscordEmbed = {
    title: `${emoji} ${signal.ticker} → ${letfTicker} (${leverage}x ${direction})`,
    description: `${biasLabel} via Leveraged ETF`,
    color: biasColor(tp.bias),
    fields: [
      { name: "Setup", value: signal.setupType, inline: true },
      { name: "Tier", value: signal.tier === "APLUS" ? "A+" : signal.tier, inline: true },
      { name: "Quality", value: `${signal.qualityScore}/100`, inline: true },
      { name: "Underlying", value: signal.ticker, inline: true },
      { name: "LETF", value: `${letfTicker} (${leverage}x)`, inline: true },
      { name: "Direction", value: direction, inline: true },
      { name: "Underlying Entry", value: `$${signal.entryPriceAtActivation?.toFixed(2) ?? "MKT"}`, inline: true },
      { name: "T1 (Underlying)", value: `$${tp.t1?.toFixed(2)}`, inline: true },
      { name: "T2 (Underlying)", value: tp.t2 ? `$${tp.t2.toFixed(2)}` : "—", inline: true },
      { name: "Stop (Underlying)", value: `$${signal.stopPrice?.toFixed(2) ?? "?"}`, inline: true },
      { name: "R:R", value: tp.riskReward?.toFixed(1) ?? "?", inline: true },
    ],
    footer: { text: "SITU GOAT Trader • Swing Alert" },
    timestamp: new Date().toISOString(),
  };

  if (trade) {
    embed.fields.push(
      { name: "IBKR Order", value: `#${trade.ibkrOrderId ?? "pending"}`, inline: true },
      { name: "Qty", value: `${trade.quantity}`, inline: true },
      { name: "LETF Entry", value: `$${trade.entryPrice?.toFixed(2) ?? "MKT"}`, inline: true },
    );
  }

  const content = `**🐐 GOAT Swing — ${signal.ticker} → ${letfTicker}** ${tp.bias === "BUY" ? "🟢" : "🔴"}`;
  return sendWebhook(DISCORD_GOAT_SWINGS_URL, content, [embed]);
}

export async function postTradeUpdate(signal: Signal, trade: IbkrTrade, event: string): Promise<boolean> {
  const isOption = trade.instrumentType === "OPTION";
  const url = await getWebhookUrl(isOption ? "alerts" : "swings");
  if (!url) return false;

  let color = BLUE;
  let emoji = "📝";

  switch (event) {
    case "FILLED":
      color = GREEN;
      emoji = "✅";
      break;
    case "STOPPED_OUT":
      color = RED;
      emoji = "🛑";
      break;
    case "TP1_HIT":
      color = GREEN;
      emoji = "🎯";
      break;
    case "TP2_HIT":
      color = PURPLE;
      emoji = "🏆";
      break;
    case "CLOSED":
      color = trade.pnl && trade.pnl > 0 ? GREEN : RED;
      emoji = trade.pnl && trade.pnl > 0 ? "💰" : "📉";
      break;
    case "BE_STOP":
      color = ORANGE;
      emoji = "🔄";
      break;
  }

  const embed: DiscordEmbed = {
    title: `${emoji} ${event.replace("_", " ")} — ${signal.ticker}`,
    color,
    fields: [
      { name: "Instrument", value: trade.instrumentTicker || signal.ticker, inline: true },
      { name: "Side", value: trade.side, inline: true },
      { name: "Qty", value: `${trade.quantity}`, inline: true },
    ],
    footer: { text: "SITU GOAT Trader • Trade Update" },
    timestamp: new Date().toISOString(),
  };

  if (trade.entryPrice) {
    embed.fields.push({ name: "Entry", value: `$${trade.entryPrice.toFixed(2)}`, inline: true });
  }
  if (trade.pnl != null) {
    embed.fields.push(
      { name: "P&L", value: `$${trade.pnl.toFixed(2)}`, inline: true },
      { name: "R", value: trade.rMultiple?.toFixed(2) ?? "?", inline: true },
    );
  }

  return sendWebhook(url, `**${emoji} ${event.replace("_", " ")}** — ${signal.ticker}`, [embed]);
}
