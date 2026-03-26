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

function TradeChart({ tr }: { tr: SimTrackingResult }) {
  if (!tr.chartBars || tr.chartBars.length === 0) return null;

  const bars = tr.chartBars;
  const allPrices = bars.flatMap((b) => [b.h, b.l]);
  if (tr.chartEntry != null) allPrices.push(tr.chartEntry);
  if (tr.chartStop != null) allPrices.push(tr.chartStop);
  if (tr.chartTarget != null) allPrices.push(tr.chartTarget);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const rangePad = (maxP - minP) * 0.1 || 1;
  const yMin = minP - rangePad;
  const yMax = maxP + rangePad;

  const minBarGap = 3;
  const dynamicW = Math.max(520, bars.length * minBarGap + 120);
  const chartW = Math.min(dynamicW, 900);
  const chartH = 170;
  const marginL = 55;
  const marginR = 70;
  const marginT = 8;
  const marginB = 24;
  const plotW = chartW - marginL - marginR;
  const plotH = chartH - marginT - marginB;

  const yScale = (v: number) => marginT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const gap = plotW / Math.max(bars.length, 1);
  const barW = Math.max(1, Math.min(8, gap * 0.6));

  const yTicks: number[] = [];
  const tickStep = (yMax - yMin) / 5;
  for (let i = 0; i <= 5; i++) yTicks.push(yMin + tickStep * i);

  const labelInterval = Math.max(1, Math.ceil(bars.length / 10));

  const formatTimeLabel = (ts: number) => {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    const prevTs = bars.length > 0 ? bars[0].t : ts;
    const prevD = new Date(prevTs);
    const sameDay = d.getDate() === prevD.getDate() && d.getMonth() === prevD.getMonth();
    if (!sameDay || (h === 9 && m === 30) || h === 0) {
      return `${d.getMonth() + 1}/${d.getDate()} ${h}:${String(m).padStart(2, "0")}`;
    }
    return `${h}:${String(m).padStart(2, "0")}`;
  };

  return (
    <div className="w-full overflow-x-auto mt-2" data-testid="trade-chart">
      <svg width={chartW} height={chartH} className="block" style={{ minWidth: 400 }}>
        <rect x={marginL} y={marginT} width={plotW} height={plotH} fill="#09090b" rx={2} />
        {yTicks.map((tick, i) => {
          const y = yScale(tick);
          return (
            <g key={i}>
              <line x1={marginL} y1={y} x2={marginL + plotW} y2={y} stroke="#27272a" strokeWidth={0.5} />
              <text x={marginL - 4} y={y + 3} textAnchor="end" fill="#71717a" fontSize={8} fontFamily="monospace">${tick.toFixed(2)}</text>
            </g>
          );
        })}

        {tr.chartEntry != null && (() => {
          const y = yScale(tr.chartEntry);
          return (
            <g>
              <line x1={marginL} y1={y} x2={marginL + plotW} y2={y} stroke="#3b82f6" strokeWidth={1.2} strokeDasharray="4 2" />
              <text x={marginL + plotW + 3} y={y + 3} fill="#3b82f6" fontSize={8} fontFamily="monospace">Entry ${tr.chartEntry.toFixed(2)}</text>
            </g>
          );
        })()}
        {tr.chartStop != null && (() => {
          const y = yScale(tr.chartStop);
          return (
            <g>
              <line x1={marginL} y1={y} x2={marginL + plotW} y2={y} stroke="#ef4444" strokeWidth={1.2} strokeDasharray="4 2" />
              <text x={marginL + plotW + 3} y={y + 3} fill="#ef4444" fontSize={8} fontFamily="monospace">Stop ${tr.chartStop.toFixed(2)}</text>
            </g>
          );
        })()}
        {tr.chartTarget != null && (() => {
          const y = yScale(tr.chartTarget);
          return (
            <g>
              <line x1={marginL} y1={y} x2={marginL + plotW} y2={y} stroke="#22c55e" strokeWidth={1.2} strokeDasharray="4 2" />
              <text x={marginL + plotW + 3} y={y + 3} fill="#22c55e" fontSize={8} fontFamily="monospace">Target ${tr.chartTarget.toFixed(2)}</text>
            </g>
          );
        })()}

        {bars.map((b, i) => {
          const x = marginL + i * gap + gap / 2;
          const bullish = b.c >= b.o;
          const color = bullish ? "#22c55e" : "#ef4444";
          const bodyTop = yScale(Math.max(b.o, b.c));
          const bodyBot = yScale(Math.min(b.o, b.c));
          const bodyH = Math.max(bodyBot - bodyTop, 1);
          const wickTop = yScale(b.h);
          const wickBot = yScale(b.l);

          return (
            <g key={i}>
              <line x1={x} y1={wickTop} x2={x} y2={wickBot} stroke={color} strokeWidth={0.5} />
              <rect x={x - barW / 2} y={bodyTop} width={barW} height={bodyH} fill={color} rx={0.25} />
              {i % labelInterval === 0 && (
                <text x={x} y={chartH - 4} textAnchor="middle" fill="#52525b" fontSize={6.5} fontFamily="monospace">
                  {formatTimeLabel(b.t)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function BacktestPage() {
  const { toast } = useToast();
  const [tickerSearch, setTickerSearch] = useState("");
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [selectedSetups, setSelectedSetups] = useState<string[]>(["A", "B", "C", "D", "E", "F"]);
  const [btodSetupTypes, setBtodSetupTypes] = useState<string[]>(["A", "B", "C"]);
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

  interface SimOptionsJson {
    mode: string;
    tradable: boolean;
    contract?: {
      ticker: string;
      strike: number;
      expiration: string;
      right: "C" | "P";
      bid: number;
      ask: number;
      mark: number;
      openInterest: number;
      impliedVol: number | null;
      delta: number | null;
      gamma: number | null;
      theta: number | null;
      vega: number | null;
    };
    checks?: {
      oiOk: boolean;
      spreadOk: boolean;
      openInterest: number | null;
      spread: number | null;
      bid: number | null;
      ask: number | null;
      checkedAt: string;
      reasonIfFail: string | null;
    };
  }

  interface SimSignalSummary {
    id: number;
    ticker: string;
    setupType: string;
    direction: string;
    qualityScore: number;
    tier: string;
    magnetPrice: number;
    targetDate?: string;
    status?: string;
    entryPrice?: number | null;
    activatedTs?: string | null;
    stopPrice?: number | null;
    stopDistance?: number | null;
    t1?: number | null;
    t2?: number | null;
    bias?: "BUY" | "SELL" | null;
    riskReward?: number | null;
    optionsJson?: SimOptionsJson | null;
  }

  interface SimBtodStatus {
    phase: "SELECTIVE" | "OPEN" | "CLOSED";
    gateOpen: boolean;
    executedSignalId: number | null;
    executedTicker: string | null;
    top3Ids: number[];
    eligibleCount: number;
  }

  interface SimTrackingBar {
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
  }

  interface SimTrackingResult {
    instrument: string;
    tradeType: "ten_percent" | "normal";
    win: boolean;
    profitPercent: number;
    lastMilestone: number;
    durationDays: number;
    exitReason: string;
    entryBarTs?: number;
    exitBarTs?: number;
    chartBars?: SimTrackingBar[];
    chartEntry?: number;
    chartStop?: number;
    chartTarget?: number;
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
    outcome?: "hit" | "miss" | "pending";
    trackingResults?: SimTrackingResult[];
  }

  interface SimPhaseSnapshot {
    label: string;
    btodTop3: Array<{ signalId: number; ticker: string; setupType: string; qualityScore: number; rank: number; activationStatus?: string }>;
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
    btodTop3: Array<{ signalId: number; ticker: string; setupType: string; qualityScore: number; rank: number; activationStatus?: string }>;
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
  const [simProgress, setSimProgress] = useState<{ completed: number; total: number; day: string; phase: string; simTimeCT?: number } | null>(null);
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
      body: JSON.stringify({ tickers, setups: selectedSetups, startDate, endDate, phaseDelayMs: simPhaseDelayMs, btodSetupTypes }),
    }).then((res) => {
      if (!res.ok) {
        toast({ title: "Simulation failed", description: "Failed to start", variant: "destructive" });
      } else {
        connectSSE();
      }
    }).catch((err) => {
      toast({ title: "Simulation failed", description: err.message, variant: "destructive" });
    });
  }, [selectedTickers, enabledSymbols, selectedSetups, startDate, endDate, simPhaseDelayMs, btodSetupTypes, toast, connectSSE]);

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
                <Label className="text-xs font-medium">BTOD Setup Types</Label>
                <div className="flex flex-wrap gap-3">
                  {SETUP_TYPES.map((setup) => (
                    <div key={setup} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`sim-btod-setup-${setup}`}
                        checked={btodSetupTypes.includes(setup)}
                        onCheckedChange={() => {
                          setBtodSetupTypes((prev) =>
                            prev.includes(setup)
                              ? prev.filter((s) => s !== setup)
                              : [...prev, setup]
                          );
                        }}
                        data-testid={`checkbox-sim-btod-setup-${setup}`}
                      />
                      <label htmlFor={`sim-btod-setup-${setup}`} className="text-xs cursor-pointer">
                        {setup}
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
                          {simProgress.phase === "live-monitor" && simProgress.simTimeCT != null && (
                            <span className="font-mono text-[11px] text-emerald-400" data-testid="text-sim-live-time">
                              {(() => {
                                const h = Math.floor(simProgress.simTimeCT / 60);
                                const m = simProgress.simTimeCT % 60;
                                const suffix = h >= 12 ? "PM" : "AM";
                                const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                                return `${h12}:${m.toString().padStart(2, "0")} ${suffix} CT`;
                              })()}
                            </span>
                          )}
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
                              onClick={() => {
                                simUserNavigatedRef.current = true;
                                simTimeNavigatedRef.current = false;
                                const targetIdx = Math.max(0, simSelectedDayIdx - 1);
                                const targetDay = simDayResults[targetIdx];
                                if (targetDay) {
                                  const keys = (simTimeSnapshotKeys[targetDay.dayIndex] ?? []);
                                  setSimSelectedTimeCT(keys.length > 0 ? keys[keys.length - 1] : targetDay.simTimeCT ?? null);
                                } else {
                                  setSimSelectedTimeCT(null);
                                }
                                setSimSelectedDayIdx(targetIdx);
                              }}
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
                              onClick={() => {
                                simUserNavigatedRef.current = true;
                                simTimeNavigatedRef.current = false;
                                const targetIdx = Math.min(simDayResults.length - 1, simSelectedDayIdx + 1);
                                const targetDay = simDayResults[targetIdx];
                                if (targetDay) {
                                  const keys = (simTimeSnapshotKeys[targetDay.dayIndex] ?? []);
                                  setSimSelectedTimeCT(keys.length > 0 ? keys[keys.length - 1] : targetDay.simTimeCT ?? null);
                                } else {
                                  setSimSelectedTimeCT(null);
                                }
                                setSimSelectedDayIdx(targetIdx);
                              }}
                              data-testid="button-sim-next-day"
                            >
                              <ArrowRight className="w-4 h-4" />
                            </Button>
                          </div>
                          {(() => {
                            const currentDay = simDayResults[simSelectedDayIdx];
                            if (!currentDay) return null;
                            const daySnaps = simTimeSnapshotsRef.current[currentDay.dayIndex] ?? {};
                            const availKeys = (simTimeSnapshotKeys[currentDay.dayIndex] ?? []).slice().sort((a, b) => a - b);
                            let resolvedTimeCT = simSelectedTimeCT;
                            if (resolvedTimeCT != null && !daySnaps[resolvedTimeCT] && availKeys.length > 0) {
                              resolvedTimeCT = availKeys[availKeys.length - 1];
                            }
                            const eff = (resolvedTimeCT != null && daySnaps[resolvedTimeCT]) ? daySnaps[resolvedTimeCT] : currentDay;
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
                                {eff.tradeSyncCalls && eff.tradeSyncCalls.length > 0 ? (
                                  <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-400 border-indigo-500/20" data-testid="badge-tradesync-day">
                                    TS {eff.tradeSyncCalls.length}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] bg-zinc-500/10 text-zinc-500 border-zinc-500/20" data-testid="badge-no-tradesync-day">
                                    No TS
                                  </Badge>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {(() => {
                          const currentDay = simDayResults[simSelectedDayIdx];
                          if (!currentDay) return null;
                          const availTimes = (simTimeSnapshotKeys[currentDay.dayIndex] ?? []).slice().sort((a, b) => a - b);
                          if (availTimes.length === 0) return null;
                          let timeCT = simSelectedTimeCT ?? currentDay.simTimeCT ?? availTimes[availTimes.length - 1];
                          let currentIdx = availTimes.indexOf(timeCT);
                          if (currentIdx < 0) {
                            currentIdx = availTimes.length - 1;
                            timeCT = availTimes[currentIdx];
                          }
                          const canPrev = currentIdx > 0;
                          const canNext = currentIdx >= 0 && currentIdx < availTimes.length - 1;
                          const formatCT = (min: number) => {
                            const h = Math.floor(min / 60);
                            const m = min % 60;
                            const suffix = h >= 12 ? "PM" : "AM";
                            const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                            return `${h12}:${m.toString().padStart(2, "0")} ${suffix}`;
                          };
                          const phaseName = timeCT < 8 * 60 + 20 ? "Start of Day" :
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
                          const availKeys = (simTimeSnapshotKeys[currentDay.dayIndex] ?? []).slice().sort((a, b) => a - b);
                          let resolvedTime = simSelectedTimeCT;
                          if (resolvedTime != null && !daySnaps[resolvedTime] && availKeys.length > 0) {
                            resolvedTime = availKeys[availKeys.length - 1];
                          }
                          const effectiveDay = (resolvedTime != null && daySnaps[resolvedTime]) ? daySnaps[resolvedTime] : currentDay;

                          const btodTop3 = effectiveDay.btodTop3;
                          const btodStatus = effectiveDay.btodStatus;
                          const activationDetails = effectiveDay.activationDetails;
                          const tradeSyncCalls = effectiveDay.tradeSyncCalls;
                          const hitDetails = effectiveDay.hitDetails;
                          const onDeckSignals = effectiveDay.onDeckSignals;
                          const activeSignals = effectiveDay.activeSignals;
                          const newSignals = effectiveDay.newSignals;
                          return (
                            <div className="space-y-3">
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
                                        <div className="flex items-center gap-2">
                                          <span className="text-muted-foreground">QS {entry.qualityScore}</span>
                                          <Badge variant="outline" className={`text-[9px] h-4 px-1 ${
                                            entry.activationStatus === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                            entry.activationStatus === "INVALIDATED" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                                            "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                                          }`}>
                                            {entry.activationStatus === "ACTIVE" ? "ACTIVE" :
                                             entry.activationStatus === "INVALIDATED" ? "INVALIDATED" :
                                             "PENDING"}
                                          </Badge>
                                        </div>
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
                                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                                    {activeSignals.map((sig) => {
                                      const activationTime = sig.activatedTs
                                        ? (() => {
                                            const d = new Date(sig.activatedTs);
                                            const h = d.getHours();
                                            const m = d.getMinutes();
                                            const ampm = h >= 12 ? "PM" : "AM";
                                            return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
                                          })()
                                        : null;
                                      const biasLabel = sig.bias ?? (sig.direction?.includes("down") ? "SELL" : "BUY");
                                      return (
                                        <div key={sig.id} className="px-2 py-2 rounded bg-amber-500/5 border border-amber-500/10 text-xs space-y-1.5" data-testid={`sim-active-${sig.id}`}>
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <span className="font-mono font-semibold">{sig.ticker}</span>
                                              <span className="text-muted-foreground">{sig.setupType}</span>
                                              <Badge variant="outline" className={`text-[9px] h-4 px-1 ${biasLabel === "SELL" ? "border-red-500/30 text-red-400" : "border-emerald-500/30 text-emerald-400"}`}>
                                                {biasLabel}
                                              </Badge>
                                              <span className="text-[9px] text-muted-foreground">{sig.tier}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              {activationTime && (
                                                <span className="text-[10px] text-amber-400 font-mono" data-testid={`text-activation-time-${sig.id}`}>
                                                  <Clock className="w-3 h-3 inline mr-0.5" />{activationTime}
                                                </span>
                                              )}
                                              {sig.entryPrice && <span className="font-mono text-muted-foreground">@${sig.entryPrice.toFixed(2)}</span>}
                                            </div>
                                          </div>
                                          {(sig.t1 || sig.stopPrice) && (
                                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground pl-1">
                                              {sig.stopPrice != null && (
                                                <span>Stop: <span className="text-red-400 font-mono">${sig.stopPrice.toFixed(2)}</span></span>
                                              )}
                                              {sig.t1 != null && (
                                                <span>T1: <span className="text-emerald-400 font-mono">${sig.t1.toFixed(2)}</span></span>
                                              )}
                                              {sig.t2 != null && (
                                                <span>T2: <span className="text-emerald-400 font-mono">${sig.t2.toFixed(2)}</span></span>
                                              )}
                                              {sig.riskReward != null && (
                                                <span>R:R <span className="text-blue-400 font-mono">{sig.riskReward.toFixed(1)}</span></span>
                                              )}
                                              {sig.magnetPrice != null && (
                                                <span>Magnet: <span className="text-violet-400 font-mono">${sig.magnetPrice.toFixed(2)}</span></span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-muted-foreground px-2">No active signals</p>
                                )}
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Today's Events
                                </div>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {activationDetails.map((a, i) => {
                                    const actTime = a.triggerTs
                                      ? (() => {
                                          const d = new Date(a.triggerTs);
                                          if (isNaN(d.getTime())) return null;
                                          const h = d.getHours();
                                          const m = d.getMinutes();
                                          const ampm = h >= 12 ? "PM" : "AM";
                                          return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
                                        })()
                                      : null;
                                    return (
                                      <div key={`act-${i}`} className="flex items-center justify-between px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/10 text-xs">
                                        <div className="flex items-center gap-2">
                                          {a.isBtod && <Star className="w-3 h-3 text-violet-400" />}
                                          <Zap className="w-3 h-3 text-amber-400" />
                                          <span className="font-mono">{a.ticker}/{a.setupType}</span>
                                          {actTime && <span className="text-[10px] text-amber-400/70 font-mono">{actTime}</span>}
                                        </div>
                                        <span className="text-muted-foreground">@${a.entryPrice.toFixed(2)}</span>
                                      </div>
                                    );
                                  })}
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

                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-blue-400">
                                <Target className="w-3.5 h-3.5" />
                                On Deck ({onDeckSignals.length})
                              </div>
                              {onDeckSignals.length > 0 ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs" data-testid="table-ondeck-signals">
                                    <thead>
                                      <tr className="border-b border-zinc-800 text-muted-foreground">
                                        <th className="text-left py-1.5 pr-2 font-medium">Ticker</th>
                                        <th className="text-left py-1.5 pr-2 font-medium">Setup</th>
                                        <th className="text-left py-1.5 pr-2 font-medium">Bias</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Magnet</th>
                                        <th className="text-center py-1.5 px-2 font-medium">QS</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Tier</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Option</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Strike</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Exp</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Bid/Ask</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Mark</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Delta</th>
                                        <th className="text-center py-1.5 px-2 font-medium">OI</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Tradable</th>
                                        <th className="text-center py-1.5 px-2 font-medium">Status</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {[...onDeckSignals].sort((a, b) => b.qualityScore - a.qualityScore).map((sig) => {
                                        const opt = sig.optionsJson as SimOptionsJson | null;
                                        const c = opt?.contract;
                                        return (
                                          <tr key={sig.id} className="border-b border-zinc-800/30" data-testid={`sim-ondeck-${sig.id}`}>
                                            <td className="py-1.5 pr-2 font-mono font-semibold">{sig.ticker}</td>
                                            <td className="py-1.5 pr-2 text-muted-foreground">{sig.setupType}</td>
                                            <td className="py-1.5 pr-2">
                                              <Badge variant="outline" className={`text-[9px] h-4 px-1 ${sig.direction?.includes("down") ? "border-red-500/30 text-red-400" : "border-emerald-500/30 text-emerald-400"}`}>
                                                {sig.direction?.includes("down") ? "SELL" : "BUY"}
                                              </Badge>
                                            </td>
                                            <td className="text-center py-1.5 px-2 font-mono text-muted-foreground">${sig.magnetPrice.toFixed(2)}</td>
                                            <td className="text-center py-1.5 px-2 font-semibold text-yellow-500">{sig.qualityScore}</td>
                                            <td className="text-center py-1.5 px-2 text-[10px] text-muted-foreground">{sig.tier}</td>
                                            <td className="text-center py-1.5 px-2 font-mono text-[10px]">
                                              {c ? (
                                                <span className={c.right === "C" ? "text-emerald-400" : "text-red-400"}>{c.right === "C" ? "Call" : "Put"}</span>
                                              ) : (
                                                <span className="text-zinc-600">—</span>
                                              )}
                                            </td>
                                            <td className="text-center py-1.5 px-2 font-mono text-[10px]">
                                              {c ? `$${c.strike.toFixed(0)}` : "—"}
                                            </td>
                                            <td className="text-center py-1.5 px-2 font-mono text-[10px] text-muted-foreground">
                                              {c?.expiration ?? "—"}
                                            </td>
                                            <td className="text-center py-1.5 px-2 font-mono text-[10px]">
                                              {c ? `${c.bid.toFixed(2)}/${c.ask.toFixed(2)}` : "—"}
                                            </td>
                                            <td className="text-center py-1.5 px-2 font-mono text-[10px] font-semibold">
                                              {c ? `$${c.mark.toFixed(2)}` : "—"}
                                            </td>
                                            <td className="text-center py-1.5 px-2 font-mono text-[10px]">
                                              {c?.delta != null ? c.delta.toFixed(2) : "—"}
                                            </td>
                                            <td className="text-center py-1.5 px-2 font-mono text-[10px]">
                                              {c?.openInterest != null ? c.openInterest.toLocaleString() : "—"}
                                            </td>
                                            <td className="text-center py-1.5 px-2">
                                              {opt ? (
                                                opt.tradable ? (
                                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">YES</span>
                                                ) : (
                                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                                                    {opt.checks?.reasonIfFail ?? "NO"}
                                                  </span>
                                                )
                                              ) : (
                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400">NO_DATA</span>
                                              )}
                                            </td>
                                            <td className="text-center py-1.5 px-2">
                                              <span className={`text-[9px] font-medium ${
                                                sig.status === "hit" ? "text-emerald-400" :
                                                sig.status === "miss" ? "text-red-400" :
                                                "text-muted-foreground"
                                              }`}>
                                                {sig.status === "hit" ? "HIT" : sig.status === "miss" ? "MISS" : "PENDING"}
                                              </span>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-[10px] text-muted-foreground px-2">No on-deck signals</p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-400">
                                <TrendingUp className="w-3.5 h-3.5" />
                                TradeSync API ({tradeSyncCalls?.length ?? 0})
                              </div>
                              {tradeSyncCalls && tradeSyncCalls.length > 0 ? (
                                <div className="space-y-3" data-testid="sim-tradesync-calls">
                                  {tradeSyncCalls.map((tc, i) => (
                                    <div key={`ts-${i}`} className="rounded bg-indigo-500/5 border border-indigo-500/10 text-xs overflow-hidden">
                                      <div className="px-3 py-2.5 space-y-2">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono font-semibold text-sm">{tc.ticker}</span>
                                            <span className="text-muted-foreground">{tc.setupType}</span>
                                            <Badge variant="outline" className={`text-[9px] h-4 px-1 ${tc.direction.includes("down") ? "border-red-500/30 text-red-400" : "border-emerald-500/30 text-emerald-400"}`}>
                                              {tc.direction.includes("down") ? "SELL" : "BUY"}
                                            </Badge>
                                            <div className="flex flex-wrap gap-1">
                                              {tc.instruments.map((inst) => (
                                                <Badge key={inst} variant="secondary" className="text-[8px] h-3.5 px-1">
                                                  {inst}
                                                </Badge>
                                              ))}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {tc.triggerTs && (
                                              <span className="text-[10px] text-indigo-400/70 font-mono">
                                                {(() => {
                                                  const d = new Date(tc.triggerTs);
                                                  if (isNaN(d.getTime())) return "";
                                                  const h = d.getHours();
                                                  const m = d.getMinutes();
                                                  const ampm = h >= 12 ? "PM" : "AM";
                                                  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
                                                })()}
                                              </span>
                                            )}
                                            {tc.outcome && tc.outcome !== "pending" ? (
                                              <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${
                                                tc.outcome === "hit" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                                "bg-red-500/10 text-red-400 border-red-500/20"
                                              }`}>
                                                {tc.outcome === "hit" ? "HIT" : "MISS"}
                                              </Badge>
                                            ) : (
                                              <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                                                {tc.status}
                                              </Badge>
                                            )}
                                          </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                                          <div className="px-2 py-1.5 rounded bg-zinc-800/50">
                                            <div className="text-[9px] text-muted-foreground mb-0.5">Entry</div>
                                            <div className="font-mono font-semibold">${tc.entryPrice.toFixed(2)}</div>
                                          </div>
                                          <div className="px-2 py-1.5 rounded bg-zinc-800/50">
                                            <div className="text-[9px] text-muted-foreground mb-0.5">Stop</div>
                                            <div className="font-mono font-semibold text-red-400">{tc.stopPrice ? `$${tc.stopPrice.toFixed(2)}` : "—"}</div>
                                          </div>
                                          <div className="px-2 py-1.5 rounded bg-zinc-800/50">
                                            <div className="text-[9px] text-muted-foreground mb-0.5">Target</div>
                                            <div className="font-mono font-semibold text-emerald-400">${tc.targetPrice.toFixed(2)}</div>
                                          </div>
                                        </div>
                                      </div>

                                      {tc.trackingResults && tc.trackingResults.length > 0 && (
                                        <div className="border-t border-indigo-500/10">
                                          <div className="px-3 py-2">
                                            <div className="text-[9px] font-medium text-indigo-400/70 uppercase tracking-wider mb-1.5">Tracking Results</div>
                                            <table className="w-full text-[11px]">
                                              <thead>
                                                <tr className="text-muted-foreground border-b border-zinc-800/50">
                                                  <th className="text-left py-1 pr-2 font-medium">Instrument</th>
                                                  <th className="text-left py-1 pr-2 font-medium">Type</th>
                                                  <th className="text-center py-1 px-1 font-medium">Result</th>
                                                  <th className="text-center py-1 px-1 font-medium">P/L %</th>
                                                  <th className="text-center py-1 px-1 font-medium">Days</th>
                                                  <th className="text-right py-1 pl-1 font-medium">Exit</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {tc.trackingResults.map((tr, j) => (
                                                  <tr key={j} className="border-b border-zinc-800/20">
                                                    <td className="py-1 pr-2 font-mono font-semibold">{tr.instrument}</td>
                                                    <td className="py-1 pr-2">
                                                      <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${tr.tradeType === "ten_percent" ? "bg-violet-500/20 text-violet-400" : "bg-blue-500/20 text-blue-400"}`}>
                                                        {tr.tradeType === "ten_percent" ? "10%" : "T1/T2"}
                                                      </span>
                                                    </td>
                                                    <td className="text-center py-1 px-1">
                                                      {tr.win ? (
                                                        <span className="text-emerald-400 font-semibold">WIN</span>
                                                      ) : (
                                                        <span className="text-red-400 font-semibold">LOSS</span>
                                                      )}
                                                    </td>
                                                    <td className={`text-center py-1 px-1 font-mono ${tr.profitPercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                      {tr.profitPercent >= 0 ? "+" : ""}{tr.profitPercent.toFixed(2)}%
                                                    </td>
                                                    <td className="text-center py-1 px-1 font-mono text-muted-foreground">{tr.durationDays}d</td>
                                                    <td className="text-right py-1 pl-1">
                                                      <span className={`text-[9px] px-1 py-0.5 rounded ${
                                                        tr.exitReason === "target_hit" ? "bg-emerald-500/15 text-emerald-400" :
                                                        tr.exitReason === "stop_loss" ? "bg-red-500/15 text-red-400" :
                                                        tr.exitReason === "milestone_then_stop" ? "bg-amber-500/15 text-amber-400" :
                                                        "bg-zinc-500/15 text-zinc-400"
                                                      }`}>
                                                        {tr.exitReason === "target_hit" ? "Target" :
                                                         tr.exitReason === "stop_loss" ? "Stopped" :
                                                         tr.exitReason === "milestone_then_stop" ? "Partial" :
                                                         "EOD"}
                                                      </span>
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                            {tc.trackingResults?.filter((r) => r.chartBars && r.chartBars.length > 0).map((tr, ci) => (
                                              <div key={ci} className="mt-2 border-t border-zinc-800/30 pt-2">
                                                <div className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                                                  {tr.instrument} {tr.tradeType === "ten_percent" ? "10%" : "T1/T2"} — 1m Chart
                                                </div>
                                                <TradeChart tr={tr} />
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[10px] text-muted-foreground px-2">No TradeSync calls this day</p>
                              )}
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
                <Tabs defaultValue="summary" className="space-y-3">
                  <TabsList className="h-8">
                    <TabsTrigger value="summary" className="text-xs h-7" data-testid="tab-sim-summary">Summary</TabsTrigger>
                    <TabsTrigger value="ts-calls" className="text-xs h-7" data-testid="tab-sim-ts-calls">
                      TradeSync Calls ({simFinalStats.totalTradeSyncCalls ?? 0})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="summary" className="space-y-3 mt-0">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
                      <Card>
                        <CardContent className="pt-3 pb-3 px-4 text-center">
                          <div className="text-xl font-bold text-indigo-400" data-testid="text-sim-tradesync">{simFinalStats.totalTradeSyncCalls ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground">
                            TS Calls ({simFinalStats.tradeSyncDays ?? 0}/{simFinalStats.totalDays} days)
                            {simFinalStats.tsWinRate != null && ` · ${(simFinalStats.tsWinRate * 100).toFixed(1)}% WR`}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {simFinalStats.instrumentTradeTypeStats && simFinalStats.instrumentTradeTypeStats.length > 0 && (
                      <Card className="border-zinc-800 bg-zinc-950/50">
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-400">
                              <TrendingUp className="w-3.5 h-3.5" />
                              TradeSync Instrument Breakdown
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              TS Active Days: <span className="text-indigo-400 font-semibold">{simFinalStats.tradeSyncDays}/{simFinalStats.totalDays}</span>
                              {" "}(<span className="text-indigo-400">{((simFinalStats.tradeSyncDayPct ?? 0) * 100).toFixed(1)}%</span>)
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs" data-testid="table-instrument-stats">
                              <thead>
                                <tr className="border-b border-zinc-800 text-muted-foreground">
                                  <th className="text-left py-1.5 pr-3 font-medium">Instrument</th>
                                  <th className="text-left py-1.5 pr-2 font-medium">Type</th>
                                  <th className="text-center py-1.5 px-2 font-medium">Trades</th>
                                  <th className="text-center py-1.5 px-2 font-medium">W/L</th>
                                  <th className="text-center py-1.5 px-2 font-medium">Win Rate</th>
                                  <th className="text-center py-1.5 px-2 font-medium">Avg P/L</th>
                                  <th className="text-center py-1.5 px-2 font-medium">Total P/L</th>
                                  <th className="text-center py-1.5 px-2 font-medium">Avg Days</th>
                                </tr>
                              </thead>
                              <tbody>
                                {simFinalStats.instrumentTradeTypeStats.map((is: any, idx: number) => {
                                  const prevInst = idx > 0 ? simFinalStats.instrumentTradeTypeStats[idx - 1]?.instrument : null;
                                  const showBorder = prevInst && prevInst !== is.instrument;
                                  return (
                                    <tr key={`${is.instrument}-${is.tradeType}`} className={`${showBorder ? "border-t border-zinc-700" : "border-b border-zinc-800/30"}`} data-testid={`row-instrument-${is.instrument}-${is.tradeType}`}>
                                      <td className="py-1.5 pr-3 font-mono font-semibold">
                                        {(prevInst !== is.instrument || idx === 0) ? is.instrument : ""}
                                      </td>
                                      <td className="py-1.5 pr-2">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${is.tradeType === "ten_percent" ? "bg-violet-500/20 text-violet-400" : "bg-blue-500/20 text-blue-400"}`}>
                                          {is.tradeType === "ten_percent" ? "10%" : "T1/T2"}
                                        </span>
                                      </td>
                                      <td className="text-center py-1.5 px-2">{is.totalTrades}</td>
                                      <td className="text-center py-1.5 px-2">
                                        <span className="text-emerald-400">{is.wins}W</span>
                                        <span className="text-muted-foreground">/</span>
                                        <span className="text-red-400">{is.losses}L</span>
                                      </td>
                                      <td className="text-center py-1.5 px-2">
                                        <span className={is.winRate >= 0.5 ? "text-emerald-400" : "text-red-400"}>
                                          {(is.winRate * 100).toFixed(1)}%
                                        </span>
                                      </td>
                                      <td className={`text-center py-1.5 px-2 font-mono ${is.avgProfitPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                        {is.avgProfitPct >= 0 ? "+" : ""}{is.avgProfitPct.toFixed(2)}%
                                      </td>
                                      <td className={`text-center py-1.5 px-2 font-mono font-semibold ${is.totalProfitPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                        {is.totalProfitPct >= 0 ? "+" : ""}{is.totalProfitPct.toFixed(2)}%
                                      </td>
                                      <td className="text-center py-1.5 px-2 text-muted-foreground font-mono">
                                        {is.avgDurationDays?.toFixed(1) ?? "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </TabsContent>

                  <TabsContent value="ts-calls" className="space-y-3 mt-0">
                    {(() => {
                      const allCalls = simDayResults.flatMap((day) =>
                        (day.tradeSyncCalls ?? []).map((tc: SimTradeSyncCall) => ({ ...tc, date: day.date }))
                      );
                      if (allCalls.length === 0) return (
                        <div className="border border-dashed rounded-lg p-8 text-center">
                          <TrendingUp className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                          <p className="text-sm text-muted-foreground">No TradeSync calls recorded</p>
                        </div>
                      );

                      const wins = allCalls.filter((c) => c.outcome === "hit").length;
                      const losses = allCalls.filter((c) => c.outcome === "miss").length;
                      const resolved = wins + losses;
                      const winRate = resolved > 0 ? wins / resolved : 0;

                      return (
                        <>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Card>
                              <CardContent className="pt-3 pb-3 px-4 text-center">
                                <div className="text-xl font-bold text-indigo-400">{allCalls.length}</div>
                                <div className="text-[10px] text-muted-foreground">Total TS Calls</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="pt-3 pb-3 px-4 text-center">
                                <div className="text-xl font-bold text-emerald-400">{wins}</div>
                                <div className="text-[10px] text-muted-foreground">Wins</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="pt-3 pb-3 px-4 text-center">
                                <div className="text-xl font-bold text-red-400">{losses}</div>
                                <div className="text-[10px] text-muted-foreground">Losses</div>
                              </CardContent>
                            </Card>
                            <Card>
                              <CardContent className="pt-3 pb-3 px-4 text-center">
                                <div className={`text-xl font-bold ${winRate >= 0.5 ? "text-emerald-400" : "text-red-400"}`}>{(winRate * 100).toFixed(1)}%</div>
                                <div className="text-[10px] text-muted-foreground">Win Rate</div>
                              </CardContent>
                            </Card>
                          </div>

                          <div className="space-y-3">
                            {allCalls.map((tc: any, i: number) => (
                              <div key={`ts-all-${i}`} className="rounded bg-indigo-500/5 border border-indigo-500/10 text-xs overflow-hidden" data-testid={`ts-call-${i}`}>
                                <div className="px-3 py-2.5 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-muted-foreground font-mono">{tc.date}</span>
                                      <span className="font-mono font-semibold text-sm">{tc.ticker}</span>
                                      <span className="text-muted-foreground">{tc.setupType}</span>
                                      <Badge variant="outline" className={`text-[9px] h-4 px-1 ${tc.direction?.includes("down") ? "border-red-500/30 text-red-400" : "border-emerald-500/30 text-emerald-400"}`}>
                                        {tc.direction?.includes("down") ? "SELL" : "BUY"}
                                      </Badge>
                                      <div className="flex flex-wrap gap-1">
                                        {(tc.instruments ?? []).map((inst: string) => (
                                          <Badge key={inst} variant="secondary" className="text-[8px] h-3.5 px-1">{inst}</Badge>
                                        ))}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {tc.triggerTs && (
                                        <span className="text-[10px] text-indigo-400/70 font-mono">
                                          {(() => {
                                            const d = new Date(tc.triggerTs);
                                            if (isNaN(d.getTime())) return "";
                                            const h = d.getHours(); const m = d.getMinutes();
                                            return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
                                          })()}
                                        </span>
                                      )}
                                      {tc.outcome && tc.outcome !== "pending" ? (
                                        <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${
                                          tc.outcome === "hit" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                          "bg-red-500/10 text-red-400 border-red-500/20"
                                        }`}>
                                          {tc.outcome === "hit" ? "HIT" : "MISS"}
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                                          {tc.status}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                                    <div className="px-2 py-1.5 rounded bg-zinc-800/50">
                                      <div className="text-[9px] text-muted-foreground mb-0.5">Entry</div>
                                      <div className="font-mono font-semibold">${tc.entryPrice?.toFixed(2)}</div>
                                    </div>
                                    <div className="px-2 py-1.5 rounded bg-zinc-800/50">
                                      <div className="text-[9px] text-muted-foreground mb-0.5">Stop</div>
                                      <div className="font-mono font-semibold text-red-400">{tc.stopPrice ? `$${tc.stopPrice.toFixed(2)}` : "—"}</div>
                                    </div>
                                    <div className="px-2 py-1.5 rounded bg-zinc-800/50">
                                      <div className="text-[9px] text-muted-foreground mb-0.5">Target</div>
                                      <div className="font-mono font-semibold text-emerald-400">${tc.targetPrice?.toFixed(2)}</div>
                                    </div>
                                  </div>
                                </div>

                                {tc.trackingResults && tc.trackingResults.length > 0 && (
                                  <div className="border-t border-indigo-500/10">
                                    <div className="px-3 py-2">
                                      <div className="text-[9px] font-medium text-indigo-400/70 uppercase tracking-wider mb-1.5">Tracking Results</div>
                                      <table className="w-full text-[11px]">
                                        <thead>
                                          <tr className="text-muted-foreground border-b border-zinc-800/50">
                                            <th className="text-left py-1 pr-2 font-medium">Instrument</th>
                                            <th className="text-left py-1 pr-2 font-medium">Type</th>
                                            <th className="text-center py-1 px-1 font-medium">Result</th>
                                            <th className="text-center py-1 px-1 font-medium">P/L %</th>
                                            <th className="text-center py-1 px-1 font-medium">Days</th>
                                            <th className="text-right py-1 pl-1 font-medium">Exit</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {tc.trackingResults.map((tr: SimTrackingResult, j: number) => (
                                            <tr key={j} className="border-b border-zinc-800/20">
                                              <td className="py-1 pr-2 font-mono font-semibold">{tr.instrument}</td>
                                              <td className="py-1 pr-2">
                                                <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${tr.tradeType === "ten_percent" ? "bg-violet-500/20 text-violet-400" : "bg-blue-500/20 text-blue-400"}`}>
                                                  {tr.tradeType === "ten_percent" ? "10%" : "T1/T2"}
                                                </span>
                                              </td>
                                              <td className="text-center py-1 px-1">
                                                {tr.win ? <span className="text-emerald-400 font-semibold">WIN</span> : <span className="text-red-400 font-semibold">LOSS</span>}
                                              </td>
                                              <td className={`text-center py-1 px-1 font-mono ${tr.profitPercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                {tr.profitPercent >= 0 ? "+" : ""}{tr.profitPercent.toFixed(2)}%
                                              </td>
                                              <td className="text-center py-1 px-1 font-mono text-muted-foreground">{tr.durationDays}d</td>
                                              <td className="text-right py-1 pl-1">
                                                <span className={`text-[9px] px-1 py-0.5 rounded ${
                                                  tr.exitReason === "target_hit" ? "bg-emerald-500/15 text-emerald-400" :
                                                  tr.exitReason === "stop_loss" ? "bg-red-500/15 text-red-400" :
                                                  tr.exitReason === "milestone_then_stop" ? "bg-amber-500/15 text-amber-400" :
                                                  "bg-zinc-500/15 text-zinc-400"
                                                }`}>
                                                  {tr.exitReason === "target_hit" ? "Target" :
                                                   tr.exitReason === "stop_loss" ? "Stopped" :
                                                   tr.exitReason === "milestone_then_stop" ? "Partial" : "EOD"}
                                                </span>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      {tc.trackingResults?.filter((r: SimTrackingResult) => r.chartBars && r.chartBars.length > 0).map((tr: SimTrackingResult, ci: number) => (
                                        <div key={ci} className="mt-2 border-t border-zinc-800/30 pt-2">
                                          <div className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                                            {tr.instrument} {tr.tradeType === "ten_percent" ? "10%" : "T1/T2"} — 1m Chart
                                          </div>
                                          <TradeChart tr={tr} />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </TabsContent>
                </Tabs>
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
