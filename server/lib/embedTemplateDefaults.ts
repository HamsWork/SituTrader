export const INSTRUMENT_TYPES = ["OPTIONS", "SHARES", "LEVERAGED_ETF", "LETF_OPTIONS"] as const;
export const EVENT_TYPES = ["FILLED", "TP1_HIT", "RAISE_STOP", "STOPPED_OUT", "CLOSED"] as const;

export type InstrumentType = typeof INSTRUMENT_TYPES[number];
export type EventType = typeof EVENT_TYPES[number];

export interface TemplateField {
  name: string;
  value: string;
  inline: boolean;
}

export interface TemplateEmbed {
  description: string;
  color: string;
  fields: TemplateField[];
  footer: string;
}

const SPACER: TemplateField = { name: "\u200b", value: "", inline: false };
const FOOTER = "Disclaimer: Not financial advice. Trade at your own risk.";

function filledOptions(): TemplateEmbed {
  return {
    description: "**🚨 {{ticker}} Options Alert - Situ Trade**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker", value: "{{ticker}}", inline: true },
      { name: "📊 Stock Price", value: "$ {{stock_price}}", inline: true },
      { ...SPACER },
      { name: "❌ Expiration", value: "{{expiry}}", inline: true },
      { name: "✍️ Strike", value: "{{strike}} {{right}}", inline: true },
      { name: "💵 Option Price", value: "$ {{option_price}}", inline: true },
      { ...SPACER },
      { name: "📝 Trade Plan", value: "🎯 Targets: {{targets_line}}\n🛑 Stop Loss: {{stop_price}} ({{stop_pct}}%)", inline: false },
      { ...SPACER },
      { name: "💰 Take Profit Plan", value: "{{tp_plan}}", inline: false },
    ],
    footer: FOOTER,
  };
}

function filledShares(): TemplateEmbed {
  return {
    description: "**🚨 {{ticker}} Shares Alert - Situ Trade**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker", value: "{{ticker}}", inline: true },
      { name: "📊 Entry Price", value: "$ {{entry_price}}", inline: true },
      { name: "📈 Instrument", value: "Shares", inline: true },
      { ...SPACER },
      { name: "📝 Trade Plan", value: "🎯 Targets: {{targets_line}}\n🛑 Stop Loss: {{stop_price}} ({{stop_pct}}%), {{entry_price}} (+0%)", inline: false },
      { ...SPACER },
      { name: "💰 Take Profit Plan", value: "{{tp_plan}}", inline: false },
    ],
    footer: FOOTER,
  };
}

function filledLetf(): TemplateEmbed {
  return {
    description: "**🚨 {{ticker}} → {{letf_ticker}} LETF Alert - Situ Trade**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker", value: "{{ticker}}", inline: true },
      { name: "📊 Stock Price", value: "$ {{stock_price}}", inline: true },
      { name: "💹 Leveraged ETF", value: "{{letf_ticker}} ({{leverage}}x {{letf_direction}})", inline: true },
      { ...SPACER },
      { name: "💰 Leveraged ETF Entry", value: "$ {{entry_price}}", inline: true },
      { name: "🛑 Stop", value: "{{stop_price}} ({{stop_pct}}%)", inline: true },
      { ...SPACER },
      { name: "📝 Trade Plan", value: "🎯 Targets: {{targets_line}}\n🛑 Stop Loss: {{stop_price}} ({{stop_pct}}%)", inline: false },
      { ...SPACER },
      { name: "💰 Take Profit Plan", value: "{{tp_plan}}", inline: false },
    ],
    footer: FOOTER,
  };
}

function filledLetfOptions(): TemplateEmbed {
  return {
    description: "**🚨 {{ticker}} → {{letf_ticker}} LETF Options Alert - Situ Trade**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker", value: "{{ticker}}", inline: true },
      { name: "📊 Stock Price", value: "$ {{stock_price}}", inline: true },
      { name: "💹 Leveraged ETF", value: "{{letf_ticker}} ({{leverage}}x {{letf_direction}})", inline: true },
      { ...SPACER },
      { name: "❌ Expiration", value: "{{expiry}}", inline: true },
      { name: "✍️ Strike", value: "{{strike}} {{right}}", inline: true },
      { name: "💵 Option Price", value: "$ {{option_price}}", inline: true },
      { ...SPACER },
      { name: "📝 Trade Plan", value: "🎯 Targets: {{targets_line}}\n🛑 Stop Loss: {{stop_price}} ({{stop_pct}}%)", inline: false },
      { ...SPACER },
      { name: "💰 Take Profit Plan", value: "{{tp_plan}}", inline: false },
    ],
    footer: FOOTER,
  };
}

function tp1Options(): TemplateEmbed {
  return {
    description: "**🎯 {{ticker}} Take Profit 1 HIT**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker: {{ticker}}", value: "\u200b", inline: false },
      { name: "❌ Expiration", value: "{{expiry}}", inline: true },
      { name: "✍️ Strike", value: "{{strike}} {{right}}", inline: true },
      { name: "💵 Option Price", value: "$ {{option_price}}", inline: true },
      { name: "✅ Entry", value: "{{entry_price}}", inline: true },
      { name: "🎯 TP1 Hit", value: "{{tp1_fill_price}}", inline: true },
      { name: "💸 Profit", value: "{{profit_pct}}", inline: true },
      { ...SPACER },
      { name: "🚨 Status: TP1 Reached 🚨", value: "\u200b", inline: false },
      { name: "🔍 Position Management", value: "✅ Reduce position by 50% (lock in profit){{tp2_rider_text}}", inline: false },
      { ...SPACER },
      { name: "🛡️ Risk Management", value: "Raising stop loss to {{entry_price}} (break even) on remaining position to secure gains while allowing room to run.", inline: false },
    ],
    footer: FOOTER,
  };
}

function tp1Shares(): TemplateEmbed {
  return {
    description: "**🎯 {{ticker}} Take Profit 1 HIT**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker: {{ticker}}", value: "\u200b", inline: false },
      { name: "✅ Entry", value: "{{entry_price}}", inline: true },
      { name: "🎯 TP1 Hit", value: "{{tp1_fill_price}}", inline: true },
      { name: "💸 Profit", value: "{{profit_pct}}", inline: true },
      { ...SPACER },
      { name: "🚨 Status: TP1 Reached 🚨", value: "\u200b", inline: false },
      { name: "🔍 Position Management", value: "✅ Reduce position by 50% (lock in profit){{tp2_rider_text}}", inline: false },
      { ...SPACER },
      { name: "🛡️ Risk Management", value: "Raising stop loss to {{entry_price}} (break even) on remaining position to secure gains while allowing room to run.", inline: false },
    ],
    footer: FOOTER,
  };
}

function tp1Letf(): TemplateEmbed {
  return {
    description: "**🎯 {{ticker}} → {{letf_ticker}} Take Profit 1 HIT**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker: {{ticker}}", value: "\u200b", inline: false },
      { name: "💹 Leveraged ETF", value: "{{letf_ticker}} ({{leverage}}x {{letf_direction}})", inline: true },
      { name: "💵 Leveraged ETF Entry", value: "$ {{entry_price}}", inline: true },
      { name: "📊 Stock Price", value: "$ {{stock_price}}", inline: true },
      { name: "✅ Entry", value: "{{entry_price}}", inline: true },
      { name: "🎯 TP1 Hit", value: "{{tp1_fill_price}}", inline: true },
      { name: "💸 Profit", value: "{{profit_pct}}", inline: true },
      { ...SPACER },
      { name: "🚨 Status: TP1 Reached 🚨", value: "\u200b", inline: false },
      { name: "🔍 Position Management", value: "✅ Reduce position by 50% (lock in profit){{tp2_rider_text}}", inline: false },
      { ...SPACER },
      { name: "🛡️ Risk Management", value: "Raising stop loss to {{entry_price}} (break even) on remaining position to secure gains while allowing room to run.", inline: false },
    ],
    footer: FOOTER,
  };
}

function tp1LetfOptions(): TemplateEmbed {
  return {
    description: "**🎯 {{ticker}} → {{letf_ticker}} Options Take Profit 1 HIT**",
    color: "#22c55e",
    fields: [
      { name: "🟢 Ticker: {{ticker}}", value: "\u200b", inline: false },
      { name: "💹 Leveraged ETF", value: "{{letf_ticker}} ({{leverage}}x {{letf_direction}})", inline: true },
      { name: "❌ Expiration", value: "{{expiry}}", inline: true },
      { name: "✍️ Strike", value: "{{strike}} {{right}}", inline: true },
      { name: "✅ Entry", value: "{{entry_price}}", inline: true },
      { name: "🎯 TP1 Hit", value: "{{tp1_fill_price}}", inline: true },
      { name: "💸 Profit", value: "{{profit_pct}}", inline: true },
      { ...SPACER },
      { name: "🚨 Status: TP1 Reached 🚨", value: "\u200b", inline: false },
      { name: "🔍 Position Management", value: "✅ Reduce position by 50% (lock in profit){{tp2_rider_text}}", inline: false },
      { ...SPACER },
      { name: "🛡️ Risk Management", value: "Raising stop loss to {{entry_price}} (break even) on remaining position to secure gains while allowing room to run.", inline: false },
    ],
    footer: FOOTER,
  };
}

function raiseStopTemplate(instrumentLabel: string, instrumentFields: TemplateField[]): TemplateEmbed {
  return {
    description: `**🛡️ {{ticker}}${instrumentLabel} Stop Loss Raised**`,
    color: "#eab308",
    fields: [
      { name: "🟠 Ticker: {{ticker}}", value: "\u200b", inline: false },
      ...instrumentFields,
      { name: "✅ Entry", value: "{{entry_price}}", inline: true },
      { name: "🛡️ New Stop", value: "{{new_stop_price}} (Break Even)", inline: true },
      { name: "💸 Risk", value: "0% (Risk-Free)", inline: true },
      { ...SPACER },
      { name: "🚨 Status: Stop Loss Raised to Break Even 🚨", value: "", inline: false },
      { name: "🛡️ Risk Management", value: "Stop loss raised to {{new_stop_price}} (break even).\nTrade is now risk-free on remaining position.{{tp2_target_text}}", inline: false },
    ],
    footer: FOOTER,
  };
}

function stoppedOutTemplate(instrumentLabel: string, instrumentFields: TemplateField[]): TemplateEmbed {
  return {
    description: `**🛑 {{ticker}}${instrumentLabel} Stop Loss HIT**`,
    color: "#ef4444",
    fields: [
      { name: "🛑 Ticker: {{ticker}}", value: "\u200b", inline: false },
      ...instrumentFields,
      { name: "✅ Entry", value: "{{entry_price}}", inline: true },
      { name: "🛑 Stop Hit", value: "{{exit_price}}", inline: true },
      { name: "💸 Result", value: "{{profit_pct}}", inline: true },
      { ...SPACER },
      { name: "🚨 Status: Position Closed 🚨", value: "\u200b", inline: false },
      { name: "🛡️ Discipline Matters", value: "Following the plan keeps you in the game for winning trades", inline: false },
      { name: "Total P&L", value: "{{pnl_dollar}} | R-Multiple: {{r_multiple}}", inline: false },
    ],
    footer: FOOTER,
  };
}

function closedTemplate(instrumentLabel: string, instrumentFields: TemplateField[]): TemplateEmbed {
  return {
    description: `**{{pnl_emoji}} {{ticker}}${instrumentLabel} Trade Closed**`,
    color: "{{pnl_color}}",
    fields: [
      { name: "{{status_emoji}} Ticker: {{ticker}}", value: "\u200b", inline: false },
      ...instrumentFields,
      { name: "✅ Entry", value: "{{entry_price}}", inline: true },
      { name: "🏁 Exit", value: "{{exit_price}}", inline: true },
      { name: "💸 Profit", value: "{{profit_pct}}", inline: true },
      { ...SPACER },
      { name: "🚨 Status: Position Closed 🚨", value: "\u200b", inline: false },
      { name: "Total P&L", value: "{{pnl_dollar}} | R-Multiple: {{r_multiple}}", inline: false },
      { ...SPACER },
      { name: "🛡️ Risk Management", value: "We're keeping our assets safe and closing this trade in profit. This trade could technically reach T2 at {{t2_price}} but we're not getting greedy.", inline: false },
    ],
    footer: FOOTER,
  };
}

const optionsInstrFields: TemplateField[] = [
  { name: "❌ Expiration", value: "{{expiry}}", inline: true },
  { name: "✍️ Strike", value: "{{strike}} {{right}}", inline: true },
  { name: "💵 Option Price", value: "$ {{option_price}}", inline: true },
];

const sharesInstrFields: TemplateField[] = [];

const letfInstrFields: TemplateField[] = [
  { name: "💹 Leveraged ETF", value: "{{letf_ticker}} ({{leverage}}x {{letf_direction}})", inline: true },
  { name: "💵 Leveraged ETF Entry", value: "$ {{entry_price}}", inline: true },
  { name: "📊 Stock Price", value: "$ {{stock_price}}", inline: true },
];

const letfOptionsInstrFields: TemplateField[] = [
  { name: "💹 Leveraged ETF", value: "{{letf_ticker}} ({{leverage}}x {{letf_direction}})", inline: true },
  { name: "❌ Expiration", value: "{{expiry}}", inline: true },
  { name: "✍️ Strike", value: "{{strike}} {{right}}", inline: true },
];

export function getDefaultTemplates(): Array<{
  instrumentType: string;
  eventType: string;
  templateName: string;
  embedJson: TemplateEmbed;
}> {
  return [
    { instrumentType: "OPTIONS", eventType: "FILLED", templateName: "Options — Entry Fill", embedJson: filledOptions() },
    { instrumentType: "SHARES", eventType: "FILLED", templateName: "Shares — Entry Fill", embedJson: filledShares() },
    { instrumentType: "LEVERAGED_ETF", eventType: "FILLED", templateName: "Leveraged ETF — Entry Fill", embedJson: filledLetf() },
    { instrumentType: "LETF_OPTIONS", eventType: "FILLED", templateName: "LETF Options — Entry Fill", embedJson: filledLetfOptions() },

    { instrumentType: "OPTIONS", eventType: "TP1_HIT", templateName: "Options — TP1 Hit", embedJson: tp1Options() },
    { instrumentType: "SHARES", eventType: "TP1_HIT", templateName: "Shares — TP1 Hit", embedJson: tp1Shares() },
    { instrumentType: "LEVERAGED_ETF", eventType: "TP1_HIT", templateName: "Leveraged ETF — TP1 Hit", embedJson: tp1Letf() },
    { instrumentType: "LETF_OPTIONS", eventType: "TP1_HIT", templateName: "LETF Options — TP1 Hit", embedJson: tp1LetfOptions() },

    { instrumentType: "OPTIONS", eventType: "RAISE_STOP", templateName: "Options — Raise Stop", embedJson: raiseStopTemplate("", optionsInstrFields) },
    { instrumentType: "SHARES", eventType: "RAISE_STOP", templateName: "Shares — Raise Stop", embedJson: raiseStopTemplate("", sharesInstrFields) },
    { instrumentType: "LEVERAGED_ETF", eventType: "RAISE_STOP", templateName: "Leveraged ETF — Raise Stop", embedJson: raiseStopTemplate(" → {{letf_ticker}}", letfInstrFields) },
    { instrumentType: "LETF_OPTIONS", eventType: "RAISE_STOP", templateName: "LETF Options — Raise Stop", embedJson: raiseStopTemplate(" → {{letf_ticker}}", letfOptionsInstrFields) },

    { instrumentType: "OPTIONS", eventType: "STOPPED_OUT", templateName: "Options — Stopped Out", embedJson: stoppedOutTemplate("", optionsInstrFields) },
    { instrumentType: "SHARES", eventType: "STOPPED_OUT", templateName: "Shares — Stopped Out", embedJson: stoppedOutTemplate("", sharesInstrFields) },
    { instrumentType: "LEVERAGED_ETF", eventType: "STOPPED_OUT", templateName: "Leveraged ETF — Stopped Out", embedJson: stoppedOutTemplate(" → {{letf_ticker}}", letfInstrFields) },
    { instrumentType: "LETF_OPTIONS", eventType: "STOPPED_OUT", templateName: "LETF Options — Stopped Out", embedJson: stoppedOutTemplate(" → {{letf_ticker}}", letfOptionsInstrFields) },

    { instrumentType: "OPTIONS", eventType: "CLOSED", templateName: "Options — Trade Closed", embedJson: closedTemplate("", optionsInstrFields) },
    { instrumentType: "SHARES", eventType: "CLOSED", templateName: "Shares — Trade Closed", embedJson: closedTemplate("", sharesInstrFields) },
    { instrumentType: "LEVERAGED_ETF", eventType: "CLOSED", templateName: "Leveraged ETF — Trade Closed", embedJson: closedTemplate(" → {{letf_ticker}}", letfInstrFields) },
    { instrumentType: "LETF_OPTIONS", eventType: "CLOSED", templateName: "LETF Options — Trade Closed", embedJson: closedTemplate(" → {{letf_ticker}}", letfOptionsInstrFields) },
  ];
}

export const AVAILABLE_VARIABLES: Record<string, string> = {
  "{{ticker}}": "Stock ticker symbol",
  "{{stock_price}}": "Underlying stock price at activation",
  "{{entry_price}}": "Instrument entry/fill price",
  "{{stop_price}}": "Stop loss price",
  "{{stop_pct}}": "Stop loss percentage from entry",
  "{{targets_line}}": "Formatted targets string (T1, T2)",
  "{{tp_plan}}": "Take profit plan text",
  "{{expiry}}": "Option expiration date",
  "{{strike}}": "Option strike price",
  "{{right}}": "Option type (CALL/PUT)",
  "{{option_price}}": "Option entry mark price",
  "{{letf_ticker}}": "Leveraged ETF ticker",
  "{{leverage}}": "Leverage ratio (e.g. 3)",
  "{{letf_direction}}": "LETF direction (BULL/BEAR)",
  "{{tp1_fill_price}}": "TP1 fill price",
  "{{tp2_fill_price}}": "TP2 fill price",
  "{{t2_price}}": "T2 target price (magnet + 0.15×ATR)",
  "{{profit_pct}}": "Profit/loss percentage",
  "{{exit_price}}": "Exit/close price",
  "{{new_stop_price}}": "New stop price after raise",
  "{{pnl_dollar}}": "Dollar P&L (e.g. +$150.00)",
  "{{r_multiple}}": "R-multiple (e.g. 2.50)",
  "{{tp2_rider_text}}": "TP2 rider instruction (auto-populated)",
  "{{tp2_target_text}}": "TP2 target reminder (auto-populated)",
  "{{pnl_emoji}}": "P&L emoji (💰 or 📉)",
  "{{pnl_color}}": "Dynamic color based on P&L",
  "{{status_emoji}}": "Status emoji (🟢 or 🛑)",
};
