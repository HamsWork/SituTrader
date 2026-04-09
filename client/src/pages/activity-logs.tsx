import { useState } from "react";
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
import {
  Activity,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  TrendingDown,
  Zap,
  Trophy,
  X,
  ShieldCheck,
  Send,
  DollarSign,
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Rocket,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface ActivityItem {
  id: string;
  type: string;
  timestamp: string;
  ticker: string;
  title: string;
  detail: string;
  meta?: Record<string, any>;
}

interface FeedResponse {
  activities: ActivityItem[];
  eventTypes: string[];
  typeCounts: Record<string, number>;
  total: number;
  page: number;
  totalPages: number;
  perPage: number;
}

const typeConfig: Record<string, { label: string; icon: any; color: string; bgColor: string }> = {
  activation: { label: "Activation", icon: Zap, color: "text-green-400", bgColor: "bg-green-500/10 border-green-500/20" },
  hit: { label: "Hit Target", icon: Target, color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/20" },
  miss: { label: "Missed", icon: X, color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/20" },
  stop_moved: { label: "Stop Moved", icon: ShieldCheck, color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/20" },
  trade_fill: { label: "Trade Fill", icon: DollarSign, color: "text-cyan-400", bgColor: "bg-cyan-500/10 border-cyan-500/20" },
  trade_tp1: { label: "TP1 Hit", icon: ArrowUpCircle, color: "text-teal-400", bgColor: "bg-teal-500/10 border-teal-500/20" },
  trade_stopped: { label: "Stopped Out", icon: TrendingDown, color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/20" },
  trade_closed: { label: "Trade Closed", icon: TrendingUp, color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/20" },
  discord: { label: "Discord", icon: Send, color: "text-indigo-400", bgColor: "bg-indigo-500/10 border-indigo-500/20" },
  btod: { label: "BTOD", icon: Trophy, color: "text-orange-400", bgColor: "bg-orange-500/10 border-orange-500/20" },
  btod_exec: { label: "BTOD Exec", icon: Rocket, color: "text-yellow-400", bgColor: "bg-yellow-500/10 border-yellow-500/20" },
};

function formatTimestamp(ts: string): { time: string; date: string } {
  const d = new Date(ts);
  return {
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "America/Chicago" }),
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }),
  };
}

function getTypeLabel(type: string): string {
  return typeConfig[type]?.label || type;
}

const PAGE_SIZE = 50;

export default function ActivityLogsPage() {
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [expandedExecs, setExpandedExecs] = useState<Set<string>>(new Set());

  function toggleExec(id: string) {
    setExpandedExecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const { data, isLoading, isError, refetch } = useQuery<FeedResponse>({
    queryKey: ["/api/activity-feed", typeFilter !== "all" ? typeFilter : "", page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      params.set("limit", String(PAGE_SIZE));
      params.set("page", String(page));
      const res = await fetch(`/api/activity-feed?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      return res.json();
    },
    refetchInterval: page === 1 ? 30000 : false,
  });

  const filteredActivities = (data?.activities ?? []).filter((a) => {
    if (!searchText) return true;
    const lower = searchText.toLowerCase();
    return (
      a.ticker.toLowerCase().includes(lower) ||
      a.title.toLowerCase().includes(lower) ||
      a.detail.toLowerCase().includes(lower)
    );
  });

  const typeCounts = data?.typeCounts ?? {};
  const totalPages = data?.totalPages ?? 1;
  const totalEvents = data?.total ?? 0;

  function handleTypeChange(newType: string) {
    setTypeFilter(newType);
    setPage(1);
  }

  return (
    <div className="p-6 space-y-4" data-testid="page-activity-feed">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Activity Feed</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {Object.entries(typeConfig).map(([type, cfg]) => {
          const count = typeCounts[type] || 0;
          if (count === 0) return null;
          const Icon = cfg.icon;
          return (
            <button
              key={type}
              onClick={() => handleTypeChange(typeFilter === type ? "all" : type)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                typeFilter === type
                  ? cfg.bgColor + " ring-1 ring-current " + cfg.color
                  : "bg-card border-border hover:bg-muted/50 text-muted-foreground"
              }`}
              data-testid={`filter-${type}`}
            >
              <Icon className={`w-3.5 h-3.5 ${typeFilter === type ? cfg.color : ""}`} />
              <span>{cfg.label}</span>
              <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 h-4">{count}</Badge>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <Select value={typeFilter} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-type-filter">
            <SelectValue placeholder="All Events" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Events</SelectItem>
            {(data?.eventTypes ?? []).map((t) => (
              <SelectItem key={t} value={t}>{getTypeLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            className="h-8 pl-7 text-xs"
            placeholder="Search by ticker, event..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            data-testid="input-search"
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid="text-count">
          {totalEvents} events
        </span>
      </div>

      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-340px)]">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="loading">
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                Loading activity...
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-12 text-red-400 gap-2" data-testid="error">
                <span>Failed to load activity feed</span>
                <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="empty">
                No activities found
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {filteredActivities.map((item) => {
                  const cfg = typeConfig[item.type] || { label: item.type, icon: Activity, color: "text-gray-400", bgColor: "bg-gray-500/10 border-gray-500/20" };
                  const Icon = cfg.icon;
                  const { time, date } = formatTimestamp(item.timestamp);
                  const pnlPct = item.meta?.pnlPct;
                  const rMultiple = item.meta?.rMultiple;
                  const isBtodExec = item.type === "btod_exec";
                  const isExpanded = expandedExecs.has(item.id);
                  const instruments = (item.meta?.instruments ?? []) as Array<{
                    type: string; success: boolean; entry?: number; stop?: number;
                    t1?: number; t2?: number; delta?: number; durationMs?: number;
                    tsId?: number; error?: string;
                  }>;

                  return (
                    <div key={item.id} data-testid={`activity-${item.id}`}>
                      <div
                        className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors ${isBtodExec ? "cursor-pointer" : ""}`}
                        onClick={isBtodExec ? () => toggleExec(item.id) : undefined}
                      >
                        <div className={`mt-0.5 p-1.5 rounded-md ${cfg.bgColor}`}>
                          <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{item.ticker}</span>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${cfg.bgColor} ${cfg.color}`}>
                              {cfg.label}
                            </Badge>
                            {item.meta?.tier && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                                {item.meta.tier}
                              </Badge>
                            )}
                            {item.meta?.setupType && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                Setup {item.meta.setupType}
                              </Badge>
                            )}
                            {isBtodExec && item.meta?.successCount != null && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 h-4 ${
                                  item.meta.failCount === 0
                                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                                    : item.meta.successCount === 0
                                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                                    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
                                }`}
                              >
                                {item.meta.successCount}/{item.meta.successCount + item.meta.failCount} sent
                              </Badge>
                            )}
                            {pnlPct != null && (
                              <Badge
                                variant="outline"
                                className={`text-[10px] px-1.5 py-0 h-4 ${
                                  pnlPct >= 0
                                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                                    : "bg-red-500/10 text-red-400 border-red-500/20"
                                }`}
                              >
                                {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                              </Badge>
                            )}
                            {rMultiple != null && (
                              <span className={`text-[10px] ${rMultiple >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {rMultiple >= 0 ? "+" : ""}{rMultiple.toFixed(2)}R
                              </span>
                            )}
                            {isBtodExec && instruments.length > 0 && (
                              <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.detail}</p>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-xs text-muted-foreground">{time} <span className="text-[9px] text-muted-foreground/50">CT</span></div>
                          <div className="text-[10px] text-muted-foreground/60">{date}</div>
                        </div>
                      </div>

                      {isBtodExec && isExpanded && instruments.length > 0 && (
                        <div className="ml-12 mr-4 mb-3 rounded-lg border border-border/50 overflow-hidden" data-testid={`exec-detail-${item.id}`}>
                          <div className="grid grid-cols-[100px_1fr_80px_80px_80px_70px_70px_60px] gap-0 text-[10px] font-medium text-muted-foreground bg-muted/30 px-3 py-1.5 border-b border-border/30">
                            <span>Instrument</span>
                            <span>Status</span>
                            <span className="text-right">Entry</span>
                            <span className="text-right">Stop</span>
                            <span className="text-right">T1</span>
                            <span className="text-right">Delta</span>
                            <span className="text-right">TS ID</span>
                            <span className="text-right">Time</span>
                          </div>
                          {instruments.map((inst, idx) => (
                            <div
                              key={idx}
                              className={`grid grid-cols-[100px_1fr_80px_80px_80px_70px_70px_60px] gap-0 text-xs px-3 py-2 border-b border-border/20 last:border-b-0 ${
                                inst.success ? "bg-green-500/5" : "bg-red-500/5"
                              }`}
                              data-testid={`exec-instrument-${item.id}-${idx}`}
                            >
                              <span className="font-medium flex items-center gap-1">
                                {inst.success ? (
                                  <CheckCircle2 className="w-3 h-3 text-green-400" />
                                ) : (
                                  <XCircle className="w-3 h-3 text-red-400" />
                                )}
                                {inst.type}
                              </span>
                              <span className={inst.success ? "text-green-400" : "text-red-400"}>
                                {inst.success ? "Sent" : inst.error || "Failed"}
                              </span>
                              <span className="text-right font-mono">{inst.entry != null ? `$${inst.entry.toFixed(2)}` : "—"}</span>
                              <span className="text-right font-mono">{inst.stop != null ? `$${inst.stop.toFixed(2)}` : "—"}</span>
                              <span className="text-right font-mono">{inst.t1 != null ? `$${inst.t1.toFixed(2)}` : "—"}</span>
                              <span className="text-right font-mono">{inst.delta != null ? inst.delta.toFixed(3) : "—"}</span>
                              <span className="text-right font-mono">{inst.tsId ?? "—"}</span>
                              <span className="text-right text-muted-foreground">{inst.durationMs != null ? `${(inst.durationMs / 1000).toFixed(1)}s` : "—"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-3 h-3 mr-1" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground" data-testid="text-page-info">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              data-testid="button-next-page"
            >
              Next
              <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
