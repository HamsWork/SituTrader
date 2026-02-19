import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, unique, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const symbols = pgTable("symbols", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
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

export const insertSymbolSchema = createInsertSchema(symbols).omit({ id: true, createdAt: true });
export const insertSignalSchema = createInsertSchema(signals).omit({ id: true, createdAt: true });
export const insertBacktestSchema = createInsertSchema(backtests).omit({ id: true, createdAt: true });
export const insertDailyBarSchema = createInsertSchema(dailyBars).omit({ id: true });
export const insertIntradayBarSchema = createInsertSchema(intradayBars).omit({ id: true });
export const insertTimeToHitStatsSchema = createInsertSchema(timeToHitStats).omit({ id: true, updatedAt: true });

export type InsertSymbol = z.infer<typeof insertSymbolSchema>;
export type Symbol = typeof symbols.$inferSelect;
export type DailyBar = typeof dailyBars.$inferSelect;
export type IntradayBar = typeof intradayBars.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type Backtest = typeof backtests.$inferSelect;
export type TimeToHitStat = typeof timeToHitStats.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;

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

export const ALERT_EVENT_TYPES = ["hit", "approaching", "new_signal", "miss"] as const;
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
