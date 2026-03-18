import path from "path";
import fs from "fs";

export type BarCacheDbConfig =
  | { mode: "sqlite"; path: string }
  | { mode: "postgres"; url: string };

/**
 * Resolves bar cache DB config from env.
 * - BAR_CACHE_DB_URL: postgresql:// or postgres:// → external Postgres; unset → SQLite at ./bar_cache.db
 */
export function getBarCacheDbConfig(): BarCacheDbConfig {
  const raw = (process.env.BAR_CACHE_DB_URL ?? "").trim();
  if (!raw) {
    return {
      mode: "sqlite",
      path: path.join(process.cwd(), "bar_cache.db"),
    };
  }
  const lower = raw.toLowerCase();
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) {
    return { mode: "postgres", url: raw };
  }
  return {
    mode: "sqlite",
    path: path.join(process.cwd(), "bar_cache.db"),
  };
}

let resolvedConfig: BarCacheDbConfig | null = null;

export function barCacheConfig(): BarCacheDbConfig {
  if (!resolvedConfig) {
    resolvedConfig = getBarCacheDbConfig();
  }
  return resolvedConfig;
}

export function getBarCacheSqlitePath(): string | null {
  const c = barCacheConfig();
  return c.mode === "sqlite" ? c.path : null;
}

export function getBarCacheDbSizeBytes(): number {
  const p = getBarCacheSqlitePath();
  if (!p) return 0;
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}
