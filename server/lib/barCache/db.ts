import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { Bar, BarCacheStats } from "./types";

const DB_PATH = path.join(process.cwd(), "bar_cache.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
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

  return db;
}

export function queryBarsRange(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): Bar[] {
  const d = getDb();
  const rows = d
    .prepare(
      `SELECT timestamp, open, high, low, close, volume
       FROM bar_cache
       WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp ASC`,
    )
    .all(symbol, timeframe, adjusted ? 1 : 0, startTs, endTs) as any[];

  return rows.map((r) => ({
    timestamp: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

export function getLatestCachedTs(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): number | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT MAX(timestamp) as maxTs
       FROM bar_cache
       WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?`,
    )
    .get(symbol, timeframe, adjusted ? 1 : 0, startTs, endTs) as any;
  return row?.maxTs ?? null;
}

export function getCachedBarCount(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): number {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM bar_cache
       WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?`,
    )
    .get(symbol, timeframe, adjusted ? 1 : 0, startTs, endTs) as any;
  return row?.cnt ?? 0;
}

export function getEarliestCachedTs(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  startTs: number,
  endTs: number,
): number | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT MIN(timestamp) as minTs
       FROM bar_cache
       WHERE symbol = ? AND timeframe = ? AND adjusted = ? AND timestamp >= ? AND timestamp <= ?`,
    )
    .get(symbol, timeframe, adjusted ? 1 : 0, startTs, endTs) as any;
  return row?.minTs ?? null;
}

export function getMeta(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
): { lastFetched: number } | null {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT last_fetched FROM cache_meta WHERE symbol = ? AND timeframe = ? AND adjusted = ?`,
    )
    .get(symbol, timeframe, adjusted ? 1 : 0) as any;
  if (!row) return null;
  return { lastFetched: row.last_fetched };
}

export function touchMeta(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO cache_meta (symbol, timeframe, adjusted, last_fetched)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol, timeframe, adjusted) DO UPDATE SET last_fetched = excluded.last_fetched`,
  ).run(symbol, timeframe, adjusted ? 1 : 0, Date.now());
}

export function upsertBarsAndMeta(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
  bars: Bar[],
): void {
  if (bars.length === 0) return;
  const d = getDb();

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
    const adj = adjusted ? 1 : 0;
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
    upsertMeta.run(symbol, timeframe, adj, Date.now());
  });

  tx();
}

export function getBarCacheStats(): BarCacheStats {
  const d = getDb();

  const countRow = d
    .prepare(`SELECT COUNT(*) as cnt FROM bar_cache`)
    .get() as any;
  const symbolRow = d
    .prepare(`SELECT COUNT(DISTINCT symbol) as cnt FROM bar_cache`)
    .get() as any;
  const oldestBar = d
    .prepare(`SELECT MIN(timestamp) as val FROM bar_cache`)
    .get() as any;
  const newestBar = d
    .prepare(`SELECT MAX(timestamp) as val FROM bar_cache`)
    .get() as any;
  const oldestMeta = d
    .prepare(`SELECT MIN(last_fetched) as val FROM cache_meta`)
    .get() as any;
  const newestMeta = d
    .prepare(`SELECT MAX(last_fetched) as val FROM cache_meta`)
    .get() as any;

  const walMode = d.pragma("journal_mode", { simple: true }) as string;
  const synchronous = d.pragma("synchronous", { simple: true }) as string;

  let dbSizeBytes = 0;
  try {
    const stat = fs.statSync(DB_PATH);
    dbSizeBytes = stat.size;
  } catch {}

  return {
    totalBarsCached: countRow?.cnt ?? 0,
    uniqueSymbols: symbolRow?.cnt ?? 0,
    dbSizeBytes,
    oldestBarTimestamp: oldestBar?.val ?? null,
    newestBarTimestamp: newestBar?.val ?? null,
    oldestLastFetched: oldestMeta?.val ?? null,
    newestLastFetched: newestMeta?.val ?? null,
    walMode: String(walMode),
    synchronous: String(synchronous),
  };
}
