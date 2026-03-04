import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  Layers,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Shield,
  Clock,
  AlertTriangle,
  CheckCircle,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from "lucide-react";

interface WindowStats {
  window_days: number;
  trading_days: number;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_r: number;
  avg_r: number;
  total_pnl: number;
  avg_pnl: number;
  trades_per_day: number;
  daily_avg_pnl: number;
  profit_factor: number;
  best_trade_r: number;
  best_trade_pnl: number;
  worst_trade_r: number;
  worst_trade_pnl: number;
  max_drawdown_r: number;
  max_drawdown_pnl: number;
  equity_curve: { trade: number; cum_r: number; cum_pnl: number }[];
}

interface ExecutionWindow {
  window_days: number;
  retention_pct: number;
  realistic_pnl: number;
  theoretical_pnl: number;
  execution_cost_total: number;
  realistic_win_rate: number;
  realistic_profit_factor: number;
  realistic_max_drawdown_r: number;
  realistic_max_drawdown_pnl: number;
  avg_cost_per_trade: number;
  tier_breakdown: { tier: string; count: number; pct: number }[];
}

interface TimingRecommendation {
  windows: { label: string; start: string; end: string; spread_factor: number; effective_cost_mult: number }[];
  optimal_savings_pct: number;
  avoid_penalty_pct: number;
}

interface InstrumentResult {
  profile: { name: string; leverage: number; rth_only: boolean; loss_cap: number | null; fee_per_trade: number };
  windows: WindowStats[];
  execution?: { windows: ExecutionWindow[]; timing: TimingRecommendation };
}

interface DataSummary {
  total_signals_considered: number;
  signals_filtered_by_profile: number;
  signals_filtered_by_optimization: number;
  signals_included: number;
  backtests_included: number;
  total_trade_inputs: number;
}

interface ProfitWindowsData {
  comparison: Record<string, InstrumentResult>;
  risk_per_trade: number;
  generated_at: string;
  filters: { min_win_rate: number; min_expectancy_r: number; min_sample_size: number; include_backtests: boolean };
  data_summary: DataSummary & { polygon_data?: boolean; over_capital?: { shares: number; letf: number; options: number; letfOptions: number } };
  cache_status?: string;
  cached_at?: string | null;
}

const INST_ORDER = ["SHARES", "LETF", "OPTIONS", "LETF_OPTIONS"];
const INST_COLORS: Record<string, string> = {
  SHARES: "hsl(var(--chart-1))",
  LETF: "hsl(var(--chart-2))",
  OPTIONS: "hsl(var(--chart-3))",
  LETF_OPTIONS: "hsl(var(--chart-4))",
};
const INST_LABELS: Record<string, string> = {
  SHARES: "Shares",
  LETF: "Leveraged ETF",
  OPTIONS: "Options",
  LETF_OPTIONS: "LETF Options",
};

function formatR(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;
}
function formatPnl(v: number) {
  return `${v >= 0 ? "+" : ""}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function ProfitWindowsPage() {
  const [risk, setRisk] = useState(1000);
  const [activeWindow, setActiveWindow] = useState(0);
  const [activeInstrument, setActiveInstrument] = useState("SHARES");
  const [rebuilding, setRebuilding] = useState(false);

  const queryParams = `risk=${risk}`;

  const { data, isLoading, refetch } = useQuery<ProfitWindowsData>({
    queryKey: ["/api/performance/profit-windows", risk],
    queryFn: () => fetch(`/api/performance/profit-windows?${queryParams}`).then(r => r.json()),
  });

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await fetch("/api/profit-windows/rebuild", { method: "POST" });
      await refetch();
    } finally {
      setRebuilding(false);
    }
  };

  const currentInstrument = useMemo(() => {
    if (!data) return null;
    return data.comparison[activeInstrument] ?? null;
  }, [data, activeInstrument]);

  const currentWindow = useMemo(() => {
    if (!currentInstrument) return null;
    return currentInstrument.windows[activeWindow] ?? null;
  }, [currentInstrument, activeWindow]);

  const currentExecWindow = useMemo(() => {
    if (!currentInstrument?.execution) return null;
    return currentInstrument.execution.windows[activeWindow] ?? null;
  }, [currentInstrument, activeWindow]);

  const comparisonData = useMemo(() => {
    if (!data) return [];
    return INST_ORDER.map(key => {
      const inst = data.comparison[key];
      if (!inst) return null;
      const w = inst.windows[activeWindow];
      if (!w) return null;
      return { key, label: INST_LABELS[key], ...w };
    }).filter(Boolean) as (WindowStats & { key: string; label: string })[];
  }, [data, activeWindow]);

  const WINDOW_LABELS = ["30 Days", "60 Days", "90 Days"];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <Layers className="w-5 h-5" />
          Multi-Instrument Profit Windows
        </h1>
        <p className="text-sm text-muted-foreground">
          Compare performance across 4 instrument types with realistic execution costs
        </p>
      </div>

      {data?.data_summary?.polygon_data && (
        <Card>
          <CardContent className="pt-3 pb-3 px-4">
            <div className="flex items-center gap-3 text-xs">
              <Badge variant="outline" className="border-green-500/50 text-green-600">
                <CheckCircle className="w-3 h-3 mr-1" />
                Real Polygon Data
              </Badge>
              <span className="text-muted-foreground">
                {data.data_summary.backtests_included} activated trades
              </span>
              {data.cache_status === "cached" && data.cached_at && (
                <span className="text-muted-foreground">
                  Cached {new Date(data.cached_at).toLocaleDateString()}
                </span>
              )}
              {data.data_summary.over_capital && (
                <span className="text-amber-500">
                  {Object.values(data.data_summary.over_capital).reduce((s, v) => s + v, 0)} trades &gt;$1K
                </span>
              )}
              <button
                onClick={handleRebuild}
                disabled={rebuilding}
                className="ml-auto px-2 py-1 text-xs rounded border border-border hover:bg-muted transition-colors disabled:opacity-50"
                data-testid="btn-rebuild-cache"
              >
                {rebuilding ? "Rebuilding..." : "Rebuild Cache"}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4 pb-4 px-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Capital Per Trade</Label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={risk}
                  onChange={(e) => setRisk(parseInt(e.target.value) || 1000)}
                  className="w-24 h-8 text-sm"
                  data-testid="input-risk"
                />
              </div>
            </div>
            <div className="flex gap-1">
              {WINDOW_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveWindow(idx)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    activeWindow === idx
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  }`}
                  data-testid={`btn-window-${idx}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {data?.data_summary && (
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t text-[11px] text-muted-foreground">
              <span data-testid="text-signals-considered">{data.data_summary.backtests_included} activated backtest trades</span>
              <span className="font-medium text-foreground" data-testid="text-signals-included">
                Real Polygon.io LETF bars + option premiums
              </span>
              <span className="font-medium">{data.data_summary.total_trade_inputs} total instruments computed</span>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : !data ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Layers className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No trade data available</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4" data-testid="instrument-cards">
            {INST_ORDER.map(key => {
              const inst = data.comparison[key];
              if (!inst) return null;
              const w = inst.windows[activeWindow];
              if (!w) return null;
              const isActive = activeInstrument === key;
              return (
                <Card
                  key={key}
                  className={`cursor-pointer transition-all ${isActive ? "ring-2 ring-primary" : "hover:bg-muted/30"}`}
                  onClick={() => setActiveInstrument(key)}
                  data-testid={`card-instrument-${key}`}
                >
                  <CardContent className="pt-3 pb-3 px-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">{INST_LABELS[key]}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {inst.profile.leverage}x
                      </Badge>
                    </div>
                    <div className={`text-2xl font-bold font-mono ${w.total_pnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`}>
                      {formatPnl(w.total_pnl)}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{w.total_trades} trades</span>
                      <span>{w.win_rate}% WR</span>
                      <span>{formatR(w.total_r)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/70">
                      <span>PF: {w.profit_factor === Infinity ? "---" : w.profit_factor.toFixed(2)}</span>
                      <span>DD: {formatR(-w.max_drawdown_r)}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Side-by-Side Comparison — {WINDOW_LABELS[activeWindow]}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metric</TableHead>
                      {INST_ORDER.map(key => (
                        <TableHead key={key} className="text-center text-xs">{INST_LABELS[key]}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: "Total Trades", fn: (w: WindowStats) => String(w.total_trades) },
                      { label: "Win Rate", fn: (w: WindowStats) => `${w.win_rate}%` },
                      { label: "Total R", fn: (w: WindowStats) => formatR(w.total_r) },
                      { label: "Avg R", fn: (w: WindowStats) => formatR(w.avg_r) },
                      { label: "Total P&L", fn: (w: WindowStats) => formatPnl(w.total_pnl) },
                      { label: "Avg P&L", fn: (w: WindowStats) => formatPnl(w.avg_pnl) },
                      { label: "Trades/Day", fn: (w: WindowStats) => w.trades_per_day.toFixed(2) },
                      { label: "Daily Avg P&L", fn: (w: WindowStats) => formatPnl(w.daily_avg_pnl) },
                      { label: "Profit Factor", fn: (w: WindowStats) => w.profit_factor === Infinity ? "---" : w.profit_factor.toFixed(2) },
                      { label: "Best Trade", fn: (w: WindowStats) => `${formatR(w.best_trade_r)} (${formatPnl(w.best_trade_pnl)})` },
                      { label: "Worst Trade", fn: (w: WindowStats) => `${formatR(w.worst_trade_r)} (${formatPnl(w.worst_trade_pnl)})` },
                      { label: "Max Drawdown", fn: (w: WindowStats) => `${formatR(-w.max_drawdown_r)} (${formatPnl(-w.max_drawdown_pnl)})` },
                      { label: "Trading Days", fn: (w: WindowStats) => String(w.trading_days) },
                    ].map(row => (
                      <TableRow key={row.label}>
                        <TableCell className="text-xs font-medium">{row.label}</TableCell>
                        {INST_ORDER.map(key => {
                          const w = data.comparison[key]?.windows[activeWindow];
                          return (
                            <TableCell key={key} className="text-center text-xs font-mono">
                              {w ? row.fn(w) : "—"}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeInstrument} onValueChange={setActiveInstrument} data-testid="instrument-tabs">
            <TabsList className="grid w-full grid-cols-4">
              {INST_ORDER.map(key => (
                <TabsTrigger key={key} value={key} className="text-xs" data-testid={`tab-${key}`}>
                  {INST_LABELS[key]}
                </TabsTrigger>
              ))}
            </TabsList>

            {INST_ORDER.map(key => {
              const inst = data.comparison[key];
              if (!inst) return null;
              const w = inst.windows[activeWindow];
              const exec = inst.execution?.windows[activeWindow];
              const timing = inst.execution?.timing;

              return (
                <TabsContent key={key} value={key} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Target className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Trades</span>
                        </div>
                        <div className="text-2xl font-bold font-mono" data-testid="text-trades">{w?.total_trades ?? 0}</div>
                        <div className="flex gap-2 mt-1 text-xs">
                          <span className="text-emerald-500">{w?.wins ?? 0}W</span>
                          <span className="text-red-500 dark:text-red-400">{w?.losses ?? 0}L</span>
                          <span className="text-muted-foreground">{w?.win_rate ?? 0}%</span>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <div className="flex items-center gap-2 mb-1">
                          <DollarSign className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Total P&L</span>
                        </div>
                        <div className={`text-2xl font-bold font-mono ${(w?.total_pnl ?? 0) >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-total-pnl">
                          {formatPnl(w?.total_pnl ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{formatR(w?.total_r ?? 0)} total</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Avg R / Trade</span>
                        </div>
                        <div className={`text-2xl font-bold font-mono ${(w?.avg_r ?? 0) >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`}>
                          {formatR(w?.avg_r ?? 0)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{formatPnl(w?.avg_pnl ?? 0)} avg/trade</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4 pb-3 px-4">
                        <div className="flex items-center gap-2 mb-1">
                          <Shield className="w-4 h-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Max Drawdown</span>
                        </div>
                        <div className="text-2xl font-bold font-mono text-red-500 dark:text-red-400" data-testid="text-drawdown">
                          {formatPnl(-(w?.max_drawdown_pnl ?? 0))}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{formatR(-(w?.max_drawdown_r ?? 0))}</div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Equity Curve (R)</CardTitle>
                        <p className="text-xs text-muted-foreground">Cumulative R progression — {INST_LABELS[key]}</p>
                      </CardHeader>
                      <CardContent className="p-2">
                        {(!w?.equity_curve || w.equity_curve.length === 0) ? (
                          <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">No trade data</div>
                        ) : (
                          <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={w.equity_curve}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="trade" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `${v}R`} />
                                <Tooltip
                                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }}
                                  formatter={(value: number, name: string) => [name === "cum_r" ? `${value.toFixed(2)}R` : `$${value.toFixed(0)}`, name === "cum_r" ? "Cumulative R" : "Cumulative P&L"]}
                                  labelFormatter={(label: number) => `Trade #${label}`}
                                />
                                <Line type="monotone" dataKey="cum_r" stroke={INST_COLORS[key]} strokeWidth={2} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">P&L per Trade</CardTitle>
                        <p className="text-xs text-muted-foreground">Individual trade P&L</p>
                      </CardHeader>
                      <CardContent className="p-2">
                        {(!w?.equity_curve || w.equity_curve.length === 0) ? (
                          <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">No trade data</div>
                        ) : (
                          <div className="h-56">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={w.equity_curve.map((pt, i, arr) => ({
                                trade: pt.trade,
                                r: i === 0 ? pt.cum_r : Math.round((pt.cum_r - arr[i - 1].cum_r) * 100) / 100,
                              }))}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis dataKey="trade" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `${v}R`} />
                                <Tooltip
                                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }}
                                  formatter={(value: number) => [`${value.toFixed(2)}R`, "Trade R"]}
                                />
                                <Bar dataKey="r" radius={[2, 2, 0, 0]}>
                                  {w.equity_curve.map((pt, i, arr) => {
                                    const r = i === 0 ? pt.cum_r : pt.cum_r - arr[i - 1].cum_r;
                                    return <Cell key={i} fill={r >= 0 ? "hsl(var(--chart-3))" : "hsl(var(--destructive))"} />;
                                  })}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {exec && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          Realistic Execution Analysis
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">Accounting for spreads, slippage, and fill rates</p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
                          <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Retention</span>
                            <div className={`text-lg font-bold font-mono ${exec.retention_pct >= 80 ? "text-emerald-500" : exec.retention_pct >= 60 ? "text-yellow-500" : "text-red-500"}`}>
                              {exec.retention_pct}%
                            </div>
                            <p className="text-[10px] text-muted-foreground">of theoretical P&L</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Realistic P&L</span>
                            <div className={`text-lg font-bold font-mono ${exec.realistic_pnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`}>
                              {formatPnl(exec.realistic_pnl)}
                            </div>
                            <p className="text-[10px] text-muted-foreground">vs {formatPnl(exec.theoretical_pnl)} theoretical</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Exec Cost</span>
                            <div className="text-lg font-bold font-mono text-red-500 dark:text-red-400">
                              {formatPnl(-exec.execution_cost_total)}
                            </div>
                            <p className="text-[10px] text-muted-foreground">{formatPnl(-exec.avg_cost_per_trade)} avg/trade</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Real Win Rate</span>
                            <div className="text-lg font-bold font-mono">{exec.realistic_win_rate}%</div>
                            <p className="text-[10px] text-muted-foreground">PF: {exec.realistic_profit_factor === Infinity ? "---" : exec.realistic_profit_factor.toFixed(2)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Real Max DD</span>
                            <div className="text-lg font-bold font-mono text-red-500 dark:text-red-400">
                              {formatPnl(-exec.realistic_max_drawdown_pnl)}
                            </div>
                            <p className="text-[10px] text-muted-foreground">{formatR(-exec.realistic_max_drawdown_r)}</p>
                          </div>
                        </div>

                        {exec.tier_breakdown.length > 0 && (
                          <div className="mt-4">
                            <span className="text-xs font-medium text-muted-foreground">Liquidity Tier Breakdown</span>
                            <div className="flex gap-2 mt-2 flex-wrap">
                              {exec.tier_breakdown.map(tb => (
                                <Badge key={tb.tier} variant="outline" className="text-[10px]">
                                  {tb.tier.replace("_", " ")}: {tb.count} ({tb.pct}%)
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {timing && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Clock className="w-4 h-4" />
                          Execution Timing Recommendations
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Trade optimal windows to save {timing.optimal_savings_pct}% in execution costs
                        </p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                          {timing.windows.map(tw => {
                            const isOptimal = tw.effective_cost_mult <= 1.05;
                            const isAvoid = tw.effective_cost_mult >= 1.7;
                            return (
                              <div
                                key={tw.start}
                                className={`p-3 rounded-lg border ${
                                  isOptimal ? "border-emerald-500/30 bg-emerald-500/5" :
                                  isAvoid ? "border-red-500/30 bg-red-500/5" :
                                  "border-border bg-muted/20"
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5">
                                    {isOptimal ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> :
                                     isAvoid ? <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> :
                                     <Clock className="w-3.5 h-3.5 text-yellow-500" />}
                                    <span className="text-xs font-medium">{tw.start} — {tw.end}</span>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${
                                      isOptimal ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
                                      isAvoid ? "bg-red-500/10 text-red-600 border-red-500/20" :
                                      "bg-yellow-500/10 text-yellow-600 border-yellow-500/20"
                                    }`}
                                  >
                                    {tw.effective_cost_mult.toFixed(1)}x cost
                                  </Badge>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-1">{tw.label}</p>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                            Optimal saves ~{timing.optimal_savings_pct}% vs avoid windows
                          </span>
                          <span className="flex items-center gap-1">
                            <ArrowDownRight className="w-3 h-3 text-red-500" />
                            Avoid windows cost ~{timing.avoid_penalty_pct}% more
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cross-Instrument Total R Comparison</CardTitle>
              <p className="text-xs text-muted-foreground">Total R-multiple by instrument — {WINDOW_LABELS[activeWindow]}</p>
            </CardHeader>
            <CardContent className="p-2">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `${v}R`} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={100} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }}
                      formatter={(value: number) => [`${value.toFixed(2)}R`, "Total R"]}
                    />
                    <Bar dataKey="total_r" radius={[0, 4, 4, 0]}>
                      {comparisonData.map((entry, i) => (
                        <Cell key={i} fill={entry.total_r >= 0 ? INST_COLORS[entry.key] : "hsl(var(--destructive))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
