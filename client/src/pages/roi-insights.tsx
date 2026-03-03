import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  LineChart,
  Line,
} from "recharts";
import {
  Trophy,
  Star,
  AlertTriangle,
  ShieldAlert,
  BarChart3,
  Target,
  TrendingUp,
  TrendingDown,
  Activity,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { SETUP_LABELS, type SetupType } from "@shared/schema";

interface SetupRanking {
  setup: string;
  totalTrades: number;
  winRate: number;
  activatedTrades: number;
  activatedWinRate: number;
  lift: number;
}

interface TopTicker {
  ticker: string;
  setup: string;
  trades: number;
  winRate: number;
  wins: number;
  losses: number;
}

interface AvoidTicker {
  ticker: string;
  trades: number;
  winRate: number;
}

interface QSBreakdown {
  range: string;
  trades: number;
  winRate: number;
  wins: number;
  losses: number;
}

interface EquityPoint {
  trade: number;
  date: string;
  pnl: number;
  cumPnl: number;
  ticker: string;
}

interface StrategyPerformance {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: { ticker: string; pnl: number } | null;
  worstTrade: { ticker: string; pnl: number } | null;
  equityCurve: EquityPoint[];
  dailyPnl: { date: string; pnl: number }[];
}

interface ROIInsightsData {
  totalBacktestTrades: number;
  totalActivatedTrades: number;
  overallActivatedWinRate: number;
  setupRankings: SetupRanking[];
  bestSetup: string | null;
  topTickers: TopTicker[];
  avoidTickers: AvoidTicker[];
  qualityScoreBreakdown: QSBreakdown[];
  strategyPerformance: StrategyPerformance | null;
}

export default function ROIInsightsPage() {
  const [setupFilter, setSetupFilter] = useState<string>("best");

  const { data, isLoading } = useQuery<ROIInsightsData>({
    queryKey: ["/api/performance/roi-insights", setupFilter],
    queryFn: async () => {
      const res = await fetch(`/api/performance/roi-insights?setup=${setupFilter}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const sp = data?.strategyPerformance;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <Trophy className="w-5 h-5 text-amber-500" />
          ROI Insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Backtest edge analysis — setup rankings, recommended strategy performance, and trade selection guidance
        </p>
      </div>

      <div className="flex items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium">Focus Setup</label>
          <Select value={setupFilter} onValueChange={setSetupFilter}>
            <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="select-setup-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="best">Best Setup (Auto)</SelectItem>
              <SelectItem value="A">A — Thu-Fri-Mon Magnet</SelectItem>
              <SelectItem value="B">B — Gap Fill</SelectItem>
              <SelectItem value="C">C — Weak Extreme</SelectItem>
              <SelectItem value="D">D — Expansion Exhaustion</SelectItem>
              <SelectItem value="E">E — Inside Day Breakout</SelectItem>
              <SelectItem value="F">F — Previous Day Level</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Activity className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
            <div className="text-sm text-muted-foreground">No data available</div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-xs text-muted-foreground">Backtest Trades</div>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-bt">{data.totalBacktestTrades.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-xs text-muted-foreground">Activated Trades</div>
                <div className="text-2xl font-bold font-mono" data-testid="text-total-act">{data.totalActivatedTrades.toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground">{data.totalBacktestTrades > 0 ? Math.round(data.totalActivatedTrades / data.totalBacktestTrades * 100) : 0}% activation rate</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-xs text-muted-foreground">Activated Win Rate</div>
                <div className={`text-2xl font-bold font-mono ${data.overallActivatedWinRate >= 50 ? "text-emerald-500" : "text-red-500"}`} data-testid="text-act-wr">
                  {data.overallActivatedWinRate}%
                </div>
              </CardContent>
            </Card>
          </div>

          {sp && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-500" />
                  Recommended Strategy — {SETUP_LABELS[data.bestSetup as SetupType] ?? data.bestSetup} + Top Tickers + Activated
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Simulated P&L for activated trades on the best setup's top-performing tickers ($1,000/trade)
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Trades</div>
                    <div className="text-xl font-bold font-mono" data-testid="text-strat-trades">{sp.totalTrades}</div>
                    <div className="text-[10px] text-muted-foreground">
                      <span className="text-emerald-500">{sp.wins}W</span> / <span className="text-red-500">{sp.losses}L</span>
                    </div>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Win Rate</div>
                    <div className={`text-xl font-bold font-mono ${sp.winRate >= 50 ? "text-emerald-500" : "text-red-500"}`} data-testid="text-strat-wr">
                      {sp.winRate}%
                    </div>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Total P&L</div>
                    <div className={`text-xl font-bold font-mono ${sp.totalPnl >= 0 ? "text-emerald-500" : "text-red-500"}`} data-testid="text-strat-pnl">
                      {sp.totalPnl >= 0 ? "+" : ""}${sp.totalPnl.toFixed(0)}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase">Avg P&L/Trade</div>
                    <div className={`text-xl font-bold font-mono ${sp.avgPnl >= 0 ? "text-emerald-500" : "text-red-500"}`} data-testid="text-strat-avg">
                      {sp.avgPnl >= 0 ? "+" : ""}${sp.avgPnl.toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {sp.bestTrade && (
                    <div className="rounded-lg border p-3 flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Best Trade</div>
                        <div className="text-sm font-mono">
                          <span className="text-emerald-500 font-medium">+${sp.bestTrade.pnl.toFixed(0)}</span>
                          <span className="text-xs text-muted-foreground ml-1.5">{sp.bestTrade.ticker}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {sp.worstTrade && (
                    <div className="rounded-lg border p-3 flex items-center gap-2">
                      <ArrowDownRight className="w-4 h-4 text-red-500" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Worst Trade</div>
                        <div className="text-sm font-mono">
                          <span className="text-red-500 font-medium">${sp.worstTrade.pnl.toFixed(0)}</span>
                          <span className="text-xs text-muted-foreground ml-1.5">{sp.worstTrade.ticker}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {sp.equityCurve.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Equity Curve — Strategy P&L</h4>
                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={sp.equityCurve} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="trade" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `$${v}`} />
                        <Tooltip
                          contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                          formatter={(v: number) => [`$${v.toFixed(2)}`, "Cum P&L"]}
                          labelFormatter={(l: number) => {
                            const pt = sp.equityCurve.find(p => p.trade === l);
                            return pt ? `Trade #${l} — ${pt.ticker} (${pt.date})` : `Trade #${l}`;
                          }}
                        />
                        <Line type="monotone" dataKey="cumPnl" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {sp.dailyPnl.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-2">Daily P&L</h4>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={sp.dailyPnl} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" interval={Math.max(0, Math.floor(sp.dailyPnl.length / 20))} />
                        <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={v => `$${v}`} />
                        <Tooltip
                          contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                          formatter={(v: number) => [`$${v.toFixed(2)}`, "P&L"]}
                        />
                        <Bar dataKey="pnl">
                          {sp.dailyPnl.map((d, i) => (
                            <Cell key={i} fill={d.pnl >= 0 ? "hsl(var(--chart-2))" : "hsl(0 84% 60%)"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Setup Rankings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Setup</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">WR</TableHead>
                        <TableHead className="text-right">Activated</TableHead>
                        <TableHead className="text-right">Act WR</TableHead>
                        <TableHead className="text-right">Lift</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.setupRankings.map((sr, i) => (
                        <TableRow key={sr.setup} className={sr.setup === data.bestSetup ? "bg-emerald-500/5" : ""} data-testid={`row-setup-${sr.setup}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {i === 0 && <Star className="w-3.5 h-3.5 text-amber-500" />}
                              <Badge variant="outline" className="text-[10px]">
                                {SETUP_LABELS[sr.setup as SetupType] ?? sr.setup}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{sr.totalTrades.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{sr.winRate}%</TableCell>
                          <TableCell className="text-right font-mono text-sm">{sr.activatedTrades.toLocaleString()}</TableCell>
                          <TableCell className={`text-right font-mono text-sm font-medium ${sr.activatedWinRate >= 50 ? "text-emerald-500" : "text-red-500"}`}>
                            {sr.activatedWinRate}%
                          </TableCell>
                          <TableCell className={`text-right font-mono text-sm ${sr.lift >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {sr.lift >= 0 ? "+" : ""}{sr.lift}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Quality Score Breakdown
                </CardTitle>
                <p className="text-xs text-muted-foreground">Win rate by quality score bucket (activated trades)</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {data.qualityScoreBreakdown.map(qs => (
                    <div key={qs.range} className="rounded-lg border p-3 text-center" data-testid={`card-qs-${qs.range}`}>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">QS {qs.range}</div>
                      <div className={`text-lg font-bold font-mono ${qs.winRate >= 50 ? "text-emerald-500" : "text-red-500"}`}>
                        {qs.winRate}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">{qs.trades.toLocaleString()} trades</div>
                      <div className="text-[10px] text-muted-foreground">{qs.wins}W / {qs.losses}L</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-500" />
                  Top Tickers — {SETUP_LABELS[data.bestSetup as SetupType] ?? data.bestSetup}
                </CardTitle>
                <p className="text-xs text-muted-foreground">65%+ win rate, 30+ activated trades</p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead className="text-right">Trades</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">W/L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topTickers.map((tt, i) => (
                        <TableRow key={tt.ticker} data-testid={`row-top-${tt.ticker}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {i < 3 && <Trophy className={`w-3.5 h-3.5 ${i === 0 ? "text-amber-500" : i === 1 ? "text-zinc-400" : "text-amber-700"}`} />}
                              {tt.ticker}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{tt.trades}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-emerald-500">{tt.winRate}%</TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">{tt.wins}W / {tt.losses}L</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Avoid List
                </CardTitle>
                <p className="text-xs text-muted-foreground">Worst tickers by win rate (50+ activated trades)</p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead className="text-right">Trades</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.avoidTickers.map(at => (
                        <TableRow key={at.ticker} data-testid={`row-avoid-${at.ticker}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                              {at.ticker}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{at.trades}</TableCell>
                          <TableCell className="text-right font-mono text-sm font-medium text-red-500">{at.winRate}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Star className="w-4 h-4" />
                1-Trade-Per-Day Selection Guide
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground min-w-[110px]">Best Setup:</span>
                  <span>
                    {data.bestSetup ? (SETUP_LABELS[data.bestSetup as SetupType] ?? data.bestSetup) : "N/A"} — highest activated win rate at{" "}
                    <span className="font-mono font-medium text-emerald-500">{data.setupRankings[0]?.activatedWinRate ?? 0}%</span> across{" "}
                    {data.setupRankings[0]?.activatedTrades.toLocaleString() ?? 0} trades
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground min-w-[110px]">Top Tickers:</span>
                  <span>
                    {data.topTickers.slice(0, 5).map(t => t.ticker).join(", ")} — all {">"}65% win rate on 30+ activated trades
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground min-w-[110px]">Quality Score:</span>
                  <span>Target QS 50+ — trades below 50 show significantly lower win rates</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground min-w-[110px]">Entry Filter:</span>
                  <span>Activated Only — confirmed entry trigger (breakout + retest) during market hours</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground min-w-[110px]">Avoid:</span>
                  <span className="text-red-500">
                    {data.avoidTickers.slice(0, 5).map(t => t.ticker).join(", ")} — consistently below 40% win rate
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-foreground min-w-[110px]">Tiebreaker:</span>
                  <span>When multiple signals fire, pick the one with the highest quality score from the top ticker list</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
