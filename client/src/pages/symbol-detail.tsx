import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Target,
  Calendar,
  BarChart3,
  Database,
  FlaskConical,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import type { Signal, DailyBar, Backtest, TimeToHitStat, BacktestDetail } from "@shared/schema";
import { SETUP_LABELS, TIER_LABELS, SETUP_TYPES, type SetupType, type TradePlan, type ConfidenceBreakdown, type QualityBreakdown } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

function getStatusBadge(status: string) {
  switch (status) {
    case "hit":
      return <Badge variant="default" className="bg-emerald-600 text-white">Hit</Badge>;
    case "miss":
      return <Badge variant="secondary" className="bg-red-500/15 text-red-500 dark:text-red-400">Miss</Badge>;
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

export default function SymbolDetail() {
  const { toast } = useToast();
  const [, params] = useRoute("/symbol/:ticker");
  const ticker = params?.ticker?.toUpperCase() ?? "";
  const [btSetup, setBtSetup] = useState<string>("A");

  const { data: symbolData, isLoading } = useQuery<{
    ticker: string;
    lastPrice?: number;
    change?: number;
    changePercent?: number;
    dailyBars: DailyBar[];
    signals: Signal[];
    intradayCoverage: { earliest: string; latest: string; count: number } | null;
    dailyCoverage: { earliest: string; latest: string; count: number } | null;
  }>({
    queryKey: ["/api/symbol", ticker],
    enabled: !!ticker,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (!symbolData) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Symbol not found or no data available.</p>
        <Link href="/">
          <Button variant="outline" className="mt-4">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const { data: backtests } = useQuery<Backtest[]>({
    queryKey: ["/api/backtests"],
    enabled: !!ticker,
  });

  const tickerBacktests = (backtests ?? []).filter(bt => bt.ticker === ticker);

  const { data: tthStats } = useQuery<TimeToHitStat | null>({
    queryKey: ["/api/time-to-hit-stats", ticker, btSetup],
    enabled: !!ticker && !!btSetup,
  });

  const backtestMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/backtest/run", {
        tickers: [ticker],
        setups: [btSetup],
        startDate: null,
        endDate: null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-to-hit-stats", ticker, btSetup] });
      toast({ title: "Backtest complete", description: `${ticker} setup ${btSetup} backtest finished.` });
    },
    onError: (error: Error) => {
      toast({ title: "Backtest failed", description: error.message, variant: "destructive" });
    },
  });

  const chartData = symbolData.dailyBars.slice(-120).map((bar) => ({
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));

  const pendingSignals = symbolData.signals.filter((s) => s.status === "pending");
  const magnetLines = pendingSignals.map((s) => s.magnetPrice);

  const changeColor = (symbolData.change ?? 0) >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-ticker-title">
            {ticker}
            {symbolData.lastPrice && (
              <span className="text-lg font-mono">${symbolData.lastPrice.toFixed(2)}</span>
            )}
          </h1>
          {symbolData.change !== undefined && (
            <p className={`text-sm ${changeColor} flex items-center gap-1`}>
              {symbolData.change >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {symbolData.change >= 0 ? "+" : ""}
              {symbolData.change.toFixed(2)} ({symbolData.changePercent?.toFixed(2)}%)
            </p>
          )}
        </div>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm">Price Chart (6 Months)</CardTitle>
            <Badge variant="outline" className="text-xs">{chartData.length} bars</Badge>
          </CardHeader>
          <CardContent className="p-2">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(val: string) => val.slice(5)}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    width={60}
                    tickFormatter={(val: number) => `$${val.toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, ""]}
                    labelFormatter={(label: string) => label}
                  />
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke="hsl(var(--primary))"
                    dot={false}
                    strokeWidth={1.5}
                  />
                  <Bar
                    dataKey="volume"
                    fill="hsl(var(--muted))"
                    opacity={0.3}
                    yAxisId="volume"
                  />
                  <YAxis yAxisId="volume" orientation="right" hide />
                  {magnetLines.map((price, i) => (
                    <ReferenceLine
                      key={i}
                      y={price}
                      stroke="hsl(var(--chart-4))"
                      strokeDasharray="4 4"
                      strokeWidth={1}
                      label={{ value: `$${price.toFixed(2)}`, fill: "hsl(var(--chart-4))", fontSize: 10, position: "right" }}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="signals">
        <TabsList>
          <TabsTrigger value="signals" data-testid="tab-signals">
            <Target className="w-3 h-3 mr-1" />
            Signals
          </TabsTrigger>
          <TabsTrigger value="backtest" data-testid="tab-backtest">
            <FlaskConical className="w-3 h-3 mr-1" />
            Backtest
          </TabsTrigger>
          <TabsTrigger value="data" data-testid="tab-data">
            <Database className="w-3 h-3 mr-1" />
            Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signals" className="mt-4">
          {symbolData.signals.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Target className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No signals for {ticker}</p>
                <p className="text-xs text-muted-foreground mt-1">Refresh data to generate signals</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {symbolData.signals.map((signal) => {
                const plan = signal.tradePlanJson as TradePlan | null;
                const breakdown = signal.confidenceBreakdown as ConfidenceBreakdown | null;
                return (
                  <Card key={signal.id} data-testid={`card-signal-${signal.id}`}>
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {signal.tier === "APLUS" && (
                              <Badge className="bg-amber-500 text-white">{TIER_LABELS[signal.tier]}</Badge>
                            )}
                            {signal.tier === "A" && (
                              <Badge className="bg-emerald-600 text-white">{TIER_LABELS[signal.tier]}</Badge>
                            )}
                            {signal.tier === "B" && (
                              <Badge variant="secondary">{TIER_LABELS[signal.tier]}</Badge>
                            )}
                            {signal.tier === "C" && (
                              <Badge variant="outline">{TIER_LABELS[signal.tier]}</Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              Setup {signal.setupType}
                            </Badge>
                            {getStatusBadge(signal.status)}
                            <span className="text-xs text-muted-foreground">
                              Q{signal.qualityScore}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Detected: {signal.asofDate}
                            </span>
                            <span>Target: {signal.targetDate}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-mono font-bold">
                            ${signal.magnetPrice.toFixed(2)}
                          </div>
                          {signal.magnetPrice2 && (
                            <div className="text-sm font-mono text-muted-foreground">
                              ${signal.magnetPrice2.toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>

                      {plan && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 p-3 bg-muted/30 rounded-md">
                          <div>
                            <span className="text-xs text-muted-foreground">Bias</span>
                            <div className={`text-sm font-medium ${plan.bias === "BUY" ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`}>
                              {plan.bias}
                            </div>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground">T1</span>
                            <div className="text-sm font-mono">${plan.t1.toFixed(2)}</div>
                          </div>
                          {plan.t2 && (
                            <div>
                              <span className="text-xs text-muted-foreground">T2</span>
                              <div className="text-sm font-mono">${plan.t2.toFixed(2)}</div>
                            </div>
                          )}
                          {plan.riskReward && (
                            <div>
                              <span className="text-xs text-muted-foreground">R:R</span>
                              <div className="text-sm font-medium">
                                1:{plan.riskReward.toFixed(1)}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {breakdown && (
                        <div className="mt-3 text-xs text-muted-foreground">
                          <span className="font-medium">Confidence breakdown: </span>
                          base {breakdown.base}
                          {breakdown.cleanEdge ? ` + edge ${breakdown.cleanEdge}` : ""}
                          {breakdown.volumeBoost ? ` + vol ${breakdown.volumeBoost}` : ""}
                          {breakdown.vixProxy ? ` + vix ${breakdown.vixProxy}` : ""}
                          {breakdown.distancePenalty ? ` - dist ${Math.abs(breakdown.distancePenalty)}` : ""}
                          {" "}= <span className="font-medium">{(breakdown.total * 100).toFixed(0)}%</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="backtest" className="mt-4">
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-sm">Run Backtest for {ticker}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={btSetup} onValueChange={setBtSetup}>
                    <SelectTrigger className="w-[160px]" data-testid="select-bt-setup">
                      <SelectValue placeholder="Setup" />
                    </SelectTrigger>
                    <SelectContent>
                      {SETUP_TYPES.map(s => (
                        <SelectItem key={s} value={s}>{s}: {SETUP_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => backtestMutation.mutate()}
                    disabled={backtestMutation.isPending}
                    data-testid="button-run-backtest"
                  >
                    {backtestMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <FlaskConical className="w-4 h-4 mr-1" />
                    )}
                    {backtestMutation.isPending ? "Running..." : "Run Backtest"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {tthStats && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Time-to-Hit Probabilities ({ticker} / Setup {btSetup})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
                    {(["p15", "p30", "p60", "p120", "p240", "p390"] as const).map(key => (
                      <div key={key} className="text-center p-2 bg-muted/30 rounded-md">
                        <div className="text-xs text-muted-foreground mb-1">{key}</div>
                        <div className="text-lg font-bold font-mono">
                          {((tthStats[key] ?? 0) * 100).toFixed(0)}%
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span>Samples: <span className="font-medium text-foreground">{tthStats.sampleSize}</span></span>
                    {tthStats.medianTimeToHitMin != null && (
                      <span>Median: <span className="font-medium text-foreground">{tthStats.medianTimeToHitMin.toFixed(0)} min</span></span>
                    )}
                  </div>
                  <div className="h-48 mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { label: "p15", value: (tthStats.p15 ?? 0) * 100 },
                        { label: "p30", value: (tthStats.p30 ?? 0) * 100 },
                        { label: "p60", value: (tthStats.p60 ?? 0) * 100 },
                        { label: "p120", value: (tthStats.p120 ?? 0) * 100 },
                        { label: "p240", value: (tthStats.p240 ?? 0) * 100 },
                        { label: "p390", value: (tthStats.p390 ?? 0) * 100 },
                      ]}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `${v}%`} />
                        <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "Hit Rate"]}
                          contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {[0, 1, 2, 3, 4, 5].map(i => (
                            <Cell key={i} fill={`hsl(var(--chart-${(i % 5) + 1}))`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {tickerBacktests.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Backtest Results for {ticker}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Setup</TableHead>
                          <TableHead className="text-right">Occurrences</TableHead>
                          <TableHead className="text-right">Hits</TableHead>
                          <TableHead className="text-right">Hit Rate</TableHead>
                          <TableHead className="text-right">Avg TTH</TableHead>
                          <TableHead className="text-right">Avg MAE</TableHead>
                          <TableHead className="text-right">Avg MFE</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tickerBacktests.map(bt => (
                          <TableRow key={bt.id} data-testid={`row-bt-${bt.id}`}>
                            <TableCell>{bt.setupType}: {SETUP_LABELS[bt.setupType as SetupType] ?? bt.setupType}</TableCell>
                            <TableCell className="text-right font-mono">{bt.occurrences}</TableCell>
                            <TableCell className="text-right font-mono">{bt.hits}</TableCell>
                            <TableCell className="text-right font-mono">
                              {bt.hitRate != null ? `${(bt.hitRate * 100).toFixed(0)}%` : "--"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {bt.avgTimeToHitMin != null ? `${bt.avgTimeToHitMin.toFixed(0)}m` : "--"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {bt.avgMae != null ? `${(bt.avgMae * 100).toFixed(2)}%` : "--"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {bt.avgMfe != null ? `${(bt.avgMfe * 100).toFixed(2)}%` : "--"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Daily Data Coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {symbolData.dailyCoverage ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bars</span>
                      <span className="font-mono">{symbolData.dailyCoverage.count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">From</span>
                      <span className="font-mono">{symbolData.dailyCoverage.earliest}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">To</span>
                      <span className="font-mono">{symbolData.dailyCoverage.latest}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No daily data</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Intraday Data Coverage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {symbolData.intradayCoverage ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bars</span>
                      <span className="font-mono">{symbolData.intradayCoverage.count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">From</span>
                      <span className="font-mono">{symbolData.intradayCoverage.earliest}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">To</span>
                      <span className="font-mono">{symbolData.intradayCoverage.latest}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No intraday data</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
