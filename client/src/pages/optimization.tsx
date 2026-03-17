import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import { FlaskConical, TrendingUp, TrendingDown, Trophy, AlertTriangle, Target, Clock, Loader2, Shield, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import type { Backtest, BacktestDetail, SetupExpectancy, ReliabilitySummary, ReliabilityGate, RegimeBreakdown, RobustnessRun } from "@shared/schema";
import { SETUP_LABELS, SETUP_TYPES, type SetupType } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

function gradeScore(winRate: number, expectancyR: number, profitFactor: number): { grade: string; color: string } {
  const score =
    (winRate >= 0.6 ? 3 : winRate >= 0.5 ? 2 : winRate >= 0.4 ? 1 : 0) +
    (expectancyR >= 0.3 ? 3 : expectancyR >= 0.15 ? 2 : expectancyR >= 0 ? 1 : 0) +
    (profitFactor >= 2 ? 3 : profitFactor >= 1.5 ? 2 : profitFactor >= 1 ? 1 : 0);

  if (score >= 8) return { grade: "A+", color: "text-emerald-500" };
  if (score >= 6) return { grade: "A", color: "text-emerald-500" };
  if (score >= 4) return { grade: "B", color: "text-amber-500" };
  if (score >= 2) return { grade: "C", color: "text-orange-500" };
  return { grade: "F", color: "text-red-500 dark:text-red-400" };
}

function gradeBadgeClass(grade: string): string {
  if (grade === "A+" || grade === "A") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  if (grade === "B") return "bg-amber-500/10 text-amber-600 border-amber-500/20";
  if (grade === "C") return "bg-orange-500/10 text-orange-600 border-orange-500/20";
  return "bg-red-500/10 text-red-600 border-red-500/20";
}

function ReliabilitySummaryCard() {
  const { data: reliability, isLoading } = useQuery<ReliabilitySummary>({
    queryKey: ["/api/analysis/reliability"],
  });

  const runAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/analysis/robustness/run-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analysis/reliability"] });
    },
  });

  const gradeColor = (grade: string) => {
    if (grade === "A+" || grade === "A") return "text-emerald-500";
    if (grade === "B") return "text-amber-500";
    if (grade === "C") return "text-orange-500";
    return "text-red-500 dark:text-red-400";
  };

  const gateIcon = (status: ReliabilityGate["status"]) => {
    if (status === "pass") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (status === "fail") return <XCircle className="w-4 h-4 text-red-500" />;
    if (status === "warn") return <AlertCircle className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
  };

  if (isLoading) return <Skeleton className="h-48" />;

  return (
    <Card data-testid="reliability-summary-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Reliability Summary</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runAllMutation.mutate()}
            disabled={runAllMutation.isPending}
            data-testid="btn-run-all-robustness"
          >
            {runAllMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            Run All Robustness Tests
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">System-wide reliability gates and robustness checks</p>
      </CardHeader>
      <CardContent>
        {!reliability ? (
          <div className="p-8 text-center">
            <Shield className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No reliability data available</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <span className={`text-3xl font-bold font-mono ${gradeColor(reliability.overallGrade)}`} data-testid="text-reliability-grade">
                {reliability.overallGrade}
              </span>
              <div>
                <div className="text-sm font-medium" data-testid="text-reliability-score">
                  {reliability.overallScore}%
                </div>
                <div className="text-xs text-muted-foreground">Overall Score</div>
              </div>
            </div>
            <div className="space-y-1.5">
              {reliability.gates.map((gate: ReliabilityGate) => (
                <div key={gate.id} className="flex items-center gap-2 text-sm" data-testid={`row-gate-${gate.id}`}>
                  {gateIcon(gate.status)}
                  <span className="flex-1 truncate">{gate.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {gate.score}/{gate.maxScore}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      gate.status === "pass" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : gate.status === "fail" ? "bg-red-500/10 text-red-600 border-red-500/20"
                        : gate.status === "warn" ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                        : ""
                    }`}
                  >
                    {gate.status === "not_run" ? "Not Run" : gate.status === "insufficient_data" ? "No Data" : gate.status}
                  </Badge>
                </div>
              ))}
            </div>
            {reliability.warnings.length > 0 && (
              <div className="space-y-1 pt-2 border-t" data-testid="reliability-warnings">
                {reliability.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-amber-600">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RegimeSummaryCard() {
  const { data: runs, isLoading } = useQuery<RobustnessRun[]>({
    queryKey: ["/api/analysis/robustness-runs", "regime_analysis"],
    queryFn: () => fetch("/api/analysis/robustness-runs?testType=regime_analysis").then(r => r.json()),
  });

  if (isLoading) return <Skeleton className="h-48" />;

  const latestRun = runs?.[0];
  const breakdowns: RegimeBreakdown[] =
    (latestRun?.summaryMetrics as any)?.breakdowns ?? [];

  return (
    <Card data-testid="regime-summary-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm">Regime Analysis</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">Performance breakdown by market regime</p>
      </CardHeader>
      <CardContent className="p-0">
        {breakdowns.length === 0 ? (
          <div className="p-8 text-center">
            <Target className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground" data-testid="text-no-regime-data">No regime analysis available</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Regime</TableHead>
                  <TableHead className="text-right">Sample Size</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Expectancy R</TableHead>
                  <TableHead className="text-right">Hit Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdowns.map((b: RegimeBreakdown) => (
                  <TableRow key={b.regime} data-testid={`row-regime-${b.regime}`}>
                    <TableCell className="font-medium">{b.label || b.regime}</TableCell>
                    <TableCell className="text-right font-mono">{b.sampleSize}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={b.winRate >= 0.5 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                        {(b.winRate * 100).toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      <span className={b.expectancyR >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                        {b.expectancyR >= 0 ? "+" : ""}{b.expectancyR.toFixed(3)}R
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {(b.hitRate * 100).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function OptimizationPage() {
  const [setupFilter, setSetupFilter] = useState<string>("all");

  const { data: allStats, isLoading: statsLoading } = useQuery<SetupExpectancy[]>({
    queryKey: ["/api/optimization/comprehensive"],
  });

  const overallStats = useMemo(() => {
    if (!allStats) return undefined;
    return allStats.filter(s => s.ticker === null);
  }, [allStats]);

  const { data: backtests } = useQuery<Backtest[]>({
    queryKey: ["/api/backtests"],
  });

  const tickerStats = useMemo(() => {
    if (!allStats) return [];
    const withTicker = allStats.filter(s => s.ticker !== null);
    if (setupFilter === "all") {
      const grouped = new Map<string, SetupExpectancy[]>();
      for (const s of withTicker) {
        const arr = grouped.get(s.ticker!) || [];
        arr.push(s);
        grouped.set(s.ticker!, arr);
      }
      return Array.from(grouped.entries()).map(([ticker, stats]) => {
        const totalSample = stats.reduce((sum, s) => sum + s.sampleSize, 0);
        const weightedWinRate = totalSample > 0
          ? stats.reduce((sum, s) => sum + s.winRate * s.sampleSize, 0) / totalSample
          : 0;
        const weightedExpectancy = totalSample > 0
          ? stats.reduce((sum, s) => sum + s.expectancyR * s.sampleSize, 0) / totalSample
          : 0;
        const weightedPF = totalSample > 0
          ? stats.reduce((sum, s) => sum + s.profitFactor * s.sampleSize, 0) / totalSample
          : 0;
        const bestSetup = stats.sort((a, b) => b.expectancyR - a.expectancyR)[0];
        return {
          ticker,
          sampleSize: totalSample,
          winRate: weightedWinRate,
          expectancyR: weightedExpectancy,
          profitFactor: weightedPF,
          avgWinR: totalSample > 0 ? stats.reduce((s, x) => s + x.avgWinR * x.sampleSize, 0) / totalSample : 0,
          avgLossR: totalSample > 0 ? stats.reduce((s, x) => s + x.avgLossR * x.sampleSize, 0) / totalSample : 0,
          medianMaeR: totalSample > 0 ? stats.reduce((s, x) => s + x.medianMaeR * x.sampleSize, 0) / totalSample : 0,
          bestSetup: bestSetup?.setupType ?? "",
          setupCount: stats.length,
          tradeability: bestSetup?.tradeability ?? "CLEAN",
        };
      });
    }
    return withTicker
      .filter(s => s.setupType === setupFilter)
      .map(s => ({
        ticker: s.ticker!,
        sampleSize: s.sampleSize,
        winRate: s.winRate,
        expectancyR: s.expectancyR,
        profitFactor: s.profitFactor,
        avgWinR: s.avgWinR,
        avgLossR: s.avgLossR,
        medianMaeR: s.medianMaeR,
        bestSetup: s.setupType,
        setupCount: 1,
        tradeability: s.tradeability,
      }));
  }, [allStats, setupFilter]);

  const topPerformers = useMemo(() =>
    [...tickerStats]
      .filter(t => t.sampleSize >= 3)
      .sort((a, b) => b.expectancyR - a.expectancyR)
      .slice(0, 15),
    [tickerStats]
  );

  const underperformers = useMemo(() =>
    [...tickerStats]
      .filter(t => t.sampleSize >= 3)
      .sort((a, b) => a.expectancyR - b.expectancyR)
      .filter(t => t.expectancyR < 0 || t.winRate < 0.4)
      .slice(0, 15),
    [tickerStats]
  );

  const kpis = useMemo(() => {
    if (!tickerStats.length) return null;
    const qualified = tickerStats.filter(t => t.sampleSize >= 3);
    const totalTickers = qualified.length;
    const profitable = qualified.filter(t => t.expectancyR > 0).length;
    const avgWinRate = totalTickers > 0 ? qualified.reduce((s, t) => s + t.winRate, 0) / totalTickers : 0;
    const avgExpectancy = totalTickers > 0 ? qualified.reduce((s, t) => s + t.expectancyR, 0) / totalTickers : 0;
    const bestTicker = qualified.length > 0 ? [...qualified].sort((a, b) => b.expectancyR - a.expectancyR)[0] : null;
    return { totalTickers, profitable, avgWinRate, avgExpectancy, bestTicker };
  }, [tickerStats]);

  const setupRadarData = useMemo(() => {
    if (!overallStats?.length) return [];
    return overallStats.map(s => ({
      setup: `${s.setupType}: ${SETUP_LABELS[s.setupType as SetupType] ?? s.setupType}`,
      shortName: s.setupType,
      winRate: Math.round(s.winRate * 100),
      expectancy: Math.max(0, s.expectancyR * 100),
      profitFactor: Math.min(s.profitFactor * 20, 100),
    }));
  }, [overallStats]);

  const timeToHitData = useMemo(() => {
    if (!backtests?.length) return [];
    const buckets = [
      { label: "0-15m", min: 0, max: 15 },
      { label: "15-30m", min: 15, max: 30 },
      { label: "30-60m", min: 30, max: 60 },
      { label: "1-2h", min: 60, max: 120 },
      { label: "2-4h", min: 120, max: 240 },
      { label: "4h+", min: 240, max: 390 },
      { label: "Miss", min: -1, max: -1 },
    ];
    const counts = buckets.map(b => ({ label: b.label, count: 0, pct: 0 }));
    let total = 0;
    for (const bt of backtests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      for (const d of details) {
        if (!d.triggered) continue;
        total++;
        if (d.hit && d.timeToHitMin !== undefined) {
          for (let i = 0; i < buckets.length - 1; i++) {
            if (d.timeToHitMin >= buckets[i].min && d.timeToHitMin < buckets[i].max) {
              counts[i].count++;
              break;
            }
          }
        } else {
          counts[counts.length - 1].count++;
        }
      }
    }
    if (total > 0) {
      for (const c of counts) c.pct = Math.round((c.count / total) * 100);
    }
    return counts;
  }, [backtests]);

  const winRateChartData = useMemo(() =>
    [...topPerformers].slice(0, 10).map(t => ({
      ticker: t.ticker,
      winRate: Math.round(t.winRate * 100),
      expectancy: parseFloat(t.expectancyR.toFixed(2)),
    })),
    [topPerformers]
  );

  const hasData = (allStats?.length ?? 0) > 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <FlaskConical className="w-5 h-5" />
          Optimization
        </h1>
        <p className="text-sm text-muted-foreground">
          Performance intelligence — identify top stocks, grade setups, and optimize your edge
        </p>
      </div>

      {statsLoading && (
        <div className="space-y-1" data-testid="progress-bar">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Loading optimization data...</span>
            <span className="text-xs font-mono text-muted-foreground">30%</span>
          </div>
          <Progress value={30} className="h-2" />
        </div>
      )}

      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : !hasData ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FlaskConical className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No optimization data yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Run backtests from the symbol detail pages first, then refresh stats here
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {kpis && (
            <div className="grid gap-4 md:grid-cols-4" data-testid="kpi-cards">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Tickers Analyzed</span>
                  </div>
                  <div className="text-2xl font-bold font-mono" data-testid="text-total-tickers">{kpis.totalTickers}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    <span className="text-emerald-500 font-medium">{kpis.profitable}</span> profitable ({kpis.totalTickers > 0 ? Math.round(kpis.profitable / kpis.totalTickers * 100) : 0}%)
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Avg Win Rate</span>
                  </div>
                  <div className={`text-2xl font-bold font-mono ${kpis.avgWinRate >= 0.5 ? 'text-emerald-500' : 'text-red-500 dark:text-red-400'}`} data-testid="text-avg-win-rate">
                    {(kpis.avgWinRate * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">across all qualified tickers</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FlaskConical className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Avg Expectancy</span>
                  </div>
                  <div className={`text-2xl font-bold font-mono ${kpis.avgExpectancy >= 0 ? 'text-emerald-500' : 'text-red-500 dark:text-red-400'}`} data-testid="text-avg-expectancy">
                    {kpis.avgExpectancy >= 0 ? "+" : ""}{kpis.avgExpectancy.toFixed(3)}R
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">per trade average</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <span className="text-xs text-muted-foreground">Top Performer</span>
                  </div>
                  {kpis.bestTicker ? (
                    <>
                      <div className="text-2xl font-bold font-mono text-emerald-500" data-testid="text-best-ticker">
                        {kpis.bestTicker.ticker}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {(kpis.bestTicker.winRate * 100).toFixed(0)}% WR / +{kpis.bestTicker.expectancyR.toFixed(2)}R
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">—</div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground font-medium">Filter by Setup:</span>
            <Select value={setupFilter} onValueChange={setSetupFilter}>
              <SelectTrigger className="w-[220px] h-8 text-xs" data-testid="select-setup-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Setups (Combined)</SelectItem>
                {SETUP_TYPES.map(st => (
                  <SelectItem key={st} value={st}>{st}: {SETUP_LABELS[st]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-emerald-500" />
                  <CardTitle className="text-sm">Top Performing Stocks</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">Stocks with highest edge under the SITU trade plan</p>
              </CardHeader>
              <CardContent className="p-0">
                {topPerformers.length === 0 ? (
                  <div className="p-8 text-center">
                    <TrendingUp className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No qualified data (min 3 trades)</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Ticker</TableHead>
                          <TableHead className="text-right">Win Rate</TableHead>
                          <TableHead className="text-right">Expectancy</TableHead>
                          <TableHead className="text-right">PF</TableHead>
                          <TableHead className="text-right">Trades</TableHead>
                          <TableHead className="text-center">Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topPerformers.map((t, i) => {
                          const { grade, color } = gradeScore(t.winRate, t.expectancyR, t.profitFactor);
                          return (
                            <TableRow key={t.ticker} data-testid={`row-top-${t.ticker}`}>
                              <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                              <TableCell className="font-medium">{t.ticker}</TableCell>
                              <TableCell className="text-right font-mono">
                                <span className={t.winRate >= 0.5 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                  {(t.winRate * 100).toFixed(1)}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
                                <span className={t.expectancyR >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                  {t.expectancyR >= 0 ? "+" : ""}{t.expectancyR.toFixed(3)}R
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">{t.profitFactor.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{t.sampleSize}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline" className={`text-[10px] font-bold ${gradeBadgeClass(grade)}`} data-testid={`badge-grade-${t.ticker}`}>
                                  {grade}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <CardTitle className="text-sm">Underperformers — Avoid Zone</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">Stocks that consistently underperform — consider removing from watchlist</p>
              </CardHeader>
              <CardContent className="p-0">
                {underperformers.length === 0 ? (
                  <div className="p-8 text-center">
                    <TrendingDown className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No underperformers detected</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>Ticker</TableHead>
                          <TableHead className="text-right">Win Rate</TableHead>
                          <TableHead className="text-right">Expectancy</TableHead>
                          <TableHead className="text-right">PF</TableHead>
                          <TableHead className="text-right">Trades</TableHead>
                          <TableHead className="text-center">Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {underperformers.map((t, i) => {
                          const { grade } = gradeScore(t.winRate, t.expectancyR, t.profitFactor);
                          return (
                            <TableRow key={t.ticker} className="bg-red-500/5" data-testid={`row-under-${t.ticker}`}>
                              <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                              <TableCell className="font-medium">{t.ticker}</TableCell>
                              <TableCell className="text-right font-mono">
                                <span className="text-red-500 dark:text-red-400">
                                  {(t.winRate * 100).toFixed(1)}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono font-medium">
                                <span className="text-red-500 dark:text-red-400">
                                  {t.expectancyR.toFixed(3)}R
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">{t.profitFactor.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{t.sampleSize}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant="outline" className={`text-[10px] font-bold ${gradeBadgeClass(grade)}`}>
                                  {grade}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {winRateChartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top 10 — Win Rate vs Expectancy</CardTitle>
                <p className="text-xs text-muted-foreground">Visual comparison of your best-performing stocks</p>
              </CardHeader>
              <CardContent className="p-2">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={winRateChartData} barGap={2}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="ticker"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        domain={[0, 100]}
                        tickFormatter={(val: number) => `${val}%`}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        tickFormatter={(val: number) => `${val}R`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar yAxisId="left" dataKey="winRate" name="Win Rate %" radius={[4, 4, 0, 0]} fill="hsl(var(--chart-3))" />
                      <Bar yAxisId="right" dataKey="expectancy" name="Expectancy (R)" radius={[4, 4, 0, 0]} fill="hsl(var(--chart-1))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm">Setup Performance Rankings</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">How each setup type performs across all tickers</p>
              </CardHeader>
              <CardContent className="p-0">
                {!overallStats || overallStats.length === 0 ? (
                  <div className="p-8 text-center">
                    <Target className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No setup data available</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Setup</TableHead>
                          <TableHead className="text-right">Sample</TableHead>
                          <TableHead className="text-right">Win Rate</TableHead>
                          <TableHead className="text-right">Expect. (R)</TableHead>
                          <TableHead className="text-right">PF</TableHead>
                          <TableHead>Trade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overallStats
                          .sort((a, b) => b.expectancyR - a.expectancyR)
                          .map(s => {
                            const { grade } = gradeScore(s.winRate, s.expectancyR, s.profitFactor);
                            return (
                              <TableRow key={s.setupType} data-testid={`row-setup-${s.setupType}`}>
                                <TableCell>
                                  <div className="flex items-center gap-1.5">
                                    <Badge variant="outline" className="text-xs">{s.setupType}</Badge>
                                    <span className="text-xs text-muted-foreground">{SETUP_LABELS[s.setupType as SetupType] ?? s.setupType}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono">{s.sampleSize}</TableCell>
                                <TableCell className="text-right font-mono">
                                  <span className={s.winRate >= 0.5 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                    {(s.winRate * 100).toFixed(1)}%
                                  </span>
                                </TableCell>
                                <TableCell className="text-right font-mono font-medium">
                                  <span className={s.expectancyR >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                    {s.expectancyR >= 0 ? "+" : ""}{s.expectancyR.toFixed(3)}R
                                  </span>
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">{s.profitFactor.toFixed(2)}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${
                                      s.tradeability === "CLEAN" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                        : s.tradeability === "CAUTION" ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                        : "bg-red-500/10 text-red-600 border-red-500/20"
                                    }`}
                                  >
                                    {s.tradeability}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm">Time-to-Hit Distribution</CardTitle>
                </div>
                <p className="text-xs text-muted-foreground">When do trades typically resolve? Optimal timeframe insights</p>
              </CardHeader>
              <CardContent className="p-2">
                {timeToHitData.length === 0 || !timeToHitData.some(d => d.count > 0) ? (
                  <div className="p-8 text-center">
                    <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">No time-to-hit data available</p>
                  </div>
                ) : (
                  <>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={timeToHitData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(val: number) => `${val}%`} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "6px",
                              fontSize: "12px",
                            }}
                            formatter={(value: number, name: string, props: any) => [`${props.payload.count} trades (${value}%)`, "Distribution"]}
                          />
                          <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                            {timeToHitData.map((entry, i) => (
                              <Cell
                                key={i}
                                fill={
                                  entry.label === "Miss"
                                    ? "hsl(var(--destructive))"
                                    : i <= 2
                                    ? "hsl(var(--chart-3))"
                                    : "hsl(var(--chart-4))"
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 px-2">
                      {(() => {
                        const early = timeToHitData.slice(0, 3).reduce((s, d) => s + d.pct, 0);
                        const late = timeToHitData.slice(3, 6).reduce((s, d) => s + d.pct, 0);
                        const miss = timeToHitData[timeToHitData.length - 1]?.pct ?? 0;
                        return (
                          <>
                            <div className="text-center p-2 bg-emerald-500/10 rounded-md">
                              <div className="text-xs text-muted-foreground">Early (0-60m)</div>
                              <div className="text-lg font-bold font-mono text-emerald-500">{early}%</div>
                            </div>
                            <div className="text-center p-2 bg-amber-500/10 rounded-md">
                              <div className="text-xs text-muted-foreground">Late (1h+)</div>
                              <div className="text-lg font-bold font-mono text-amber-500">{late}%</div>
                            </div>
                            <div className="text-center p-2 bg-red-500/10 rounded-md">
                              <div className="text-xs text-muted-foreground">Miss</div>
                              <div className="text-lg font-bold font-mono text-red-500 dark:text-red-400">{miss}%</div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {setupRadarData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Setup Comparison Radar</CardTitle>
                <p className="text-xs text-muted-foreground">Multi-dimensional comparison of setup effectiveness</p>
              </CardHeader>
              <CardContent className="p-2">
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={setupRadarData}>
                      <PolarGrid stroke="hsl(var(--border))" />
                      <PolarAngleAxis dataKey="shortName" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <PolarRadiusAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} />
                      <Radar name="Win Rate" dataKey="winRate" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.2} />
                      <Radar name="Expectancy" dataKey="expectancy" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.15} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                          fontSize: "12px",
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <ReliabilitySummaryCard />

          <RegimeSummaryCard />
        </>
      )}
    </div>
  );
}
