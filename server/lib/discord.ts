import { log } from "../log";
import type { Signal, TradePlan, IbkrTrade } from "@shared/schema";

async function getWebhookUrl(
  channel: "alerts" | "swings" | "shares",
): Promise<string | undefined> {
  const envKey =
    channel === "alerts"
      ? "DISCORD_GOAT_ALERTS_WEBHOOK"
      : channel === "swings"
        ? "DISCORD_GOAT_SWINGS_WEBHOOK"
        : "DISCORD_GOAT_SHARES_WEBHOOK";
  try {
    const { storage } = await import("../storage");
    const settingKey =
      channel === "alerts"
        ? "discordGoatAlertsWebhook"
        : channel === "swings"
          ? "discordGoatSwingsWebhook"
          : "discordGoatSharesWebhook";
    const fromDb = await storage.getSetting(settingKey);
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

function parseContractTicker(ticker: string | null | undefined): { strike: number | null; expiry: string | null; right: "C" | "P" | null } {
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

async function sendWebhook(
  url: string,
  content: string,
  embeds: DiscordEmbed[],
  isRetry = false,
): Promise<boolean> {
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
      const freshSig = freshSigs.find(s => s.id === signal.id);
      if (freshSig?.optionsJson) {
        optData = freshSig.optionsJson as any;
        signal = { ...signal, optionsJson: optData, optionContractTicker: freshSig.optionContractTicker ?? signal.optionContractTicker, optionEntryMark: freshSig.optionEntryMark ?? signal.optionEntryMark };
      }
    } catch (err: any) {
      log(`postOptionsAlert: on-demand enrichment failed for signal ${signal.id}: ${err.message}`, "discord");
    }
  }
  const parsed = parseContractTicker(signal.optionContractTicker || optData?.candidate?.contractSymbol);
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
    tpPlanText += `\nTake Profit (2): At ${t2Pct} take off 50.0% of remaining position.`;
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

  return sendWebhook(DISCORD_GOAT_ALERTS_URL, `@everyone`, [embed]);
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
  if (tp.t2)
    targetsStr += `, ${fmtPrice(tp.t2)} (${t2Pct})`;

  let tpPlanText = `Take Profit (1): At ${t1Pct} take off 50.0% of position and raise stop loss to break even.`;
  if (tp.t2)
    tpPlanText += `\nTake Profit (2): At ${t2Pct} take off remaining 50.0% of position.`;

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

  return sendWebhook(DISCORD_GOAT_SWINGS_URL, `@everyone`, [embed]);
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
    tpPlanText += `\nTake Profit (2): At ${t2Pct} take off 50.0% of remaining position.`;
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

  return sendWebhook(DISCORD_GOAT_SHARES_URL, `@everyone`, [embed]);
}

export async function postTradeUpdate(
  signalInput: Signal,
  trade: IbkrTrade,
  event: string,
  tradeUpdateWebhookUrl?: string,
): Promise<boolean> {
  const isOption = trade.instrumentType === "OPTION";
  const isLetf = trade.instrumentType === "LEVERAGED_ETF";
  const isShares = trade.instrumentType === "SHARES";
  const channelKey = isOption ? "alerts" : isShares ? "shares" : "swings";
  const url =
    tradeUpdateWebhookUrl ??
    (await getWebhookUrl(channelKey));
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
      const freshSig = freshSigs.find(s => s.id === signal.id);
      if (freshSig?.optionsJson) {
        optData = freshSig.optionsJson as any;
        signal = { ...signal, optionsJson: optData, optionContractTicker: freshSig.optionContractTicker ?? signal.optionContractTicker, optionEntryMark: freshSig.optionEntryMark ?? signal.optionEntryMark };
      }
    } catch (err: any) {
      log(`postTradeUpdate: on-demand enrichment failed for signal ${signal.id}: ${err.message}`, "discord");
    }
  }
  const parsedContract = parseContractTicker(signal.optionContractTicker || optData?.candidate?.contractSymbol);
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
          name: "\u{1F4B9} Leveraged ETF",
          value: letfDisplayLabel,
          inline: true,
        },
        {
          name: "\u{1F4B5} Leveraged ETF Entry",
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

  let color = BLUE;
  let heading = "";
  const fields: DiscordField[] = [];
  const letfLabel = hasLetfInfo ? ` \u2192 ${letfTicker}` : "";

  switch (event) {
    case "FILLED": {
      color = GREEN;
      heading = hasLetfInfo
        ? `**\u{1F6A8} ${signal.ticker} \u2192 ${letfTicker} Swing Alert**`
        : `**\u{1F6A8} ${signal.ticker} Trade Alert**`;

      const tpData = signal.tradePlanJson as any;
      const entryPx = trade.entryPrice ?? signal.entryPriceAtActivation ?? 0;
      const stopPx = trade.stopPrice ?? signal.stopPrice ?? 0;
      const stopPctFill =
        entryPx > 0 ? (((stopPx - entryPx) / entryPx) * 100).toFixed(1) : "?";

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

      const t1PctFill = entryPx > 0 ? fmtPct(entryPx, tpData?.t1 ?? 0) : "?";
      const t2PctFill = tpData?.t2 && entryPx > 0 ? fmtPct(entryPx, tpData.t2) : null;
      const t3PctFill = tpData?.t3 && entryPx > 0 ? fmtPct(entryPx, tpData.t3) : null;
      let tpPlanText = `Take Profit (1): At ${t1PctFill} take off 50.0% of position and raise stop loss to break even.`;
      if (tpData?.t2)
        tpPlanText += `\nTake Profit (2): At ${t2PctFill} take off 50.0% of remaining position.`;
      if (tpData?.t3)
        tpPlanText += `\nTake Profit (3): At ${t3PctFill} take off 50.0% of remaining position.`;

      fields.push(
        { name: "\u{1F7E2} Ticker", value: `${signal.ticker}`, inline: true },
        {
          name: "\u{1F4CA} Stock Price",
          value: `$ ${(signal.entryPriceAtActivation ?? entryPx).toFixed(2)}`,
          inline: true,
        },
        { ...SPACER },
      );

      if (hasLetfInfo) {
        fields.push(
          {
            name: "\u{1F4B9} Leveraged ETF",
            value: letfDisplayLabel,
            inline: true,
          },
          {
            name: "\u{1F4B5} Leveraged ETF Entry",
            value: trade.entryPrice
              ? `$ ${trade.entryPrice.toFixed(2)}`
              : "Pending",
            inline: true,
          },
          { ...SPACER },
        );
      } else if (strike && expiry) {
        const optionPx = signal.optionEntryMark ?? trade.entryPrice ?? 0;
        fields.push(
          { name: "\u274C Expiration", value: `${expiry}`, inline: true },
          {
            name: "\u270D\uFE0F Strike",
            value: `${strike} ${right}`,
            inline: true,
          },
          {
            name: "\u{1F4B5} Option Price",
            value: `$ ${optionPx.toFixed(2)}`,
            inline: true,
          },
          { ...SPACER },
        );
      }

      const stopLine = hasLetfInfo
        ? `\u{1F6D1} Stop Loss: ${fmtPrice(stopPx)}(${stopPctFill}%)`
        : `\u{1F6D1} Stop Loss: ${fmtPrice(stopPx)}(${stopPctFill}%), ${fmtPrice(entryPx)}(+0%)`;
      fields.push(
        {
          name: "\u{1F4DD} Trade Plan",
          value: `\u{1F3AF} Targets: ${targetsLine}\n${stopLine}`,
          inline: false,
        },
        { ...SPACER },
        {
          name: "\u{1F4B0} Take Profit Plan",
          value: tpPlanText,
          inline: false,
        },
      );
      break;
    }

    case "TP1_HIT": {
      color = GREEN;
      heading = `**\u{1F3AF} ${signal.ticker}${letfLabel} Take Profit HIT**`;
      const entry = trade.entryPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const stockEntry = signal.entryPriceAtActivation ?? entry;
      const tpData1 = signal.tradePlanJson as any;
      const stockTp1 = tpData1?.t1 ?? tp1Fill;
      const profitPct = hasLetfInfo
        ? stockEntry > 0
          ? fmtPct(stockEntry, stockTp1)
          : "?"
        : entry > 0
          ? fmtPct(entry, tp1Fill)
          : "?";

      fields.push({
        name: `\u{1F7E2} Ticker: ${signal.ticker}`,
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntry);

      const entryDisplay = hasLetfInfo ? stockEntry : entry;
      const tp1Display = hasLetfInfo ? stockTp1 : tp1Fill;
      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(entryDisplay)}`,
          inline: true,
        },
        {
          name: "\u{1F3AF} TP Hit",
          value: `${fmtPrice(tp1Display)}`,
          inline: true,
        },
        { name: "\u{1F4B8} Profit", value: `${profitPct}`, inline: true },
        { ...SPACER },
        {
          name: "\u{1F6A8} Status: TP Reached \u{1F6A8}",
          value: "\u200b",
          inline: false,
        },
        {
          name: "\u{1F50D} Position Management",
          value: `\u2705 Reduce position by 50% (lock in profit)${tp?.t2 ? `\n\u{1F3AF} Let remaining 50% ride to TP2 (${fmtPrice(tp.t2)})` : ""}`,
          inline: false,
        },
        { ...SPACER },
        {
          name: "\u{1F6E1}\uFE0F Risk Management",
          value: `Raising stop loss to ${fmtPrice(entry)} (break even) on remaining position to secure gains while allowing room to run.`,
          inline: false,
        },
      );
      break;
    }

    case "TP2_HIT": {
      color = GREEN;
      heading = `**\u{1F3AF} ${signal.ticker}${letfLabel} Take Profit 2 HIT**`;
      const entry = trade.entryPrice ?? 0;
      const tp2Fill = trade.tp2FillPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const stockEntry2 = signal.entryPriceAtActivation ?? entry;
      const tpData2 = signal.tradePlanJson as any;
      const stockTp2 = tpData2?.t2 ?? tp2Fill;
      const stockTp1forRisk = tpData2?.t1 ?? tp1Fill;
      const profitPct = hasLetfInfo
        ? stockEntry2 > 0
          ? fmtPct(stockEntry2, stockTp2)
          : "?"
        : entry > 0
          ? fmtPct(entry, tp2Fill)
          : "?";

      fields.push({
        name: `\u{1F7E2} Ticker: ${signal.ticker}`,
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntry2);

      const entryDisp2 = hasLetfInfo ? stockEntry2 : entry;
      const tp2Disp = hasLetfInfo ? stockTp2 : tp2Fill;
      const tp1DispRisk = hasLetfInfo ? stockTp1forRisk : tp1Fill;
      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(entryDisp2)}`,
          inline: true,
        },
        {
          name: "\u{1F3AF} TP2 Hit",
          value: `${fmtPrice(tp2Disp)}`,
          inline: true,
        },
        { name: "\u{1F4B8} Profit", value: `${profitPct}`, inline: true },
        { ...SPACER },
        {
          name: "\u{1F6A8} Status: TP2 Reached \u{1F6A8}",
          value: "\u200b",
          inline: false,
        },
        {
          name: "\u{1F50D} Position Management",
          value: `\u2705 Reduce position by 50% of remaining (lock in ${profitPct})\n\u{1F3AF} Set trailing stop on remaining runners`,
          inline: false,
        },
        { ...SPACER },
        {
          name: "\u{1F6E1}\uFE0F Risk Management",
          value: `Raising stop loss to ${fmtPrice(tp1DispRisk)} (TP1 level) on remaining position. Locking in gains while allowing room to run.`,
          inline: false,
        },
      );
      break;
    }

    case "TP3_HIT": {
      color = GREEN;
      heading = `**\u{1F3AF} ${signal.ticker}${letfLabel} Take Profit 3 HIT**`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? trade.tp2FillPrice ?? 0;
      const stockEntry3 = signal.entryPriceAtActivation ?? entry;
      const tpData3 = signal.tradePlanJson as any;
      const stockTp3 = tpData3?.t3 ?? exitPrice;
      const profitPct = hasLetfInfo
        ? stockEntry3 > 0
          ? fmtPct(stockEntry3, stockTp3)
          : "?"
        : entry > 0
          ? fmtPct(entry, exitPrice)
          : "?";

      fields.push({
        name: `\u{1F7E2} Ticker: ${signal.ticker}`,
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntry3);

      const entryDisp3 = hasLetfInfo ? stockEntry3 : entry;
      const tp3Disp = hasLetfInfo ? stockTp3 : exitPrice;
      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(entryDisp3)}`,
          inline: true,
        },
        {
          name: "\u{1F3AF} TP3 Hit",
          value: `${fmtPrice(tp3Disp)}`,
          inline: true,
        },
        { name: "\u{1F4B8} Profit", value: `${profitPct}`, inline: true },
        { ...SPACER },
        {
          name: "\u{1F6A8} Status: Position Closed \u{1F6A8}",
          value: "\u200b",
          inline: false,
        },
        {
          name: "\u{1F50D} Position Management",
          value: `\u2705 Full exit \u2014 all targets reached`,
          inline: false,
        },
      );
      break;
    }

    case "RAISE_STOP": {
      color = GOLD;
      heading = `**\u{1F6E1}\uFE0F ${signal.ticker}${letfLabel} Stop Loss Raised**`;
      const entry = trade.entryPrice ?? 0;
      const newStopPx = trade.stopPrice ?? entry;
      const stockEntryRS = signal.entryPriceAtActivation ?? entry;
      const tpDataRS = signal.tradePlanJson as any;

      fields.push({
        name: `\u{1F7E0} Ticker: ${signal.ticker}`,
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntryRS);

      const entryDispRS = hasLetfInfo ? stockEntryRS : entry;
      const stopDispRS = hasLetfInfo ? stockEntryRS : newStopPx;
      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(entryDispRS)}`,
          inline: true,
        },
        {
          name: "\u{1F6E1}\uFE0F New Stop",
          value: `${fmtPrice(stopDispRS)} (Break Even)`,
          inline: true,
        },
        { name: "\u{1F4B8} Risk", value: `0% (Risk-Free)`, inline: true },
        { ...SPACER },
        {
          name: "\u{1F6A8} Status: Stop Loss Raised to Break Even \u{1F6A8}",
          value: "",
          inline: false,
        },
      );

      if (hasLetfInfo && newStopPx !== stopDispRS) {
        fields.push(
          {
            name: "\u{1F4B9} LETF Stop Price",
            value: `${fmtPrice(newStopPx)}`,
            inline: true,
          },
          { ...SPACER },
        );
      }

      fields.push({
        name: "\u{1F6E1}\uFE0F Risk Management",
        value: `Stop loss raised from initial level to ${fmtPrice(stopDispRS)} (break even).\nTrade is now risk-free on remaining position.${tpDataRS?.t2 ? `\n\u{1F3AF} Remaining target: TP2 at ${fmtPrice(tpDataRS.t2)}` : ""}`,
        inline: false,
      });
      break;
    }

    case "TIME_STOP": {
      color = GOLD;
      heading = `**\u23F0 ${signal.ticker}${letfLabel} Time Stop Tightened**`;
      const entryTS = trade.entryPrice ?? 0;
      const newInstrStopTS = trade.stopPrice ?? 0;
      const stockEntryTS = signal.entryPriceAtActivation ?? entryTS;
      const tpDataTS = signal.tradePlanJson as any;
      const oldUnderlyingStop = signal.stopPrice ?? 0;
      const detailsTS = trade.detailsJson as any;
      const oldInstrStop = detailsTS?.oldStopPrice ?? 0;

      const isSellTS = tpDataTS?.bias === "SELL";
      const tightenedUnderlyingStop =
        detailsTS?.underlyingNewStop ??
        (() => {
          const dist = Math.abs(stockEntryTS - oldUnderlyingStop);
          const factor = detailsTS?.timeStopTightenFactor ?? 0.5;
          return isSellTS
            ? stockEntryTS + dist * factor
            : stockEntryTS - dist * factor;
        })();

      fields.push({
        name: "\u{1F7E0} Ticker: ${signal.ticker}",
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntryTS);

      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(hasLetfInfo ? stockEntryTS : entryTS)}`,
          inline: true,
        },
        {
          name: "\u{1F6E1}\uFE0F New Stop",
          value: `${fmtPrice(hasLetfInfo ? tightenedUnderlyingStop : newInstrStopTS)}`,
          inline: true,
        },
        {
          name: "\u{1F4B8} Risk",
          value: `${fmtPct(hasLetfInfo ? stockEntryTS : entryTS, hasLetfInfo ? tightenedUnderlyingStop : newInstrStopTS)}`,
          inline: true,
        },
        { ...SPACER },
        {
          name: "\u{1F6A8} Status: Time Stop Activated \u{1F6A8}",
          value: "",
          inline: false,
        },
      );

      if (hasLetfInfo) {
        fields.push(
          {
            name: "\u{1F4C9} Old LETF Stop",
            value: `${fmtPrice(oldInstrStop)}`,
            inline: true,
          },
          {
            name: "\u{1F4C8} New LETF Stop",
            value: `${fmtPrice(newInstrStopTS)}`,
            inline: true,
          },
          { ...SPACER },
        );
      }

      const activeMins = signal.activatedTs
        ? Math.floor(
            (Date.now() - new Date(signal.activatedTs).getTime()) / 60000,
          )
        : 0;

      const oldDispTS = hasLetfInfo
        ? oldUnderlyingStop
        : oldInstrStop || oldUnderlyingStop;
      const newDispTS = hasLetfInfo ? tightenedUnderlyingStop : newInstrStopTS;
      fields.push({
        name: "\u23F0 Time Stop Details",
        value: `Stop tightened after ${activeMins} minutes — insufficient movement toward target.\nOld stop: ${fmtPrice(oldDispTS)} → New stop: ${fmtPrice(newDispTS)}${tpDataTS?.t1 ? `\n\u{1F3AF} Target: ${fmtPrice(tpDataTS.t1)}` : ""}`,
        inline: false,
      });
      break;
    }

    case "STOPPED_OUT": {
      color = RED;
      heading = `**\u{1F6D1} ${signal.ticker}${letfLabel} Stop Loss HIT**`;
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const stockEntryStop = signal.entryPriceAtActivation ?? entry;
      const stockStopPx = signal.stopPrice ?? exitPrice;
      const lossPct = hasLetfInfo
        ? stockEntryStop > 0
          ? fmtPct(stockEntryStop, stockStopPx)
          : "?"
        : entry > 0
          ? fmtPct(entry, exitPrice)
          : "?";

      fields.push({
        name: `\u{1F6D1} Ticker: ${signal.ticker}`,
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntryStop);

      const entryDispStop = hasLetfInfo ? stockEntryStop : entry;
      const stopDispPx = hasLetfInfo ? stockStopPx : exitPrice;
      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(entryDispStop)}`,
          inline: true,
        },
        {
          name: "\u{1F6D1} Stop Hit",
          value: `${fmtPrice(stopDispPx)}`,
          inline: true,
        },
        { name: "\u{1F4B8} Result", value: `${lossPct}`, inline: true },
        { ...SPACER },
      );

      if (hasLetfInfo && exitPrice > 0) {
        fields.push(
          {
            name: "\u{1F4B9} LETF Exit Price",
            value: `${fmtPrice(exitPrice)}`,
            inline: true,
          },
          { ...SPACER },
        );
      }

      fields.push(
        {
          name: "\u{1F6A8} Status: Position Closed \u{1F6A8}",
          value: "\u200b",
          inline: false,
        },
        {
          name: "\u{1F6E1}\uFE0F Discipline Matters",
          value: `Following the plan keeps you in the game for winning trades`,
          inline: false,
        },
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
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const tp1Fill = trade.tp1FillPrice ?? 0;
      const stockEntryBE = signal.entryPriceAtActivation ?? entry;
      const tpDataBE = signal.tradePlanJson as any;
      const stockTp1BE = tpDataBE?.t1 ?? tp1Fill;
      const tp1Pct = hasLetfInfo
        ? stockEntryBE > 0
          ? fmtPct(stockEntryBE, stockTp1BE)
          : "?"
        : entry > 0
          ? fmtPct(entry, tp1Fill)
          : "?";

      fields.push({
        name: "\u{1F7E0} Ticker: ${signal.ticker}",
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntryBE);

      const entryDispBE = hasLetfInfo ? stockEntryBE : entry;
      const beStopDisp = hasLetfInfo ? stockEntryBE : exitPrice;
      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(entryDispBE)}`,
          inline: true,
        },
        {
          name: "\u{1F6D1} BE Stop",
          value: `${fmtPrice(beStopDisp)}`,
          inline: true,
        },
        {
          name: "\u{1F4B8} Profit",
          value: `${tp1Pct} (TP1 only)`,
          inline: true,
        },
        { ...SPACER },
        {
          name: "\u{1F6A8} Status: Stopped at BE (after TP1) \u{1F6A8}",
          value: "\u200b",
          inline: false,
        },
        {
          name: "\u{1F6E1}\uFE0F Discipline Matters",
          value: `Following the plan keeps you in the game for winning trades`,
          inline: false,
        },
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
      const entry = trade.entryPrice ?? 0;
      const exitPrice = trade.exitPrice ?? 0;
      const stockEntryClosed = signal.entryPriceAtActivation ?? entry;
      color = trade.pnl && trade.pnl > 0 ? GREEN : RED;
      const emoji = trade.pnl && trade.pnl > 0 ? "\u{1F4B0}" : "\u{1F4C9}";
      heading = `**${emoji} ${signal.ticker}${letfLabel} Trade Closed**`;
      const pnlPct = hasLetfInfo
        ? "\u2014"
        : entry > 0 && exitPrice > 0
          ? fmtPct(entry, exitPrice)
          : "\u2014";

      fields.push({
        name: `${trade.pnl && trade.pnl > 0 ? "\u{1F7E2}" : "\u{1F6D1}"} Ticker: ${signal.ticker}`,
        value: `\u200b`,
        inline: false,
      });

      pushInstrumentFields(fields, stockEntryClosed);

      const entryDispClosed = hasLetfInfo ? stockEntryClosed : entry;
      fields.push(
        {
          name: "\u2705 Entry",
          value: `${fmtPrice(entryDispClosed)}`,
          inline: true,
        },
        {
          name: "\u{1F3C1} Exit",
          value: hasLetfInfo
            ? `${fmtPrice(exitPrice)} (LETF)`
            : `${fmtPrice(exitPrice)}`,
          inline: true,
        },
        { name: "\u{1F4B8} Profit", value: `${pnlPct}`, inline: true },
        { ...SPACER },
        {
          name: "\u{1F6A8} Status: Position Closed \u{1F6A8}",
          value: "\u200b",
          inline: false,
        },
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

  return sendWebhook(url, `@everyone`, [embed]);
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
        "Take Profit (1): At T1 take off 50.0% of position and raise stop loss to break even.\nTake Profit (2): At T2 take off remaining 50.0% of position.",
      inline: false,
    },
  ];

  const embed: DiscordEmbed = {
    description: "**\u{1F6A8} SPY \u2192 SPXL Swing Alert**",
    color: GREEN,
    fields,
    footer: { text: DISCLAIMER },
  };

  return sendWebhook(webhookUrl, "@everyone", [embed]);
}
