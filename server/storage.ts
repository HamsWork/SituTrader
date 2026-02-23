import { eq, and, desc, gte, sql, asc, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  symbols, dailyBars, intradayBars, signals, backtests, backtestJobs, timeToHitStats, appSettings,
  universeMembers, tickerStats, setupExpectancy, signalProfiles, schedulerState,
  ibkrTrades, ibkrState,
  type Symbol, type DailyBar, type IntradayBar, type Signal, type Backtest, type BacktestJob, type TimeToHitStat,
  type UniverseMember, type TickerStat, type SetupExpectancy, type SignalProfile, type SchedulerState,
  type InsertSymbol, type InsertSignalProfile,
  type IbkrTrade, type IbkrState,
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
  getAlertEligibleSignals(): Promise<Signal[]>;
  updateSignalStatus(id: number, status: string, hitTs?: string, missReason?: string): Promise<void>;
  updateSignalAlert(id: number, alertState: string, nextEligibleAt: string | null): Promise<void>;
  updateSignalActivation(id: number, activationStatus: string, activatedTs?: string, entryPrice?: number, stopPrice?: number, entryTriggerPrice?: number): Promise<void>;
  updateSignalInvalidation(id: number, invalidationTs: string): Promise<void>;
  updateSignalStopStage(id: number, stopStage: string, stopPrice: number, stopMovedToBeTs?: string, timeStopTriggeredTs?: string): Promise<void>;
  getSignalStats(profileFilter?: { allowedSetups: string[]; minTier: string; minQualityScore: number } | null): Promise<{
    activeCount: number;
    hitRate60d: number;
    hits60d: number;
    misses60d: number;
    totalSignals: number;
    hitRateBySetup: Record<string, { hits: number; total: number; rate: number }>;
    topSignalsToday: Signal[];
  }>;
  getHitRateForTickerSetup(ticker: string, setupType: string): Promise<number | null>;

  upsertBacktest(bt: Omit<Backtest, "id" | "createdAt">): Promise<Backtest>;
  getBacktests(): Promise<Backtest[]>;

  createBacktestJob(job: Omit<BacktestJob, "id" | "createdAt" | "updatedAt">): Promise<BacktestJob>;
  getActiveBacktestJob(): Promise<BacktestJob | null>;
  getBacktestJob(id: number): Promise<BacktestJob | null>;
  updateBacktestJob(id: number, updates: Partial<BacktestJob>): Promise<void>;
  getAllBacktestJobs(): Promise<BacktestJob[]>;

  upsertTimeToHitStats(stat: Omit<TimeToHitStat, "id" | "updatedAt">): Promise<TimeToHitStat>;
  getTimeToHitStats(ticker: string, setupType: string, timeframe?: string): Promise<TimeToHitStat | null>;
  getOverallTimeToHitStats(setupType: string, timeframe?: string): Promise<{ p15: number; p30: number; p60: number; p120: number; p240: number; p390: number; sampleSize: number; medianTimeToHitMin: number | null } | null>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getAllSettings(): Promise<Record<string, string>>;

  upsertUniverseMember(member: Omit<UniverseMember, "id">): Promise<void>;
  getUniverseMembers(universeDate: string): Promise<UniverseMember[]>;
  getLatestUniverseDate(): Promise<string | null>;
  clearUniverseDate(universeDate: string): Promise<void>;

  upsertTickerStats(stat: Omit<TickerStat, "id" | "updatedAt">): Promise<void>;
  getTickerStats(ticker: string): Promise<TickerStat | null>;
  getAllTickerStats(): Promise<TickerStat[]>;

  setSymbolWatchlist(ticker: string, isWatchlist: boolean): Promise<void>;
  getWatchlistSymbols(): Promise<Symbol[]>;
  getScanList(mode: string): Promise<string[]>;

  upsertSetupExpectancy(stat: Omit<SetupExpectancy, "id" | "updatedAt">): Promise<void>;
  getSetupExpectancy(setupType: string, ticker?: string | null): Promise<SetupExpectancy | null>;
  getAllSetupExpectancy(): Promise<SetupExpectancy[]>;
  getOverallSetupExpectancy(): Promise<SetupExpectancy[]>;

  getProfiles(): Promise<SignalProfile[]>;
  getActiveProfile(): Promise<SignalProfile | null>;
  getProfile(id: number): Promise<SignalProfile | null>;
  createProfile(profile: InsertSignalProfile): Promise<SignalProfile>;
  updateProfile(id: number, profile: Partial<InsertSignalProfile>): Promise<SignalProfile | null>;
  deleteProfile(id: number): Promise<void>;
  setActiveProfile(id: number): Promise<void>;
  seedDefaultProfiles(): Promise<void>;

  updateSignalOptions(id: number, optionsJson: any): Promise<void>;
  updateSignalOptionTracking(id: number, updates: { optionContractTicker?: string | null; optionEntryMark?: number | null }): Promise<void>;
  updateSignalInstrument(id: number, instrumentType: string, instrumentTicker: string | null, instrumentEntryPrice: number | null): Promise<Signal | null>;
  updateSignalLeveragedEtf(id: number, leveragedEtfJson: any): Promise<void>;
  getActivatedSignals(): Promise<Signal[]>;
  getPendingSignalsForEnrichment(): Promise<Signal[]>;

  getSchedulerState(): Promise<SchedulerState>;
  updateSchedulerState(updates: Partial<Omit<SchedulerState, "key">>): Promise<SchedulerState>;
  ensureSchedulerState(): Promise<SchedulerState>;

  createIbkrTrade(data: Partial<IbkrTrade>): Promise<IbkrTrade>;
  getIbkrTrade(id: number): Promise<IbkrTrade | null>;
  updateIbkrTrade(id: number, updates: Partial<IbkrTrade>): Promise<IbkrTrade | null>;
  getActiveIbkrTrades(): Promise<IbkrTrade[]>;
  getAllIbkrTrades(): Promise<IbkrTrade[]>;
  getIbkrState(): Promise<IbkrState | null>;
  updateIbkrState(updates: Partial<IbkrState>): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getSymbols(): Promise<Symbol[]> {
    return db.select().from(symbols).orderBy(asc(symbols.ticker));
  }

  async getEnabledSymbols(): Promise<Symbol[]> {
    return db.select().from(symbols).where(eq(symbols.enabled, true)).orderBy(asc(symbols.ticker));
  }

  async upsertSymbol(ticker: string, enabled: boolean = true, isWatchlist: boolean = true): Promise<Symbol> {
    const existing = await db.select().from(symbols).where(eq(symbols.ticker, ticker));
    if (existing.length > 0) {
      if (isWatchlist && !existing[0].isWatchlist) {
        await db.update(symbols).set({ isWatchlist: true }).where(eq(symbols.ticker, ticker));
        return { ...existing[0], isWatchlist: true };
      }
      return existing[0];
    }
    const [result] = await db.insert(symbols).values({ ticker, enabled, isWatchlist }).returning();
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
    return db.select().from(dailyBars)
      .where(
        from && to
          ? and(eq(dailyBars.ticker, ticker), gte(dailyBars.date, from), sql`${dailyBars.date} <= ${to}`)
          : from
          ? and(eq(dailyBars.ticker, ticker), gte(dailyBars.date, from))
          : eq(dailyBars.ticker, ticker)
      )
      .orderBy(asc(dailyBars.date));
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
          qualityScore: signal.qualityScore,
          tier: signal.tier,
          alertState: signal.alertState,
          nextAlertEligibleAt: signal.nextAlertEligibleAt,
          qualityBreakdown: signal.qualityBreakdown,
          activationStatus: signal.activationStatus,
          activatedTs: signal.activatedTs,
          entryPriceAtActivation: signal.entryPriceAtActivation,
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
      .orderBy(desc(signals.qualityScore), desc(signals.confidence));
  }

  async getAlertEligibleSignals(): Promise<Signal[]> {
    const now = new Date().toISOString();
    return db.select().from(signals)
      .where(
        and(
          eq(signals.status, "pending"),
          sql`(${signals.nextAlertEligibleAt} IS NULL OR ${signals.nextAlertEligibleAt} <= ${now})`
        )
      )
      .orderBy(desc(signals.qualityScore));
  }

  async updateSignalStatus(id: number, status: string, hitTs?: string, missReason?: string): Promise<void> {
    const updates: any = { status };
    if (hitTs) updates.hitTs = hitTs;
    if (missReason) updates.missReason = missReason;
    await db.update(signals).set(updates).where(eq(signals.id, id));
  }

  async updateSignalAlert(id: number, alertState: string, nextEligibleAt: string | null): Promise<void> {
    await db.update(signals).set({
      alertState,
      nextAlertEligibleAt: nextEligibleAt,
    }).where(eq(signals.id, id));
  }

  async updateSignalActivation(id: number, activationStatus: string, activatedTs?: string, entryPrice?: number, stopPrice?: number, entryTriggerPrice?: number): Promise<void> {
    const updates: any = { activationStatus };
    if (activatedTs) updates.activatedTs = activatedTs;
    if (entryPrice != null) updates.entryPriceAtActivation = entryPrice;
    if (stopPrice != null) updates.stopPrice = stopPrice;
    if (entryTriggerPrice != null) updates.entryTriggerPrice = entryTriggerPrice;
    await db.update(signals).set(updates).where(eq(signals.id, id));
  }

  async updateSignalInvalidation(id: number, invalidationTs: string): Promise<void> {
    await db.update(signals).set({
      activationStatus: "INVALIDATED",
      invalidationTs,
    }).where(eq(signals.id, id));
  }

  async updateSignalStopStage(id: number, stopStage: string, stopPrice: number, stopMovedToBeTs?: string, timeStopTriggeredTs?: string): Promise<void> {
    const update: Record<string, any> = { stopStage, stopPrice };
    if (stopMovedToBeTs) update.stopMovedToBeTs = stopMovedToBeTs;
    if (timeStopTriggeredTs) update.timeStopTriggeredTs = timeStopTriggeredTs;
    await db.update(signals).set(update).where(eq(signals.id, id));
  }

  async updateSignalOptions(id: number, optionsJson: any): Promise<void> {
    await db.update(signals).set({ optionsJson }).where(eq(signals.id, id));
  }

  async updateSignalOptionTracking(id: number, updates: { optionContractTicker?: string | null; optionEntryMark?: number | null }): Promise<void> {
    await db.update(signals).set(updates).where(eq(signals.id, id));
  }

  async updateSignalInstrument(id: number, instrumentType: string, instrumentTicker: string | null, instrumentEntryPrice: number | null): Promise<Signal | null> {
    const result = await db.update(signals)
      .set({ instrumentType, instrumentTicker, instrumentEntryPrice })
      .where(eq(signals.id, id))
      .returning();
    return result[0] ?? null;
  }

  async updateSignalLeveragedEtf(id: number, leveragedEtfJson: any): Promise<void> {
    await db.update(signals).set({ leveragedEtfJson }).where(eq(signals.id, id));
  }

  async getActivatedSignals(): Promise<Signal[]> {
    return db.select().from(signals)
      .where(and(eq(signals.status, "pending"), eq(signals.activationStatus, "ACTIVE")));
  }

  async getPendingSignalsForEnrichment(): Promise<Signal[]> {
    return db.select().from(signals)
      .where(eq(signals.status, "pending"))
      .orderBy(desc(signals.qualityScore));
  }

  async getHitRateForTickerSetup(ticker: string, setupType: string): Promise<number | null> {
    const resolved = await db.select().from(signals).where(
      and(
        eq(signals.ticker, ticker),
        eq(signals.setupType, setupType),
        sql`${signals.status} IN ('hit', 'miss')`
      )
    );
    if (resolved.length < 5) return null;
    const hits = resolved.filter(s => s.status === "hit").length;
    return hits / resolved.length;
  }

  async getSignalStats(profileFilter?: { allowedSetups: string[]; minTier: string; minQualityScore: number } | null): Promise<{
    activeCount: number;
    hitRate60d: number;
    hits60d: number;
    misses60d: number;
    totalSignals: number;
    hitRateBySetup: Record<string, { hits: number; total: number; rate: number }>;
    topSignalsToday: Signal[];
  }> {
    const TIER_RANK: Record<string, number> = { APLUS: 0, A: 1, B: 2, C: 3 };
    const allSignals = await db.select().from(signals);
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const activeCount = allSignals.filter((s) => s.status === "pending").length;
    const totalSignals = allSignals.length;

    const matchesProfile = (s: Signal) => {
      if (!profileFilter) return true;
      if (!profileFilter.allowedSetups.includes(s.setupType)) return false;
      const sigTierRank = TIER_RANK[s.tier] ?? 3;
      const minTierRank = TIER_RANK[profileFilter.minTier] ?? 3;
      if (sigTierRank > minTierRank) return false;
      if (s.qualityScore < profileFilter.minQualityScore) return false;
      return true;
    };

    const recent = allSignals.filter((s) => s.asofDate >= sixtyDaysAgo && s.status !== "pending" && matchesProfile(s));
    const recentHits = recent.filter((s) => s.status === "hit").length;
    const recentMisses = recent.filter((s) => s.status === "miss").length;
    const hitRate60d = recent.length > 0 ? recentHits / recent.length : 0;

    const ALL_SETUP_TYPES = ["A", "B", "C", "D", "E", "F"];
    const hitRateBySetup: Record<string, { hits: number; total: number; rate: number }> = {};
    for (const st of ALL_SETUP_TYPES) {
      hitRateBySetup[st] = { hits: 0, total: 0, rate: 0 };
    }
    const resolved = allSignals.filter((s) => s.status !== "pending" && matchesProfile(s));
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

    const topSignalsToday = allSignals
      .filter(s => s.status === "pending" && (s.tier === "APLUS" || s.tier === "A"))
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, 5);

    return { activeCount, hitRate60d, hits60d: recentHits, misses60d: recentMisses, totalSignals, hitRateBySetup, topSignalsToday };
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

  async createBacktestJob(job: Omit<BacktestJob, "id" | "createdAt" | "updatedAt">): Promise<BacktestJob> {
    const [result] = await db.insert(backtestJobs).values(job).returning();
    return result;
  }

  async getActiveBacktestJob(): Promise<BacktestJob | null> {
    const results = await db.select().from(backtestJobs)
      .where(sql`${backtestJobs.status} IN ('running', 'pending', 'paused')`)
      .orderBy(desc(backtestJobs.createdAt))
      .limit(1);
    return results[0] ?? null;
  }

  async getBacktestJob(id: number): Promise<BacktestJob | null> {
    const results = await db.select().from(backtestJobs).where(eq(backtestJobs.id, id));
    return results[0] ?? null;
  }

  async updateBacktestJob(id: number, updates: Partial<BacktestJob>): Promise<void> {
    await db.update(backtestJobs)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(backtestJobs.id, id));
  }

  async getAllBacktestJobs(): Promise<BacktestJob[]> {
    return db.select().from(backtestJobs).orderBy(desc(backtestJobs.createdAt));
  }

  async upsertTimeToHitStats(stat: Omit<TimeToHitStat, "id" | "updatedAt">): Promise<TimeToHitStat> {
    const existing = await db.select().from(timeToHitStats).where(
      and(
        eq(timeToHitStats.ticker, stat.ticker),
        eq(timeToHitStats.setupType, stat.setupType),
        eq(timeToHitStats.timeframe, stat.timeframe),
      )
    );
    if (existing.length > 0) {
      await db.update(timeToHitStats)
        .set({ ...stat, updatedAt: new Date() })
        .where(eq(timeToHitStats.id, existing[0].id));
      return { ...existing[0], ...stat, updatedAt: new Date() };
    }
    const [result] = await db.insert(timeToHitStats).values(stat).returning();
    return result;
  }

  async getTimeToHitStats(ticker: string, setupType: string, timeframe: string = "5"): Promise<TimeToHitStat | null> {
    const result = await db.select().from(timeToHitStats).where(
      and(
        eq(timeToHitStats.ticker, ticker),
        eq(timeToHitStats.setupType, setupType),
        eq(timeToHitStats.timeframe, timeframe),
      )
    );
    return result[0] ?? null;
  }

  async getOverallTimeToHitStats(setupType: string, timeframe: string = "5"): Promise<{ p15: number; p30: number; p60: number; p120: number; p240: number; p390: number; sampleSize: number; medianTimeToHitMin: number | null } | null> {
    const allStats = await db.select().from(timeToHitStats).where(
      and(
        eq(timeToHitStats.setupType, setupType),
        eq(timeToHitStats.timeframe, timeframe),
      )
    );
    if (allStats.length === 0) return null;
    const totalSamples = allStats.reduce((s, r) => s + r.sampleSize, 0);
    if (totalSamples === 0) return null;
    const weighted = (field: keyof TimeToHitStat) =>
      allStats.reduce((s, r) => s + (r[field] as number) * r.sampleSize, 0) / totalSamples;
    const medians = allStats.filter(r => r.medianTimeToHitMin !== null).map(r => r.medianTimeToHitMin!);
    const overallMedian = medians.length > 0 ? medians.sort((a, b) => a - b)[Math.floor(medians.length / 2)] : null;
    return {
      p15: weighted("p15"),
      p30: weighted("p30"),
      p60: weighted("p60"),
      p120: weighted("p120"),
      p240: weighted("p240"),
      p390: weighted("p390"),
      sampleSize: totalSamples,
      medianTimeToHitMin: overallMedian,
    };
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

  async upsertUniverseMember(member: Omit<UniverseMember, "id">): Promise<void> {
    await db.insert(universeMembers).values(member)
      .onConflictDoUpdate({
        target: [universeMembers.universeDate, universeMembers.ticker],
        set: { avgDollarVol20d: member.avgDollarVol20d, rank: member.rank, included: member.included },
      });
  }

  async getUniverseMembers(universeDate: string): Promise<UniverseMember[]> {
    return db.select().from(universeMembers)
      .where(and(eq(universeMembers.universeDate, universeDate), eq(universeMembers.included, true)))
      .orderBy(asc(universeMembers.rank));
  }

  async getLatestUniverseDate(): Promise<string | null> {
    const result = await db.select({ maxDate: sql<string>`max(${universeMembers.universeDate})` })
      .from(universeMembers);
    return result[0]?.maxDate ?? null;
  }

  async clearUniverseDate(universeDate: string): Promise<void> {
    await db.delete(universeMembers).where(eq(universeMembers.universeDate, universeDate));
  }

  async upsertTickerStats(stat: Omit<TickerStat, "id" | "updatedAt">): Promise<void> {
    await db.insert(tickerStats).values(stat)
      .onConflictDoUpdate({
        target: [tickerStats.ticker],
        set: {
          avgDollarVol20d: stat.avgDollarVol20d,
          avgVol20d: stat.avgVol20d,
          atr14: stat.atr14,
          lastPrice: stat.lastPrice,
          updatedAt: new Date(),
        },
      });
  }

  async getTickerStats(ticker: string): Promise<TickerStat | null> {
    const result = await db.select().from(tickerStats).where(eq(tickerStats.ticker, ticker));
    return result[0] ?? null;
  }

  async getAllTickerStats(): Promise<TickerStat[]> {
    return db.select().from(tickerStats).orderBy(desc(tickerStats.avgDollarVol20d));
  }

  async setSymbolWatchlist(ticker: string, isWatchlist: boolean): Promise<void> {
    await db.update(symbols).set({ isWatchlist }).where(eq(symbols.ticker, ticker));
  }

  async getWatchlistSymbols(): Promise<Symbol[]> {
    return db.select().from(symbols)
      .where(and(eq(symbols.enabled, true), eq(symbols.isWatchlist, true)))
      .orderBy(asc(symbols.ticker));
  }

  async getScanList(mode: string): Promise<string[]> {
    if (mode === "WATCHLIST_ONLY") {
      const wl = await this.getWatchlistSymbols();
      return wl.map(s => s.ticker);
    }

    const latestDate = await this.getLatestUniverseDate();
    const universeTickers = latestDate
      ? (await this.getUniverseMembers(latestDate)).map(m => m.ticker)
      : [];

    if (mode === "LIQUIDITY_ONLY") {
      return universeTickers;
    }

    const wl = await this.getWatchlistSymbols();
    const watchlistTickers = wl.map(s => s.ticker);
    const combined = new Set([...watchlistTickers, ...universeTickers]);
    return Array.from(combined).sort();
  }

  async upsertSetupExpectancy(stat: Omit<SetupExpectancy, "id" | "updatedAt">): Promise<void> {
    const tickerCondition = stat.ticker === null
      ? sql`${setupExpectancy.ticker} IS NULL`
      : eq(setupExpectancy.ticker, stat.ticker);
    const existing = await db.select().from(setupExpectancy).where(
      and(eq(setupExpectancy.setupType, stat.setupType), tickerCondition)
    );
    if (existing.length > 0) {
      await db.update(setupExpectancy)
        .set({ ...stat, updatedAt: new Date() })
        .where(eq(setupExpectancy.id, existing[0].id));
    } else {
      await db.insert(setupExpectancy).values(stat);
    }
  }

  async getSetupExpectancy(setupType: string, ticker?: string | null): Promise<SetupExpectancy | null> {
    const tickerCondition = !ticker
      ? sql`${setupExpectancy.ticker} IS NULL`
      : eq(setupExpectancy.ticker, ticker);
    const result = await db.select().from(setupExpectancy).where(
      and(eq(setupExpectancy.setupType, setupType), tickerCondition)
    );
    return result[0] ?? null;
  }

  async getAllSetupExpectancy(): Promise<SetupExpectancy[]> {
    return db.select().from(setupExpectancy).orderBy(desc(setupExpectancy.expectancyR));
  }

  async getOverallSetupExpectancy(): Promise<SetupExpectancy[]> {
    return db.select().from(setupExpectancy)
      .where(sql`${setupExpectancy.ticker} IS NULL`)
      .orderBy(desc(setupExpectancy.expectancyR));
  }

  async getProfiles(): Promise<SignalProfile[]> {
    return db.select().from(signalProfiles).orderBy(asc(signalProfiles.name));
  }

  async getActiveProfile(): Promise<SignalProfile | null> {
    const result = await db.select().from(signalProfiles).where(eq(signalProfiles.isActive, true));
    return result[0] ?? null;
  }

  async getProfile(id: number): Promise<SignalProfile | null> {
    const result = await db.select().from(signalProfiles).where(eq(signalProfiles.id, id));
    return result[0] ?? null;
  }

  async createProfile(profile: InsertSignalProfile): Promise<SignalProfile> {
    const result = await db.insert(signalProfiles).values(profile).returning();
    return result[0];
  }

  async updateProfile(id: number, profile: Partial<InsertSignalProfile>): Promise<SignalProfile | null> {
    const result = await db.update(signalProfiles).set(profile).where(eq(signalProfiles.id, id)).returning();
    return result[0] ?? null;
  }

  async deleteProfile(id: number): Promise<void> {
    await db.delete(signalProfiles).where(eq(signalProfiles.id, id));
  }

  async setActiveProfile(id: number): Promise<void> {
    await db.update(signalProfiles).set({ isActive: false }).where(eq(signalProfiles.isActive, true));
    await db.update(signalProfiles).set({ isActive: true }).where(eq(signalProfiles.id, id));
  }

  async seedDefaultProfiles(): Promise<void> {
    const existing = await db.select().from(signalProfiles);

    if (existing.length === 0) {
      const defaults: InsertSignalProfile[] = [
        {
          name: "Win-Rate Focus (A/B)",
          allowedSetups: ["A", "B"],
          minTier: "A",
          minQualityScore: 70,
          minSampleSize: 50,
          minHitRate: 0.70,
          minExpectancyR: 0,
          timePriorityMode: "EARLY",
          isPinned: true,
          isActive: true,
        },
        {
          name: "Balanced",
          allowedSetups: ["A", "B", "C"],
          minTier: "B",
          minQualityScore: 60,
          minSampleSize: 30,
          minHitRate: 0,
          minExpectancyR: 0.15,
          timePriorityMode: "BLEND",
          isPinned: false,
          isActive: false,
        },
        {
          name: "Home Run",
          allowedSetups: ["A", "B", "C", "D", "E", "F"],
          minTier: "B",
          minQualityScore: 50,
          minSampleSize: 20,
          minHitRate: 0,
          minExpectancyR: 0.25,
          timePriorityMode: "SAME_DAY",
          isPinned: false,
          isActive: false,
        },
        {
          name: "A Only",
          allowedSetups: ["A", "B", "C", "D", "E", "F"],
          minTier: "A",
          minQualityScore: 0,
          minSampleSize: 0,
          minHitRate: 0,
          minExpectancyR: 0,
          timePriorityMode: "BLEND",
          isPinned: false,
          isActive: false,
        },
        {
          name: "All Together",
          allowedSetups: ["A", "B", "C", "D", "E", "F"],
          minTier: "C",
          minQualityScore: 0,
          minSampleSize: 0,
          minHitRate: 0,
          minExpectancyR: 0,
          timePriorityMode: "BLEND",
          isPinned: false,
          isActive: false,
        },
      ];

      for (const p of defaults) {
        await db.insert(signalProfiles).values(p);
      }
      return;
    }

    const existingNames = new Set(existing.map(p => p.name));
    const newProfiles: InsertSignalProfile[] = [
      {
        name: "A Only",
        allowedSetups: ["A", "B", "C", "D", "E", "F"],
        minTier: "A",
        minQualityScore: 0,
        minSampleSize: 0,
        minHitRate: 0,
        minExpectancyR: 0,
        timePriorityMode: "BLEND",
        isPinned: false,
        isActive: false,
      },
      {
        name: "All Together",
        allowedSetups: ["A", "B", "C", "D", "E", "F"],
        minTier: "C",
        minQualityScore: 0,
        minSampleSize: 0,
        minHitRate: 0,
        minExpectancyR: 0,
        timePriorityMode: "BLEND",
        isPinned: false,
        isActive: false,
      },
    ];

    for (const p of newProfiles) {
      if (!existingNames.has(p.name)) {
        await db.insert(signalProfiles).values(p);
      }
    }
  }

  async getSchedulerState(): Promise<SchedulerState> {
    const rows = await db.select().from(schedulerState).where(eq(schedulerState.key, "default"));
    if (rows.length === 0) return this.ensureSchedulerState();
    return rows[0];
  }

  async updateSchedulerState(updates: Partial<Omit<SchedulerState, "key">>): Promise<SchedulerState> {
    await this.ensureSchedulerState();
    await db.update(schedulerState).set(updates).where(eq(schedulerState.key, "default"));
    return this.getSchedulerState();
  }

  async ensureSchedulerState(): Promise<SchedulerState> {
    const rows = await db.select().from(schedulerState).where(eq(schedulerState.key, "default"));
    if (rows.length > 0) return rows[0];
    const defaults: SchedulerState = {
      key: "default",
      authorModeEnabled: true,
      autoEnabled: true,
      afterCloseEnabled: true,
      preOpenEnabled: true,
      liveMonitorEnabled: true,
      lastAfterCloseRunTs: null,
      lastPreOpenRunTs: null,
      lastLiveMonitorRunTs: null,
      lastRunSummaryJson: null,
      nextAfterCloseTs: null,
      nextPreOpenTs: null,
    };
    await db.insert(schedulerState).values(defaults);
    return defaults;
  }

  async createIbkrTrade(data: Partial<IbkrTrade>): Promise<IbkrTrade> {
    const qty = data.quantity ?? 1;
    const rows = await db.insert(ibkrTrades).values({
      signalId: data.signalId ?? null,
      ticker: data.ticker ?? "",
      instrumentType: data.instrumentType ?? "OPTION",
      instrumentTicker: data.instrumentTicker ?? null,
      side: data.side ?? "BUY",
      quantity: qty,
      originalQuantity: data.originalQuantity ?? qty,
      remainingQuantity: data.remainingQuantity ?? qty,
      tpHitLevel: data.tpHitLevel ?? 0,
      entryPrice: data.entryPrice ?? null,
      exitPrice: data.exitPrice ?? null,
      stopPrice: data.stopPrice ?? null,
      target1Price: data.target1Price ?? null,
      target2Price: data.target2Price ?? null,
      tp1FillPrice: data.tp1FillPrice ?? null,
      tp2FillPrice: data.tp2FillPrice ?? null,
      tp1PnlRealized: data.tp1PnlRealized ?? null,
      ibkrOrderId: data.ibkrOrderId ?? null,
      ibkrStopOrderId: data.ibkrStopOrderId ?? null,
      ibkrTp1OrderId: data.ibkrTp1OrderId ?? null,
      ibkrTp2OrderId: data.ibkrTp2OrderId ?? null,
      status: data.status ?? "PENDING",
      pnl: data.pnl ?? null,
      pnlPct: data.pnlPct ?? null,
      rMultiple: data.rMultiple ?? null,
      filledAt: data.filledAt ?? null,
      closedAt: data.closedAt ?? null,
      tp1FilledAt: data.tp1FilledAt ?? null,
      tp2FilledAt: data.tp2FilledAt ?? null,
      stopMovedToBe: data.stopMovedToBe ?? false,
      discordAlertSent: data.discordAlertSent ?? false,
      discordUpdateSent: data.discordUpdateSent ?? false,
      notes: data.notes ?? null,
      detailsJson: data.detailsJson ?? null,
    }).returning();
    return rows[0];
  }

  async getIbkrTrade(id: number): Promise<IbkrTrade | null> {
    const rows = await db.select().from(ibkrTrades).where(eq(ibkrTrades.id, id));
    return rows[0] ?? null;
  }

  async updateIbkrTrade(id: number, updates: Partial<IbkrTrade>): Promise<IbkrTrade | null> {
    const { id: _id, createdAt: _ca, ...rest } = updates as any;
    const rows = await db.update(ibkrTrades).set(rest).where(eq(ibkrTrades.id, id)).returning();
    return rows[0] ?? null;
  }

  async getActiveIbkrTrades(): Promise<IbkrTrade[]> {
    return db.select().from(ibkrTrades).where(eq(ibkrTrades.status, "FILLED")).orderBy(desc(ibkrTrades.id));
  }

  async getAllIbkrTrades(): Promise<IbkrTrade[]> {
    return db.select().from(ibkrTrades).orderBy(desc(ibkrTrades.id));
  }

  async getIbkrState(): Promise<IbkrState | null> {
    const rows = await db.select().from(ibkrState).where(eq(ibkrState.key, "default"));
    return rows[0] ?? null;
  }

  async updateIbkrState(updates: Partial<IbkrState>): Promise<void> {
    const existing = await this.getIbkrState();
    if (existing) {
      const { key: _k, ...rest } = updates as any;
      await db.update(ibkrState).set(rest).where(eq(ibkrState.key, "default"));
    } else {
      await db.insert(ibkrState).values({ key: "default", ...updates } as any);
    }
  }
}

export const storage = new DatabaseStorage();
