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
  CalendarDays,
  Zap,
  Star,
  ArrowRight,
  CheckCircle2,
  XCircle,
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
  const [activeTab, setActiveTab] = useState("simulate");

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

  interface SimSignalSummary {
    id: number;
    ticker: string;
    setupType: string;
    direction: string;
    qualityScore: number;
    tier: string;
    magnetPrice: number;
    targetDate?: string;
    entryPrice?: number | null;
    activatedTs?: string | null;
  }

  interface SimBtodStatus {
    phase: "SELECTIVE" | "OPEN" | "CLOSED";
    gateOpen: boolean;
    executedSignalId: number | null;
    executedTicker: string | null;
    top3Ids: number[];
    eligibleCount: number;
  }

  interface SimTradeSyncCall {
    signalId: number;
    ticker: string;
    setupType: string;
    direction: string;
    entryPrice: number;
    stopPrice: number | null;
    targetPrice: number;
    instruments: string[];
    status: "SIMULATED";
    triggerTs: string;
  }

  interface SimPhaseSnapshot {
    label: string;
    btodTop3: Array<{ signalId: number; ticker: string; setupType: string; qualityScore: number; rank: number }>;
    btodStatus: SimBtodStatus;
    tradeSyncCalls: SimTradeSyncCall[];
    activations: Array<{ signalId: number; ticker: string; setupType: string; triggerTs: string; entryPrice: number; isBtod: boolean }>;
    hits: Array<{ signalId: number; ticker: string; hitTs: string; timeToHitMin: number }>;
    misses: Array<{ signalId: number; ticker: string; reason: string }>;
    summary: { totalPending: number; totalActive: number; totalHit: number; totalMiss: number };
    signalsGenerated: any[];
    onDeckSignals: SimSignalSummary[];
    activeSignals: SimSignalSummary[];
  }

  interface SimDayDetail {
    date: string;
    dayIndex: number;
    totalDays: number;
    simTimeCT?: number;
    signalsGenerated: number;
    btodTop3Count: number;
    btodTop3: Array<{ signalId: number; ticker: string; setupType: string; qualityScore: number; rank: number }>;
    btodStatus: SimBtodStatus;
    tradeSyncCalls: SimTradeSyncCall[];
    activations: number;
    activationDetails: Array<{ signalId: number; ticker: string; setupType: string; triggerTs: string; entryPrice: number; isBtod: boolean }>;
    hits: number;
    hitDetails: Array<{ signalId: number; ticker: string; hitTs: string; timeToHitMin: number }>;
    misses: number;
    missDetails: Array<{ signalId: number; ticker: string; reason: string }>;
    summary: { totalPending: number; totalActive: number; totalHit: number; totalMiss: number };
    onDeckSignals: SimSignalSummary[];
    activeSignals: SimSignalSummary[];
    newSignals: SimSignalSummary[];
    phases?: SimPhaseSnapshot[];
  }

  const [simLogs, setSimLogs] = useState<{ message: string; type: string; ts: number }[]>([]);
  const [simProgress, setSimProgress] = useState<{ completed: number; total: number; day: string; phase: string } | null>(null);
  const [simDayResults, setSimDayResults] = useState<SimDayDetail[]>([]);
  const [simSelectedDayIdx, setSimSelectedDayIdx] = useState<number>(-1);
  const [simFinalStats, setSimFinalStats] = useState<any | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simPaused, setSimPaused] = useState(false);
  const [simPhaseDelayMs, setSimPhaseDelayMs] = useState(4000);
  const simLogEndRef = useRef<HTMLDivElement>(null);
  const simUserNavigatedRef = useRef(false);
  const simTimeNavigatedRef = useRef(false);
  const sseRef = useRef<EventSource | null>(null);
  const simDayCountRef = useRef(0);

  const simTimeSnapshotsRef = useRef<Record<number, Record<number, SimDayDetail>>>({});
  const [simTimeSnapshotKeys, setSimTimeSnapshotKeys] = useState<Record<number, number[]>>({});
  const [simSelectedTimeCT, setSimSelectedTimeCT] = useState<number | null>(null);

  const connectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    let catchUpLogs: Array<{ message: string; type: string; ts: number }> = [];
    let catchUpDays: SimDayDetail[] = [];
    let isCatchUp = true;

    const es = new EventSource("/api/backtest/simulate-stream");
    sseRef.current = es;

    const flushCatchUp = () => {
      if (!isCatchUp) return;
      isCatchUp = false;
      if (catchUpLogs.length > 0) {
        setSimLogs(catchUpLogs);
        catchUpLogs = [];
      }
      if (catchUpDays.length > 0) {
        setSimDayResults(catchUpDays);
        simDayCountRef.current = catchUpDays.length;
        if (!simUserNavigatedRef.current) {
          setSimSelectedDayIdx(catchUpDays.length - 1);
        }
        const snapData: Record<number, Record<number, SimDayDetail>> = {};
        const snapKeys: Record<number, number[]> = {};
        for (const d of catchUpDays) {
          if (d.simTimeCT != null && d.simTimeCT > 0) {
            if (!snapData[d.dayIndex]) { snapData[d.dayIndex] = {}; snapKeys[d.dayIndex] = []; }
            snapData[d.dayIndex][d.simTimeCT] = d;
            if (!snapKeys[d.dayIndex].includes(d.simTimeCT)) snapKeys[d.dayIndex].push(d.simTimeCT);
          }
        }
        simTimeSnapshotsRef.current = snapData;
        setSimTimeSnapshotKeys(snapKeys);
        const lastDay = catchUpDays[catchUpDays.length - 1];
        if (lastDay?.simTimeCT && !simTimeNavigatedRef.current) {
          setSimSelectedTimeCT(lastDay.simTimeCT);
        }
        catchUpDays = [];
      }
    };

    es.onmessage = (evt) => {
      try {
        const { event, data } = JSON.parse(evt.data);

        if (event === "init") {
          setSimRunning(true);
          setSimPaused(false);
        } else if (event === "log") {
          if (isCatchUp) {
            catchUpLogs.push(data);
          } else {
            setSimLogs((prev) => [...prev, data]);
          }
        } else if (event === "progress") {
          flushCatchUp();
          setSimProgress(data);
        } else if (event === "day") {
          if (isCatchUp) {
            const existingIdx = catchUpDays.findIndex((d) => d.dayIndex === data.dayIndex);
            if (existingIdx >= 0) {
              catchUpDays[existingIdx] = data;
            } else {
              catchUpDays.push(data);
            }
          } else {
            setSimDayResults((prev) => {
              const updated = [...prev];
              const existingIdx = updated.findIndex((d) => d.dayIndex === data.dayIndex);
              if (existingIdx >= 0) {
                updated[existingIdx] = data;
              } else {
                updated.push(data);
              }
              const isNewDay = updated.length > simDayCountRef.current;
              if (isNewDay) {
                simDayCountRef.current = updated.length;
                simTimeNavigatedRef.current = false;
              }
              if (!simUserNavigatedRef.current) {
                setSimSelectedDayIdx(updated.length - 1);
              }
              return updated;
            });
            if (data.simTimeCT != null && data.simTimeCT > 0) {
              const dayIdx = data.dayIndex as number;
              const t = data.simTimeCT as number;
              if (!simTimeSnapshotsRef.current[dayIdx]) simTimeSnapshotsRef.current[dayIdx] = {};
              simTimeSnapshotsRef.current[dayIdx][t] = data;
              setSimTimeSnapshotKeys((prev) => {
                const existing = prev[dayIdx] ?? [];
                if (existing.length > 0 && existing[existing.length - 1] === t) return prev;
                return { ...prev, [dayIdx]: [...existing, t] };
              });
              if (!simTimeNavigatedRef.current && !simUserNavigatedRef.current) {
                setSimSelectedTimeCT(t);
              }
            }
          }
        } else if (event === "complete") {
          flushCatchUp();
          setSimFinalStats(data);
          setSimRunning(false);
          setSimProgress({ completed: data.totalDays, total: data.totalDays, day: "done", phase: "complete" });
          toast({ title: "Simulation complete", description: "Day-by-day results are ready." });
        } else if (event === "error") {
          flushCatchUp();
          setSimRunning(false);
          toast({ title: "Simulation failed", description: data.message, variant: "destructive" });
        } else if (event === "paused") {
          flushCatchUp();
          setSimPaused(true);
        } else if (event === "resumed") {
          setSimPaused(false);
        } else if (event === "cancelled") {
          setSimRunning(false);
          setSimPaused(false);
        } else if (event === "speed") {
          setSimPhaseDelayMs(data.phaseDelayMs);
        }
      } catch {}
    };

    es.onerror = () => {
      setTimeout(() => {
        if (sseRef.current === es) {
          connectSSE();
        }
      }, 3000);
    };
  }, [toast]);

  useEffect(() => {
    connectSSE();
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, [connectSSE]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [backtestLogs]);

  useEffect(() => {
    simLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [simLogs]);

  const pauseSimulation = useCallback(() => {
    fetch("/api/backtest/simulate-pause", { method: "POST" }).then((res) => {
      if (!res.ok) toast({ title: "Failed to pause", variant: "destructive" });
    }).catch(() => toast({ title: "Failed to pause", variant: "destructive" }));
  }, [toast]);

  const resumeSimulation = useCallback(() => {
    fetch("/api/backtest/simulate-resume", { method: "POST" }).then((res) => {
      if (!res.ok) toast({ title: "Failed to resume", variant: "destructive" });
    }).catch(() => toast({ title: "Failed to resume", variant: "destructive" }));
  }, [toast]);

  const cancelSimulation = useCallback(() => {
    fetch("/api/backtest/simulate-cancel", { method: "POST" }).then((res) => {
      if (res.ok) {
        toast({ title: "Simulation cancelled" });
      } else {
        toast({ title: "Failed to cancel", variant: "destructive" });
      }
    }).catch(() => toast({ title: "Failed to cancel", variant: "destructive" }));
  }, [toast]);

  const runSimulationStart = useCallback(() => {
    const tickers = selectedTickers.length ? selectedTickers : enabledSymbols.map((s) => s.ticker);
    setSimLogs([]);
    setSimProgress(null);
    setSimDayResults([]);
    setSimSelectedDayIdx(-1);
    setSimFinalStats(null);
    simDayCountRef.current = 0;
    simUserNavigatedRef.current = false;
    simTimeNavigatedRef.current = false;
    setSimSelectedTimeCT(null);
    simTimeSnapshotsRef.current = {};
    setSimTimeSnapshotKeys({});

    fetch("/api/backtest/simulate-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, setups: selectedSetups, startDate, endDate, phaseDelayMs: simPhaseDelayMs }),
    }).then((res) => {
      if (!res.ok) {
        toast({ title: "Simulation failed", description: "Failed to start", variant: "destructive" });
      } else {
        connectSSE();
      }
    }).catch((err) => {
      toast({ title: "Simulation failed", description: err.message, variant: "destructive" });
    });
  }, [selectedTickers, enabledSymbols, selectedSetups, startDate, endDate, simPhaseDelayMs, toast, connectSSE]);

  const btRunLogCountRef = useRef(0);
  const btRunWasRunningRef = useRef(false);
  const btRunPollIdRef = useRef(0);
  const btRunFinalHandled = useRef(false);

  useEffect(() => {
    const pollId = ++btRunPollIdRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (pollId !== btRunPollIdRef.current) return;
      try {
        const res = await fetch(`/api/backtest/run-status?logsFrom=${btRunLogCountRef.current}`);
        if (pollId !== btRunPollIdRef.current) return;
        const data = await res.json();

        if (data.logs?.length > 0) {
          setBacktestLogs((prev) => [...prev, ...data.logs]);
          btRunLogCountRef.current = data.totalLogs;
        }

        if (data.progress) {
          setBacktestProgress(data.progress);
        }

        if (data.running) setBacktestRunning(true);

        if (data.finalStats && btRunWasRunningRef.current && !btRunFinalHandled.current) {
          btRunFinalHandled.current = true;
          setBacktestRunning(false);
          queryClient.invalidateQueries({ queryKey: ["/api/backtests"] });
          queryClient.invalidateQueries({ queryKey: ["/api/setup-stats"] });
          toast({ title: "Backtest complete", description: "Results are ready to view." });
        }

        if (data.error && btRunWasRunningRef.current) {
          setBacktestRunning(false);
          toast({ title: "Backtest failed", description: data.error, variant: "destructive" });
        }

        if (!data.running && btRunWasRunningRef.current && !data.finalStats && !data.error) {
          setBacktestRunning(false);
        }

        btRunWasRunningRef.current = data.running;

        if (!data.running && (data.finalStats || data.error)) {
          return;
        }
      } catch {}

      if (pollId === btRunPollIdRef.current) {
        timer = setTimeout(poll, 1000);
      }
    };

    poll();
    return () => {
      btRunPollIdRef.current++;
      if (timer) clearTimeout(timer);
    };
  }, [toast]);

  const runBacktestStart = useCallback(() => {
    const tickers = selectedTickers.length ? selectedTickers : enabledSymbols.map((s) => s.ticker);
    setBacktestRunning(true);
    setBacktestLogs([]);
    setBacktestProgress(null);
    btRunLogCountRef.current = 0;
    btRunFinalHandled.current = false;

    fetch("/api/backtest/run-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, setups: selectedSetups, startDate, endDate }),
    }).then((res) => {
      if (!res.ok) {
        setBacktestRunning(false);
        toast({ title: "Backtest failed", description: "Failed to start", variant: "destructive" });
      }
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
          <TabsTrigger value="simulate" data-testid="tab-simulate">
            <CalendarDays className="w-3.5 h-3.5 mr-1" />
            Simulate
          </TabsTrigger>
          <TabsTrigger value="run" data-testid="tab-run">Run Backtest</TabsTrigger>
          <TabsTrigger value="results" data-testid="tab-results">
            Results {backtests?.length ? `(${backtests.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="rankings" data-testid="tab-rankings">Setup Rankings</TabsTrigger>
          <TabsTrigger value="charts" data-testid="tab-charts">Charts</TabsTrigger>
        </TabsList>

        <TabsContent value="simulate" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                Day-by-Day Simulation
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Replays the full system lifecycle: after-close scan, BTOD ranking, intraday activation &amp; magnet touch — day by day, timeframe by timeframe
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Date Range</Label>
                <div className="flex flex-wrap gap-2">
                  {DURATION_PRESETS.map((p) => (
                    <Button
                      key={p.months}
                      size="sm"
                      variant={durationPreset === String(p.months) ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => handleDurationChange(String(p.months))}
                      data-testid={`btn-sim-duration-${p.months}`}
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
                      data-testid="input-sim-start-date"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="text-sm w-40"
                      data-testid="input-sim-end-date"
                    />
                  </div>
                )}
                {durationPreset !== "0" && (
                  <p className="text-[10px] text-muted-foreground">{startDate} → {endDate}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Setups</Label>
                <div className="flex flex-wrap gap-3">
                  {SETUP_TYPES.map((setup) => (
                    <div key={setup} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`sim-setup-${setup}`}
                        checked={selectedSetups.includes(setup)}
                        onCheckedChange={() => toggleSetup(setup)}
                        data-testid={`checkbox-sim-setup-${setup}`}
                      />
                      <label htmlFor={`sim-setup-${setup}`} className="text-xs cursor-pointer">
                        {setup}: {SETUP_LABELS[setup as SetupType]}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium">Step Delay</Label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={5000}
                    step={100}
                    value={simPhaseDelayMs}
                    onChange={(e) => {
                      const ms = parseInt(e.target.value, 10);
                      setSimPhaseDelayMs(ms);
                      if (simRunning) {
                        fetch("/api/backtest/simulate-speed", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ phaseDelayMs: ms }),
                        });
                      }
                    }}
                    className="flex-1 h-2 accent-primary cursor-pointer"
                    data-testid="slider-sim-speed"
                  />
                  <span className="text-xs font-mono w-14 text-right tabular-nums" data-testid="text-sim-speed-value">
                    {simPhaseDelayMs === 0 ? "Instant" : `${(simPhaseDelayMs / 1000).toFixed(1)}s`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "Instant", ms: 0 },
                    { label: "Fast", ms: 500 },
                    { label: "Normal", ms: 2000 },
                    { label: "Slow", ms: 4000 },
                  ].map((preset) => (
                    <Button
                      key={preset.ms}
                      size="sm"
                      variant={simPhaseDelayMs === preset.ms ? "default" : "outline"}
                      className="h-6 text-[10px] px-2"
                      onClick={() => {
                        setSimPhaseDelayMs(preset.ms);
                        if (simRunning) {
                          fetch("/api/backtest/simulate-speed", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ phaseDelayMs: preset.ms }),
                          });
                        }
                      }}
                      data-testid={`btn-sim-speed-${preset.ms}`}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Delay between each simulation phase. Drag the slider or pick a preset. Changes apply immediately.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">
                    Tickers {selectedTickers.length === 0
                      ? `(All ${enabledSymbols.length} universe tickers)`
                      : `(${selectedTickers.length} selected)`}
                  </Label>
                  {selectedTickers.length > 0 && (
                    <Button
                      size="sm" variant="ghost" className="h-6 text-[10px] px-2"
                      onClick={selectAllTickers}
                      data-testid="btn-sim-select-all"
                    >
                      Use All
                    </Button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search tickers..."
                    value={tickerSearch}
                    onChange={(e) => setTickerSearch(e.target.value)}
                    className="pl-8 text-sm h-9"
                    data-testid="input-sim-ticker-search"
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
                        data-testid={`badge-sim-selected-${t}`}
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
                      data-testid={`badge-sim-ticker-${sym.ticker}`}
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
                  onClick={runSimulationStart}
                  disabled={simRunning || selectedSetups.length === 0}
                  data-testid="button-run-simulation"
                >
                  {simRunning ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  {simRunning
                    ? "Simulating..."
                    : `Run Simulation (${selectedTickers.length || enabledSymbols.length} tickers × ${selectedSetups.length} setups)`}
                </Button>
                {simRunning && !simPaused && (
                  <Button variant="outline" size="sm" onClick={pauseSimulation} data-testid="button-sim-pause">
                    <Pause className="w-4 h-4 mr-1" /> Pause
                  </Button>
                )}
                {simRunning && simPaused && (
                  <Button variant="outline" size="sm" onClick={resumeSimulation} data-testid="button-sim-resume">
                    <Play className="w-4 h-4 mr-1" /> Resume
                  </Button>
                )}
                {simRunning && (
                  <Button variant="destructive" size="sm" onClick={cancelSimulation} data-testid="button-sim-cancel">
                    <Square className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                )}
              </div>

              {(simLogs.length > 0 || simRunning || simDayResults.length > 0) && (
                <div className="mt-4 space-y-3">
                  {simProgress && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant={simPaused ? "secondary" : "default"} className={`text-[10px] ${simRunning && !simPaused ? "animate-pulse" : ""}`}>
                            {simPaused ? "PAUSED" : simRunning ? "LIVE" : "DONE"}
                          </Badge>
                          <span className="font-mono font-semibold">{simProgress.day}</span>
                          <span className="text-muted-foreground">
                            {simProgress.phase === "preload" ? "Loading Data..." :
                             simProgress.phase === "pre-open-scan" ? "Pre-Open Scan" :
                             simProgress.phase === "live-monitor" ? "Live Monitor" :
                             simProgress.phase === "after-close-scan" ? "After-Close Scan" :
                             simProgress.phase === "end-of-day" ? "End of Day" :
                             simProgress.phase}
                          </span>
                        </div>
                        <span className="text-muted-foreground">{simProgress.completed}/{simProgress.total} days</span>
                      </div>
                      <Progress value={(simProgress.completed / simProgress.total) * 100} className="h-2" />
                    </div>
                  )}

                  {simDayResults.length > 0 && (
                    <Card className="border-zinc-800 bg-zinc-950/50">
                      <CardContent className="p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0"
                              disabled={simSelectedDayIdx <= 0}
                              onClick={() => { simUserNavigatedRef.current = true; simTimeNavigatedRef.current = false; setSimSelectedTimeCT(null); setSimSelectedDayIdx((prev) => Math.max(0, prev - 1)); }}
                              data-testid="button-sim-prev-day"
                            >
                              <ArrowRight className="w-4 h-4 rotate-180" />
                            </Button>
                            <span className="font-mono text-sm font-semibold" data-testid="text-sim-current-date">
                              {simDayResults[simSelectedDayIdx]?.date ?? "—"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Day {simSelectedDayIdx + 1} of {simDayResults.length}
                            </span>
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0"
                              disabled={simSelectedDayIdx >= simDayResults.length - 1}
                              onClick={() => { simUserNavigatedRef.current = true; simTimeNavigatedRef.current = false; setSimSelectedTimeCT(null); setSimSelectedDayIdx((prev) => Math.min(simDayResults.length - 1, prev + 1)); }}
                              data-testid="button-sim-next-day"
                            >
                              <ArrowRight className="w-4 h-4" />
                            </Button>
                          </div>
                          {(() => {
                            const currentDay = simDayResults[simSelectedDayIdx];
                            if (!currentDay) return null;
                            const daySnaps = simTimeSnapshotsRef.current[currentDay.dayIndex] ?? {};
                            const eff = (simSelectedTimeCT != null && daySnaps[simSelectedTimeCT]) ? daySnaps[simSelectedTimeCT] : currentDay;
                            const summary = eff.summary;
                            const sigCount = eff.signalsGenerated;
                            return (
                              <div className="flex items-center gap-2 text-xs">
                                <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-500/20">
                                  +{sigCount} new
                                </Badge>
                                <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                                  {summary.totalPending} pending
                                </Badge>
                                <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                                  {summary.totalActive} active
                                </Badge>
                                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                  {summary.totalHit} hits
                                </Badge>
                              </div>
                            );
                          })()}
                        </div>

                        {(() => {
                          const currentDay = simDayResults[simSelectedDayIdx];
                          if (!currentDay) return null;
                          const availTimes = (simTimeSnapshotKeys[currentDay.dayIndex] ?? []).slice().sort((a, b) => a - b);
                          const timeCT = simSelectedTimeCT ?? currentDay.simTimeCT ?? 0;
                          if (availTimes.length === 0 && timeCT === 0) return null;
                          const currentIdx = availTimes.indexOf(timeCT);
                          const canPrev = currentIdx > 0;
                          const canNext = currentIdx >= 0 && currentIdx < availTimes.length - 1;
                          const formatCT = (min: number) => {
                            const h = Math.floor(min / 60);
                            const m = min % 60;
                            const suffix = h >= 12 ? "PM" : "AM";
                            const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                            return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
                          };
                          const phaseName = timeCT < 8 * 60 + 20 ? "Pre-Market" :
                            timeCT < 8 * 60 + 30 ? "Pre-Open" :
                            timeCT < 15 * 60 ? "Live Monitor" :
                            timeCT < 15 * 60 + 10 ? "After-Close" : "End of Day";
                          return (
                            <div className="flex items-center gap-2 mb-2" data-testid="sim-time-stepper">
                              <Button
                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                disabled={!canPrev}
                                onClick={() => {
                                  if (canPrev) {
                                    simTimeNavigatedRef.current = true;
                                    setSimSelectedTimeCT(availTimes[currentIdx - 1]);
                                  }
                                }}
                                data-testid="button-sim-prev-time"
                              >
                                <ArrowRight className="w-4 h-4 rotate-180" />
                              </Button>
                              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="font-mono text-sm font-semibold" data-testid="text-sim-time">
                                {formatCT(timeCT)} CT
                              </span>
                              <Badge variant="outline" className={`text-[10px] h-5 px-1.5 ${
                                phaseName === "Live Monitor" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                phaseName === "Pre-Open" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                                phaseName === "After-Close" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                                phaseName === "End of Day" ? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" :
                                "bg-violet-500/10 text-violet-400 border-violet-500/20"
                              }`}>
                                {phaseName}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {currentIdx >= 0 ? currentIdx + 1 : "—"} of {availTimes.length}
                              </span>
                              <Button
                                variant="ghost" size="sm" className="h-7 w-7 p-0"
                                disabled={!canNext}
                                onClick={() => {
                                  if (canNext) {
                                    simTimeNavigatedRef.current = true;
                                    setSimSelectedTimeCT(availTimes[currentIdx + 1]);
                                  }
                                }}
                                data-testid="button-sim-next-time"
                              >
                                <ArrowRight className="w-4 h-4" />
                              </Button>
                            </div>
                          );
                        })()}

                        {(() => {
                          const currentDay = simDayResults[simSelectedDayIdx];
                          if (!currentDay) return null;

                          const daySnaps = simTimeSnapshotsRef.current[currentDay.dayIndex] ?? {};
                          const effectiveDay = (simSelectedTimeCT != null && daySnaps[simSelectedTimeCT]) ? daySnaps[simSelectedTimeCT] : currentDay;

                          const btodTop3 = effectiveDay.btodTop3;
                          const btodStatus = effectiveDay.btodStatus;
                          const activationDetails = effectiveDay.activationDetails;
                          const tradeSyncCalls = effectiveDay.tradeSyncCalls;
                          const hitDetails = effectiveDay.hitDetails;
                          const onDeckSignals = effectiveDay.onDeckSignals;
                          const activeSignals = effectiveDay.activeSignals;
                          const newSignals = effectiveDay.newSignals;
                          return (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-violet-400">
                                  <Star className="w-3.5 h-3.5" />
                                  BTOD Top 3
                                </div>
                                {btodTop3.length > 0 ? (
                                  <div className="space-y-1">
                                    {btodTop3.map((entry) => (
                                      <div key={entry.signalId} className="flex items-center justify-between px-2 py-1.5 rounded bg-violet-500/5 border border-violet-500/10 text-xs" data-testid={`sim-btod-entry-${entry.signalId}`}>
                                        <div className="flex items-center gap-2">
                                          <Badge variant="outline" className="text-[9px] h-4 px-1 bg-violet-500/10 text-violet-400 border-violet-500/20">
                                            #{entry.rank}
                                          </Badge>
                                          <span className="font-mono font-semibold">{entry.ticker}</span>
                                          <span className="text-muted-foreground">{entry.setupType}</span>
                                        </div>
                                        <span className="text-muted-foreground">QS {entry.qualityScore}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground px-2">No eligible BTOD signals</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-cyan-400">
                                  <Crosshair className="w-3.5 h-3.5" />
                                  BTOD Status
                                </div>
                                {btodStatus ? (
                                  <div className="px-2 py-2 rounded bg-cyan-500/5 border border-cyan-500/10 text-xs space-y-1.5" data-testid="sim-btod-status">
                                    <div className="flex items-center justify-between">
                                      <span className="text-muted-foreground">Phase</span>
                                      <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${
                                        btodStatus.phase === "SELECTIVE" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                                        btodStatus.phase === "OPEN" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                        "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                                      }`}>
                                        {btodStatus.phase}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-muted-foreground">Gate</span>
                                      <span className={btodStatus.gateOpen ? "text-emerald-400" : "text-red-400"}>
                                        {btodStatus.gateOpen ? "OPEN" : "CLOSED"}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-muted-foreground">Eligible</span>
                                      <span>{btodStatus.eligibleCount} signals</span>
                                    </div>
                                    {btodStatus.executedTicker && (
                                      <div className="flex items-center justify-between pt-1 border-t border-cyan-500/10">
                                        <span className="text-muted-foreground">Executed</span>
                                        <span className="font-mono font-semibold text-emerald-400">{btodStatus.executedTicker}</span>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground px-2">No BTOD data</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                                  <Zap className="w-3.5 h-3.5" />
                                  Activated ({activeSignals.length})
                                </div>
                                {activeSignals.length > 0 ? (
                                  <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {activeSignals.map((sig) => (
                                      <div key={sig.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/10 text-xs" data-testid={`sim-active-${sig.id}`}>
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono font-semibold">{sig.ticker}</span>
                                          <span className="text-muted-foreground">{sig.setupType}</span>
                                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                                            {sig.direction === "BEARISH" ? "SELL" : "BUY"}
                                          </Badge>
                                        </div>
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                          {sig.entryPrice && <span>@${sig.entryPrice.toFixed(2)}</span>}
                                          <span className="text-[9px]">{sig.tier}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground px-2">No active signals</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400">
                                  <Target className="w-3.5 h-3.5" />
                                  On Deck ({onDeckSignals.length})
                                </div>
                                {onDeckSignals.length > 0 ? (
                                  <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {onDeckSignals.slice(0, 10).map((sig) => (
                                      <div key={sig.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-blue-500/5 border border-blue-500/10 text-xs" data-testid={`sim-ondeck-${sig.id}`}>
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono font-semibold">{sig.ticker}</span>
                                          <span className="text-muted-foreground">{sig.setupType}</span>
                                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                                            {sig.direction === "BEARISH" ? "SELL" : "BUY"}
                                          </Badge>
                                        </div>
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                          <span>${sig.magnetPrice.toFixed(2)}</span>
                                          <span className="text-[9px]">{sig.tier}</span>
                                        </div>
                                      </div>
                                    ))}
                                    {onDeckSignals.length > 10 && (
                                      <p className="text-[10px] text-muted-foreground px-2">+{onDeckSignals.length - 10} more</p>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground px-2">No pending on-deck signals</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-400">
                                  <TrendingUp className="w-3.5 h-3.5" />
                                  TradeSync API ({tradeSyncCalls?.length ?? 0})
                                </div>
                                {tradeSyncCalls && tradeSyncCalls.length > 0 ? (
                                  <div className="space-y-1.5" data-testid="sim-tradesync-calls">
                                    {tradeSyncCalls.map((tc, i) => (
                                      <div key={`ts-${i}`} className="px-2 py-2 rounded bg-indigo-500/5 border border-indigo-500/10 text-xs space-y-1">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono font-semibold">{tc.ticker}</span>
                                            <span className="text-muted-foreground">{tc.setupType}</span>
                                            <Badge variant="outline" className="text-[9px] h-4 px-1">
                                              {tc.direction.includes("down") ? "SELL" : "BUY"}
                                            </Badge>
                                          </div>
                                          <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                                            {tc.status}
                                          </Badge>
                                        </div>
                                        <div className="flex items-center gap-3 text-muted-foreground">
                                          <span>Entry: ${tc.entryPrice.toFixed(2)}</span>
                                          {tc.stopPrice && <span>Stop: ${tc.stopPrice.toFixed(2)}</span>}
                                          <span>Target: ${tc.targetPrice.toFixed(2)}</span>
                                        </div>
                                        <div className="flex flex-wrap gap-1 pt-0.5">
                                          {tc.instruments.map((inst) => (
                                            <Badge key={inst} variant="secondary" className="text-[8px] h-3.5 px-1">
                                              {inst}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground px-2">No TradeSync calls this day</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Today's Events
                                </div>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {activationDetails.map((a, i) => (
                                    <div key={`act-${i}`} className="flex items-center justify-between px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/10 text-xs">
                                      <div className="flex items-center gap-2">
                                        {a.isBtod && <Star className="w-3 h-3 text-violet-400" />}
                                        <Zap className="w-3 h-3 text-amber-400" />
                                        <span className="font-mono">{a.ticker}/{a.setupType}</span>
                                      </div>
                                      <span className="text-muted-foreground">@${a.entryPrice.toFixed(2)}</span>
                                    </div>
                                  ))}
                                  {hitDetails.map((h, i) => (
                                    <div key={`hit-${i}`} className="flex items-center justify-between px-2 py-1.5 rounded bg-emerald-500/5 border border-emerald-500/10 text-xs">
                                      <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                        <span className="font-mono">{h.ticker}</span>
                                      </div>
                                      <span className="text-muted-foreground">{h.timeToHitMin}min</span>
                                    </div>
                                  ))}
                                  {(effectiveDay.missDetails ?? []).map((m, i) => (
                                    <div key={`miss-${i}`} className="flex items-center justify-between px-2 py-1.5 rounded bg-red-500/5 border border-red-500/10 text-xs">
                                      <div className="flex items-center gap-2">
                                        <XCircle className="w-3 h-3 text-red-400" />
                                        <span className="font-mono">{m.ticker}</span>
                                      </div>
                                      <span className="text-muted-foreground text-[10px]">{m.reason}</span>
                                    </div>
                                  ))}
                                  {activationDetails.length === 0 && hitDetails.length === 0 && (effectiveDay.missDetails ?? []).length === 0 && (
                                    <p className="text-[10px] text-muted-foreground px-2">No events today</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>
                  )}

                  <div
                    className="bg-zinc-950 rounded-md border border-zinc-800 p-3 max-h-60 overflow-y-auto font-mono text-xs leading-relaxed"
                    data-testid="simulation-log-panel"
                  >
                    {simLogs.map((entry, i) => (
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
                    <div ref={simLogEndRef} />
                  </div>
                </div>
              )}

              {simFinalStats && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="pt-3 pb-3 px-4 text-center">
                        <div className="text-xl font-bold" data-testid="text-sim-total-signals">{simFinalStats.totalSignalsGenerated}</div>
                        <div className="text-[10px] text-muted-foreground">Signals Generated</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-3 pb-3 px-4 text-center">
                        <div className="text-xl font-bold text-amber-500" data-testid="text-sim-activations">{simFinalStats.totalActivations}</div>
                        <div className="text-[10px] text-muted-foreground">Activations</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-3 pb-3 px-4 text-center">
                        <div className="text-xl font-bold text-emerald-500" data-testid="text-sim-hits">{simFinalStats.totalHits}</div>
                        <div className="text-[10px] text-muted-foreground">Hits ({(simFinalStats.hitRate * 100).toFixed(1)}%)</div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-3 pb-3 px-4 text-center">
                        <div className="text-xl font-bold text-violet-500" data-testid="text-sim-btod">{simFinalStats.btodActivations}</div>
                        <div className="text-[10px] text-muted-foreground">BTOD Activations</div>
                      </CardContent>
                    </Card>
                  </div>

                </div>
              )}

              {!simRunning && simLogs.length === 0 && !simFinalStats && (
                <div className="border border-dashed rounded-lg p-8 text-center">
                  <CalendarDays className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Configure tickers, setups, and date range above</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    The simulation replays each trading day: detects setups, ranks BTOD candidates, checks activations, and validates magnet touches
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="run" className="space-y-4 mt-4">
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
                  onClick={runBacktestStart}
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
