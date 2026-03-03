import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Target,
  DollarSign,
  ArrowRightLeft,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { SETUP_LABELS, type SetupType } from "@shared/schema";

interface SplitTrade {
  signalId: number;
  ticker: string;
  setupType: string;
  direction: string;
  bias: string;
  instrumentType: string;
  date: string;
  entryPrice: number;
  halfwayPrice: number;
  t1Price: number;
  shares: number;
  halfShares: number;
  remainShares: number;
  invested: number;
  pnlDollar: number;
  pnlPct: number;
  outcome: string;
  halfwayHit: boolean;
  source: string;
}

interface Summary {
  totalTrades: number;
  wins: number;
  partials?: number;
  losses: number;
  totalPnl: number;
  totalInvested: number;
  capitalRequired: number;
  winRate: number;
  avgPnlPerTrade: number;
  roiOnCapital: number;
  edgePct: number;
  avgDailyTrades: number;
  tradingDays: number;
}

interface CurvePoint {
  trade: number;
  date: string;
  ticker: string;
  pnl: number;
  cumPnl: number;
}

interface ActivatedData {
  totalResolvedTrades: number;
  halfwayHitCount: number;
  halfwayHitRate: number;
  t1OnlySummary: Summary;
  splitSummary: Summary;
  deltaPnl: number;
  deltaPct: number;
  t1Curve: CurvePoint[];
  splitCurve: CurvePoint[];
}

interface PerformanceHalfData {
  capitalPerTrade: number;
  totalResolvedTrades: number;
  halfwayHitCount: number;
  halfwayHitRate: number;
  t1OnlySummary: Summary;
  splitSummary: Summary;
  deltaPnl: number;
  deltaPct: number;
  activated: ActivatedData;
  marketHours: ActivatedData;
  t1Curve: CurvePoint[];
  splitCurve: CurvePoint[];
  trades: SplitTrade[];
  pagination: {
    page: number;
    pageSize: number;
    totalFilteredTrades: number;
    totalPages: number;
  };
}

export default function PerformanceHalfPage() {
  const [capital, setCapital] = useState(1000);
  const [periodFilter, setPeriodFilter] = useState<number>(4);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const { toast } = useToast();

  const { data, isLoading } = useQuery<PerformanceHalfData>({
    queryKey: ["/api/performance-half/analysis", capital, periodFilter, page],
    queryFn: async () => {
      const res = await fetch(`/api/performance-half/analysis?capital=${capital}&period=${periodFilter}&page=${page}&pageSize=${pageSize}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/backtests/backfill-activation");
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({ title: "Backfill Complete", description: `Enriched ${result.enriched} backtests with activation data. Refresh to see updated results.` });
      queryClient.invalidateQueries({ queryKey: ["/api/performance-half/analysis"] });
    },
    onError: (err: any) => {
      toast({ title: "Backfill Failed", description: err.message, variant: "destructive" });
    },
  });

  const mergedCurve = useMemo(() => {
    if (!data) return [];
    const maxLen = Math.max(data.t1Curve.length, data.splitCurve.length);
    const merged: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      merged.push({
        trade: i + 1,
        t1Only: data.t1Curve[i]?.cumPnl ?? null,
        splitHalf: data.splitCurve[i]?.cumPnl ?? null,
      });
    }
    return merged;
  }, [data]);

  const activatedCurve = useMemo(() => {
    if (!data?.activated) return [];
    const act = data.activated;
    const maxLen = Math.max(act.t1Curve.length, act.splitCurve.length);
    const merged: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      merged.push({
        trade: i + 1,
        t1Only: act.t1Curve[i]?.cumPnl ?? null,
        splitHalf: act.splitCurve[i]?.cumPnl ?? null,
      });
    }
    return merged;
  }, [data]);

  const marketHoursCurve = useMemo(() => {
    if (!data?.marketHours) return [];
    const mkt = data.marketHours;
    const maxLen = Math.max(mkt.t1Curve.length, mkt.splitCurve.length);
    const merged: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      merged.push({
        trade: i + 1,
        t1Only: mkt.t1Curve[i]?.cumPnl ?? null,
        splitHalf: mkt.splitCurve[i]?.cumPnl ?? null,
      });
    }
    return merged;
  }, [data]);

  const t1 = data?.t1OnlySummary;
  const split = data?.splitSummary;
  const pagination = data?.pagination ?? { page: 1, pageSize, totalFilteredTrades: 0, totalPages: 1 };
  const trades = data?.trades ?? [];

  const winner = data && t1 && split
    ? (split.totalPnl > t1.totalPnl ? "SPLIT" : "T1_ONLY")
    : null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <ArrowRightLeft className="w-5 h-5" />
          Performance ½ Study
        </h1>
        <p className="text-sm text-muted-foreground">
          Comparing T1-Only (100% exit at target) vs Split ½ (50% at halfway, 50% at T1)
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Capital Per Trade</Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              value={capital}
              onChange={(e) => { setCapital(parseInt(e.target.value) || 1000); setPage(1); }}
              className="w-24 h-8 text-sm"
              data-testid="input-capital"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Select value={String(periodFilter)} onValueChange={(v) => { setPeriodFilter(parseInt(v)); setPage(1); }}>
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
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : !data || data.totalResolvedTrades === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Activity className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No resolved trades yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Signals need to hit or miss targets before the study can run
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className={`border-2 ${winner === "SPLIT" ? "border-blue-500/40" : "border-emerald-500/40"}`}>
            <CardContent className="pt-4 pb-4 px-5">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">T1-Only P&L</div>
                  <div className={`text-2xl font-bold font-mono ${t1!.totalPnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-t1-pnl">
                    {t1!.totalPnl >= 0 ? "+" : ""}${t1!.totalPnl.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{t1!.roiOnCapital}% ROI</div>
                </div>

                <div className="text-center text-muted-foreground">
                  <div className="text-xs mb-1">vs</div>
                  <div className={`text-lg font-bold font-mono ${data.deltaPnl >= 0 ? "text-blue-500" : "text-orange-500"}`} data-testid="text-delta">
                    {data.deltaPnl >= 0 ? "+" : ""}${data.deltaPnl.toLocaleString()}
                    <span className="text-xs ml-1">({data.deltaPct >= 0 ? "+" : ""}{data.deltaPct}%)</span>
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Split ½ P&L</div>
                  <div className={`text-2xl font-bold font-mono ${split!.totalPnl >= 0 ? "text-blue-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-split-pnl">
                    {split!.totalPnl >= 0 ? "+" : ""}${split!.totalPnl.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{split!.roiOnCapital}% ROI</div>
                </div>

                <div className="ml-auto text-right space-y-1">
                  <div className="text-xs text-muted-foreground">{data.totalResolvedTrades.toLocaleString()} trades analyzed</div>
                  <div className="text-xs text-muted-foreground">Halfway Hit Rate: <span className="font-mono font-medium text-foreground">{data.halfwayHitRate}%</span> ({data.halfwayHitCount.toLocaleString()} / {data.totalResolvedTrades.toLocaleString()})</div>
                  <Badge
                    variant="outline"
                    className={`text-xs ${winner === "SPLIT" ? "bg-blue-500/10 text-blue-600 border-blue-500/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}`}
                    data-testid="badge-winner"
                  >
                    {winner === "SPLIT" ? "Split ½ Wins" : "T1-Only Wins"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  T1-Only Model
                </CardTitle>
                <p className="text-xs text-muted-foreground">100% of shares exit at T1 target</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Win Rate</div>
                    <div className="text-lg font-bold font-mono" data-testid="text-t1-winrate">{t1!.winRate}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Avg P&L</div>
                    <div className={`text-lg font-bold font-mono ${t1!.avgPnlPerTrade >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {t1!.avgPnlPerTrade >= 0 ? "+" : ""}${t1!.avgPnlPerTrade.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Edge</div>
                    <div className={`text-lg font-bold font-mono ${t1!.edgePct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {t1!.edgePct >= 0 ? "+" : ""}{t1!.edgePct}%
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{t1!.wins}W / {t1!.losses}L</span>
                  <span>${t1!.capitalRequired.toLocaleString()} req</span>
                  <span>{t1!.avgDailyTrades} avg/day</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" />
                  Split ½ Model
                </CardTitle>
                <p className="text-xs text-muted-foreground">50% at halfway, remaining 50% at T1 or stop</p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Win Rate</div>
                    <div className="text-lg font-bold font-mono" data-testid="text-split-winrate">{split!.winRate}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Avg P&L</div>
                    <div className={`text-lg font-bold font-mono ${split!.avgPnlPerTrade >= 0 ? "text-blue-500" : "text-red-500"}`}>
                      {split!.avgPnlPerTrade >= 0 ? "+" : ""}${split!.avgPnlPerTrade.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Edge</div>
                    <div className={`text-lg font-bold font-mono ${split!.edgePct >= 0 ? "text-blue-500" : "text-red-500"}`}>
                      {split!.edgePct >= 0 ? "+" : ""}{split!.edgePct}%
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{split!.wins}W{(split!.partials ?? 0) > 0 ? ` / ${split!.partials}P` : ""} / {split!.losses}L</span>
                  <span>${split!.capitalRequired.toLocaleString()} req</span>
                  <span>{split!.avgDailyTrades} avg/day</span>
                  <span>{data.halfwayHitRate}% halfway hit</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Equity Curve Comparison</CardTitle>
              <p className="text-xs text-muted-foreground">
                Cumulative P&L: <span className="text-emerald-500">T1-Only (green)</span> vs <span className="text-blue-500">Split ½ (blue)</span>
              </p>
            </CardHeader>
            <CardContent className="p-2">
              {mergedCurve.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">No trade data</div>
              ) : (
                <div className="h-64" data-testid="chart-equity-curve">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={mergedCurve}>
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
                        formatter={(value: number, name: string) => [
                          `$${value?.toFixed(2) ?? "—"}`,
                          name === "t1Only" ? "T1-Only" : "Split ½",
                        ]}
                        labelFormatter={(label: number) => `Trade #${label}`}
                      />
                      <Legend formatter={(value: string) => value === "t1Only" ? "T1-Only" : "Split ½"} />
                      <Line type="monotone" dataKey="t1Only" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} connectNulls />
                      <Line type="monotone" dataKey="splitHalf" stroke="hsl(220 90% 56%)" strokeWidth={2} dot={false} strokeDasharray="6 3" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {data.activated && (() => {
            const act = data.activated;
            const actT1 = act.t1OnlySummary;
            const actSp = act.splitSummary;
            const actWinner = actSp.totalPnl > actT1.totalPnl ? "SPLIT" : "T1_ONLY";
            return (
              <>
                <div className="flex items-center gap-3 pt-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Activated Only — Market Hours Trades</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {act.totalResolvedTrades === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground" data-testid="text-activated-empty">No activated trades found</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Existing backtests may not have activation data yet. Run the backfill to enrich them with entry trigger simulation.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => backfillMutation.mutate()}
                        disabled={backfillMutation.isPending}
                        data-testid="button-backfill-activation"
                      >
                        {backfillMutation.isPending ? (
                          <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Backfilling...</>
                        ) : (
                          <><RefreshCw className="w-3 h-3 mr-1" /> Backfill Activation Data</>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                <>

                <Card className={`border-2 ${actWinner === "SPLIT" ? "border-purple-500/40" : "border-emerald-500/40"}`}>
                  <CardContent className="pt-4 pb-4 px-5">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground mb-1">T1-Only P&L</div>
                        <div className={`text-2xl font-bold font-mono ${actT1.totalPnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-act-t1-pnl">
                          {actT1.totalPnl >= 0 ? "+" : ""}${actT1.totalPnl.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{actT1.roiOnCapital}% ROI</div>
                      </div>

                      <div className="text-center text-muted-foreground">
                        <div className="text-xs mb-1">vs</div>
                        <div className={`text-lg font-bold font-mono ${act.deltaPnl >= 0 ? "text-purple-500" : "text-orange-500"}`} data-testid="text-act-delta">
                          {act.deltaPnl >= 0 ? "+" : ""}${act.deltaPnl.toLocaleString()}
                          <span className="text-xs ml-1">({act.deltaPct >= 0 ? "+" : ""}{act.deltaPct}%)</span>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="text-xs text-muted-foreground mb-1">Split ½ P&L</div>
                        <div className={`text-2xl font-bold font-mono ${actSp.totalPnl >= 0 ? "text-purple-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-act-split-pnl">
                          {actSp.totalPnl >= 0 ? "+" : ""}${actSp.totalPnl.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{actSp.roiOnCapital}% ROI</div>
                      </div>

                      <div className="ml-auto text-right space-y-1">
                        <div className="text-xs text-muted-foreground">{act.totalResolvedTrades.toLocaleString()} activated trades</div>
                        <div className="text-xs text-muted-foreground">Halfway Hit Rate: <span className="font-mono font-medium text-foreground">{act.halfwayHitRate}%</span></div>
                        <Badge
                          variant="outline"
                          className={`text-xs ${actWinner === "SPLIT" ? "bg-purple-500/10 text-purple-600 border-purple-500/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}`}
                          data-testid="badge-act-winner"
                        >
                          {actWinner === "SPLIT" ? "Split ½ Wins" : "T1-Only Wins"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        T1-Only (Activated)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Win Rate</div>
                          <div className="text-lg font-bold font-mono">{actT1.winRate}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Avg P&L</div>
                          <div className={`text-lg font-bold font-mono ${actT1.avgPnlPerTrade >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {actT1.avgPnlPerTrade >= 0 ? "+" : ""}${actT1.avgPnlPerTrade.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Edge</div>
                          <div className={`text-lg font-bold font-mono ${actT1.edgePct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {actT1.edgePct >= 0 ? "+" : ""}{actT1.edgePct}%
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{actT1.wins}W / {actT1.losses}L</span>
                        <span>${actT1.capitalRequired.toLocaleString()} req</span>
                        <span>{actT1.avgDailyTrades} avg/day</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ArrowRightLeft className="w-4 h-4" />
                        Split ½ (Activated)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Win Rate</div>
                          <div className="text-lg font-bold font-mono">{actSp.winRate}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Avg P&L</div>
                          <div className={`text-lg font-bold font-mono ${actSp.avgPnlPerTrade >= 0 ? "text-purple-500" : "text-red-500"}`}>
                            {actSp.avgPnlPerTrade >= 0 ? "+" : ""}${actSp.avgPnlPerTrade.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Edge</div>
                          <div className={`text-lg font-bold font-mono ${actSp.edgePct >= 0 ? "text-purple-500" : "text-red-500"}`}>
                            {actSp.edgePct >= 0 ? "+" : ""}{actSp.edgePct}%
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{actSp.wins}W{(actSp.partials ?? 0) > 0 ? ` / ${actSp.partials}P` : ""} / {actSp.losses}L</span>
                        <span>${actSp.capitalRequired.toLocaleString()} req</span>
                        <span>{actSp.avgDailyTrades} avg/day</span>
                        <span>{act.halfwayHitRate}% halfway hit</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Activated Equity Curve</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Only trades activated during RTH: <span className="text-emerald-500">T1-Only</span> vs <span className="text-purple-500">Split ½</span>
                    </p>
                  </CardHeader>
                  <CardContent className="p-2">
                    {activatedCurve.length === 0 ? (
                      <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">No activated trades</div>
                    ) : (
                      <div className="h-64" data-testid="chart-activated-equity">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={activatedCurve}>
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
                              formatter={(value: number, name: string) => [
                                `$${value?.toFixed(2) ?? "—"}`,
                                name === "t1Only" ? "T1-Only" : "Split ½",
                              ]}
                              labelFormatter={(label: number) => `Trade #${label}`}
                            />
                            <Legend formatter={(value: string) => value === "t1Only" ? "T1-Only" : "Split ½"} />
                            <Line type="monotone" dataKey="t1Only" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} connectNulls />
                            <Line type="monotone" dataKey="splitHalf" stroke="hsl(270 70% 56%)" strokeWidth={2} dot={false} strokeDasharray="6 3" connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
                </>
                )}
              </>
            );
          })()}

          {data.marketHours && (() => {
            const mkt = data.marketHours;
            const mktT1 = mkt.t1OnlySummary;
            const mktSp = mkt.splitSummary;
            const mktWinner = mktSp.totalPnl > mktT1.totalPnl ? "SPLIT" : "T1_ONLY";
            return (
              <>
                <div className="flex items-center gap-3 pt-2">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Market Hours Only — 9:30 AM – 4:00 PM ET</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {mkt.totalResolvedTrades === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground" data-testid="text-mkt-empty">No market hours trades found</p>
                    </CardContent>
                  </Card>
                ) : (
                <>

                <Card className={`border-2 ${mktWinner === "SPLIT" ? "border-purple-500/40" : "border-emerald-500/40"}`}>
                  <CardContent className="pt-4 pb-4 px-5">
                    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                      <div className="text-center">
                        <div className="text-xs text-muted-foreground mb-1">T1-Only P&L</div>
                        <div className={`text-2xl font-bold font-mono ${mktT1.totalPnl >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-mkt-t1-pnl">
                          {mktT1.totalPnl >= 0 ? "+" : ""}${mktT1.totalPnl.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{mktT1.roiOnCapital}% ROI</div>
                      </div>

                      <div className="text-center text-muted-foreground">
                        <div className="text-xs mb-1">vs</div>
                        <div className={`text-lg font-bold font-mono ${mkt.deltaPnl >= 0 ? "text-purple-500" : "text-orange-500"}`} data-testid="text-mkt-delta">
                          {mkt.deltaPnl >= 0 ? "+" : ""}${mkt.deltaPnl.toLocaleString()}
                          <span className="text-xs ml-1">({mkt.deltaPct >= 0 ? "+" : ""}{mkt.deltaPct}%)</span>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="text-xs text-muted-foreground mb-1">Split ½ P&L</div>
                        <div className={`text-2xl font-bold font-mono ${mktSp.totalPnl >= 0 ? "text-purple-500" : "text-red-500 dark:text-red-400"}`} data-testid="text-mkt-split-pnl">
                          {mktSp.totalPnl >= 0 ? "+" : ""}${mktSp.totalPnl.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{mktSp.roiOnCapital}% ROI</div>
                      </div>

                      <div className="ml-auto text-right space-y-1">
                        <div className="text-xs text-muted-foreground">{mkt.totalResolvedTrades.toLocaleString()} RTH trades</div>
                        <div className="text-xs text-muted-foreground">Halfway Hit Rate: <span className="font-mono font-medium text-foreground">{mkt.halfwayHitRate}%</span></div>
                        <Badge
                          variant="outline"
                          className={`text-xs ${mktWinner === "SPLIT" ? "bg-purple-500/10 text-purple-600 border-purple-500/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}`}
                          data-testid="badge-mkt-winner"
                        >
                          {mktWinner === "SPLIT" ? "Split ½ Wins" : "T1-Only Wins"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        T1-Only (Market Hours)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Win Rate</div>
                          <div className="text-lg font-bold font-mono" data-testid="text-mkt-t1-wr">{mktT1.winRate}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Avg P&L</div>
                          <div className={`text-lg font-bold font-mono ${mktT1.avgPnlPerTrade >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {mktT1.avgPnlPerTrade >= 0 ? "+" : ""}${mktT1.avgPnlPerTrade.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Edge</div>
                          <div className={`text-lg font-bold font-mono ${mktT1.edgePct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {mktT1.edgePct >= 0 ? "+" : ""}{mktT1.edgePct}%
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{mktT1.wins}W / {mktT1.losses}L</span>
                        <span>${mktT1.capitalRequired.toLocaleString()} req</span>
                        <span>{mktT1.avgDailyTrades} avg/day</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ArrowRightLeft className="w-4 h-4" />
                        Split ½ (Market Hours)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Win Rate</div>
                          <div className="text-lg font-bold font-mono" data-testid="text-mkt-split-wr">{mktSp.winRate}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Avg P&L</div>
                          <div className={`text-lg font-bold font-mono ${mktSp.avgPnlPerTrade >= 0 ? "text-purple-500" : "text-red-500"}`}>
                            {mktSp.avgPnlPerTrade >= 0 ? "+" : ""}${mktSp.avgPnlPerTrade.toFixed(2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Edge</div>
                          <div className={`text-lg font-bold font-mono ${mktSp.edgePct >= 0 ? "text-purple-500" : "text-red-500"}`}>
                            {mktSp.edgePct >= 0 ? "+" : ""}{mktSp.edgePct}%
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{mktSp.wins}W{(mktSp.partials ?? 0) > 0 ? ` / ${mktSp.partials}P` : ""} / {mktSp.losses}L</span>
                        <span>${mktSp.capitalRequired.toLocaleString()} req</span>
                        <span>{mktSp.avgDailyTrades} avg/day</span>
                        <span>{mkt.halfwayHitRate}% halfway hit</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Market Hours Equity Curve</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      RTH trades only (9:30–16:00 ET): <span className="text-emerald-500">T1-Only</span> vs <span className="text-purple-500">Split ½</span>
                    </p>
                  </CardHeader>
                  <CardContent className="p-2">
                    {marketHoursCurve.length === 0 ? (
                      <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">No market hours trades</div>
                    ) : (
                      <div className="h-64" data-testid="chart-mkt-equity">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={marketHoursCurve}>
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
                              formatter={(value: number, name: string) => [
                                `$${value?.toFixed(2) ?? "—"}`,
                                name === "t1Only" ? "T1-Only" : "Split ½",
                              ]}
                              labelFormatter={(label: number) => `Trade #${label}`}
                            />
                            <Legend formatter={(value: string) => value === "t1Only" ? "T1-Only" : "Split ½"} />
                            <Line type="monotone" dataKey="t1Only" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} connectNulls />
                            <Line type="monotone" dataKey="splitHalf" stroke="hsl(270 70% 56%)" strokeWidth={2} dot={false} strokeDasharray="6 3" connectNulls />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
                </>
                )}
              </>
            );
          })()}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Split ½ Trade Details</CardTitle>
                  <div className="text-xs text-muted-foreground">{pagination.totalFilteredTrades} trades — showing entry, halfway, T1, and outcome</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {trades.length === 0 ? (
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
                          <TableHead className="text-right">Halfway</TableHead>
                          <TableHead className="text-right">T1</TableHead>
                          <TableHead className="text-right">Shares</TableHead>
                          <TableHead className="text-right">½ Hit</TableHead>
                          <TableHead className="text-right">P&L</TableHead>
                          <TableHead className="text-right">P&L %</TableHead>
                          <TableHead>Result</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {trades.map(t => (
                          <TableRow key={t.signalId} data-testid={`row-trade-${t.signalId}`}>
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
                            <TableCell className="text-right font-mono text-sm text-amber-500">${t.halfwayPrice.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm text-blue-500">${t.t1Price.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {t.halfShares}+{t.remainShares}
                            </TableCell>
                            <TableCell className="text-right">
                              {t.halfwayHit ? (
                                <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 border-amber-500/20">YES</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[9px] bg-muted text-muted-foreground">NO</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              <span className={t.pnlDollar >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                {t.pnlDollar >= 0 ? "+" : ""}${t.pnlDollar.toFixed(2)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              <span className={t.pnlPct >= 0 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  t.outcome === "HIT_T1"
                                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                    : t.outcome === "PARTIAL"
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                    : "bg-red-500/10 text-red-600 border-red-500/20"
                                }`}
                              >
                                {t.outcome === "HIT_T1" ? "WIN" : t.outcome === "PARTIAL" ? "PARTIAL" : "LOSS"}
                              </Badge>
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

          <Card>
            <CardContent className="pt-4 pb-4 px-5">
              <h3 className="text-sm font-medium mb-2">Study Methodology</h3>
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>T1-Only:</strong> 100% of shares exit at T1 (magnet price). If stopped, full position exits at stop.</p>
                <p><strong>Split ½:</strong> 50% of shares exit at the halfway point between entry and T1. Once halfway is hit, stop moves to break-even on remaining shares. Remaining 50% rides to T1 (if hit) or exits at break-even (if miss). If halfway is never reached, full position takes the stop loss.</p>
                <p><strong>Halfway price:</strong> Entry + (T1 - Entry) / 2 for longs, Entry - (Entry - T1) / 2 for shorts.</p>
                <p><strong>PARTIAL outcome:</strong> Halfway TP hit (50% profit booked), stop raised to break-even. T1 missed, so remaining 50% exits at break-even ($0 P&L on that leg).</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
