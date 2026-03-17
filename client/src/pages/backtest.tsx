import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Play,
  Pause,
  Square,
  Download,
  Loader2,
  Crosshair,
  FlaskConical,
  Search,
  X,
  BarChart3,
  Clock,
  Target,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import type { Symbol, Backtest, BacktestDetail, BacktestJob } from "@shared/schema";
import { SETUP_LABELS, SETUP_TYPES, type SetupType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface SetupStats {
  setupType: string;
  ticker: string | null;
  sampleSize: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  medianR: number;
  expectancyR: number;
  profitFactor: number;
  avgMaeR: number;
  medianMaeR: number;
  tradeability: string;
  category: string;
}

interface BacktestJobStatus {
  workerRunning: boolean;
  workerPaused: boolean;
  activeJob: BacktestJob | null;
  latestJob: BacktestJob | null;
  totalJobs: number;
}

const DURATION_PRESETS = [
  { label: "3 Months", months: 3 },
  { label: "6 Months", months: 6 },
  { label: "1 Year", months: 12 },
  { label: "2 Years", months: 24 },
  { label: "Custom", months: 0 },
];

function getDateFromMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export default function BacktestPage() {
  const { toast } = useToast();
  const [tickerSearch, setTickerSearch] = useState("");
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [selectedSetups, setSelectedSetups] = useState<string[]>(["A", "B", "C", "D", "E", "F"]);
  const [durationPreset, setDurationPreset] = useState("12");
  const [startDate, setStartDate] = useState(getDateFromMonthsAgo(12));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab] = useState("run");

  const { data: symbolList } = useQuery<Symbol[]>({ queryKey: ["/api/symbols"] });

  const { data: backtests, isLoading: backtestsLoading } = useQuery<Backtest[]>({
    queryKey: ["/api/backtests"],
  });

  const { data: setupStats } = useQuery<SetupStats[]>({ queryKey: ["/api/setup-stats"] });

  const { data: jobStatus } = useQuery<BacktestJobStatus>({
    queryKey: ["/api/backtest/jobs/status"],
    refetchInterval: 3000,
  });

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/backtest/jobs/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/jobs/status"] });
      toast({ title: "Worker started" });
    },
  });
  const pauseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/backtest/jobs/pause"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/backtest/jobs/status"] }),
  });
  const resumeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/backtest/jobs/resume"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/backtest/jobs/status"] }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/backtest/jobs/cancel"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/backtest/jobs/status"] });
      toast({ title: "Worker cancelled" });
    },
  });

  const enabledSymbols = useMemo(
    () => (symbolList ?? []).filter((s) => s.enabled),
    [symbolList]
  );

  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestLogs, setBacktestLogs] = useState<{ message: string; type: string; ts: number }[]>([]);
  const [backtestProgress, setBacktestProgress] = useState<{ completed: number; total: number; ticker: string; setup: string } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [backtestLogs]);

  const runBacktestStream = useCallback(() => {
    const tickers = selectedTickers.length ? selectedTickers : enabledSymbols.map((s) => s.ticker);
    setBacktestRunning(true);
    setBacktestLogs([]);
    setBacktestProgress(null);

    fetch("/api/backtest/run-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, setups: selectedSetups, startDate, endDate }),
    }).then((response) => {
      if (!response.ok || !response.body) {
        setBacktestRunning(false);
        toast({ title: "Backtest failed", description: "Failed to start stream", variant: "destructive" });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hadFatalError = false;
      let receivedDone = false;

      const processChunk = ({ done, value }: ReadableStreamReadResult<Uint8Array>): Promise<void> | void => {
        if (done) {
          setBacktestRunning(false);
          if (receivedDone && !hadFatalError) {
            queryClient.invalidateQueries({ queryKey: ["/api/backtests"] });
            queryClient.invalidateQueries({ queryKey: ["/api/setup-stats"] });
            toast({ title: "Backtest complete", description: "Results are ready to view." });
          } else if (hadFatalError) {
            toast({ title: "Backtest failed", description: "See log for details", variant: "destructive" });
          }
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "log") {
                setBacktestLogs((prev) => [...prev, { ...data, ts: Date.now() }]);
              } else if (eventType === "progress") {
                setBacktestProgress(data);
              } else if (eventType === "done") {
                receivedDone = true;
                setBacktestLogs((prev) => [...prev, { message: `Backtest complete: ${data.completed} combos processed`, type: "done", ts: Date.now() }]);
              } else if (eventType === "error") {
                hadFatalError = true;
                setBacktestLogs((prev) => [...prev, { message: `Fatal error: ${data.message}`, type: "error", ts: Date.now() }]);
              }
            } catch {}
            eventType = "";
          }
        }

        return reader.read().then(processChunk);
      };

      reader.read().then(processChunk);
    }).catch((err) => {
      setBacktestRunning(false);
      toast({ title: "Backtest failed", description: err.message, variant: "destructive" });
    });
  }, [selectedTickers, enabledSymbols, selectedSetups, startDate, endDate, toast]);

  const filteredSymbols = useMemo(() => {
    if (!tickerSearch.trim()) return enabledSymbols.slice(0, 50);
    const q = tickerSearch.toUpperCase();
    return enabledSymbols.filter((s) => s.ticker.includes(q));
  }, [enabledSymbols, tickerSearch]);

  const handleDurationChange = (val: string) => {
    setDurationPreset(val);
    if (val !== "0") {
      setStartDate(getDateFromMonthsAgo(parseInt(val)));
      setEndDate(new Date().toISOString().slice(0, 10));
    }
  };

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

  const selectAllTickers = () => setSelectedTickers([]);
  const clearTickers = () => setSelectedTickers([]);

  const workerJob = jobStatus?.activeJob || jobStatus?.latestJob;
  const workerPct = workerJob && workerJob.totalCombos > 0
    ? Math.round((workerJob.completedCombos / workerJob.totalCombos) * 100) : 0;

  const totalOccurrences = backtests?.reduce((s, bt) => s + bt.occurrences, 0) ?? 0;
  const totalHits = backtests?.reduce((s, bt) => s + bt.hits, 0) ?? 0;
  const overallHitRate = totalOccurrences > 0 ? totalHits / totalOccurrences : 0;
  const uniqueTickers = new Set(backtests?.map(bt => bt.ticker) ?? []).size;
  const uniqueSetups = new Set(backtests?.map(bt => bt.setupType) ?? []).size;

  const chartData = useMemo(() => {
    if (!backtests?.length) return [];
    const bySetup = new Map<string, { total: number; hits: number }>();
    for (const bt of backtests) {
      const cur = bySetup.get(bt.setupType) ?? { total: 0, hits: 0 };
      cur.total += bt.occurrences;
      cur.hits += bt.hits;
      bySetup.set(bt.setupType, cur);
    }
    return Array.from(bySetup.entries())
      .map(([setup, d]) => ({
        name: `${setup}: ${SETUP_LABELS[setup as SetupType] ?? setup}`,
        hitRate: d.total > 0 ? Math.round((d.hits / d.total) * 100) : 0,
        count: d.total,
      }))
      .sort((a, b) => b.hitRate - a.hitRate);
  }, [backtests]);

  const tthData = useMemo(() => {
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
    return counts.some(c => c.count > 0) ? counts : [];
  }, [backtests]);

  const exportCsv = () => {
    if (!backtests?.length) return;
    const headers = ["Ticker", "Setup", "Start", "End", "Occurrences", "Hits", "Hit Rate", "Avg Time (min)", "Avg MAE", "Avg MFE"];
    const rows = backtests.map((bt) =>
      [bt.ticker, bt.setupType, bt.startDate, bt.endDate, bt.occurrences, bt.hits,
       (bt.hitRate * 100).toFixed(1) + "%", bt.avgTimeToHitMin?.toFixed(0) ?? "",
       bt.avgMae?.toFixed(4) ?? "", bt.avgMfe?.toFixed(4) ?? ""].join(",")
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
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2" data-testid="text-page-title">
          <FlaskConical className="w-5 h-5" />
          Backtest Engine
        </h1>
        <p className="text-sm text-muted-foreground">
          Run backtests, manage the background worker, and analyze historical setup performance
        </p>
      </div>

      <Card data-testid="backtest-worker-card">
        <CardContent className="pt-4 pb-3 px-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Background Worker</span>
              {jobStatus?.workerRunning && !jobStatus.workerPaused && (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />Running
                </Badge>
              )}
              {jobStatus?.workerPaused && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]">Paused</Badge>
              )}
              {!jobStatus?.workerRunning && !jobStatus?.activeJob && jobStatus?.latestJob?.status === "completed" && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px]">Completed</Badge>
              )}
              {!jobStatus?.workerRunning && !jobStatus?.activeJob && !jobStatus?.latestJob && (
                <Badge variant="outline" className="text-[10px]">Not Started</Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!jobStatus?.workerRunning && (
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  data-testid="btn-start-worker"
                >
                  <Play className="w-3 h-3 mr-1" />
                  {jobStatus?.activeJob ? "Resume" : "Start All"}
                </Button>
              )}
              {jobStatus?.workerRunning && !jobStatus.workerPaused && (
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => pauseMutation.mutate()}
                  disabled={pauseMutation.isPending}
                  data-testid="btn-pause-worker"
                >
                  <Pause className="w-3 h-3 mr-1" />Pause
                </Button>
              )}
              {jobStatus?.workerPaused && (
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  data-testid="btn-resume-worker"
                >
                  <Play className="w-3 h-3 mr-1" />Resume
                </Button>
              )}
              {(jobStatus?.workerRunning || jobStatus?.activeJob) && (
                <Button
                  size="sm" variant="outline" className="h-7 text-xs text-red-500"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  data-testid="btn-cancel-worker"
                >
                  <Square className="w-3 h-3 mr-1" />Cancel
                </Button>
              )}
            </div>
          </div>
          {!workerJob ? (
            <p className="text-xs text-muted-foreground">
              Run backtests across all universe tickers × 6 setups. Progress checkpoints save automatically.
            </p>
          ) : (
            <div className="space-y-2">
              <Progress value={workerPct} className="h-2" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{workerJob.completedCombos} / {workerJob.totalCombos} combos ({workerPct}%)</span>
                {workerJob.failedCombos > 0 && (
                  <span className="text-red-500">{workerJob.failedCombos} failed</span>
                )}
                {workerJob.currentTicker && workerJob.currentSetup && jobStatus?.workerRunning && (
                  <span className="font-mono">{workerJob.currentTicker} · {SETUP_LABELS[workerJob.currentSetup as SetupType] || workerJob.currentSetup}</span>
                )}
              </div>
              {workerJob.lastError && (
                <p className="text-[10px] text-red-500/80 truncate">Last error: {workerJob.lastError}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3 px-4 text-center">
            <div className="text-2xl font-bold" data-testid="text-total-occurrences">{totalOccurrences.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Total Trades Tested</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 px-4 text-center">
            <div className="text-2xl font-bold text-emerald-500" data-testid="text-overall-hitrate">
              {(overallHitRate * 100).toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Overall Hit Rate</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 px-4 text-center">
            <div className="text-2xl font-bold" data-testid="text-unique-tickers">{uniqueTickers}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Tickers Tested</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 px-4 text-center">
            <div className="text-2xl font-bold" data-testid="text-unique-setups">{uniqueSetups}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Setup Types</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="run" data-testid="tab-run">Run Backtest</TabsTrigger>
          <TabsTrigger value="results" data-testid="tab-results">
            Results {backtests?.length ? `(${backtests.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="rankings" data-testid="tab-rankings">Setup Rankings</TabsTrigger>
          <TabsTrigger value="charts" data-testid="tab-charts">Charts</TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Backtest Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Duration</Label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_PRESETS.map((p) => (
                    <Button
                      key={p.months}
                      size="sm"
                      variant={durationPreset === String(p.months) ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => handleDurationChange(String(p.months))}
                      data-testid={`btn-duration-${p.months}`}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                {durationPreset === "0" && (
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="text-sm w-40"
                      data-testid="input-start-date"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="text-sm w-40"
                      data-testid="input-end-date"
                    />
                  </div>
                )}
                {durationPreset !== "0" && (
                  <p className="text-[10px] text-muted-foreground">
                    {startDate} → {endDate}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Setups</Label>
                <div className="flex flex-wrap gap-3">
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

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">
                    Tickers {selectedTickers.length === 0
                      ? `(All ${enabledSymbols.length} universe tickers)`
                      : `(${selectedTickers.length} selected)`}
                  </Label>
                  <div className="flex gap-1">
                    {selectedTickers.length > 0 && (
                      <Button
                        size="sm" variant="ghost" className="h-6 text-[10px] px-2"
                        onClick={selectAllTickers}
                        data-testid="btn-select-all-tickers"
                      >
                        Use All
                      </Button>
                    )}
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search tickers..."
                    value={tickerSearch}
                    onChange={(e) => setTickerSearch(e.target.value)}
                    className="pl-8 text-sm h-9"
                    data-testid="input-ticker-search"
                  />
                  {tickerSearch && (
                    <Button
                      variant="ghost" size="sm"
                      className="absolute right-1 top-1 h-7 w-7 p-0"
                      onClick={() => setTickerSearch("")}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                {selectedTickers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selectedTickers.map((t) => (
                      <Badge
                        key={t}
                        variant="default"
                        className="cursor-pointer text-[10px] gap-1"
                        onClick={() => toggleTicker(t)}
                        data-testid={`badge-selected-${t}`}
                      >
                        {t}
                        <X className="w-2.5 h-2.5" />
                      </Badge>
                    ))}
                    <Button
                      size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-red-500"
                      onClick={clearTickers}
                    >
                      Clear All
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto border rounded-md p-2 bg-muted/20">
                  {filteredSymbols.map((sym) => (
                    <Badge
                      key={sym.ticker}
                      variant={selectedTickers.includes(sym.ticker) ? "default" : "outline"}
                      className="cursor-pointer text-[10px] hover:bg-primary/10"
                      onClick={() => toggleTicker(sym.ticker)}
                      data-testid={`badge-ticker-${sym.ticker}`}
                    >
                      {sym.ticker}
                    </Badge>
                  ))}
                  {filteredSymbols.length === 0 && (
                    <span className="text-xs text-muted-foreground">No matching tickers</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={runBacktestStream}
                  disabled={backtestRunning || selectedSetups.length === 0}
                  data-testid="button-run-backtest"
                >
                  {backtestRunning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {backtestRunning
                    ? "Running..."
                    : `Run Backtest (${selectedTickers.length || enabledSymbols.length} tickers × ${selectedSetups.length} setups)`}
                </Button>
                {backtests && backtests.length > 0 && (
                  <Button variant="outline" onClick={exportCsv} data-testid="button-export-csv">
                    <Download className="w-4 h-4 mr-2" />
                    Export CSV
                  </Button>
                )}
              </div>

              {(backtestLogs.length > 0 || backtestRunning) && (
                <div className="mt-4 space-y-2">
                  {backtestProgress && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Processing: {backtestProgress.ticker} setup {backtestProgress.setup}</span>
                        <span>{backtestProgress.completed}/{backtestProgress.total} combos</span>
                      </div>
                      <Progress value={(backtestProgress.completed / backtestProgress.total) * 100} className="h-2" />
                    </div>
                  )}
                  <div
                    className="bg-zinc-950 rounded-md border border-zinc-800 p-3 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed"
                    data-testid="backtest-log-panel"
                  >
                    {backtestLogs.map((entry, i) => (
                      <div
                        key={i}
                        className={
                          entry.type === "error" ? "text-red-400" :
                          entry.type === "success" ? "text-emerald-400" :
                          entry.type === "done" ? "text-blue-400 font-semibold" :
                          entry.type === "processing" ? "text-yellow-300" :
                          "text-zinc-400"
                        }
                      >
                        <span className="text-zinc-600 mr-2">{new Date(entry.ts).toLocaleTimeString()}</span>
                        {entry.message}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="results" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-sm">Backtest Results</CardTitle>
              <div className="flex items-center gap-2">
                {backtests && <Badge variant="outline">{backtests.length} runs</Badge>}
                {backtests && backtests.length > 0 && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={exportCsv}>
                    <Download className="w-3 h-3 mr-1" />CSV
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {backtestsLoading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : !backtests || backtests.length === 0 ? (
                <div className="p-8 text-center">
                  <BarChart3 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No backtest results yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Configure and run a backtest from the Run tab</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ticker</TableHead>
                        <TableHead>Setup</TableHead>
                        <TableHead>Range</TableHead>
                        <TableHead className="text-right">Trades</TableHead>
                        <TableHead className="text-right">Hits</TableHead>
                        <TableHead className="text-right">Hit Rate</TableHead>
                        <TableHead className="text-right">Avg Time</TableHead>
                        <TableHead className="text-right">Med Time</TableHead>
                        <TableHead className="text-right">Avg MAE</TableHead>
                        <TableHead className="text-right">Avg MFE</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {backtests
                        .sort((a, b) => b.hitRate - a.hitRate)
                        .map((bt) => (
                        <TableRow key={bt.id} data-testid={`row-backtest-${bt.id}`}>
                          <TableCell className="font-medium font-mono text-sm">{bt.ticker}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">
                              {bt.setupType}: {SETUP_LABELS[bt.setupType as SetupType] ?? bt.setupType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {bt.startDate} → {bt.endDate}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{bt.occurrences}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{bt.hits}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            <span className={bt.hitRate >= 0.5 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                              {(bt.hitRate * 100).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {bt.avgTimeToHitMin ? `${bt.avgTimeToHitMin.toFixed(0)}m` : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {bt.medianTimeToHitMin ? `${bt.medianTimeToHitMin.toFixed(0)}m` : "—"}
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
        </TabsContent>

        <TabsContent value="rankings" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div className="flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-muted-foreground" />
                <CardTitle className="text-sm">Setup Rankings (Expectancy)</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!setupStats ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : setupStats.filter(s => !s.ticker).length === 0 ? (
                <div className="p-8 text-center">
                  <Crosshair className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No expectancy data yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Run a backtest to compute setup expectancy stats</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Setup</TableHead>
                        <TableHead className="text-right">Sample</TableHead>
                        <TableHead className="text-right">Win Rate</TableHead>
                        <TableHead className="text-right">Expectancy (R)</TableHead>
                        <TableHead className="text-right">Avg Win (R)</TableHead>
                        <TableHead className="text-right">Avg Loss (R)</TableHead>
                        <TableHead className="text-right">Profit Factor</TableHead>
                        <TableHead className="text-right">Med MAE (R)</TableHead>
                        <TableHead>Tradeability</TableHead>
                        <TableHead>Category</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {setupStats
                        .filter(s => !s.ticker)
                        .sort((a, b) => b.expectancyR - a.expectancyR)
                        .map((s) => (
                          <TableRow key={s.setupType} data-testid={`row-setup-rank-${s.setupType}`}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="outline" className="text-xs">{s.setupType}</Badge>
                                <span className="text-xs text-muted-foreground">{SETUP_LABELS[s.setupType as SetupType] ?? s.setupType}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">{s.sampleSize.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono">
                              <span className={s.winRate >= 0.5 ? "text-emerald-500" : "text-red-500 dark:text-red-400"}>
                                {(s.winRate * 100).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono font-medium">
                              <span className={s.expectancyR >= 0.15 ? "text-emerald-500" : s.expectancyR >= 0 ? "text-amber-500" : "text-red-500 dark:text-red-400"}>
                                {s.expectancyR >= 0 ? "+" : ""}{s.expectancyR.toFixed(3)}R
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm">{s.avgWinR.toFixed(2)}R</TableCell>
                            <TableCell className="text-right font-mono text-sm">{s.avgLossR.toFixed(2)}R</TableCell>
                            <TableCell className="text-right font-mono text-sm">{s.profitFactor.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-mono text-sm">{s.medianMaeR.toFixed(2)}R</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  s.tradeability === "CLEAN"
                                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                    : s.tradeability === "CAUTION"
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                    : "bg-red-500/10 text-red-600 border-red-500/20"
                                }`}
                              >
                                {s.tradeability}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  s.category === "PRIMARY"
                                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                    : s.category === "SECONDARY"
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                    : "bg-red-500/10 text-red-600 border-red-500/20"
                                }`}
                              >
                                {s.category}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charts" className="space-y-4 mt-4">
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-muted-foreground" />
                  Hit Rate by Setup (Aggregate)
                </CardTitle>
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
                        angle={-15}
                        textAnchor="end"
                        height={50}
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
                        formatter={(value: number, name: string) => {
                          if (name === "hitRate") return [`${value}%`, "Hit Rate"];
                          return [value, name];
                        }}
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

          {tthData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  Time-to-Hit Distribution
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tthData}>
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
                        formatter={(value: number) => [value.toLocaleString(), "Count"]}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {tthData.map((_, i) => (
                          <Cell key={i} fill={i < tthData.length - 1 ? `hsl(var(--chart-${(i % 5) + 1}))` : "hsl(var(--muted-foreground))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {chartData.length === 0 && tthData.length === 0 && (
            <div className="p-12 text-center">
              <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">No chart data available</p>
              <p className="text-xs text-muted-foreground mt-1">Run a backtest to generate visualizations</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
