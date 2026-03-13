import path from "path";
import fs from "fs";

export type BarCacheDbConfig =
  | { mode: "sqlite"; path: string }
  | { mode: "postgres"; url: string };

/**
 * Resolves bar cache DB config from env.
 * - BAR_CACHE_DB_URL or BAR_CACHE_DB_PATH
 * - Unset → SQLite at process.cwd()/bar_cache.db
 * - file:/path or path string → SQLite at that path
 * - postgres:// or postgresql:// → Postgres at that URL
 */
export function getBarCacheDbConfig(): BarCacheDbConfig {
  const raw =
    process.env.BAR_CACHE_DB_URL ??
    process.env.BAR_CACHE_DB_PATH ??
    "";

  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      mode: "sqlite",
      path: path.join(process.cwd(), "bar_cache.db"),
    };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("postgresql://") || lower.startsWith("postgres://")) {
    return { mode: "postgres", url: trimmed };
  }

  if (lower.startsWith("file:")) {
    try {
      const filePath = new URL(trimmed).pathname;
      return {
        mode: "sqlite",
        path: path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath),
      };
    } catch {
      return { mode: "sqlite", path: path.resolve(process.cwd(), "bar_cache.db") };
    }
  }

  return {
    mode: "sqlite",
    path: path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed),
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
