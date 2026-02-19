import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Target,
  Zap,
  Clock,
  ArrowUpRight,
} from "lucide-react";
import { Link } from "wouter";
import type { Signal } from "@shared/schema";
import { SETUP_LABELS, type SetupType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`text-stat-${title.toLowerCase().replace(/\s/g, "-")}`}>
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            {trend === "up" && <TrendingUp className="w-3 h-3 text-emerald-500" />}
            {trend === "down" && <TrendingDown className="w-3 h-3 text-red-500" />}
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function getStatusBadge(status: string) {
  switch (status) {
    case "hit":
      return <Badge variant="default" className="bg-emerald-600 text-white" data-testid="badge-status-hit">Hit</Badge>;
    case "miss":
      return <Badge variant="secondary" className="bg-red-500/15 text-red-500 dark:text-red-400" data-testid="badge-status-miss">Miss</Badge>;
    default:
      return <Badge variant="outline" data-testid="badge-status-pending">Pending</Badge>;
  }
}

function getDirectionBadge(direction: string) {
  if (direction.toLowerCase().includes("down") || direction === "SELL") {
    return (
      <span className="flex items-center gap-1 text-red-500 dark:text-red-400 text-xs font-medium">
        <TrendingDown className="w-3 h-3" /> Sell
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-emerald-500 text-xs font-medium">
      <TrendingUp className="w-3 h-3" /> Buy
    </span>
  );
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return "text-emerald-500";
  if (confidence >= 0.5) return "text-chart-4";
  return "text-red-500 dark:text-red-400";
}

export default function Dashboard() {
  const { toast } = useToast();

  const { data: signals, isLoading: signalsLoading } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{
    activeCount: number;
    hitRate60d: number;
    totalSignals: number;
    lastRefresh: string | null;
    hitRateBySetup: Record<string, { hits: number; total: number; rate: number }>;
  }>({
    queryKey: ["/api/stats"],
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Data refreshed", description: "Market data and signals have been updated." });
    },
    onError: (error: Error) => {
      toast({
        title: "Refresh failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const activeSignals = signals?.filter((s) => s.status === "pending") ?? [];
  const recentSignals = signals?.slice(0, 20) ?? [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Active signals and market analysis overview
          </p>
        </div>
        <Button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          data-testid="button-refresh-data"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          {refreshMutation.isPending ? "Refreshing..." : "Refresh Data"}
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-3 w-32 mt-2" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <StatCard
              title="Active Signals"
              value={stats?.activeCount ?? 0}
              subtitle="Pending validation"
              icon={Zap}
            />
            <StatCard
              title="Hit Rate (60d)"
              value={stats?.hitRate60d ? `${(stats.hitRate60d * 100).toFixed(1)}%` : "N/A"}
              subtitle="All setups combined"
              icon={Target}
              trend={stats?.hitRate60d && stats.hitRate60d > 0.5 ? "up" : "neutral"}
            />
            <StatCard
              title="Total Signals"
              value={stats?.totalSignals ?? 0}
              subtitle="All time"
              icon={Activity}
            />
            <StatCard
              title="Last Refresh"
              value={stats?.lastRefresh ? new Date(stats.lastRefresh).toLocaleTimeString() : "Never"}
              subtitle={stats?.lastRefresh ? new Date(stats.lastRefresh).toLocaleDateString() : "Click refresh to start"}
              icon={Clock}
            />
          </>
        )}
      </div>

      {stats?.hitRateBySetup && Object.keys(stats.hitRateBySetup).length > 0 && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {Object.entries(stats.hitRateBySetup).map(([setup, data]) => (
            <Card key={setup}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-medium text-muted-foreground">Setup {setup}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {data.total}
                  </Badge>
                </div>
                <div className={`text-lg font-bold ${getConfidenceColor(data.rate)}`}>
                  {(data.rate * 100).toFixed(0)}%
                </div>
                <p className="text-[10px] text-muted-foreground truncate">
                  {SETUP_LABELS[setup as SetupType] ?? setup}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Recent Signals</CardTitle>
          <Badge variant="outline">{recentSignals.length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {signalsLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : recentSignals.length === 0 ? (
            <div className="p-8 text-center">
              <Activity className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No signals yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click "Refresh Data" to fetch market data and generate signals
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Ticker</TableHead>
                    <TableHead>Setup</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Magnet</TableHead>
                    <TableHead className="text-right">Confidence</TableHead>
                    <TableHead>Target Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSignals.map((signal) => (
                    <TableRow key={signal.id} className="hover-elevate" data-testid={`row-signal-${signal.id}`}>
                      <TableCell className="font-medium">
                        <Link href={`/symbol/${signal.ticker}`}>
                          <span className="text-primary cursor-pointer">{signal.ticker}</span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs">
                          {SETUP_LABELS[signal.setupType as SetupType] ?? signal.setupType}
                        </span>
                      </TableCell>
                      <TableCell>{getDirectionBadge(signal.direction)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        ${signal.magnetPrice.toFixed(2)}
                        {signal.magnetPrice2 && (
                          <span className="text-muted-foreground"> / ${signal.magnetPrice2.toFixed(2)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`font-medium ${getConfidenceColor(signal.confidence)}`}>
                          {(signal.confidence * 100).toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{signal.targetDate}</TableCell>
                      <TableCell>{getStatusBadge(signal.status)}</TableCell>
                      <TableCell>
                        <Link href={`/symbol/${signal.ticker}`}>
                          <Button variant="ghost" size="icon" data-testid={`button-view-signal-${signal.id}`}>
                            <ArrowUpRight className="w-3 h-3" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
