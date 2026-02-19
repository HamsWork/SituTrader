import { eq, and, desc, gte, sql, asc, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  symbols, dailyBars, intradayBars, signals, backtests, appSettings,
  type Symbol, type DailyBar, type IntradayBar, type Signal, type Backtest,
  type InsertSymbol,
} from "@shared/schema";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export interface IStorage {
  getSymbols(): Promise<Symbol[]>;
  getEnabledSymbols(): Promise<Symbol[]>;
  upsertSymbol(ticker: string, enabled?: boolean): Promise<Symbol>;
  toggleSymbol(ticker: string, enabled: boolean): Promise<void>;
  deleteSymbol(ticker: string): Promise<void>;

  upsertDailyBar(bar: Omit<DailyBar, "id">): Promise<void>;
  getDailyBars(ticker: string, from?: string, to?: string): Promise<DailyBar[]>;
  getDailyCoverage(ticker: string): Promise<{ earliest: string; latest: string; count: number } | null>;

  upsertIntradayBar(bar: Omit<IntradayBar, "id">): Promise<void>;
  getIntradayBars(ticker: string, date: string, timeframe?: string): Promise<IntradayBar[]>;
  getIntradayCoverage(ticker: string): Promise<{ earliest: string; latest: string; count: number } | null>;

  upsertSignal(signal: Omit<Signal, "id" | "createdAt">): Promise<Signal>;
  getSignals(ticker?: string, limit?: number): Promise<Signal[]>;
  getActiveSignals(): Promise<Signal[]>;
  updateSignalStatus(id: number, status: string, hitTs?: string, missReason?: string): Promise<void>;
  getSignalStats(): Promise<{
    activeCount: number;
    hitRate60d: number;
    totalSignals: number;
    hitRateBySetup: Record<string, { hits: number; total: number; rate: number }>;
  }>;

  upsertBacktest(bt: Omit<Backtest, "id" | "createdAt">): Promise<Backtest>;
  getBacktests(): Promise<Backtest[]>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getAllSettings(): Promise<Record<string, string>>;
}

export class DatabaseStorage implements IStorage {
  async getSymbols(): Promise<Symbol[]> {
    return db.select().from(symbols).orderBy(asc(symbols.ticker));
  }

  async getEnabledSymbols(): Promise<Symbol[]> {
    return db.select().from(symbols).where(eq(symbols.enabled, true)).orderBy(asc(symbols.ticker));
  }

  async upsertSymbol(ticker: string, enabled: boolean = true): Promise<Symbol> {
    const existing = await db.select().from(symbols).where(eq(symbols.ticker, ticker));
    if (existing.length > 0) return existing[0];
    const [result] = await db.insert(symbols).values({ ticker, enabled }).returning();
    return result;
  }

  async toggleSymbol(ticker: string, enabled: boolean): Promise<void> {
    await db.update(symbols).set({ enabled }).where(eq(symbols.ticker, ticker));
  }

  async deleteSymbol(ticker: string): Promise<void> {
    await db.delete(symbols).where(eq(symbols.ticker, ticker));
  }

  async upsertDailyBar(bar: Omit<DailyBar, "id">): Promise<void> {
    await db.insert(dailyBars).values(bar)
      .onConflictDoUpdate({
        target: [dailyBars.ticker, dailyBars.date],
        set: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume, vwap: bar.vwap },
      });
  }

  async getDailyBars(ticker: string, from?: string, to?: string): Promise<DailyBar[]> {
    let query = db.select().from(dailyBars).where(eq(dailyBars.ticker, ticker));
    if (from) query = query.where(and(eq(dailyBars.ticker, ticker), gte(dailyBars.date, from))) as any;
    const results = await db.select().from(dailyBars)
      .where(
        from && to
          ? and(eq(dailyBars.ticker, ticker), gte(dailyBars.date, from), sql`${dailyBars.date} <= ${to}`)
          : from
          ? and(eq(dailyBars.ticker, ticker), gte(dailyBars.date, from))
          : eq(dailyBars.ticker, ticker)
      )
      .orderBy(asc(dailyBars.date));
    return results;
  }

  async getDailyCoverage(ticker: string): Promise<{ earliest: string; latest: string; count: number } | null> {
    const result = await db.select({
      earliest: sql<string>`min(${dailyBars.date})`,
      latest: sql<string>`max(${dailyBars.date})`,
      count: sql<number>`count(*)::int`,
    }).from(dailyBars).where(eq(dailyBars.ticker, ticker));
    if (!result[0] || !result[0].earliest) return null;
    return result[0] as any;
  }

  async upsertIntradayBar(bar: Omit<IntradayBar, "id">): Promise<void> {
    await db.insert(intradayBars).values(bar)
      .onConflictDoUpdate({
        target: [intradayBars.ticker, intradayBars.ts, intradayBars.timeframe],
        set: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
      });
  }

  async getIntradayBars(ticker: string, date: string, timeframe: string = "5"): Promise<IntradayBar[]> {
    return db.select().from(intradayBars)
      .where(
        and(
          eq(intradayBars.ticker, ticker),
          eq(intradayBars.timeframe, timeframe),
          sql`${intradayBars.ts} >= ${date + "T00:00:00"}`,
          sql`${intradayBars.ts} < ${date + "T23:59:59"}`,
        )
      )
      .orderBy(asc(intradayBars.ts));
  }

  async getIntradayCoverage(ticker: string): Promise<{ earliest: string; latest: string; count: number } | null> {
    const result = await db.select({
      earliest: sql<string>`min(${intradayBars.ts})`,
      latest: sql<string>`max(${intradayBars.ts})`,
      count: sql<number>`count(*)::int`,
    }).from(intradayBars).where(eq(intradayBars.ticker, ticker));
    if (!result[0] || !result[0].earliest) return null;
    return result[0] as any;
  }

  async upsertSignal(signal: Omit<Signal, "id" | "createdAt">): Promise<Signal> {
    const existing = await db.select().from(signals).where(
      and(
        eq(signals.ticker, signal.ticker),
        eq(signals.setupType, signal.setupType),
        eq(signals.asofDate, signal.asofDate),
        eq(signals.targetDate, signal.targetDate),
      )
    );
    if (existing.length > 0) {
      await db.update(signals)
        .set({
          magnetPrice: signal.magnetPrice,
          magnetPrice2: signal.magnetPrice2,
          direction: signal.direction,
          confidence: signal.confidence,
          status: signal.status,
          hitTs: signal.hitTs,
          missReason: signal.missReason,
          tradePlanJson: signal.tradePlanJson,
          confidenceBreakdown: signal.confidenceBreakdown,
        })
        .where(eq(signals.id, existing[0].id));
      return { ...existing[0], ...signal };
    }
    const [result] = await db.insert(signals).values(signal).returning();
    return result;
  }

  async getSignals(ticker?: string, limit: number = 50): Promise<Signal[]> {
    if (ticker) {
      return db.select().from(signals)
        .where(eq(signals.ticker, ticker))
        .orderBy(desc(signals.asofDate))
        .limit(limit);
    }
    return db.select().from(signals)
      .orderBy(desc(signals.asofDate))
      .limit(limit);
  }

  async getActiveSignals(): Promise<Signal[]> {
    return db.select().from(signals)
      .where(eq(signals.status, "pending"))
      .orderBy(desc(signals.confidence));
  }

  async updateSignalStatus(id: number, status: string, hitTs?: string, missReason?: string): Promise<void> {
    const updates: any = { status };
    if (hitTs) updates.hitTs = hitTs;
    if (missReason) updates.missReason = missReason;
    await db.update(signals).set(updates).where(eq(signals.id, id));
  }

  async getSignalStats(): Promise<{
    activeCount: number;
    hitRate60d: number;
    totalSignals: number;
    hitRateBySetup: Record<string, { hits: number; total: number; rate: number }>;
  }> {
    const allSignals = await db.select().from(signals);
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const activeCount = allSignals.filter((s) => s.status === "pending").length;
    const totalSignals = allSignals.length;

    const recent = allSignals.filter((s) => s.asofDate >= sixtyDaysAgo && s.status !== "pending");
    const recentHits = recent.filter((s) => s.status === "hit").length;
    const hitRate60d = recent.length > 0 ? recentHits / recent.length : 0;

    const hitRateBySetup: Record<string, { hits: number; total: number; rate: number }> = {};
    const resolved = allSignals.filter((s) => s.status !== "pending");
    for (const s of resolved) {
      if (!hitRateBySetup[s.setupType]) {
        hitRateBySetup[s.setupType] = { hits: 0, total: 0, rate: 0 };
      }
      hitRateBySetup[s.setupType].total++;
      if (s.status === "hit") hitRateBySetup[s.setupType].hits++;
    }
    for (const key of Object.keys(hitRateBySetup)) {
      const entry = hitRateBySetup[key];
      entry.rate = entry.total > 0 ? entry.hits / entry.total : 0;
    }

    return { activeCount, hitRate60d, totalSignals, hitRateBySetup };
  }

  async upsertBacktest(bt: Omit<Backtest, "id" | "createdAt">): Promise<Backtest> {
    const existing = await db.select().from(backtests).where(
      and(
        eq(backtests.ticker, bt.ticker),
        eq(backtests.setupType, bt.setupType),
        eq(backtests.startDate, bt.startDate),
        eq(backtests.endDate, bt.endDate),
      )
    );
    if (existing.length > 0) {
      await db.update(backtests).set(bt).where(eq(backtests.id, existing[0].id));
      return { ...existing[0], ...bt };
    }
    const [result] = await db.insert(backtests).values(bt).returning();
    return result;
  }

  async getBacktests(): Promise<Backtest[]> {
    return db.select().from(backtests).orderBy(desc(backtests.createdAt));
  }

  async getSetting(key: string): Promise<string | null> {
    const result = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return result[0]?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await db.select().from(appSettings).where(eq(appSettings.key, key));
    if (existing.length > 0) {
      await db.update(appSettings).set({ value }).where(eq(appSettings.key, key));
    } else {
      await db.insert(appSettings).values({ key, value });
    }
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const rows = await db.select().from(appSettings);
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }
}

export const storage = new DatabaseStorage();
