import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Legend,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRightLeft,
} from "lucide-react";
import { SETUP_LABELS, type SetupType } from "@shared/schema";

interface TradeResult {
  signalId: number;
  ticker: string;
  setupType: string;
  direction: string;
  bias: string;
  instrumentType: string;
  date: string;
  entryPrice: number;
  exitPrice: number | null;
  t1Price: number | null;
  t2Price: number | null;
  t2Reached: boolean;
  t1LegPnl: number;
  t2LegPnl: number;
  t1OnlyPnl: number;
  shares: number;
  halfShares1: number;
  halfShares2: number;
  invested: number;
  pnlDollar: number;
  pnlPct: number;
  outcome: string;
  tier: string;
  qualityScore: number;
  timeToHitMin: number | null;
  hasIbkrTrade: boolean;
  ibkrPnl: number | null;
  ibkrStatus: string | null;
  source?: string;
}

interface EquityCurvePoint {
  trade: number;
  date: string;
  ticker: string;
  pnl: number;
  cumPnl: number;
  cumT1Pnl: number;
}

interface DailyPnlPoint {
  date: string;
  pnl: number;
}

interface PeriodSummary {
  label: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalInvested: number;
  capitalRequired: number;
  avgPnlPerTrade: number;
  roiOnCapital: number;
  edgePct: number;
  bestTrade: { ticker: string; pnl: number } | null;
  worstTrade: { ticker: string; pnl: number } | null;
  instrumentBreakdown: { type: string; count: number; pnl: number; winRate: number }[];
  liveCount?: number;
  backtestCount?: number;
  t2HitRate: number;
  t2Hits: number;
  t1OnlyHits: number;
  t1OnlyTotalPnl: number;
  equityCurve: EquityCurvePoint[];
  dailyPnl: DailyPnlPoint[];
}

interface Comparison {
  t1OnlyPnl: number;
  splitPnl: number;
  deltaDollar: number;
  deltaPercent: number;
  t2HitRate: number;
  t2HitCount: number;
  t2MissCount: number;
  t2ExtraProfit: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalFilteredTrades: number;
  totalPages: number;
}

interface Performance2Data {
  capitalPerTrade: number;
  totalSignalsAnalyzed: number;
  totalResolvedTrades: number;
  activeProfileName: string | null;
  dataSpanDays: number;
  earliestDate: string | null;
  latestDate: string | null;
  periodSummaries: PeriodSummary[];
  trades: TradeResult[];
  pagination: Pagination;
  comparison: Comparison;
}

export default function Performance2Page() {
  const [capital, setCapital] = useState(1000);
  const [periodFilter, setPeriodFilter] = useState<number>(4);
  const [instrumentFilter, setInstrumentFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const { data, isLoading } = useQuery<Performance2Data>({
    queryKey: ["/api/performance2/analysis", capital, periodFilter, instrumentFilter, page],
    queryFn: async () => {
      const res = await fetch(`/api/performance2/analysis?capital=${capital}&period=${periodFilter}&instrument=${instrumentFilter}&page=${page}&pageSize=${pageSize}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const activePeriod = useMemo(() => {
    if (!data) return null;
    return data.periodSummaries[periodFilter] ?? data.periodSummaries[4];
  }, [data, periodFilter]);

  const equityCurve = activePeriod?.equityCurve ?? [];
  const dailyPnl = activePeriod?.dailyPnl ?? [];
  const filteredTrades = data?.trades ?? [];
  const pagination = data?.pagination ?? { page: 1, pageSize, totalFilteredTrades: 0, totalPages: 1 };
  const comparison = data?.comparison ?? null;

  const handlePeriodChange = (v: string) => {
    setPeriodFilter(parseInt(v));
    setPage(1);
  };

  const handleInstrumentChange = (v: string) => {
    setInstrumentFilter(v);
    setPage(1);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <ArrowRightLeft className="w-5 h-5" />
          Performance 2 — Split-Exit Model
        </h1>
        <div className="text-sm text-muted-foreground flex items-center flex-wrap gap-1">
          <span>50% exits at T1, remaining 50% rides to T2 or exits at break-even</span>
          {data?.activeProfileName && (
            <Badge variant="outline" className="text-xs font-normal">{data.activeProfileName}</Badge>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-1" data-testid="progress-bar">
          <span className="text-xs text-muted-foreground">Loading analysis...</span>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Capital Per Trade</Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              value={capital}
              onChange={(e) => setCapital(parseInt(e.target.value) || 1000)}
              className="w-24 h-8 text-sm"
              data-testid="input-capital"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Select value={String(periodFilter)} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Last 30 Days</SelectItem>
              <SelectItem value="1">31-60 Days</SelectItem>
              <SelectItem value="2">61-90 Days</SelectItem>
              <SelectItem value="3">91+ Days</SelectItem>
              <SelectItem value="4">Total</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Instrument</Label>
          <Select value={instrumentFilter} onValueChange={handleInstrumentChange}>
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-instrument">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Instruments</SelectItem>
              <SelectItem value="OPTION">Options</SelectItem>
              <SelectItem value="SHARES">Shares</SelectItem>
              <SelectItem value="LEVERAGED_ETF">Leveraged ETF</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : !data || data.totalResolvedTrades === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Activity className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No resolved trades yet</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {comparison && (
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardContent className="py-4 px-6">
                <div className="flex items-center gap-2 mb-3">
                  <ArrowRightLeft className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Split-Exit vs T1-Only Comparison</span>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">T1-Only P&L</div>
                    <div className={`text-lg font-bold font-mono ${comparison.t1OnlyPnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-t1-only-pnl">
                      {comparison.t1OnlyPnl >= 0 ? "+" : ""}${comparison.t1OnlyPnl.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">100% exit at T1</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Split-Exit P&L</div>
                    <div className={`text-lg font-bold font-mono ${comparison.splitPnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-split-pnl">
                      {comparison.splitPnl >= 0 ? "+" : ""}${comparison.splitPnl.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">50% T1 + 50% T2/BE</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Delta</div>
                    <div className={`text-lg font-bold font-mono ${comparison.deltaDollar >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-delta">
                      {comparison.deltaDollar >= 0 ? "+" : ""}${comparison.deltaDollar.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{comparison.deltaPercent >= 0 ? "+" : ""}{comparison.deltaPercent}% vs T1-only</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">T2 Hit Rate</div>
                    <div className="text-lg font-bold font-mono text-cyan-500" data-testid="text-t2-rate">
                      {comparison.t2HitRate}%
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {comparison.t2HitCount} hits / {comparison.t2MissCount} miss
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {data.dataSpanDays > 0 && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              Data spans {data.dataSpanDays} days ({data.earliestDate} to {data.latestDate}) — {data.totalResolvedTrades} resolved trades
            </div>
          )}

          <div data-testid="period-summaries" className="space-y-3">
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              {data.periodSummaries.slice(0, 4).map((p, idx) => (
                <Card
                  key={p.label}
                  className={`cursor-pointer transition-all ${periodFilter === idx ? "ring-2 ring-primary" : "hover:bg-muted/30"}`}
                  onClick={() => { setPeriodFilter(idx); setPage(1); }}
                  data-testid={`card-period-${idx}`}
                >
                  <CardContent className="pt-3 pb-3 px-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">{p.label}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${p.totalPnl >= 0 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-red-500/10 text-red-600 border-red-500/20"}`}
                      >
                        {p.totalPnl >= 0 ? "+" : ""}{p.roiOnCapital}% ROI
                      </Badge>
                    </div>
                    <div className={`text-xl font-bold font-mono ${p.totalPnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`}>
                      {p.totalPnl >= 0 ? "+" : ""}${p.totalPnl.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{p.totalTrades} trades</span>
                      <span>{p.winRate}% WR</span>
                      <span className="text-cyan-500">{p.t2HitRate}% T2</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/70">
                      <span>{p.edgePct >= 0 ? "+" : ""}{p.edgePct}% edge</span>
                      {(p.liveCount ?? 0) > 0 && <span>{p.liveCount} live</span>}
                      {(p.backtestCount ?? 0) > 0 && <span>{p.backtestCount} backtest</span>}
                    </div>
                    {p.totalTrades === 0 && (
                      <div className="text-[10px] text-muted-foreground/60 mt-1">No trades in this period</div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
            {data.periodSummaries[4] && (() => {
              const p = data.periodSummaries[4];
              return (
                <Card
                  className={`cursor-pointer transition-all ${periodFilter === 4 ? "ring-2 ring-primary" : "hover:bg-muted/30"}`}
                  onClick={() => setPeriodFilter(4)}
                  data-testid="card-period-4"
                >
                  <CardContent className="pt-3 pb-3 px-4">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground">{p.label}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${p.totalPnl >= 0 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-red-500/10 text-red-600 border-red-500/20"}`}
                        >
                          {p.totalPnl >= 0 ? "+" : ""}{p.roiOnCapital}% ROI
                        </Badge>
                      </div>
                      <div className={`text-xl font-bold font-mono ${p.totalPnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`}>
                        {p.totalPnl >= 0 ? "+" : ""}${p.totalPnl.toLocaleString()}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{p.totalTrades} trades</span>
                        <span>{p.winRate}% WR</span>
                        <span className="text-cyan-500">{p.t2HitRate}% T2</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}
          </div>

          {activePeriod && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Total Trades</span>
                  </div>
                  <div className="text-2xl font-bold font-mono" data-testid="text-total-trades">{activePeriod.totalTrades}</div>
                  <div className="flex gap-2 mt-1 text-xs">
                    <span className="text-emerald-500">{activePeriod.wins} W</span>
                    <span className="text-red-500 dark:text-red-400">{activePeriod.losses} L</span>
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    <span className="text-cyan-500">{activePeriod.t2Hits} T2 hits</span>
                    <span>{activePeriod.t1OnlyHits} T1-only</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">ROI on Capital</span>
                  </div>
                  <div className={`text-2xl font-bold font-mono ${activePeriod.roiOnCapital >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-roi">
                    {activePeriod.roiOnCapital >= 0 ? "+" : ""}{activePeriod.roiOnCapital}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    on ${activePeriod.capitalRequired.toLocaleString()} capital ({activePeriod.edgePct}% edge)
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Avg P&L / Trade</span>
                  </div>
                  <div className={`text-2xl font-bold font-mono ${activePeriod.avgPnlPerTrade >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-avg-pnl">
                    {activePeriod.avgPnlPerTrade >= 0 ? "+" : ""}${activePeriod.avgPnlPerTrade.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">per ${capital} position (split-exit)</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Best / Worst</span>
                  </div>
                  <div className="space-y-1">
                    {activePeriod.bestTrade && (
                      <div className="flex items-center gap-1 text-sm">
                        <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                        <span className="font-mono text-emerald-500">+${activePeriod.bestTrade.pnl.toFixed(0)}</span>
                        <span className="text-xs text-muted-foreground">{activePeriod.bestTrade.ticker}</span>
                      </div>
                    )}
                    {activePeriod.worstTrade && (
                      <div className="flex items-center gap-1 text-sm">
                        <ArrowDownRight className="w-3 h-3 text-red-500" />
                        <span className="font-mono text-red-500 dark:text-red-400">${activePeriod.worstTrade.pnl.toFixed(0)}</span>
                        <span className="text-xs text-muted-foreground">{activePeriod.worstTrade.ticker}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Equity Curve — Split vs T1-Only</CardTitle>
                <p className="text-xs text-muted-foreground">Cumulative P&L comparison — {activePeriod?.label ?? "Total"}</p>
              </CardHeader>
              <CardContent className="p-2">
                {equityCurve.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">No trade data for this period</div>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={equityCurve}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="trade" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: "Trade #", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `$${v}`} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "6px",
                            fontSize: "12px",
                          }}
                          formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name === "cumPnl" ? "Split-Exit" : "T1-Only"]}
                          labelFormatter={(label: number) => `Trade #${label}`}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: "11px" }}
                          formatter={(value: string) => value === "cumPnl" ? "Split-Exit" : "T1-Only"}
                        />
                        <Line
                          type="monotone"
                          dataKey="cumPnl"
                          stroke="hsl(var(--chart-3))"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="cumT1Pnl"
                          stroke="hsl(var(--muted-foreground))"
                          strokeWidth={1}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Daily P&L</CardTitle>
                <p className="text-xs text-muted-foreground">Net profit/loss per trading day (split-exit)</p>
              </CardHeader>
              <CardContent className="p-2">
                {dailyPnl.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">No trade data for this period</div>
                ) : (
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyPnl}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => `$${v}`} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "6px",
                            fontSize: "12px",
                          }}
                          formatter={(value: number) => [`$${value.toFixed(2)}`, "P&L"]}
                        />
                        <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                          {dailyPnl.map((entry, i) => (
                            <Cell key={i} fill={entry.pnl >= 0 ? "hsl(var(--chart-3))" : "hsl(var(--destructive))"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {activePeriod && activePeriod.instrumentBreakdown.filter(b => b.count > 0).length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Instrument Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  {activePeriod.instrumentBreakdown.filter(b => b.count > 0).map(b => (
                    <div key={b.type} className="p-3 rounded-lg bg-muted/30 space-y-1">
                      <div className="text-xs font-medium">
                        {b.type === "LEVERAGED_ETF" ? "Leveraged ETF" : b.type === "OPTION" ? "Options" : "Shares"}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className={`text-lg font-bold font-mono ${b.pnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`}>
                          {b.pnl >= 0 ? "+" : ""}${b.pnl.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        <span>{b.count} trades</span>
                        <span>{(b.winRate * 100).toFixed(0)}% WR</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Trade History (Split-Exit)</CardTitle>
                  <div className="text-xs text-muted-foreground">{pagination.totalFilteredTrades} trades in selected period</div>
                </div>
                <div className="flex gap-2">
                  {activePeriod && (
                    <Badge variant="outline" className="text-xs">
                      {activePeriod.wins}W / {activePeriod.losses}L
                    </Badge>
                  )}
                  {activePeriod && (
                    <Badge variant="outline" className="text-xs text-cyan-500 border-cyan-500/30">
                      {activePeriod.t2HitRate}% T2
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredTrades.length === 0 ? (
                <div className="p-8 text-center">
                  <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <div className="text-xs text-muted-foreground">No trades in this period</div>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Ticker</TableHead>
                          <TableHead>Setup</TableHead>
                          <TableHead>Dir</TableHead>
                          <TableHead className="text-right">Entry</TableHead>
                          <TableHead className="text-right">T1</TableHead>
                          <TableHead className="text-right">T2</TableHead>
                          <TableHead className="text-center">T2 Hit</TableHead>
                          <TableHead className="text-right">T1 Leg</TableHead>
                          <TableHead className="text-right">T2 Leg</TableHead>
                          <TableHead className="text-right">Total P&L</TableHead>
                          <TableHead className="text-right">T1-Only</TableHead>
                          <TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTrades.map(t => (
                          <TableRow key={`${t.signalId}-${t.date}`} data-testid={`row-trade-${t.signalId}`}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{t.date}</TableCell>
                            <TableCell className="font-medium">{t.ticker}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">
                                {SETUP_LABELS[t.setupType as SetupType] ?? t.setupType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs font-medium ${t.bias === "BUY" ? "text-emerald-500" : "text-red-500"}`}>
                                {t.bias}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">${t.entryPrice.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-emerald-500/80">
                              {t.t1Price ? `$${t.t1Price.toFixed(2)}` : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-cyan-500/80">
                              {t.t2Price ? `$${t.t2Price.toFixed(2)}` : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              {t.outcome === "STOPPED" ? (
                                <span className="text-muted-foreground text-xs">—</span>
                              ) : t.t2Reached ? (
                                <Badge variant="outline" className="text-[10px] bg-cyan-500/10 text-cyan-500 border-cyan-500/20">YES</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">NO</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {t.outcome !== "STOPPED" ? (
                                <span className="text-emerald-500">+${t.t1LegPnl.toFixed(2)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {t.outcome === "STOPPED" ? (
                                <span className="text-muted-foreground">—</span>
                              ) : t.t2Reached ? (
                                <span className="text-cyan-500">+${t.t2LegPnl.toFixed(2)}</span>
                              ) : (
                                <span className="text-muted-foreground">$0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              <span className={t.pnlDollar >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                {t.pnlDollar >= 0 ? "+" : ""}${t.pnlDollar.toFixed(2)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm text-muted-foreground">
                              {t.t1OnlyPnl >= 0 ? "+" : ""}${t.t1OnlyPnl.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${
                                    t.outcome === "HIT_T2"
                                      ? "bg-cyan-500/10 text-cyan-600 border-cyan-500/20"
                                      : t.outcome === "HIT_T1_ONLY"
                                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                      : "bg-red-500/10 text-red-600 border-red-500/20"
                                  }`}
                                >
                                  {t.outcome === "HIT_T2" ? "T2 WIN" : t.outcome === "HIT_T1_ONLY" ? "T1 ONLY" : "LOSS"}
                                </Badge>
                                {t.source === "backtest" && (
                                  <Badge variant="outline" className="text-[9px] bg-blue-500/10 text-blue-500 border-blue-500/20">BT</Badge>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t" data-testid="pagination-controls">
                      <div className="text-xs text-muted-foreground">
                        Showing {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.totalFilteredTrades)} of {pagination.totalFilteredTrades}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={pagination.page <= 1}
                          className="px-3 py-1 text-xs rounded border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                          data-testid="button-prev-page"
                        >
                          Previous
                        </button>
                        <span className="text-xs text-muted-foreground font-mono">
                          {pagination.page} / {pagination.totalPages}
                        </span>
                        <button
                          onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                          disabled={pagination.page >= pagination.totalPages}
                          className="px-3 py-1 text-xs rounded border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                          data-testid="button-next-page"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
