import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, RefreshCw, Search, Pause, Play, ArrowDown, Filter } from "lucide-react";

interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
  level: "info" | "warn" | "error";
}

interface LogResponse {
  entries: LogEntry[];
  sources: string[];
  total: number;
}

const levelColors: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  warn: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  error: "bg-red-500/10 text-red-500 border-red-500/20",
};

const sourceColors: Record<string, string> = {
  scheduler: "bg-purple-500/10 text-purple-400",
  activation: "bg-green-500/10 text-green-400",
  btod: "bg-orange-500/10 text-orange-400",
  optionMonitor: "bg-cyan-500/10 text-cyan-400",
  letfMonitor: "bg-teal-500/10 text-teal-400",
  discord: "bg-indigo-500/10 text-indigo-400",
  ibkr: "bg-pink-500/10 text-pink-400",
  polygon: "bg-amber-500/10 text-amber-400",
  options: "bg-violet-500/10 text-violet-400",
  express: "bg-slate-500/10 text-slate-400",
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ActivityLogsPage() {
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch } = useQuery<LogResponse>({
    queryKey: [
      "/api/activity-logs",
      sourceFilter !== "all" ? sourceFilter : "",
      levelFilter !== "all" ? levelFilter : "",
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (levelFilter !== "all") params.set("level", levelFilter);
      params.set("limit", "1000");
      const res = await fetch(`/api/activity-logs?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch logs: ${res.status}`);
      }
      return res.json();
    },
    refetchInterval: autoRefresh ? 3000 : false,
  });

  const filteredEntries = (data?.entries ?? []).filter((e) => {
    if (!searchText) return true;
    const lower = searchText.toLowerCase();
    return (
      e.message.toLowerCase().includes(lower) ||
      e.source.toLowerCase().includes(lower) ||
      e.timestamp.toLowerCase().includes(lower)
    );
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      const el = scrollRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [filteredEntries.length, autoScroll]);

  const infoCount = filteredEntries.filter((e) => e.level === "info").length;
  const warnCount = filteredEntries.filter((e) => e.level === "warn").length;
  const errorCount = filteredEntries.filter((e) => e.level === "error").length;

  return (
    <div className="p-6 space-y-4" data-testid="page-activity-logs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Activity Logs</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            data-testid="button-toggle-auto-refresh"
          >
            {autoRefresh ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button
            variant={autoScroll ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
            data-testid="button-toggle-auto-scroll"
          >
            <ArrowDown className="w-3 h-3 mr-1" />
            Auto-scroll
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh-logs">
            <RefreshCw className="w-3 h-3 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-source-filter">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              {(data?.sources ?? []).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs" data-testid="select-level-filter">
            <SelectValue placeholder="All Levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warning</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            className="h-8 pl-7 text-xs"
            placeholder="Search logs..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            data-testid="input-search-logs"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className={levelColors.info} data-testid="badge-info-count">
            {infoCount} info
          </Badge>
          <Badge variant="outline" className={levelColors.warn} data-testid="badge-warn-count">
            {warnCount} warn
          </Badge>
          <Badge variant="outline" className={levelColors.error} data-testid="badge-error-count">
            {errorCount} error
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span>
              System Logs
              {autoRefresh && (
                <span className="ml-2 inline-flex items-center">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse mr-1" />
                  <span className="text-xs text-muted-foreground font-normal">Live</span>
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground font-normal" data-testid="text-log-count">
              {filteredEntries.length} entries
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-280px)]" ref={scrollRef}>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="loading-logs">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                Loading logs...
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-12 text-red-400 gap-2" data-testid="error-logs">
                <span>Failed to load activity logs</span>
                <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-logs">
                  Retry
                </Button>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="empty-logs">
                No log entries found
              </div>
            ) : (
              <div className="font-mono text-xs">
                {filteredEntries.map((entry, i) => {
                  const srcColor = sourceColors[entry.source] || "bg-gray-500/10 text-gray-400";
                  return (
                    <div
                      key={`${entry.timestamp}-${i}`}
                      className={`flex items-start gap-2 px-4 py-1.5 border-b border-border/30 hover:bg-muted/40 transition-colors ${
                        entry.level === "error"
                          ? "bg-red-500/5"
                          : entry.level === "warn"
                            ? "bg-yellow-500/5"
                            : ""
                      }`}
                      data-testid={`log-entry-${i}`}
                    >
                      <span className="text-muted-foreground whitespace-nowrap shrink-0 w-[62px]">
                        {formatTime(entry.timestamp)}
                      </span>
                      <span className="text-muted-foreground/60 whitespace-nowrap shrink-0 w-[42px]">
                        {formatDate(entry.timestamp)}
                      </span>
                      <Badge
                        variant="outline"
                        className={`${levelColors[entry.level]} text-[10px] px-1.5 py-0 h-4 shrink-0`}
                      >
                        {entry.level}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={`${srcColor} text-[10px] px-1.5 py-0 h-4 shrink-0 min-w-[80px] justify-center`}
                      >
                        {entry.source}
                      </Badge>
                      <span
                        className={`break-all ${
                          entry.level === "error"
                            ? "text-red-400"
                            : entry.level === "warn"
                              ? "text-yellow-400"
                              : "text-foreground/80"
                        }`}
                      >
                        {entry.message}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
