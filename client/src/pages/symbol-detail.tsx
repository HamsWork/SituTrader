import { useQuery } from "@tanstack/react-query";
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
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Target,
  Calendar,
  BarChart3,
  Database,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { Signal, DailyBar } from "@shared/schema";
import { SETUP_LABELS, TIER_LABELS, type SetupType, type TradePlan, type ConfidenceBreakdown, type QualityBreakdown } from "@shared/schema";

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
  const [, params] = useRoute("/symbol/:ticker");
  const ticker = params?.ticker?.toUpperCase() ?? "";

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
