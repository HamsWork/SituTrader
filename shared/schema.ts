import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, unique, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const symbols = pgTable("symbols", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  isWatchlist: boolean("is_watchlist").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const dailyBars = pgTable("daily_bars", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  date: text("date").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull().default(0),
  vwap: real("vwap"),
  source: text("source").default("polygon"),
}, (table) => [
  unique("daily_bars_ticker_date").on(table.ticker, table.date),
]);

export const intradayBars = pgTable("intraday_bars", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  ts: text("ts").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull().default(0),
  timeframe: text("timeframe").notNull().default("5"),
  source: text("source").default("polygon"),
}, (table) => [
  unique("intraday_bars_ticker_ts_tf").on(table.ticker, table.ts, table.timeframe),
]);

export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  setupType: text("setup_type").notNull(),
  asofDate: text("asof_date").notNull(),
  targetDate: text("target_date").notNull(),
  targetDate2: text("target_date_2"),
  targetDate3: text("target_date_3"),
  magnetPrice: real("magnet_price").notNull(),
  magnetPrice2: real("magnet_price_2"),
  direction: text("direction").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  status: text("status").notNull().default("pending"),
  hitTs: text("hit_ts"),
  timeToHitMin: real("time_to_hit_min"),
  missReason: text("miss_reason"),
  tradePlanJson: jsonb("trade_plan_json"),
  confidenceBreakdown: jsonb("confidence_breakdown"),
  qualityScore: integer("quality_score").notNull().default(0),
  tier: text("tier").notNull().default("C"),
  alertState: text("alert_state").notNull().default("new"),
  nextAlertEligibleAt: text("next_alert_eligible_at"),
  qualityBreakdown: jsonb("quality_breakdown"),
  pHit60: real("p_hit_60"),
  pHit120: real("p_hit_120"),
  pHit390: real("p_hit_390"),
  timeScore: real("time_score"),
  universePass: boolean("universe_pass").notNull().default(true),
  activationStatus: text("activation_status").notNull().default("NOT_ACTIVE"),
  activatedTs: text("activated_ts"),
  entryPriceAtActivation: real("entry_price_at_activation"),
  stopPrice: real("stop_price"),
  entryTriggerPrice: real("entry_trigger_price"),
  invalidationTs: text("invalidation_ts"),
  stopStage: text("stop_stage").notNull().default("INITIAL"),
  stopMovedToBeTs: text("stop_moved_to_be_ts"),
  timeStopTriggeredTs: text("time_stop_triggered_ts"),
  optionsJson: jsonb("options_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const backtests = pgTable("backtests", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  setupType: text("setup_type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  occurrences: integer("occurrences").notNull().default(0),
  hits: integer("hits").notNull().default(0),
  hitRate: real("hit_rate").notNull().default(0),
  avgTimeToHitMin: real("avg_time_to_hit_min"),
  medianTimeToHitMin: real("median_time_to_hit_min"),
  avgMae: real("avg_mae"),
  avgMfe: real("avg_mfe"),
  details: jsonb("details"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeToHitStats = pgTable("time_to_hit_stats", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  setupType: text("setup_type").notNull(),
  timeframe: text("timeframe").notNull().default("5"),
  sampleSize: integer("sample_size").notNull().default(0),
  p15: real("p15").notNull().default(0),
  p30: real("p30").notNull().default(0),
  p60: real("p60").notNull().default(0),
  p120: real("p120").notNull().default(0),
  p240: real("p240").notNull().default(0),
  p390: real("p390").notNull().default(0),
  medianTimeToHitMin: real("median_time_to_hit_min"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("tth_ticker_setup_tf").on(table.ticker, table.setupType, table.timeframe),
]);

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const universeMembers = pgTable("universe_members", {
  id: serial("id").primaryKey(),
  universeDate: text("universe_date").notNull(),
  ticker: text("ticker").notNull(),
  avgDollarVol20d: real("avg_dollar_vol_20d").notNull().default(0),
  rank: integer("rank").notNull().default(0),
  included: boolean("included").notNull().default(true),
}, (table) => [
  unique("um_date_ticker").on(table.universeDate, table.ticker),
]);

export const tickerStats = pgTable("ticker_stats", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  avgDollarVol20d: real("avg_dollar_vol_20d").notNull().default(0),
  avgVol20d: real("avg_vol_20d").notNull().default(0),
  atr14: real("atr_14").notNull().default(0),
  lastPrice: real("last_price"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const setupExpectancy = pgTable("setup_expectancy", {
  id: serial("id").primaryKey(),
  setupType: text("setup_type").notNull(),
  ticker: text("ticker"),
  sampleSize: integer("sample_size").notNull().default(0),
  winRate: real("win_rate").notNull().default(0),
  avgWinR: real("avg_win_r").notNull().default(0),
  avgLossR: real("avg_loss_r").notNull().default(0),
  medianR: real("median_r").notNull().default(0),
  expectancyR: real("expectancy_r").notNull().default(0),
  profitFactor: real("profit_factor").notNull().default(0),
  avgMaeR: real("avg_mae_r").notNull().default(0),
  medianMaeR: real("median_mae_r").notNull().default(0),
  tradeability: text("tradeability").notNull().default("CLEAN"),
  category: text("category").notNull().default("SECONDARY"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  unique("se_setup_ticker").on(table.setupType, table.ticker),
]);

export const signalProfiles = pgTable("signal_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  allowedSetups: text("allowed_setups").array().notNull(),
  minTier: text("min_tier").notNull().default("C"),
  minQualityScore: integer("min_quality_score").notNull().default(0),
  minSampleSize: integer("min_sample_size").notNull().default(30),
  minHitRate: real("min_hit_rate").notNull().default(0),
  minExpectancyR: real("min_expectancy_r").notNull().default(0),
  timePriorityMode: text("time_priority_mode").notNull().default("BLEND"),
  stopMode: text("stop_mode").notNull().default("VOLATILITY_ONLY"),
  isPinned: boolean("is_pinned").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const schedulerState = pgTable("scheduler_state", {
  key: text("key").primaryKey(),
  authorModeEnabled: boolean("author_mode_enabled").notNull().default(true),
  autoEnabled: boolean("auto_enabled").notNull().default(true),
  afterCloseEnabled: boolean("after_close_enabled").notNull().default(true),
  preOpenEnabled: boolean("pre_open_enabled").notNull().default(true),
  liveMonitorEnabled: boolean("live_monitor_enabled").notNull().default(true),
  lastAfterCloseRunTs: text("last_after_close_run_ts"),
  lastPreOpenRunTs: text("last_pre_open_run_ts"),
  lastLiveMonitorRunTs: text("last_live_monitor_run_ts"),
  lastRunSummaryJson: jsonb("last_run_summary_json"),
  nextAfterCloseTs: text("next_after_close_ts"),
  nextPreOpenTs: text("next_pre_open_ts"),
});

export type SchedulerState = typeof schedulerState.$inferSelect;

export const insertSignalProfileSchema = createInsertSchema(signalProfiles).omit({ id: true, createdAt: true });

export const insertSymbolSchema = createInsertSchema(symbols).omit({ id: true, createdAt: true });
export const insertSignalSchema = createInsertSchema(signals).omit({ id: true, createdAt: true });
export const insertBacktestSchema = createInsertSchema(backtests).omit({ id: true, createdAt: true });
export const insertDailyBarSchema = createInsertSchema(dailyBars).omit({ id: true });
export const insertIntradayBarSchema = createInsertSchema(intradayBars).omit({ id: true });
export const insertTimeToHitStatsSchema = createInsertSchema(timeToHitStats).omit({ id: true, updatedAt: true });
export const insertUniverseMemberSchema = createInsertSchema(universeMembers).omit({ id: true });
export const insertTickerStatsSchema = createInsertSchema(tickerStats).omit({ id: true, updatedAt: true });
export const insertSetupExpectancySchema = createInsertSchema(setupExpectancy).omit({ id: true, updatedAt: true });

export type InsertSymbol = z.infer<typeof insertSymbolSchema>;
export type Symbol = typeof symbols.$inferSelect;
export type DailyBar = typeof dailyBars.$inferSelect;
export type IntradayBar = typeof intradayBars.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type Backtest = typeof backtests.$inferSelect;
export type TimeToHitStat = typeof timeToHitStats.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type UniverseMember = typeof universeMembers.$inferSelect;
export type TickerStat = typeof tickerStats.$inferSelect;
export type SetupExpectancy = typeof setupExpectancy.$inferSelect;
export type SignalProfile = typeof signalProfiles.$inferSelect;
export type InsertSignalProfile = z.infer<typeof insertSignalProfileSchema>;

export const FOCUS_MODES = ["WIN_RATE", "EXPECTANCY", "BARBELL"] as const;
export type FocusMode = typeof FOCUS_MODES[number];

export const SETUP_CATEGORIES = ["PRIMARY", "SECONDARY", "OFF"] as const;
export type SetupCategory = typeof SETUP_CATEGORIES[number];

export const TRADEABILITY_LEVELS = ["CLEAN", "CAUTION", "AVOID"] as const;
export type TradeabilityLevel = typeof TRADEABILITY_LEVELS[number];

export const SETUP_TYPES = ["F", "C", "D", "E", "A", "B"] as const;
export type SetupType = typeof SETUP_TYPES[number];

export const SETUP_LABELS: Record<SetupType, string> = {
  F: "Weak Extreme",
  C: "Gap Fill Magnet",
  D: "Inside Day Expansion",
  E: "PDH/PDL Sweep",
  A: "Thu-Fri-Mon Magnet",
  B: "Mon-Wed-Thu Magnet",
};

export const TIER_LABELS: Record<string, string> = {
  "APLUS": "A+",
  "A": "A",
  "B": "B",
  "C": "C",
};

export const STOP_MODES = ["VOLATILITY_ONLY", "VOLATILITY_TIME", "VOLATILITY_BE", "FULL"] as const;
export type StopMode = typeof STOP_MODES[number];

export const STOP_STAGES = ["INITIAL", "BE", "TIME_TIGHTENED"] as const;
export type StopStage = typeof STOP_STAGES[number];

export const ALERT_EVENT_TYPES = ["hit", "approaching", "new_signal", "miss", "activated"] as const;
export const ACTIVATION_STATUSES = ["NOT_ACTIVE", "ACTIVE", "INVALIDATED"] as const;
export type ActivationStatus = typeof ACTIVATION_STATUSES[number];
export type AlertEventType = typeof ALERT_EVENT_TYPES[number];

export interface TradePlan {
  bias: "BUY" | "SELL";
  entryTrigger: string;
  invalidation: string;
  t1: number;
  t2?: number;
  riskReward?: number;
  stopDistance?: number;
  notes?: string;
}

export type OptionLive = {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  openInterest: number | null;
  volume: number | null;
  impliedVol: number | null;
  delta: number | null;
  lastUpdated: string | null;
};

export type SignalLive = {
  currentPrice: number;
  activeMinutes: number | null;
  progressToTarget: number;
  rNow: number | null;
  distToTargetAtr: number | null;
  distToStopAtr: number | null;
  atr14: number | null;
  stopStage: string;
  timeStopMinutesLeft: number | null;
  optionLive?: OptionLive;
};

export type SignalApi = Signal & { live?: SignalLive };

export interface ConfidenceBreakdown {
  base: number;
  cleanEdge?: number;
  volumeBoost?: number;
  vixProxy?: number;
  distancePenalty?: number;
  total: number;
}

export interface QualityBreakdown {
  edgeStrength: number;
  magnetDistance: number;
  liquidity: number;
  movementEnv: number;
  historicalHitRate: number;
  timeScore?: number;
  total: number;
}

export interface BacktestDetail {
  date: string;
  triggered: boolean;
  hit: boolean;
  timeToHitMin?: number;
  mae?: number;
  mfe?: number;
  magnetPrice: number;
  entryPrice?: number;
}

export interface OptionsCandidate {
  contractSymbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  dte: number;
}

export interface OptionsChecks {
  oiOk: boolean;
  spreadOk: boolean;
  openInterest: number | null;
  spread: number | null;
  bid: number | null;
  ask: number | null;
  checkedAt: string;
  reasonIfFail?: string;
}

export interface OptionsData {
  mode: "NONE" | "AUTO";
  candidate?: OptionsCandidate;
  checks?: OptionsChecks;
  tradable: boolean;
}
