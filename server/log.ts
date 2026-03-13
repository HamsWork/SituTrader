export interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
  level: "info" | "warn" | "error";
}

const MAX_LOG_ENTRIES = 2000;
const logBuffer: LogEntry[] = [];

export function log(message: string, source = "express") {
  const now = new Date();
  const formattedTime = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);

  const lower = message.toLowerCase();
  let level: "info" | "warn" | "error" = "info";
  if (lower.includes("error") || lower.includes("failed") || lower.includes("fatal")) {
    level = "error";
  } else if (lower.includes("warn") || lower.includes("skipped") || lower.includes("fallback")) {
    level = "warn";
  }

  logBuffer.push({
    timestamp: now.toISOString(),
    source,
    message,
    level,
  });

  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
  }
}

export function getLogEntries(options?: {
  source?: string;
  level?: string;
  limit?: number;
  since?: string;
}): LogEntry[] {
  let entries = logBuffer;

  if (options?.source) {
    entries = entries.filter(e => e.source === options.source);
  }
  if (options?.level) {
    entries = entries.filter(e => e.level === options.level);
  }
  if (options?.since) {
    entries = entries.filter(e => e.timestamp >= options.since!);
  }

  const limit = options?.limit ?? 500;
  return entries.slice(-limit);
}

export function getLogSources(): string[] {
  return Array.from(new Set(logBuffer.map(e => e.source))).sort();
}
