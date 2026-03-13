import Database from "better-sqlite3";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { barCache, barCacheMeta } from "@shared/schema";
import type { Bar, BarCacheStats } from "./types";
import { barCacheConfig, getBarCacheDbSizeBytes } from "./config";

// ----- SQLite -----
let sqliteDb: Database.Database | null = null;

function getSqlitePath(): string {
  const c = barCacheConfig();
  if (c.mode !== "sqlite") throw new Error("Bar cache is not configured for SQLite");
  return c.path;
}

function getSqliteDb(): Database.Database {
  if (sqliteDb) return sqliteDb;
  const dbPath = getSqlitePath();
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("synchronous = NORMAL");
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS bar_cache (
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      adjusted INTEGER NOT NULL,
      timestamp REAL NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      UNIQUE(symbol, timeframe, adjusted, timestamp)
    );
    CREATE TABLE IF NOT EXISTS cache_meta (
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      adjusted INTEGER NOT NULL,
      last_fetched REAL NOT NULL,
      PRIMARY KEY(symbol, timeframe, adjusted)
    );
    CREATE INDEX IF NOT EXISTS idx_bar_cache_lookup
      ON bar_cache(symbol, timeframe, adjusted, timestamp);
  `);
  return sqliteDb;
}

// ----- Postgres -----
let pgPool: pg.Pool | null = null;
let pgDb: ReturnType<typeof drizzle> | null = null;

function getPgDb(): ReturnType<typeof drizzle> {
  if (pgDb) return pgDb;
  const c = barCacheConfig();
  if (c.mode !== "postgres") throw new Error("Bar cache is not configured for Postgres");
  pgPool = new pg.Pool({ connectionString: c.url });
  pgDb = drizzle(pgPool);
  return pgDb;
}

// ----- Shared API (async) -----

export function getDb(): Database.Database {
  const c = barCacheConfig();
  if (c.mode === "sqlite") return getSqliteDb();
  throw new Error("getDb() returns SQLite only; use getBars/db helpers for Postgres");
}

export async function queryBarsRange(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): Promise<Bar[]> {
  const c = barCacheConfig();
  const adj = adjusted ? 1 : 0;

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    const rows = d
      .prepare(
        `SELECT timestamp, open, high, low, close, volume
         FROM bar_cache
         WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
      )
      .all(symbol, timeframe, adj, startTs, endTs) as any[];
    return rows.map((r) => ({
      timestamp: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  }

  const db = getPgDb();
  const rows = await db
    .select()
    .from(barCache)
    .where(
      and(
        eq(barCache.symbol, symbol),
        eq(barCache.timeframe, timeframe),
        eq(barCache.adjusted, adj),
        gte(barCache.timestamp, startTs),
        lte(barCache.timestamp, endTs),
      ),
    )
    .orderBy(barCache.timestamp);
  return rows.map((r) => ({
    timestamp: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

export async function getLatestCachedTs(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): Promise<number | null> {
  const c = barCacheConfig();
  const adj = adjusted ? 1 : 0;

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    const row = d
      .prepare(
        `SELECT MAX(timestamp) as maxTs FROM bar_cache
         WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?`,
      )
      .get(symbol, timeframe, adj, startTs, endTs) as any;
    return row?.maxTs ?? null;
  }

  const db = getPgDb();
  const rows = await db
    .select({ maxTs: sql<number>`MAX(${barCache.timestamp})` })
    .from(barCache)
    .where(
      and(
        eq(barCache.symbol, symbol),
        eq(barCache.timeframe, timeframe),
        eq(barCache.adjusted, adj),
        gte(barCache.timestamp, startTs),
        lte(barCache.timestamp, endTs),
      ),
    );
  const val = rows[0]?.maxTs;
  return val != null ? Number(val) : null;
}

export async function getCachedBarCount(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): Promise<number> {
  const c = barCacheConfig();
  const adj = adjusted ? 1 : 0;

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    const row = d
      .prepare(
        `SELECT COUNT(*) as cnt FROM bar_cache
         WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?`,
      )
      .get(symbol, timeframe, adj, startTs, endTs) as any;
    return row?.cnt ?? 0;
  }

  const db = getPgDb();
  const rows = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(barCache)
    .where(
      and(
        eq(barCache.symbol, symbol),
        eq(barCache.timeframe, timeframe),
        eq(barCache.adjusted, adj),
        gte(barCache.timestamp, startTs),
        lte(barCache.timestamp, endTs),
      ),
    );
  return Number(rows[0]?.cnt ?? 0);
}

export async function getEarliestCachedTs(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): Promise<number | null> {
  const c = barCacheConfig();
  const adj = adjusted ? 1 : 0;

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    const row = d
      .prepare(
        `SELECT MIN(timestamp) as minTs FROM bar_cache
         WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?`,
      )
      .get(symbol, timeframe, adj, startTs, endTs) as any;
    return row?.minTs ?? null;
  }

  const db = getPgDb();
  const rows = await db
    .select({ minTs: sql<number>`MIN(${barCache.timestamp})` })
    .from(barCache)
    .where(
      and(
        eq(barCache.symbol, symbol),
        eq(barCache.timeframe, timeframe),
        eq(barCache.adjusted, adj),
        gte(barCache.timestamp, startTs),
        lte(barCache.timestamp, endTs),
      ),
    );
  const val = rows[0]?.minTs;
  return val != null ? Number(val) : null;
}

export async function getMeta(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
): Promise<{ lastFetched: number } | null> {
  const c = barCacheConfig();
  const adj = adjusted ? 1 : 0;

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    const row = d
      .prepare(`SELECT last_fetched FROM cache_meta WHERE symbol = ? AND timeframe = ? AND adjusted = ?`)
      .get(symbol, timeframe, adj) as any;
    if (!row) return null;
    return { lastFetched: row.last_fetched };
  }

  const db = getPgDb();
  const rows = await db
    .select()
    .from(barCacheMeta)
    .where(
      and(
        eq(barCacheMeta.symbol, symbol),
        eq(barCacheMeta.timeframe, timeframe),
        eq(barCacheMeta.adjusted, adj),
      ),
    );
  const r = rows[0];
  return r ? { lastFetched: r.lastFetched } : null;
}

export async function touchMeta(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
): Promise<void> {
  const c = barCacheConfig();
  const adj = adjusted ? 1 : 0;
  const now = Date.now();

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    d.prepare(
      `INSERT INTO cache_meta (symbol, timeframe, adjusted, last_fetched)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol, timeframe, adjusted) DO UPDATE SET last_fetched = excluded.last_fetched`,
    ).run(symbol, timeframe, adj, now);
    return;
  }

  const db = getPgDb();
  await db
    .insert(barCacheMeta)
    .values({ symbol, timeframe, adjusted: adj, lastFetched: now })
    .onConflictDoUpdate({
      target: [barCacheMeta.symbol, barCacheMeta.timeframe, barCacheMeta.adjusted],
      set: { lastFetched: now },
    });
}

export async function upsertBarsAndMeta(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  bars: Bar[],
): Promise<void> {
  if (bars.length === 0) return;
  const c = barCacheConfig();
  const adj = adjusted ? 1 : 0;
  const now = Date.now();

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    const insertBar = d.prepare(
      `INSERT OR REPLACE INTO bar_cache (symbol, timeframe, adjusted, timestamp, open, high, low, close, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const upsertMeta = d.prepare(
      `INSERT INTO cache_meta (symbol, timeframe, adjusted, last_fetched)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol, timeframe, adjusted) DO UPDATE SET last_fetched = excluded.last_fetched`,
    );
    const tx = d.transaction(() => {
      for (const bar of bars) {
        insertBar.run(
          symbol,
          timeframe,
          adj,
          bar.timestamp,
          bar.open,
          bar.high,
          bar.low,
          bar.close,
          bar.volume,
        );
      }
      upsertMeta.run(symbol, timeframe, adj, now);
    });
    tx();
    return;
  }

  const db = getPgDb();
  for (const bar of bars) {
    await db
      .insert(barCache)
      .values({
        symbol,
        timeframe,
        adjusted: adj,
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })
      .onConflictDoUpdate({
        target: [barCache.symbol, barCache.timeframe, barCache.adjusted, barCache.timestamp],
        set: {
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        },
      });
  }
  await db
    .insert(barCacheMeta)
    .values({ symbol, timeframe, adjusted: adj, lastFetched: now })
    .onConflictDoUpdate({
      target: [barCacheMeta.symbol, barCacheMeta.timeframe, barCacheMeta.adjusted],
      set: { lastFetched: now },
    });
}

export async function getBarCacheStats(): Promise<BarCacheStats> {
  const c = barCacheConfig();

  if (c.mode === "sqlite") {
    const d = getSqliteDb();
    const countRow = d.prepare(`SELECT COUNT(*) as cnt FROM bar_cache`).get() as any;
    const symbolRow = d.prepare(`SELECT COUNT(DISTINCT symbol) as cnt FROM bar_cache`).get() as any;
    const oldestBar = d.prepare(`SELECT MIN(timestamp) as val FROM bar_cache`).get() as any;
    const newestBar = d.prepare(`SELECT MAX(timestamp) as val FROM bar_cache`).get() as any;
    const oldestMeta = d.prepare(`SELECT MIN(last_fetched) as val FROM cache_meta`).get() as any;
    const newestMeta = d.prepare(`SELECT MAX(last_fetched) as val FROM cache_meta`).get() as any;
    const walMode = d.pragma("journal_mode", { simple: true }) as string;
    const synchronous = d.pragma("synchronous", { simple: true }) as string;
    return {
      totalBarsCached: countRow?.cnt ?? 0,
      uniqueSymbols: symbolRow?.cnt ?? 0,
      dbSizeBytes: getBarCacheDbSizeBytes(),
      oldestBarTimestamp: oldestBar?.val ?? null,
      newestBarTimestamp: newestBar?.val ?? null,
      oldestLastFetched: oldestMeta?.val ?? null,
      newestLastFetched: newestMeta?.val ?? null,
      walMode: String(walMode),
      synchronous: String(synchronous),
    };
  }

  const db = getPgDb();
  const countRows = await db.select({ cnt: sql<number>`COUNT(*)::int` }).from(barCache);
  const symbolRows = await db.select({ cnt: sql<number>`COUNT(DISTINCT ${barCache.symbol})::int` }).from(barCache);
  const oldestRows = await db.select({ val: sql<number | null>`MIN(${barCache.timestamp})` }).from(barCache);
  const newestRows = await db.select({ val: sql<number | null>`MAX(${barCache.timestamp})` }).from(barCache);
  const oldestMetaRows = await db.select({ val: sql<number | null>`MIN(${barCacheMeta.lastFetched})` }).from(barCacheMeta);
  const newestMetaRows = await db.select({ val: sql<number | null>`MAX(${barCacheMeta.lastFetched})` }).from(barCacheMeta);

  let dbSizeBytes = 0;
  try {
    const sizeResult = await db.execute(
      sql`SELECT (pg_total_relation_size('bar_cache') + pg_total_relation_size('bar_cache_meta'))::bigint as total`,
    );
    const rows = (sizeResult as { rows?: { total: string }[] })?.rows;
    const total = rows?.[0]?.total;
    if (total != null) dbSizeBytes = Number(total);
  } catch {}

  return {
    totalBarsCached: countRows[0]?.cnt ?? 0,
    uniqueSymbols: symbolRows[0]?.cnt ?? 0,
    dbSizeBytes,
    oldestBarTimestamp: oldestRows[0]?.val != null ? Number(oldestRows[0].val) : null,
    newestBarTimestamp: newestRows[0]?.val != null ? Number(newestRows[0].val) : null,
    oldestLastFetched: oldestMetaRows[0]?.val != null ? Number(oldestMetaRows[0].val) : null,
    newestLastFetched: newestMetaRows[0]?.val != null ? Number(newestMetaRows[0].val) : null,
    walMode: "n/a",
    synchronous: "n/a",
  };
}
