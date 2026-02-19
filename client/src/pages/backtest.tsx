import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "recharts";
import { BarChart3, Play, Download, Loader2 } from "lucide-react";
import type { Symbol, Backtest, BacktestDetail } from "@shared/schema";
import { SETUP_LABELS, SETUP_TYPES, type SetupType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function BacktestPage() {
  const { toast } = useToast();
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [selectedSetups, setSelectedSetups] = useState<string[]>([]);
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: symbolList } = useQuery<Symbol[]>({
    queryKey: ["/api/symbols"],
  });

  const { data: backtests, isLoading: backtestsLoading } = useQuery<Backtest[]>({
    queryKey: ["/api/backtests"],
  });

  const runBacktest = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/backtest/run", {
        tickers: selectedTickers.length ? selectedTickers : symbolList?.filter((s) => s.enabled).map((s) => s.ticker) ?? [],
        setups: selectedSetups,
        startDate,
        endDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtests"] });
      toast({ title: "Backtest complete", description: "Results are ready to view." });
    },
    onError: (error: Error) => {
      toast({ title: "Backtest failed", description: error.message, variant: "destructive" });
    },
  });

  const toggleSetup = (setup: string) => {
    setSelectedSetups((prev) =>
      prev.includes(setup) ? prev.filter((s) => s !== setup) : [...prev, setup]
    );
  };

  const toggleTicker = (ticker: string) => {
    setSelectedTickers((prev) =>
      prev.includes(ticker) ? prev.filter((t) => t !== ticker) : [...prev, ticker]
    );
  };

  const chartData = backtests?.map((bt) => ({
    name: `${bt.ticker} ${bt.setupType}`,
    hitRate: Math.round(bt.hitRate * 100),
    occurrences: bt.occurrences,
  })) ?? [];

  const exportCsv = () => {
    if (!backtests?.length) return;
    const headers = ["Ticker", "Setup", "Start", "End", "Occurrences", "Hits", "Hit Rate", "Avg Time (min)", "Avg MAE", "Avg MFE"];
    const rows = backtests.map((bt) =>
      [bt.ticker, bt.setupType, bt.startDate, bt.endDate, bt.occurrences, bt.hits, (bt.hitRate * 100).toFixed(1) + "%", bt.avgTimeToHitMin?.toFixed(0) ?? "", bt.avgMae?.toFixed(4) ?? "", bt.avgMfe?.toFixed(4) ?? ""].join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Backtest Engine</h1>
        <p className="text-sm text-muted-foreground">
          Validate setup performance using historical intraday data
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Date Range</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="text-sm"
                  data-testid="input-start-date"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="text-sm"
                  data-testid="input-end-date"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Tickers (empty = all enabled)</Label>
              <div className="flex flex-wrap gap-2">
                {symbolList?.filter((s) => s.enabled).map((sym) => (
                  <Badge
                    key={sym.ticker}
                    variant={selectedTickers.includes(sym.ticker) ? "default" : "outline"}
                    className="cursor-pointer toggle-elevate"
                    onClick={() => toggleTicker(sym.ticker)}
                    data-testid={`badge-ticker-${sym.ticker}`}
                  >
                    {sym.ticker}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Setups</Label>
            <div className="flex flex-wrap gap-2">
              {SETUP_TYPES.map((setup) => (
                <div key={setup} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`setup-${setup}`}
                    checked={selectedSetups.includes(setup)}
                    onCheckedChange={() => toggleSetup(setup)}
                    data-testid={`checkbox-setup-${setup}`}
                  />
                  <label htmlFor={`setup-${setup}`} className="text-xs cursor-pointer">
                    {setup}: {SETUP_LABELS[setup as SetupType]}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => runBacktest.mutate()}
              disabled={runBacktest.isPending}
              data-testid="button-run-backtest"
            >
              {runBacktest.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {runBacktest.isPending ? "Running..." : "Run Backtest"}
            </Button>
            {backtests && backtests.length > 0 && (
              <Button variant="outline" onClick={exportCsv} data-testid="button-export-csv">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hit Rate by Setup</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    domain={[0, 100]}
                    tickFormatter={(val: number) => `${val}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    formatter={(value: number) => [`${value}%`, "Hit Rate"]}
                  />
                  <Bar dataKey="hitRate" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          entry.hitRate >= 60
                            ? "hsl(var(--chart-3))"
                            : entry.hitRate >= 40
                            ? "hsl(var(--chart-4))"
                            : "hsl(var(--destructive))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {backtests && backtests.length > 0 && (() => {
        const buckets = [
          { label: "0-15m", min: 0, max: 15 },
          { label: "15-30m", min: 15, max: 30 },
          { label: "30-60m", min: 30, max: 60 },
          { label: "60-120m", min: 60, max: 120 },
          { label: "120-240m", min: 120, max: 240 },
          { label: "240-390m", min: 240, max: 390 },
          { label: "No Hit", min: -1, max: -1 },
        ];
        const counts = buckets.map(b => ({ label: b.label, count: 0 }));
        for (const bt of backtests) {
          const details = bt.details as BacktestDetail[] | null;
          if (!details) continue;
          for (const d of details) {
            if (!d.triggered) continue;
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
        const hasData = counts.some(c => c.count > 0);
        if (!hasData) return null;
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Time-to-Hit Distribution</CardTitle>
            </CardHeader>
            <CardContent className="p-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={counts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                      formatter={(value: number) => [value, "Count"]}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {counts.map((_, i) => (
                        <Cell key={i} fill={i < counts.length - 1 ? `hsl(var(--chart-${(i % 5) + 1}))` : "hsl(var(--muted-foreground))"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm">Results</CardTitle>
          {backtests && <Badge variant="outline">{backtests.length} runs</Badge>}
        </CardHeader>
        <CardContent className="p-0">
          {backtestsLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !backtests || backtests.length === 0 ? (
            <div className="p-8 text-center">
              <BarChart3 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No backtest results yet</p>
              <p className="text-xs text-muted-foreground mt-1">Configure and run a backtest above</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Setup</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Hits</TableHead>
                    <TableHead className="text-right">Hit Rate</TableHead>
                    <TableHead className="text-right">Avg Time</TableHead>
                    <TableHead className="text-right">Avg MAE</TableHead>
                    <TableHead className="text-right">Avg MFE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backtests.map((bt) => (
                    <TableRow key={bt.id} data-testid={`row-backtest-${bt.id}`}>
                      <TableCell className="font-medium">{bt.ticker}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{bt.setupType}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {bt.startDate} - {bt.endDate}
                      </TableCell>
                      <TableCell className="text-right font-mono">{bt.occurrences}</TableCell>
                      <TableCell className="text-right font-mono">{bt.hits}</TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        <span className={bt.hitRate >= 0.5 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                          {(bt.hitRate * 100).toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {bt.avgTimeToHitMin ? `${bt.avgTimeToHitMin.toFixed(0)}m` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {bt.avgMae ? `${(bt.avgMae * 100).toFixed(2)}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {bt.avgMfe ? `${(bt.avgMfe * 100).toFixed(2)}%` : "—"}
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
