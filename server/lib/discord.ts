import { log } from "../log";
import type { Signal, TradePlan, IbkrTrade } from "@shared/schema";

async function getWebhookUrl(
  channel: "alerts" | "swings" | "shares" | "letf_options",
): Promise<string | undefined> {
  const envMap: Record<string, string> = {
    alerts: "DISCORD_GOAT_ALERTS_WEBHOOK",
    swings: "DISCORD_GOAT_SWINGS_WEBHOOK",
    shares: "DISCORD_GOAT_SHARES_WEBHOOK",
    letf_options: "DISCORD_GOAT_LETF_OPTIONS_WEBHOOK",
  };
  const settingMap: Record<string, string> = {
    alerts: "discordGoatAlertsWebhook",
    swings: "discordGoatSwingsWebhook",
    shares: "discordGoatSharesWebhook",
    letf_options: "discordGoatLetfOptionsWebhook",
  };
  const envKey = envMap[channel];
  try {
    const { storage } = await import("../storage");
    const fromDb = await storage.getSetting(settingMap[channel]);
    return fromDb || process.env[envKey] || undefined;
  } catch {
    return process.env[envKey] || undefined;
  }
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

function formatExpiry(raw: string): string {
  if (!raw || raw === "?") return "?";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(4, 6)}/${digits.slice(6, 8)}/${digits.slice(0, 4)}`;
  }
  if (digits.length === 6) {
    return `${digits.slice(2, 4)}/${digits.slice(4, 6)}/20${digits.slice(0, 2)}`;
  }
  return raw;
}

function parseContractTicker(ticker: string | null | undefined): {
  strike: number | null;
  expiry: string | null;
  right: "C" | "P" | null;
} {
  if (!ticker) return { strike: null, expiry: null, right: null };
  const match = ticker.match(/(\d{6})([CP])(\d{8})$/);
  if (!match) return { strike: null, expiry: null, right: null };
  const [, dateStr, rightChar, strikeStr] = match;
  return {
    expiry: dateStr,
    right: rightChar as "C" | "P",
    strike: parseInt(strikeStr, 10) / 1000,
  };
}

interface WebhookResult {
  success: boolean;
  messageId?: string;
  status: "sent" | "failed" | "rate_limited";
  error?: string;
}

async function sendWebhook(
  url: string,
  content: string,
  embeds: DiscordEmbed[],
  isRetry = false,
): Promise<WebhookResult> {
  if (!url) {
    log("Discord webhook URL not configured", "discord");
    return { success: false, status: "failed", error: "No webhook URL" };
  }

  try {
    const webhookUrl = url.includes("?") ? `${url}&wait=true` : `${url}?wait=true`;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds }),
    });

    if (res.status === 429 && !isRetry) {
      const body = await res.json().catch(() => ({}));
      const retryAfter = (body as { retry_after?: number }).retry_after ?? 1;
      log(`Discord rate limited, retrying after ${retryAfter}s`, "discord");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return sendWebhook(url, content, embeds, true);
    }

    if (!res.ok) {
      const body = await res.text();
      log(`Discord webhook failed: ${res.status} ${body}`, "discord");
      return { success: false, status: "failed", error: `${res.status} ${body}` };
    }

    let messageId: string | undefined;
    try {
      const body = await res.json();
      messageId = (body as { id?: string }).id;
    } catch {}

    log(`Discord webhook sent successfully${messageId ? ` (msg: ${messageId})` : ""}`, "discord");
    return { success: true, status: "sent", messageId };
  } catch (err: any) {
    log(`Discord webhook error: ${err.message}`, "discord");
    return { success: false, status: "failed", error: err.message };
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

const SPACER: DiscordField = { name: "\u200b", value: "", inline: false };
const DISCLAIMER = "Disclaimer: Not financial advice. Trade at your own risk.";

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

export async function postOptionsAlert(
  signalInput: Signal,
  trade?: IbkrTrade,
  alertsWebhookUrl?: string,
): Promise<boolean> {
  const DISCORD_GOAT_ALERTS_URL =
    alertsWebhookUrl ?? (await getWebhookUrl("alerts"));
  if (!DISCORD_GOAT_ALERTS_URL) return false;

  let signal = signalInput;
  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  let optData = signal.optionsJson as any;
  if (!optData?.candidate) {
    try {
      const { enrichPendingSignalsWithOptions } = await import("./options");
      await enrichPendingSignalsWithOptions({ force: true });
      const { storage } = await import("../storage");
      const freshSigs = await storage.getSignals(undefined, 1000);
      const freshSig = freshSigs.find((s) => s.id === signal.id);
      if (freshSig?.optionsJson) {
        optData = freshSig.optionsJson as any;
        signal = {
          ...signal,
          optionsJson: optData,
          optionContractTicker:
            freshSig.optionContractTicker ?? signal.optionContractTicker,
          optionEntryMark: freshSig.optionEntryMark ?? signal.optionEntryMark,
        };
      }
    } catch (err: any) {
      log(
        `postOptionsAlert: on-demand enrichment failed for signal ${signal.id}: ${err.message}`,
        "discord",
      );
    }
  }
  const parsed = parseContractTicker(
    signal.optionContractTicker || optData?.candidate?.contractSymbol,
  );
  const strike = optData?.candidate?.strike ?? parsed.strike ?? "?";
  const rawExpiry = optData?.candidate?.expiry ?? parsed.expiry ?? "?";
  const expiry = formatExpiry(String(rawExpiry));
  const rightVal = optData?.candidate?.right ?? parsed.right;
  const right = rightVal === "C" ? "CALL" : rightVal === "P" ? "PUT" : "?";
  const optionPrice = signal.optionEntryMark ?? trade?.entryPrice ?? 0;
  const stockPrice = signal.entryPriceAtActivation ?? 0;
  const stopPrice = trade?.stopPrice ?? signal.stopPrice ?? 0;

  const t1Pct = fmtPct(stockPrice, tp.t1);
  const stopPct =
    stockPrice > 0
      ? (((stopPrice - stockPrice) / stockPrice) * 100).toFixed(1)
      : "?";

  let targetsStr = `${fmtPrice(tp.t1)} (${t1Pct})`;
  if (tp.t2)
    targetsStr += `, ${fmtPrice(tp.t2)} (${fmtPct(stockPrice, tp.t2)})`;

  const t2Pct = tp.t2 ? fmtPct(stockPrice, tp.t2) : null;
  let tpPlanText = `Take Profit (1): At ${t1Pct} take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2) {
    tpPlanText += `\nTake Profit (2): At T1 close remaining 50%. This trade could reach ${fmtPrice(tp.t2)} but we close here — don't get greedy.`;
  }

  const fields: DiscordField[] = [
    {
      name: "\u{1F7E2} Ticker",
      value: `${signal.ticker}(${signal.ticker})`,
      inline: true,
    },
    {
      name: "\u{1F4CA} Stock Price",
      value: `$ ${stockPrice.toFixed(2)}`,
      inline: true,
    },
    { ...SPACER },
    { name: "\u274C Expiration", value: `${expiry}`, inline: true },
    { name: "\u270D\uFE0F Strike", value: `${strike} ${right}`, inline: true },
    {
      name: "\u{1F4B5} Option Price",
      value: `$ ${optionPrice.toFixed(2)}`,
      inline: true,
    },
    { ...SPACER },
    {
      name: "\u{1F4DD} Trade Plan",
      value: `\u{1F3AF} Targets: ${targetsStr}\n\u{1F6D1} Stop Loss: ${fmtPrice(stopPrice)}(${stopPct}%), ${fmtPrice(stockPrice)}(+0%)`,
      inline: false,
    },
    { ...SPACER },
    { name: "\u{1F4B0} Take Profit Plan", value: tpPlanText, inline: false },
  ];

  const embed: DiscordEmbed = {
    description: `**\u{1F6A8} ${signal.ticker} Trade Alert**`,
    color: GREEN,
    fields,
    footer: { text: DISCLAIMER },
  };

  const result = await sendWebhook(DISCORD_GOAT_ALERTS_URL, `@everyone`, [embed]);
  return result.success;
}

export async function postLetfAlert(
  signal: Signal,
  trade?: IbkrTrade,
  swingsWebhookUrl?: string,
): Promise<boolean> {
  const DISCORD_GOAT_SWINGS_URL =
    swingsWebhookUrl ?? (await getWebhookUrl("swings"));
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
  const stopPct =
    entryPrice > 0
      ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1)
      : "?";

  const t1Pct = fmtPct(entryPrice, tp.t1);
  let targetsStr = `${fmtPrice(tp.t1)} (${t1Pct})`;
  const t2Pct = tp.t2 ? fmtPct(entryPrice, tp.t2) : null;
  if (tp.t2) targetsStr += `, ${fmtPrice(tp.t2)} (${t2Pct})`;

  let tpPlanText = `Take Profit (1): At ${t1Pct} take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2)
    tpPlanText += `\nTake Profit (2): At T1 close remaining 50%. This trade could reach ${fmtPrice(tp.t2)} but we close here — don't get greedy.`;

  const fields: DiscordField[] = [
    { name: "\u{1F7E2} Ticker", value: `${signal.ticker}`, inline: true },
    {
      name: "\u{1F4CA} Stock Price",
      value: `$ ${entryPrice.toFixed(2)}`,
      inline: true,
    },
    {
      name: "\u{1F4B9} Leveraged ETF",
      value: `${letfTicker} (${leverage}x ${direction})`,
      inline: true,
    },
    { ...SPACER },
    {
      name: "\u{1F4B0} Leveraged ETF Entry",
      value: letfEntry > 0 ? `$ ${letfEntry.toFixed(2)}` : "Pending",
      inline: true,
    },
    {
      name: "\u{1F6D1} Stop",
      value: `${fmtPrice(stopPrice)} (${stopPct}%)`,
      inline: true,
    },
    { ...SPACER },
    {
      name: "\u{1F4DD} Trade Plan",
      value: `\u{1F3AF} Targets: ${targetsStr}\n\u{1F6D1} Stop Loss: ${fmtPrice(stopPrice)}(${stopPct}%)`,
      inline: false,
    },
    { ...SPACER },
    { name: "\u{1F4B0} Take Profit Plan", value: tpPlanText, inline: false },
  ];

  const embed: DiscordEmbed = {
    description: `**\u{1F6A8} ${signal.ticker} \u2192 ${letfTicker} Swing Alert**`,
    color: GREEN,
    fields,
    footer: { text: DISCLAIMER },
  };

  const result = await sendWebhook(DISCORD_GOAT_SWINGS_URL, `@everyone`, [embed]);
  return result.success;
}

export async function postSharesAlert(
  signal: Signal,
  trade?: IbkrTrade,
  sharesWebhookUrl?: string,
): Promise<boolean> {
  const DISCORD_GOAT_SHARES_URL =
    sharesWebhookUrl ?? (await getWebhookUrl("shares"));
  if (!DISCORD_GOAT_SHARES_URL) return false;

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  const entryPrice = trade?.entryPrice ?? signal.entryPriceAtActivation ?? 0;
  const stopPrice = trade?.stopPrice ?? signal.stopPrice ?? 0;
  const stopPct =
    entryPrice > 0
      ? (((stopPrice - entryPrice) / entryPrice) * 100).toFixed(1)
      : "?";

  const t1Pct = fmtPct(entryPrice, tp.t1);
  let targetsStr = `${fmtPrice(tp.t1)} (${t1Pct})`;
  if (tp.t2)
    targetsStr += `, ${fmtPrice(tp.t2)} (${fmtPct(entryPrice, tp.t2)})`;

  const t2Pct = tp.t2 ? fmtPct(entryPrice, tp.t2) : null;
  let tpPlanText = `Take Profit (1): At ${t1Pct} take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2) {
    tpPlanText += `\nTake Profit (2): At T1 close remaining 50%. This trade could reach ${fmtPrice(tp.t2)} but we close here — don't get greedy.`;
  }

  const fields: DiscordField[] = [
    {
      name: "\u{1F7E2} Ticker",
      value: `${signal.ticker}`,
      inline: true,
    },
    {
      name: "\u{1F4CA} Entry Price",
      value: `$ ${entryPrice.toFixed(2)}`,
      inline: true,
    },
    {
      name: "\u{1F4C8} Instrument",
      value: `Shares`,
      inline: true,
    },
    { ...SPACER },
    {
      name: "\u{1F4DD} Trade Plan",
      value: `\u{1F3AF} Targets: ${targetsStr}\n\u{1F6D1} Stop Loss: ${fmtPrice(stopPrice)}(${stopPct}%), ${fmtPrice(entryPrice)}(+0%)`,
      inline: false,
    },
    { ...SPACER },
    { name: "\u{1F4B0} Take Profit Plan", value: tpPlanText, inline: false },
  ];

  const embed: DiscordEmbed = {
    description: `**\u{1F6A8} ${signal.ticker} Shares Alert**`,
    color: GREEN,
    fields,
    footer: { text: DISCLAIMER },
  };

  const result = await sendWebhook(DISCORD_GOAT_SHARES_URL, `@everyone`, [embed]);
  return result.success;
}

export async function postLetfOptionsAlert(
  signal: Signal,
  trade?: IbkrTrade,
  letfOptionsWebhookUrl?: string,
  letfOptionContract?: {
    contractTicker: string;
    strike: number;
    expiry: string;
    right: "C" | "P";
    delta: number | null;
    markPrice: number;
  } | null,
): Promise<boolean> {
  const DISCORD_GOAT_LETF_OPTIONS_URL =
    letfOptionsWebhookUrl ?? (await getWebhookUrl("letf_options"));
  if (!DISCORD_GOAT_LETF_OPTIONS_URL) return false;

  const tp = signal.tradePlanJson as TradePlan;
  if (!tp) return false;

  const letfData = signal.leveragedEtfJson as any;
  if (!letfData) return false;

  const letfTicker = letfData.ticker || signal.instrumentTicker || "?";
  const leverage = letfData.leverage ?? "?";
  const direction = letfData.direction ?? "?";
  const stockEntry = signal.entryPriceAtActivation ?? 0;
  const stopPrice = signal.stopPrice ?? 0;

  const contractInfo = letfOptionContract;
  const optionPrice = contractInfo?.markPrice ?? trade?.entryPrice ?? 0;
  const strike = contractInfo?.strike ?? "?";
  const expiry = contractInfo?.expiry ? formatExpiry(String(contractInfo.expiry)) : "?";
  const right = contractInfo?.right === "C" ? "CALL" : contractInfo?.right === "P" ? "PUT" : "?";
  const delta = contractInfo?.delta;

  const letfEntry = signal.instrumentEntryPrice ?? 0;
  const letfStop = trade?.stopPrice ?? 0;
  const letfT1 = trade?.target1Price ?? 0;

  const stopPct =
    stockEntry > 0
      ? (((stopPrice - stockEntry) / stockEntry) * 100).toFixed(1)
      : "?";

  const t1Pct = fmtPct(stockEntry, tp.t1);
  let targetsStr = `${fmtPrice(tp.t1)} (${t1Pct})`;
  const t2Pct = tp.t2 ? fmtPct(stockEntry, tp.t2) : null;
  if (tp.t2) targetsStr += `, ${fmtPrice(tp.t2)} (${t2Pct})`;

  let tpPlanText = `Take Profit (1): At ${t1Pct} take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2)
    tpPlanText += `\nTake Profit (2): At T1 close remaining 50%. This trade could reach ${fmtPrice(tp.t2)} but we close here — don't get greedy.`;

  const fields: DiscordField[] = [
    { name: "\u{1F7E2} Underlying", value: `${signal.ticker}`, inline: true },
    {
      name: "\u{1F4B9} Leveraged ETF",
      value: `${letfTicker} (${leverage}x ${direction})`,
      inline: true,
    },
    {
      name: "\u{1F4CA} Stock Price",
      value: `$ ${stockEntry.toFixed(2)}`,
      inline: true,
    },
    { ...SPACER },
    { name: "\u274C Expiration", value: `${expiry}`, inline: true },
    { name: "\u270D\uFE0F Strike", value: `${strike} ${right}`, inline: true },
    {
      name: "\u{1F4B5} Option Price",
      value: `$ ${optionPrice.toFixed(2)}`,
      inline: true,
    },
    { ...SPACER },
    {
      name: "\u{1F4C8} Delta",
      value: delta != null ? delta.toFixed(3) : "?",
      inline: true,
    },
    {
      name: "\u{1F4B0} LETF Entry",
      value: letfEntry > 0 ? `$ ${letfEntry.toFixed(2)}` : "Pending",
      inline: true,
    },
    { ...SPACER },
    {
      name: "\u{1F4DD} Trade Plan (Stock Levels)",
      value: `\u{1F3AF} Targets: ${targetsStr}\n\u{1F6D1} Stop Loss: ${fmtPrice(stopPrice)}(${stopPct}%)`,
      inline: false,
    },
    { ...SPACER },
    { name: "\u{1F4B0} Take Profit Plan", value: tpPlanText, inline: false },
  ];

  const embed: DiscordEmbed = {
    description: `**\u{1F6A8} ${signal.ticker} \u2192 ${letfTicker} LETF Options Alert**`,
    color: PURPLE,
    fields,
    footer: { text: DISCLAIMER },
  };

  const result = await sendWebhook(DISCORD_GOAT_LETF_OPTIONS_URL, `@everyone`, [embed]);
  return result.success;
}

export async function postTradeUpdate(
  signalInput: Signal,
  trade: IbkrTrade,
  event: string,
  tradeUpdateWebhookUrl?: string,
): Promise<boolean> {
  const isOption = trade.instrumentType === "OPTION";
  const isLetfOptions = trade.instrumentType === "LETF_OPTIONS";
  const isLetf = trade.instrumentType === "LEVERAGED_ETF";
  const isShares = trade.instrumentType === "SHARES";
  const channelKey = isOption ? "alerts" : isLetfOptions ? "letf_options" : isShares ? "shares" : "swings";
  const url = tradeUpdateWebhookUrl ?? (await getWebhookUrl(channelKey));
  if (!url) return false;

  let signal = signalInput;
  const tp = signal.tradePlanJson as TradePlan;
  let optData = signal.optionsJson as any;
  if (isOption && !optData?.candidate) {
    try {
      const { enrichPendingSignalsWithOptions } = await import("./options");
      await enrichPendingSignalsWithOptions({ force: true });
      const { storage } = await import("../storage");
      const freshSigs = await storage.getSignals(undefined, 1000);
      const freshSig = freshSigs.find((s) => s.id === signal.id);
      if (freshSig?.optionsJson) {
        optData = freshSig.optionsJson as any;
        signal = {
          ...signal,
          optionsJson: optData,
          optionContractTicker:
            freshSig.optionContractTicker ?? signal.optionContractTicker,
          optionEntryMark: freshSig.optionEntryMark ?? signal.optionEntryMark,
        };
      }
    } catch (err: any) {
      log(
        `postTradeUpdate: on-demand enrichment failed for signal ${signal.id}: ${err.message}`,
        "discord",
      );
    }
  }
  const parsedContract = parseContractTicker(
    signal.optionContractTicker || optData?.candidate?.contractSymbol,
  );
  const strike = optData?.candidate?.strike ?? parsedContract.strike ?? "?";
  const rawExpiry = optData?.candidate?.expiry ?? parsedContract.expiry ?? "?";
  const expiry = formatExpiry(String(rawExpiry));
  const rightVal = optData?.candidate?.right ?? parsedContract.right;
  const right = rightVal === "C" ? "CALL" : rightVal === "P" ? "PUT" : "?";

  const letfData = signal.leveragedEtfJson as any;
  const letfTicker = letfData?.ticker || trade.instrumentTicker || "";
  const letfLeverage = letfData?.leverage ?? "";
  const letfDirection = letfData?.direction ?? "";
  const hasLetfInfo = isLetf && !!letfTicker;
  const letfDisplayLabel =
    letfLeverage && letfDirection
      ? `${letfTicker} (${letfLeverage}x ${letfDirection})`
      : letfTicker;

  function pushInstrumentFields(fields: DiscordField[], stockPx: number) {
    if (hasLetfInfo) {
      fields.push(
        {
          name: "\u{1F4B9} LETF",
          value: letfDisplayLabel,
          inline: true,
        },
        {
          name: "\u{1F4B5} LETF Entry",
          value: trade.entryPrice
            ? `$ ${trade.entryPrice.toFixed(2)}`
            : "Pending",
          inline: true,
        },
        {
          name: "\u{1F4CA} Stock Price",
          value: `$ ${stockPx.toFixed(2)}`,
          inline: true,
        },
      );
    } else if (isOption) {
      fields.push(
        { name: "\u274C Expiration", value: `${expiry}`, inline: true },
        {
          name: "\u270D\uFE0F Strike",
          value: `${strike} ${right}`,
          inline: true,
        },
        {
          name: "\u{1F4B5} Option Price",
          value: `$ ${(signal.optionEntryMark ?? trade.entryPrice ?? 0).toFixed(2)}`,
          inline: true,
        },
      );
    }
  }

  const mappedEvent = event === "STOPPED_OUT_AFTER_TP" ? "STOPPED_OUT" : event === "TIME_STOP" ? "RAISE_STOP" : event === "TP3_HIT" ? "CLOSED" : event;
  const instrumentTypeForTemplate = isLetfOptions ? "LETF_OPTIONS" : isOption ? "OPTIONS" : isLetf ? "LEVERAGED_ETF" : isShares ? "SHARES" : "OPTIONS";
  const TEMPLATE_EVENTS = ["FILLED", "TP1_HIT", "RAISE_STOP", "STOPPED_OUT", "CLOSED"];

  if (TEMPLATE_EVENTS.includes(mappedEvent)) {
    try {
      const { getTemplateForEvent, renderTemplate } = await import("./embedTemplateEngine");
      const template = await getTemplateForEvent(instrumentTypeForTemplate, mappedEvent);
      if (template) {
        const instrEntry = trade.entryPrice ?? 0;
        const instrStop = trade.stopPrice ?? 0;
        const instrT1 = trade.target1Price ?? 0;
        const instrT2 = trade.target2Price ?? 0;
        const stockPx = signal.entryPriceAtActivation ?? 0;
        const stopPctCalc = instrEntry > 0 ? (((instrStop - instrEntry) / instrEntry) * 100).toFixed(1) : "?";
        let targetsLineCalc = instrT1 > 0 ? `${fmtPrice(instrT1)} (${fmtPct(instrEntry, instrT1)})` : "";
        if (instrT2 > 0) targetsLineCalc += `, ${fmtPrice(instrT2)} (${fmtPct(instrEntry, instrT2)})`;
        const t1PctCalc = instrEntry > 0 && instrT1 > 0 ? fmtPct(instrEntry, instrT1) : "?";
        const t2PctCalc = instrT2 > 0 && instrEntry > 0 ? fmtPct(instrEntry, instrT2) : null;
        let tpPlanCalc = `Take Profit (1): At ${t1PctCalc} take off 50.0% of position and raise stop loss to break even.`;
        if (instrT2 > 0) tpPlanCalc += `\nTake Profit (2): At T1 close remaining 50%. This trade could reach ${fmtPrice(instrT2)} but we close here — don't get greedy.`;

        const exitPx = trade.exitPrice ?? trade.tp1FillPrice ?? trade.tp2FillPrice ?? 0;
        const profitPctCalc = instrEntry > 0 && exitPx > 0 ? fmtPct(instrEntry, exitPx) : "—";
        const isProfitable = trade.pnl != null ? trade.pnl > 0 : false;

        const vars: Record<string, string> = {
          "{{ticker}}": signal.ticker,
          "{{stock_price}}": stockPx.toFixed(2),
          "{{entry_price}}": fmtPrice(instrEntry),
          "{{stop_price}}": fmtPrice(instrStop),
          "{{stop_pct}}": stopPctCalc,
          "{{targets_line}}": targetsLineCalc,
          "{{tp_plan}}": tpPlanCalc,
          "{{expiry}}": expiry,
          "{{strike}}": String(strike),
          "{{right}}": right,
          "{{option_price}}": (signal.optionEntryMark ?? instrEntry).toFixed(2),
          "{{letf_ticker}}": letfTicker,
          "{{leverage}}": String(letfLeverage),
          "{{letf_direction}}": String(letfDirection),
          "{{tp1_fill_price}}": fmtPrice(trade.tp1FillPrice ?? instrT1),
          "{{tp2_fill_price}}": fmtPrice(trade.tp2FillPrice ?? instrT2),
          "{{t2_price}}": fmtPrice(instrT2),
          "{{profit_pct}}": profitPctCalc,
          "{{exit_price}}": fmtPrice(exitPx),
          "{{new_stop_price}}": fmtPrice(trade.stopPrice ?? instrEntry),
          "{{pnl_dollar}}": fmtPnl(trade.pnl),
          "{{r_multiple}}": trade.rMultiple?.toFixed(2) ?? "—",
          "{{tp2_rider_text}}": instrT2 > 0 ? `\n\u{1F3AF} Let remaining 50% ride to TP2 (${fmtPrice(instrT2)})` : "",
          "{{tp2_target_text}}": instrT2 > 0 ? `\n\u{1F3AF} Remaining target: TP2 at ${fmtPrice(instrT2)}` : "",
          "{{pnl_emoji}}": isProfitable ? "\u{1F4B0}" : "\u{1F4C9}",
          "{{pnl_color}}": isProfitable ? "#22c55e" : "#ef4444",
          "{{status_emoji}}": isProfitable ? "\u{1F7E2}" : "\u{1F6D1}",
        };

        const renderedEmbed = renderTemplate(template, vars);
        const webhookResult = await sendWebhook(url, `@everyone`, [renderedEmbed]);

        try {
          const { storage } = await import("../storage");
          await storage.insertDiscordTradeLog({
            tradeId: trade.id,
            signalId: signal.id,
            event,
            channel: channelKey,
            instrumentType: trade.instrumentType,
            instrumentTicker: trade.instrumentTicker ?? signal.ticker,
            ticker: signal.ticker,
            entryPrice: trade.entryPrice,
            targetPrice: trade.target1Price,
            stopPrice: trade.stopPrice,
            exitPrice: trade.exitPrice,
            profitPct: trade.pnlPct,
            embedJson: renderedEmbed,
            webhookStatus: webhookResult.status,
            discordMessageId: webhookResult.messageId ?? null,
            errorMessage: webhookResult.error ?? null,
          });
        } catch (logErr: any) {
          log(`Failed to log Discord trade (template): ${logErr.message}`, "discord");
        }

        return webhookResult.success;
      }
    } catch (tmplErr: any) {
      log(`Template rendering failed, falling back to hardcoded: ${tmplErr.message}`, "discord");
    }
  }

  let color = BLUE;
  let heading = "";
  const fields: DiscordField[] = [];
  const letfLabel = hasLetfInfo ? ` \u2192 ${letfTicker}` : "";

  switch (event) {
    case "FILLED": {
      color = GREEN;
      heading = hasLetfInfo
        ? `**\u{1F6A8} ${signal.ticker} \u2192 ${letfTicker} Swing Alert**`
        : isShares
          ? `**\u{1F6A8} ${signal.ticker} Shares Alert**`
          : `**\u{1F6A8} ${signal.ticker} Trade Alert**`;

      const instrEntry = trade.entryPrice ?? 0;
      const instrStop = trade.stopPrice ?? 0;
      const instrT1 = trade.target1Price ?? 0;
      const instrT2 = trade.target2Price ?? 0;
      const stockEntryRef = signal.entryPriceAtActivation ?? 0;
      const stopPctFill =
        instrEntry > 0 ? (((instrStop - instrEntry) / instrEntry) * 100).toFixed(1) : "?";

      let targetsLine = "";
      if (instrT1 > 0) {
        targetsLine = `${fmtPrice(instrT1)} (${fmtPct(instrEntry, instrT1)})`;
        if (instrT2 > 0) targetsLine += `, ${fmtPrice(instrT2)} (${fmtPct(instrEntry, instrT2)})`;
      }

      const t1PctFill = instrEntry > 0 && instrT1 > 0 ? fmtPct(instrEntry, instrT1) : "?";
      const t2PctFill = instrT2 > 0 && instrEntry > 0 ? fmtPct(instrEntry, instrT2) : null;
      let tpPlanText = `Take Profit (1): At ${t1PctFill} take off 50.0% of position and raise stop loss to break even.`;
      if (instrT2 > 0)
        tpPlanText += `\nTake Profit (2): At T1 close remaining 50%. This trade could reach ${fmtPrice(instrT2)} but we close here — don't get greedy.`;

      fields.push(
        { name: "\u{1F7E2} Ticker", value: `${signal.ticker}`, inline: true },
        {
          name: "\u{1F4CA} Stock Price",
          value: `$ ${stockEntryRef.toFixed(2)}`,
          inline: true,
        },
        { ...SPACER },
      );

      if (hasLetfInfo) {
        fields.push(
          { name: "\u{1F4B9} Leveraged ETF", value: letfDisplayLabel, inline: true },
          { name: "\u{1F4B5} Entry Price", value: `$ ${instrEntry.toFixed(2)}`, inline: true },
          { ...SPACER },
        );
      } else if (isOption && strike && expiry) {
        fields.push(
          { name: "\u274C Expiration", value: `${expiry}`, inline: true },
          { name: "\u270D\uFE0F Strike", value: `${strike} ${right}`, inline: true },
          { name: "\u{1F4B5} Option Entry", value: `$ ${instrEntry.toFixed(2)}`, inline: true },
          { ...SPACER },
        );
      }

      fields.push(
        {
          name: "\u{1F4DD} Trade Plan",
          value: `\u{1F3AF} Targets: ${targetsLine}\n\u{1F6D1} Stop Loss: ${fmtPrice(instrStop)} (${stopPctFill}%)`,
          inline: false,
        },
        { ...SPACER },
        { name: "\u{1F4B0} Take Profit Plan", value: tpPlanText, inline: false },
      );
      break;
    }

    case "TP1_HIT": {
      color = GREEN;
      heading = `**\u{1F3AF} ${signal.ticker}${letfLabel} Take Profit HIT**`;
      const instrEntry1 = trade.entryPrice ?? 0;
      const instrTp1Fill = trade.tp1FillPrice ?? 0;
      const profitPct1 = instrEntry1 > 0 ? fmtPct(instrEntry1, instrTp1Fill) : "?";

      fields.push({ name: `\u{1F7E2} Ticker: ${signal.ticker}`, value: `\u200b`, inline: false });
      pushInstrumentFields(fields, signal.entryPriceAtActivation ?? instrEntry1);

      fields.push(
        { name: "\u2705 Entry", value: `${fmtPrice(instrEntry1)}`, inline: true },
        { name: "\u{1F3AF} TP Hit", value: `${fmtPrice(instrTp1Fill)}`, inline: true },
        { name: "\u{1F4B8} Profit", value: `${profitPct1}`, inline: true },
        { ...SPACER },
        { name: "\u{1F6A8} Status: TP Reached \u{1F6A8}", value: "\u200b", inline: false },
        {
          name: "\u{1F50D} Position Management",
          value: `\u2705 Reduce position by 50% (lock in profit)${trade.target2Price ? `\n\u{1F3AF} Let remaining 50% ride to TP2 (${fmtPrice(trade.target2Price)})` : ""}`,
          inline: false,
        },
        { ...SPACER },
        {
          name: "\u{1F6E1}\uFE0F Risk Management",
          value: `Raising stop loss to ${fmtPrice(instrEntry1)} (break even) on remaining position to secure gains while allowing room to run.`,
          inline: false,
        },
      );
      break;
    }

    case "RAISE_STOP": {
      color = GOLD;
      heading = `**\u{1F6E1}\uFE0F ${signal.ticker}${letfLabel} Stop Loss Raised**`;
      const instrEntryRS = trade.entryPrice ?? 0;
      const instrNewStop = trade.stopPrice ?? instrEntryRS;

      fields.push({ name: `\u{1F7E0} Ticker: ${signal.ticker}`, value: `\u200b`, inline: false });
      pushInstrumentFields(fields, signal.entryPriceAtActivation ?? instrEntryRS);

      fields.push(
        { name: "\u2705 Entry", value: `${fmtPrice(instrEntryRS)}`, inline: true },
        { name: "\u{1F6E1}\uFE0F New Stop", value: `${fmtPrice(instrNewStop)} (Break Even)`, inline: true },
        { name: "\u{1F4B8} Risk", value: `0% (Risk-Free)`, inline: true },
        { ...SPACER },
        { name: "\u{1F6A8} Status: Stop Loss Raised to Break Even \u{1F6A8}", value: "", inline: false },
      );

      fields.push({
        name: "\u{1F6E1}\uFE0F Risk Management",
        value: `Stop loss raised to ${fmtPrice(instrNewStop)} (break even).\nTrade is now risk-free on remaining position.${trade.target2Price ? `\n\u{1F3AF} Remaining target: TP2 at ${fmtPrice(trade.target2Price)}` : ""}`,
        inline: false,
      });
      break;
    }

    case "TIME_STOP": {
      color = GOLD;
      heading = `**\u23F0 ${signal.ticker}${letfLabel} Time Stop Tightened**`;
      const instrEntryTS = trade.entryPrice ?? 0;
      const instrNewStopTS = trade.stopPrice ?? 0;
      const detailsTS = trade.detailsJson as any;
      const instrOldStop = detailsTS?.oldStopPrice ?? 0;

      fields.push({ name: `\u{1F7E0} Ticker: ${signal.ticker}`, value: `\u200b`, inline: false });
      pushInstrumentFields(fields, signal.entryPriceAtActivation ?? instrEntryTS);

      fields.push(
        { name: "\u2705 Entry", value: `${fmtPrice(instrEntryTS)}`, inline: true },
        { name: "\u{1F6E1}\uFE0F New Stop", value: `${fmtPrice(instrNewStopTS)}`, inline: true },
        { name: "\u{1F4B8} Risk", value: `${fmtPct(instrEntryTS, instrNewStopTS)}`, inline: true },
        { ...SPACER },
        { name: "\u{1F6A8} Status: Time Stop Activated \u{1F6A8}", value: "", inline: false },
      );

      const activeMins = signal.activatedTs
        ? Math.floor((Date.now() - new Date(signal.activatedTs).getTime()) / 60000)
        : 0;

      fields.push({
        name: "\u23F0 Time Stop Details",
        value: `Stop tightened after ${activeMins} minutes — insufficient movement toward target.\nOld stop: ${fmtPrice(instrOldStop)} → New stop: ${fmtPrice(instrNewStopTS)}${trade.target1Price ? `\n\u{1F3AF} Target: ${fmtPrice(trade.target1Price)}` : ""}`,
        inline: false,
      });
      break;
    }

    case "STOPPED_OUT": {
      color = RED;
      heading = `**\u{1F6D1} ${signal.ticker}${letfLabel} Stop Loss HIT**`;
      const instrEntrySO = trade.entryPrice ?? 0;
      const instrExitSO = trade.exitPrice ?? 0;
      const lossPct = instrEntrySO > 0 ? fmtPct(instrEntrySO, instrExitSO) : "?";

      fields.push({ name: `\u{1F6D1} Ticker: ${signal.ticker}`, value: `\u200b`, inline: false });
      pushInstrumentFields(fields, signal.entryPriceAtActivation ?? instrEntrySO);

      fields.push(
        { name: "\u2705 Entry", value: `${fmtPrice(instrEntrySO)}`, inline: true },
        { name: "\u{1F6D1} Stop Hit", value: `${fmtPrice(instrExitSO)}`, inline: true },
        { name: "\u{1F4B8} Result", value: `${lossPct}`, inline: true },
        { ...SPACER },
        { name: "\u{1F6A8} Status: Position Closed \u{1F6A8}", value: "\u200b", inline: false },
        { name: "\u{1F6E1}\uFE0F Discipline Matters", value: `Following the plan keeps you in the game for winning trades`, inline: false },
      );

      if (trade.pnl != null) {
        fields.push({
          name: "Total P&L",
          value: `${fmtPnl(trade.pnl)} | R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}`,
          inline: false,
        });
      }
      break;
    }

    case "STOPPED_OUT_AFTER_TP": {
      color = GOLD;
      heading = `**\u{1F504} ${signal.ticker}${letfLabel} Stopped at BE**`;
      const instrEntryBE = trade.entryPrice ?? 0;
      const instrTp1FillBE = trade.tp1FillPrice ?? 0;
      const tp1PctBE = instrEntryBE > 0 ? fmtPct(instrEntryBE, instrTp1FillBE) : "?";

      fields.push({ name: `\u{1F7E0} Ticker: ${signal.ticker}`, value: `\u200b`, inline: false });
      pushInstrumentFields(fields, signal.entryPriceAtActivation ?? instrEntryBE);

      fields.push(
        { name: "\u2705 Entry", value: `${fmtPrice(instrEntryBE)}`, inline: true },
        { name: "\u{1F6D1} BE Stop", value: `${fmtPrice(instrEntryBE)}`, inline: true },
        { name: "\u{1F4B8} Profit", value: `${tp1PctBE} (TP1 only)`, inline: true },
        { ...SPACER },
        { name: "\u{1F6A8} Status: Stopped at BE (after TP1) \u{1F6A8}", value: "\u200b", inline: false },
        { name: "\u{1F6E1}\uFE0F Discipline Matters", value: `Following the plan keeps you in the game for winning trades`, inline: false },
      );

      if (trade.tp1PnlRealized != null) {
        fields.push({
          name: "\u{1F4B0} TP1 P&L (banked)",
          value: `${fmtPnl(trade.tp1PnlRealized)}`,
          inline: false,
        });
      }
      break;
    }

    case "CLOSED": {
      const instrEntryClosed = trade.entryPrice ?? 0;
      const instrExitClosed = trade.exitPrice ?? 0;
      const instrT2Closed = trade.target2Price ?? 0;
      color = trade.pnl && trade.pnl > 0 ? GREEN : RED;
      const emoji = trade.pnl && trade.pnl > 0 ? "\u{1F4B0}" : "\u{1F4C9}";
      heading = `**${emoji} ${signal.ticker}${letfLabel} Trade Closed**`;
      const pnlPctClosed = instrEntryClosed > 0 && instrExitClosed > 0
        ? fmtPct(instrEntryClosed, instrExitClosed)
        : "\u2014";

      fields.push({
        name: `${trade.pnl && trade.pnl > 0 ? "\u{1F7E2}" : "\u{1F6D1}"} Ticker: ${signal.ticker}`,
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, signal.entryPriceAtActivation ?? instrEntryClosed);

      fields.push(
        { name: "\u2705 Entry", value: `${fmtPrice(instrEntryClosed)}`, inline: true },
        { name: "\u{1F3C1} Exit", value: `${fmtPrice(instrExitClosed)}`, inline: true },
        { name: "\u{1F4B8} Profit", value: `${pnlPctClosed}`, inline: true },
        { ...SPACER },
        { name: "\u{1F6A8} Status: Position Closed \u{1F6A8}", value: "\u200b", inline: false },
      );

      if (trade.pnl != null) {
        fields.push({
          name: "Total P&L",
          value: `${fmtPnl(trade.pnl)} | R-Multiple: ${trade.rMultiple?.toFixed(2) ?? "\u2014"}`,
          inline: false,
        });
      }

      if (instrT2Closed > 0) {
        fields.push(
          { ...SPACER },
          {
            name: "\u{1F6E1}\uFE0F Risk Management",
            value: `We're keeping our assets safe and closing this trade in profit. This trade could technically reach T2 at ${fmtPrice(instrT2Closed)} but we're not getting greedy.`,
            inline: false,
          },
        );
      }
      break;
    }

    default: {
      heading = `**\u{1F4DD} ${signal.ticker} Trade Update**`;
      fields.push({
        name: `Event: ${event}`,
        value: `Instrument: ${trade.instrumentTicker || signal.ticker}`,
        inline: false,
      });
    }
  }

  const embed: DiscordEmbed = {
    description: heading,
    color,
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: DISCLAIMER },
  };

  const webhookResult = await sendWebhook(url, `@everyone`, [embed]);

  try {
    const { storage } = await import("../storage");
    await storage.insertDiscordTradeLog({
      tradeId: trade.id,
      signalId: signal.id,
      event,
      channel: channelKey,
      instrumentType: trade.instrumentType,
      instrumentTicker: trade.instrumentTicker ?? signal.ticker,
      ticker: signal.ticker,
      entryPrice: trade.entryPrice,
      targetPrice: trade.target1Price,
      stopPrice: trade.stopPrice,
      exitPrice: trade.exitPrice,
      profitPct: trade.pnlPct,
      embedJson: embed,
      webhookStatus: webhookResult.status,
      discordMessageId: webhookResult.messageId ?? null,
      errorMessage: webhookResult.error ?? null,
    });
  } catch (logErr: any) {
    log(`Failed to log Discord trade: ${logErr.message}`, "discord");
  }

  return webhookResult.success;
}

export async function sendTestLetfAlert(webhookUrl: string): Promise<boolean> {
  const fields: DiscordField[] = [
    { name: "\u{1F7E2} Ticker", value: "SPY", inline: true },
    { name: "\u{1F4CA} Stock Price", value: "$ 598.45", inline: true },
    { name: "\u{1F4B9} Leveraged ETF", value: "SPXL (3x BULL)", inline: true },
    { ...SPACER },
    { name: "\u{1F4B0} Leveraged ETF Entry", value: "$ 178.32", inline: true },
    { name: "\u{1F6D1} Stop", value: "$594.20 (-0.7%)", inline: true },
    { ...SPACER },
    {
      name: "\u{1F4DD} Trade Plan",
      value:
        "\u{1F3AF} Targets: $604.50 (+1.0%), $610.80 (+2.1%)\n\u{1F6D1} Stop Loss: $594.20(-0.7%)",
      inline: false,
    },
    { ...SPACER },
    {
      name: "\u{1F4B0} Take Profit Plan",
      value:
        "Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.\nTake Profit (2): At T1 close remaining 50%. This trade could reach T2 but we close here — don't get greedy.",
      inline: false,
    },
  ];

  const embed: DiscordEmbed = {
    description: "**\u{1F6A8} SPY \u2192 SPXL Swing Alert**",
    color: GREEN,
    fields,
    footer: { text: DISCLAIMER },
  };

  const result = await sendWebhook(webhookUrl, "@everyone", [embed]);
  return result.success;
}
