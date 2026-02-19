import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
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
  Activity,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Target,
  Zap,
  Clock,
  ArrowUpRight,
  Bell,
  Filter,
  Shield,
  Crosshair,
  Timer,
  ChevronDown,
  ChevronUp,
  Radio,
  Eye,
  Database,
} from "lucide-react";
import { Link } from "wouter";
import type { Signal, TradePlan, SignalApi } from "@shared/schema";
import { SETUP_LABELS, type SetupType, TIER_LABELS } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

function getTierBadge(tier: string) {
  const label = TIER_LABELS[tier] || tier;
  switch (tier) {
    case "APLUS":
      return <Badge className="bg-amber-500 text-white" data-testid={`badge-tier-${tier}`}>{label}</Badge>;
    case "A":
      return <Badge className="bg-emerald-600 text-white" data-testid={`badge-tier-${tier}`}>{label}</Badge>;
    case "B":
      return <Badge variant="secondary" data-testid={`badge-tier-${tier}`}>{label}</Badge>;
    default:
      return <Badge variant="outline" data-testid={`badge-tier-${tier}`}>{label}</Badge>;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "hit":
      return <Badge variant="default" className="bg-emerald-600 text-white" data-testid="badge-status-hit">Hit</Badge>;
    case "miss":
      return <Badge variant="secondary" className="bg-red-500/15 text-red-500 dark:text-red-400" data-testid="badge-status-miss">Miss</Badge>;
    case "invalidated":
      return <Badge variant="secondary" className="bg-orange-500/15 text-orange-500 dark:text-orange-400" data-testid="badge-status-invalidated">Invalidated</Badge>;
    default:
      return <Badge variant="outline" data-testid="badge-status-pending">Pending</Badge>;
  }
}

function getQualityColor(score: number): string {
  if (score >= 90) return "text-amber-500";
  if (score >= 80) return "text-emerald-500";
  if (score >= 70) return "text-chart-4";
  return "text-muted-foreground";
}

function getProbColor(p: number): string {
  if (p >= 0.7) return "text-emerald-500";
  if (p >= 0.5) return "text-chart-4";
  return "text-red-500 dark:text-red-400";
}

const TIER_ORDER: Record<string, number> = { APLUS: 0, A: 1, B: 2, C: 3 };

function oneLinePlan(signal: Signal): string {
  const tp = signal.tradePlanJson as TradePlan | null;
  if (!tp) return "";
  const biasLabel = tp.bias;
  const entryNum = signal.entryPriceAtActivation ?? signal.entryTriggerPrice ?? null;
  const stopNum = signal.stopPrice ?? null;
  const t1Num = tp.t1 ?? signal.magnetPrice;

  if (entryNum != null && stopNum != null) {
    return `${biasLabel} → entry $${entryNum.toFixed(2)} → stop $${stopNum.toFixed(2)} → T1 $${t1Num.toFixed(2)}`;
  }
  const earlyHit = signal.pHit60 != null ? `${(signal.pHit60 * 100).toFixed(0)}%` : "--";
  return `${biasLabel} → target $${t1Num.toFixed(2)} → Early Hit ${earlyHit}`;
}

function ProgressBar({ signal, currentPrice }: { signal: SignalApi; currentPrice?: number }) {
  const tp = signal.tradePlanJson as TradePlan | null;
  if (!tp) return null;

  const targetPrice = (tp.t1 ?? signal.magnetPrice);

  const entryPrice = signal.entryPriceAtActivation ?? null;
  const stopPrice = signal.stopPrice ?? null;
  if (signal.activationStatus === "ACTIVE" && (entryPrice == null || stopPrice == null)) return null;

  const resolvedEntry =
    entryPrice ??
    signal.entryTriggerPrice ??
    (tp.bias === "SELL"
      ? targetPrice + (tp.stopDistance ?? 0) * 2
      : targetPrice - (tp.stopDistance ?? 0) * 2);

  const resolvedStop =
    stopPrice ??
    (tp.bias === "SELL"
      ? resolvedEntry + (tp.stopDistance ?? 0)
      : resolvedEntry - (tp.stopDistance ?? 0));

  const isSell = tp.bias === "SELL";

  const priceMin = Math.min(targetPrice, resolvedEntry, resolvedStop);
  const priceMax = Math.max(targetPrice, resolvedEntry, resolvedStop);
  const range = priceMax - priceMin || 1;

  const toPercent = (price: number) => Math.max(0, Math.min(100, ((price - priceMin) / range) * 100));

  const entryPct = toPercent(resolvedEntry);
  const targetPct = toPercent(targetPrice);
  const stopPct = toPercent(resolvedStop);

  const rawCurrentPct = currentPrice != null ? ((currentPrice - priceMin) / range) * 100 : null;
  const currentPct = rawCurrentPct != null ? Math.max(0, Math.min(100, rawCurrentPct)) : null;
  const currentClamped = rawCurrentPct != null && (rawCurrentPct < 0 || rawCurrentPct > 100);

  const beyondStop = currentPrice != null && ((isSell && currentPrice > resolvedStop) || (!isSell && currentPrice < resolvedStop));
  const pastTarget = currentPrice != null && ((isSell && currentPrice < targetPrice) || (!isSell && currentPrice > targetPrice));

  const progressFillLeft = currentPct != null ? Math.min(entryPct, currentPct) : null;
  const progressFillWidth = currentPct != null ? Math.abs(currentPct - entryPct) : null;

  const isWinning =
    currentPrice != null && ((!isSell && currentPrice > resolvedEntry) || (isSell && currentPrice < resolvedEntry));

  const nowPillAnchor =
    currentPct != null ? (currentPct > 85 ? "right" : currentPct < 15 ? "left" : "center") : "center";

  const delta =
    currentPrice != null ? (isSell ? (resolvedEntry - currentPrice) : (currentPrice - resolvedEntry)) : null;

  return (
    <div className="space-y-0.5" data-testid={`progress-bar-${signal.id}`}>
      <div className="relative h-4 pt-5">
        {currentPct != null && currentPrice != null && (
          <div
            className="absolute z-30 flex flex-col items-center"
            style={{
              left: `${currentPct}%`,
              transform:
                nowPillAnchor === "center" ? "translateX(-50%)" : nowPillAnchor === "right" ? "translateX(-90%)" : "translateX(-10%)",
              top: 0,
            }}
            data-testid={`marker-now-${signal.id}`}
          >
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap leading-none ${
                beyondStop
                  ? "bg-red-500 text-white animate-pulse"
                  : pastTarget
                    ? "bg-emerald-500 text-white"
                    : isWinning
                      ? "bg-emerald-500/90 text-white"
                      : "bg-amber-500/90 text-white"
              }`}
              data-testid={`text-now-price-${signal.id}`}
            >
              NOW {currentPrice.toFixed(2)}
              {delta != null && ` (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`}
              {currentClamped && " ⚠"}
              {pastTarget && " Past T1"}
            </span>
            <div className={`w-0.5 h-2.5 ${beyondStop ? "bg-red-500" : isWinning ? "bg-emerald-500" : "bg-amber-500"}`} />
          </div>
        )}

        <div className="relative h-3 rounded-full bg-muted overflow-hidden">
          {progressFillLeft != null && progressFillWidth != null && progressFillWidth > 0 && (
            <div
              className={`absolute h-full rounded-full transition-all duration-300 ${
                isWinning ? "bg-emerald-400/50 dark:bg-emerald-500/40" : "bg-red-400/50 dark:bg-red-500/40"
              }`}
              style={{ left: `${progressFillLeft}%`, width: `${progressFillWidth}%` }}
              data-testid={`fill-progress-${signal.id}`}
            />
          )}

          <div
            className="absolute w-1.5 h-full rounded-sm bg-red-400/70 dark:bg-red-400/60"
            style={{ left: `${stopPct}%`, transform: "translateX(-50%)" }}
            title={`Stop: ${resolvedStop.toFixed(2)}`}
            data-testid={`marker-stop-${signal.id}`}
          />

          <div
            className="absolute w-2.5 h-2.5 rounded-full bg-muted-foreground/80 border-2 border-background top-[1px]"
            style={{ left: `${entryPct}%`, transform: "translateX(-50%)" }}
            title={`Entry: ${resolvedEntry.toFixed(2)}`}
            data-testid={`marker-entry-${signal.id}`}
          />

          <div
            className={`absolute w-2.5 h-2.5 rounded-full top-[1px] border-2 border-background ${isSell ? "bg-red-500" : "bg-emerald-500"}`}
            style={{ left: `${targetPct}%`, transform: "translateX(-50%)" }}
            title={`T1: ${targetPrice.toFixed(2)}`}
            data-testid={`marker-target-${signal.id}`}
          />

          {currentPct != null && (
            <div
              className={`absolute w-0.5 h-full z-20 ${beyondStop ? "bg-red-500" : isWinning ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ left: `${currentPct}%`, transform: "translateX(-50%)" }}
            />
          )}
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground px-0.5">
        <span title={`Stop: ${resolvedStop.toFixed(2)}`}>Stop {resolvedStop.toFixed(2)}</span>
        <span title={`Entry: ${resolvedEntry.toFixed(2)}`}>Entry {resolvedEntry.toFixed(2)}</span>
        <span title={`T1: ${targetPrice.toFixed(2)}`}>T1 {targetPrice.toFixed(2)}</span>
      </div>
    </div>
  );
}

function getPaceLabel(signal: SignalApi): string | null {
  const live = signal.live;
  if (!live || live.activeMinutes == null || live.progressToTarget == null) return null;
  if (live.activeMinutes <= 60 && live.progressToTarget >= 0.25) return "On pace";
  if (live.activeMinutes > 120 && live.progressToTarget < 0.15 && signal.pHit60 != null && signal.pHit60 >= 0.5) return "Late";
  return null;
}

function TradeNowCard({ signal }: { signal: SignalApi }) {
  const tp = signal.tradePlanJson as TradePlan | null;
  const isBuy = tp?.bias === "BUY" || (!tp && !signal.direction.toLowerCase().includes("down") && signal.direction !== "SELL");
  const biasLabel = isBuy ? "BUY" : "SELL";
  const biasColor = isBuy ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  const biasBg = isBuy ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30";
  const live = signal.live;
  const paceLabel = getPaceLabel(signal);

  return (
    <Card className={`border-2 ${biasBg}`} data-testid={`card-trade-now-${signal.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-1.5 text-xl font-bold ${biasColor}`}>
              {isBuy ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
              <span data-testid={`text-bias-${signal.id}`}>{biasLabel}</span>
            </div>
            <Link href={`/symbol/${signal.ticker}`}>
              <span className="text-lg font-bold cursor-pointer" data-testid={`text-ticker-${signal.id}`}>
                {signal.ticker}
              </span>
            </Link>
            {getTierBadge(signal.tier)}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${getQualityColor(signal.qualityScore)}`} data-testid={`text-quality-${signal.id}`}>
              Q{signal.qualityScore}
            </span>
            <Link href={`/symbol/${signal.ticker}`}>
              <Button variant="ghost" size="icon" data-testid={`button-view-signal-${signal.id}`}>
                <ArrowUpRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>

        {live?.currentPrice != null ? (
          <div className="flex items-center justify-between gap-2 flex-wrap rounded-md bg-muted/40 p-2" data-testid={`live-strip-${signal.id}`}>
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <span className="font-semibold" data-testid={`text-current-${signal.id}`}>
                Current: ${live.currentPrice.toFixed(2)}
              </span>
              {live.activeMinutes != null && (
                <span className="text-muted-foreground" data-testid={`text-active-min-${signal.id}`}>
                  Active: <span className="font-semibold">{live.activeMinutes}m</span>
                </span>
              )}
              {live.rNow != null && (
                <span className="text-muted-foreground" data-testid={`text-rnow-${signal.id}`}>
                  R Now:{" "}
                  <span className={`font-semibold ${live.rNow >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {live.rNow.toFixed(2)}R
                  </span>
                </span>
              )}
              <span className="text-muted-foreground" data-testid={`text-progress-${signal.id}`}>
                Progress: <span className="font-semibold">{Math.round(live.progressToTarget * 100)}%</span>
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {live.distToTargetAtr != null && (
                <span data-testid={`text-to-t1-${signal.id}`}>
                  To T1: <span className="font-semibold">{live.distToTargetAtr.toFixed(2)} ATR</span>
                </span>
              )}
              {live.distToStopAtr != null && (
                <span data-testid={`text-to-stop-${signal.id}`}>
                  To Stop: <span className="font-semibold">{live.distToStopAtr.toFixed(2)} ATR</span>
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground" data-testid={`badge-live-unavailable-${signal.id}`}>
            Live price unavailable
          </div>
        )}

        <div className="rounded-md bg-muted/50 p-2 font-mono text-xs" data-testid={`text-one-line-${signal.id}`}>
          {(() => {
            const entryNum = signal.entryPriceAtActivation ?? signal.entryTriggerPrice ?? null;
            const stopNum = signal.stopPrice ?? null;
            const t1Num = (tp?.t1 ?? signal.magnetPrice);
            return entryNum != null && stopNum != null
              ? `${biasLabel} → entry ${entryNum.toFixed(2)} → stop ${stopNum.toFixed(2)} → T1 ${t1Num.toFixed(2)}`
              : (oneLinePlan(signal) || `${biasLabel} → target ${signal.magnetPrice.toFixed(2)}`);
          })()}
        </div>

        <ProgressBar signal={signal} currentPrice={live?.currentPrice} />

        {tp && (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
            <div className="rounded-md bg-muted/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5 flex items-center gap-1">
                <Zap className="w-3 h-3" /> Entry
              </div>
              <p className="text-xs leading-relaxed" data-testid={`text-entry-${signal.id}`}>
                {signal.entryPriceAtActivation
                  ? `Activated at $${signal.entryPriceAtActivation.toFixed(2)}`
                  : tp.entryTrigger}
              </p>
            </div>
            <div className="rounded-md bg-muted/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Stop
              </div>
              <p className="text-xs leading-relaxed" data-testid={`text-stop-${signal.id}`}>
                {signal.stopPrice != null
                  ? `$${signal.stopPrice.toFixed(2)}`
                  : tp.invalidation}
              </p>
            </div>
            <div className="rounded-md bg-muted/50 p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5 flex items-center gap-1">
                <Target className="w-3 h-3" /> Targets
              </div>
              <p className="text-xs font-mono leading-relaxed" data-testid={`text-targets-${signal.id}`}>
                T1: ${tp.t1.toFixed(2)}
                {tp.t2 != null && <> / T2: ${tp.t2.toFixed(2)}</>}
                {tp.riskReward != null && (
                  <span className="text-muted-foreground"> ({tp.riskReward}R)</span>
                )}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
          {signal.pHit60 != null && (
            <div className="flex items-center gap-1" data-testid={`text-early-hit-${signal.id}`}>
              <Timer className="w-3 h-3" />
              <span>Early Hit: <span className={`font-semibold ${getProbColor(signal.pHit60)}`}>{(signal.pHit60 * 100).toFixed(0)}%</span></span>
            </div>
          )}
          {signal.pHit390 != null && (
            <div className="flex items-center gap-1" data-testid={`text-same-day-${signal.id}`}>
              <Timer className="w-3 h-3" />
              <span>Same-day Hit: <span className={`font-semibold ${getProbColor(signal.pHit390)}`}>{(signal.pHit390 * 100).toFixed(0)}%</span></span>
            </div>
          )}
          {paceLabel && (
            <Badge
              variant="outline"
              className={`text-[10px] ${paceLabel === "On pace" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-amber-500/10 text-amber-600 border-amber-500/20"}`}
              data-testid={`badge-pace-${signal.id}`}
            >
              {paceLabel}
            </Badge>
          )}
          {signal.activatedTs && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>
                Activated:{" "}
                {new Date(signal.activatedTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ET
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OnDeckCard({ signal }: { signal: Signal }) {
  const tp = signal.tradePlanJson as TradePlan | null;
  const isBuy = tp?.bias === "BUY" || (!tp && !signal.direction.toLowerCase().includes("down") && signal.direction !== "SELL");
  const biasLabel = isBuy ? "BUY" : "SELL";
  const biasColor = isBuy ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

  return (
    <Card data-testid={`card-on-deck-${signal.id}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-bold text-sm ${biasColor}`} data-testid={`text-bias-${signal.id}`}>
              {biasLabel}
            </span>
            <Link href={`/symbol/${signal.ticker}`}>
              <span className="font-semibold text-sm cursor-pointer">{signal.ticker}</span>
            </Link>
            {getTierBadge(signal.tier)}
            <Badge variant="outline" className="text-[10px]">
              {signal.setupType}: {SETUP_LABELS[signal.setupType as SetupType] ?? signal.setupType}
            </Badge>
          </div>
          <span className={`text-xs font-bold ${getQualityColor(signal.qualityScore)}`} data-testid={`text-quality-${signal.id}`}>
            Q{signal.qualityScore}
          </span>
        </div>

        <div className="rounded-md bg-muted/50 p-2 font-mono text-xs" data-testid={`text-one-line-${signal.id}`}>
          {oneLinePlan(signal) || `${biasLabel} bias → magnet $${signal.magnetPrice.toFixed(2)}`}
        </div>

        {tp && (
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 shrink-0" />
              <span>Trigger: {tp.entryTrigger}</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3 shrink-0" />
              <span>Invalidation: {tp.invalidation}</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{signal.targetDate}</span>
          </div>
          {signal.pHit60 != null && (
            <span>Early Hit: <span className={`font-semibold ${getProbColor(signal.pHit60)}`}>{(signal.pHit60 * 100).toFixed(0)}%</span></span>
          )}
          {signal.pHit390 != null && (
            <span>Same-day: <span className={`font-semibold ${getProbColor(signal.pHit390)}`}>{(signal.pHit390 * 100).toFixed(0)}%</span></span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function getDateRange(mode: string): { type: "exact" | "from"; date: string } | null {
  const now = new Date();
  if (mode === "today") return { type: "exact", date: now.toISOString().slice(0, 10) };
  if (mode === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { type: "from", date: d.toISOString().slice(0, 10) };
  }
  return null;
}

export default function Dashboard() {
  const { toast } = useToast();
  const [timeRange, setTimeRange] = useState<string>("today");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [filterSetup, setFilterSetup] = useState<string>("all");
  const [filterTicker, setFilterTicker] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showHistory, setShowHistory] = useState(false);

  const { data: signals, isLoading: signalsLoading } = useQuery<SignalApi[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 30000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<{
    activeCount: number;
    hitRate60d: number;
    totalSignals: number;
    lastRefresh: string | null;
    hitRateBySetup: Record<string, { hits: number; total: number; rate: number }>;
    topSignalsToday: Signal[];
  }>({
    queryKey: ["/api/stats"],
  });

  const { data: universeStatus } = useQuery<{
    lastRebuild: string | null;
    universeDate: string | null;
    memberCount: number;
    topTickers: { ticker: string; avgDollarVol20d: number; rank: number }[];
  }>({
    queryKey: ["/api/universe/status"],
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Data refreshed", description: "Market data and signals updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Refresh failed", description: error.message, variant: "destructive" });
    },
  });

  const activationMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/activation/scan"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Activation scan complete",
        description: `${data.events?.length ?? 0} activation events`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Activation scan failed", description: error.message, variant: "destructive" });
    },
  });

  const alertMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/alerts/run"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Alert scan complete",
        description: `${data.events?.length ?? 0} alert events generated`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Alert scan failed", description: error.message, variant: "destructive" });
    },
  });

  const allSignals = signals ?? [];
  const dateFilter = getDateRange(timeRange);

  const matchesDate = (targetDate: string) => {
    if (!dateFilter) return true;
    if (dateFilter.type === "exact") return targetDate === dateFilter.date;
    return targetDate >= dateFilter.date;
  };

  const pendingSignals = allSignals
    .filter(s => s.status === "pending")
    .filter(s => matchesDate(s.targetDate))
    .sort((a, b) => {
      const tierDiff = (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
      if (tierDiff !== 0) return tierDiff;
      return b.qualityScore - a.qualityScore;
    });

  const tradeNowSignals = pendingSignals.filter(s => s.activationStatus === "ACTIVE");
  const onDeckSignals = pendingSignals.filter(s => s.activationStatus === "NOT_ACTIVE");

  const getEffectiveStatus = (s: Signal) => {
    if (s.activationStatus === "INVALIDATED") return "invalidated";
    return s.status;
  };

  const resolvedSignals = allSignals
    .filter(s => s.status !== "pending" || s.activationStatus === "INVALIDATED")
    .filter(s => matchesDate(s.targetDate))
    .filter(s => filterTier === "all" || s.tier === filterTier)
    .filter(s => filterSetup === "all" || s.setupType === filterSetup)
    .filter(s => filterTicker === "all" || s.ticker === filterTicker)
    .filter(s => {
      if (filterStatus === "all") return true;
      return getEffectiveStatus(s) === filterStatus;
    })
    .sort((a, b) => {
      const tierDiff = (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
      if (tierDiff !== 0) return tierDiff;
      return b.qualityScore - a.qualityScore;
    });

  const uniqueTickers = Array.from(new Set(allSignals.map(s => s.ticker))).sort();
  const hitCount = allSignals.filter(s => s.status === "hit").length;
  const missCount = allSignals.filter(s => s.status === "miss").length;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {tradeNowSignals.length > 0
              ? `${tradeNowSignals.length} activated trade${tradeNowSignals.length === 1 ? "" : "s"} ready to act on`
              : pendingSignals.length > 0
              ? `${pendingSignals.length} signal${pendingSignals.length === 1 ? "" : "s"} on deck, awaiting entry triggers`
              : "Refresh data to scan for new setups"
            }
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-md border">
            {(["today", "week", "all"] as const).map(range => (
              <Button
                key={range}
                variant="ghost"
                size="sm"
                className={`rounded-none first:rounded-l-md last:rounded-r-md ${timeRange === range ? "bg-muted" : ""}`}
                onClick={() => setTimeRange(range)}
                data-testid={`button-range-${range}`}
              >
                {range === "today" ? "Today" : range === "week" ? "Week" : "All"}
              </Button>
            ))}
          </div>
          <Separator orientation="vertical" className="h-6" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => activationMutation.mutate()}
            disabled={activationMutation.isPending}
            data-testid="button-scan-triggers"
          >
            <Radio className={`w-4 h-4 mr-1.5 ${activationMutation.isPending ? "animate-pulse" : ""}`} />
            {activationMutation.isPending ? "Scanning..." : "Scan Triggers"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => alertMutation.mutate()}
            disabled={alertMutation.isPending}
            data-testid="button-run-alerts"
          >
            <Bell className={`w-4 h-4 mr-1.5 ${alertMutation.isPending ? "animate-pulse" : ""}`} />
            {alertMutation.isPending ? "Scanning..." : "Alerts"}
          </Button>
          <Button
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            data-testid="button-refresh-data"
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            {refreshMutation.isPending ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-16" /><Skeleton className="h-3 w-32 mt-2" /></CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Trade Now</CardTitle>
                <Radio className="h-4 w-4 text-amber-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-stat-trade-now">{tradeNowSignals.length}</div>
                <p className="text-xs text-muted-foreground mt-1">Entry triggers fired</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">On Deck</CardTitle>
                <Eye className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-stat-on-deck">{onDeckSignals.length}</div>
                <p className="text-xs text-muted-foreground mt-1">Awaiting entry triggers</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Hit Rate (60d)</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-stat-hit-rate">
                  {stats?.hitRate60d ? `${(stats.hitRate60d * 100).toFixed(1)}%` : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                  {stats?.hitRate60d && stats.hitRate60d > 0.5 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                  {hitCount} hits / {missCount} misses
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Last Refresh</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-stat-last-refresh">
                  {stats?.lastRefresh ? new Date(stats.lastRefresh).toLocaleTimeString() : "Never"}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.lastRefresh ? new Date(stats.lastRefresh).toLocaleDateString() : "Click refresh to start"}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {universeStatus && universeStatus.memberCount > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap" data-testid="text-universe-info">
          <div className="flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" />
            <span>Universe: {universeStatus.memberCount} tickers</span>
          </div>
          {universeStatus.lastRebuild && (
            <span>Updated {new Date(universeStatus.lastRebuild).toLocaleDateString()}</span>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Radio className="w-4 h-4 text-amber-500" />
          <h2 className="text-base font-semibold" data-testid="text-trade-now-title">Trade Now</h2>
          <Badge variant="outline">{tradeNowSignals.length}</Badge>
        </div>
        {signalsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-lg" />)}
          </div>
        ) : tradeNowSignals.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <Radio className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-medium" data-testid="text-no-trade-now">No activated trades</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click "Scan Triggers" to check if any entry conditions have fired
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tradeNowSignals.map(signal => (
              <TradeNowCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-semibold" data-testid="text-on-deck-title">On Deck</h2>
          <Badge variant="outline">{onDeckSignals.length}</Badge>
        </div>
        {signalsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
          </div>
        ) : onDeckSignals.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center">
              <Crosshair className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm font-medium" data-testid="text-no-on-deck">No pending signals</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click "Refresh" to pull market data and detect new setups
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
            {onDeckSignals.map(signal => (
              <OnDeckCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>

      {stats?.hitRateBySetup && Object.keys(stats.hitRateBySetup).length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Setup Hit Rates</h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {Object.entries(stats.hitRateBySetup).map(([setup, data]) => (
              <Card key={setup}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Setup {setup}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{data.total}</Badge>
                  </div>
                  <div className={`text-lg font-bold ${getProbColor(data.rate)}`}>
                    {(data.rate * 100).toFixed(0)}%
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {SETUP_LABELS[setup as SetupType] ?? setup}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-base">Done</CardTitle>
            <Badge variant="outline">{resolvedSignals.length}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            data-testid="button-toggle-history"
          >
            {showHistory ? "Hide" : "Show"}
            {showHistory ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
          </Button>
        </CardHeader>
        {showHistory && (
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Select value={filterTier} onValueChange={setFilterTier}>
                <SelectTrigger className="w-[120px]" data-testid="select-filter-tier">
                  <SelectValue placeholder="Tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tiers</SelectItem>
                  <SelectItem value="APLUS">A+</SelectItem>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="B">B</SelectItem>
                  <SelectItem value="C">C</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterSetup} onValueChange={setFilterSetup}>
                <SelectTrigger className="w-[120px]" data-testid="select-filter-setup">
                  <SelectValue placeholder="Setup" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Setups</SelectItem>
                  {(["F", "C", "D", "E", "A", "B"] as const).map(s => (
                    <SelectItem key={s} value={s}>{s}: {SETUP_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterTicker} onValueChange={setFilterTicker}>
                <SelectTrigger className="w-[120px]" data-testid="select-filter-ticker">
                  <SelectValue placeholder="Ticker" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tickers</SelectItem>
                  {uniqueTickers.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[130px]" data-testid="select-filter-status">
                  <SelectValue placeholder="Result" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Results</SelectItem>
                  <SelectItem value="hit">Hit Only</SelectItem>
                  <SelectItem value="miss">Miss Only</SelectItem>
                  <SelectItem value="invalidated">Invalidated</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {resolvedSignals.length === 0 ? (
              <div className="p-6 text-center">
                <Activity className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-history">No resolved signals</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Tier</TableHead>
                      <TableHead className="w-20">Ticker</TableHead>
                      <TableHead>Setup</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead className="text-right">Quality</TableHead>
                      <TableHead className="text-right">Early Hit</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resolvedSignals.map((signal) => (
                      <TableRow key={signal.id} data-testid={`row-signal-${signal.id}`}>
                        <TableCell>{getTierBadge(signal.tier)}</TableCell>
                        <TableCell className="font-medium">
                          <Link href={`/symbol/${signal.ticker}`}>
                            <span className="cursor-pointer">{signal.ticker}</span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">
                            {signal.setupType}: {SETUP_LABELS[signal.setupType as SetupType] ?? signal.setupType}
                          </span>
                        </TableCell>
                        <TableCell>
                          {signal.direction.toLowerCase().includes("down") || signal.direction === "SELL" ? (
                            <span className="flex items-center gap-1 text-red-500 dark:text-red-400 text-xs font-medium">
                              <TrendingDown className="w-3 h-3" /> Sell
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-emerald-500 text-xs font-medium">
                              <TrendingUp className="w-3 h-3" /> Buy
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">${signal.magnetPrice.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`font-bold ${getQualityColor(signal.qualityScore)}`}>{signal.qualityScore}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {signal.pHit60 != null ? `${(signal.pHit60 * 100).toFixed(0)}%` : <span className="text-muted-foreground">--</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{signal.targetDate}</TableCell>
                        <TableCell>{getStatusBadge(getEffectiveStatus(signal))}</TableCell>
                        <TableCell>
                          <Link href={`/symbol/${signal.ticker}`}>
                            <Button variant="ghost" size="icon" data-testid={`button-view-signal-${signal.id}`}>
                              <ArrowUpRight className="w-3 h-3" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
