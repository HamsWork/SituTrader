import { useState, useEffect, useRef } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
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
  ThumbsUp,
  ThumbsDown,
  CircleDot,
  Play,
  Pen,
} from "lucide-react";
import { Link } from "wouter";
import type { Signal, TradePlan, SignalApi, SignalProfile, SetupExpectancy, OptionsData, OptionLive, InstrumentLive, LeveragedEtfSuggestion } from "@shared/schema";
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

function OptionsBadge({ signal }: { signal: SignalApi }) {
  const opts = signal.optionsJson as OptionsData | null | undefined;
  if (!opts || opts.mode !== "AUTO") return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        opts.tradable
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
      }`}
      data-testid={`badge-options-${signal.id}`}
    >
      {opts.tradable ? "Opt" : "No Opt"}
    </span>
  );
}

function OptionsPanel({ signal }: { signal: SignalApi }) {
  const opts = signal.optionsJson as OptionsData | null | undefined;
  if (!opts || opts.mode !== "AUTO") return null;
  const c = opts.candidate;
  const ch = opts.checks;
  const ol = signal.live?.optionLive;
  const isActive = signal.activationStatus === "ACTIVE";

  if (!opts.tradable) {
    return (
      <div className="rounded-md bg-amber-500/5 border border-amber-500/15 p-2 text-xs" data-testid={`panel-options-${signal.id}`}>
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <span className="font-semibold">Options:</span>
          <span>{ch?.reasonIfFail?.replace(/,/g, " · ") || "No tradable contract"}</span>
          {c && (
            <span className="text-muted-foreground ml-auto">
              Checked: {c.right === "C" ? "Call" : "Put"} {c.strike} ({c.dte}d)
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!c) return null;

  const liveBid = ol?.optionBidNow ?? ol?.bid ?? ch?.bid ?? null;
  const liveAsk = ol?.optionAskNow ?? ol?.ask ?? ch?.ask ?? null;
  const liveMid = ol?.optionMarkNow ?? ol?.mid ?? (liveBid != null && liveAsk != null ? Math.round((liveBid + liveAsk) / 2 * 100) / 100 : null);
  const liveOI = ol?.openInterest ?? ch?.openInterest ?? null;
  const liveVol = ol?.volume ?? null;
  const iv = ol?.impliedVol ?? null;
  const delta = ol?.delta ?? null;
  const entryMark = ol?.optionEntryMark ?? null;
  const changeAbs = ol?.optionChangeAbs ?? null;
  const changePct = ol?.optionChangePct ?? null;
  const isStale = ol?.stale ?? false;
  const spreadDollar = ol?.optionSpreadNow ?? (liveBid != null && liveAsk != null ? Math.round((liveAsk - liveBid) * 100) / 100 : null);

  const hasLivePnl = isActive && entryMark != null && liveMid != null;
  const isPositive = changeAbs != null && changeAbs >= 0;
  const changeColor = isPositive ? "text-emerald-500" : "text-red-500";

  const formatExpiry = (exp: string) => {
    if (exp.length === 8) return `${exp.slice(4, 6)}/${exp.slice(6, 8)}`;
    return exp;
  };

  const optBarRange = hasLivePnl ? (() => {
    const pctChange = (liveMid - entryMark) / entryMark;
    const scale = 0.50;
    const nowPct = 50 + (pctChange / scale) * 45;
    const clampedNow = Math.max(3, Math.min(97, nowPct));
    const fillL = Math.min(50, clampedNow);
    const fillW = Math.abs(clampedNow - 50);
    return { entryPct: 50, nowPct: clampedNow, fillL, fillW };
  })() : null;

  return (
    <div className={`rounded-md border p-2.5 space-y-2 ${hasLivePnl ? (isPositive ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20") : "bg-emerald-500/5 border-emerald-500/15"}`} data-testid={`panel-options-${signal.id}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {c.right === "C" ? "CALL" : "PUT"} ${c.strike} · {formatExpiry(c.expiry)} · {c.dte}d
          </span>
          {isStale && isActive && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-500 font-medium" data-testid={`badge-option-stale-${signal.id}`}>
              delayed
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasLivePnl && changeAbs != null && changePct != null && (
            <span className={`text-xs font-bold ${changeColor}`} data-testid={`text-option-change-${signal.id}`}>
              {changeAbs >= 0 ? "+" : ""}{changeAbs.toFixed(2)} ({changePct >= 0 ? "+" : ""}{changePct.toFixed(1)}%)
            </span>
          )}
          {liveMid != null && (
            <span className="text-sm font-bold" data-testid={`text-option-mid-${signal.id}`}>
              ${liveMid.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {hasLivePnl && optBarRange && (
        <div data-testid={`bar-option-progress-${signal.id}`}>
          <div className="relative h-2.5 rounded-full bg-muted">
            {optBarRange.fillW > 0 && (
              <div
                className={`absolute h-full rounded-full transition-all duration-300 ${isPositive ? "bg-emerald-400/50 dark:bg-emerald-500/40" : "bg-red-400/50 dark:bg-red-500/40"}`}
                style={{ left: `${optBarRange.fillL}%`, width: `${Math.min(optBarRange.fillW, 100 - optBarRange.fillL)}%` }}
              />
            )}
            <div
              className="absolute w-2 h-2 rounded-full bg-muted-foreground/80 border-2 border-background top-[1px] z-[2]"
              style={{ left: `${optBarRange.entryPct}%`, transform: "translateX(-50%)" }}
              title={`Entry: $${entryMark.toFixed(2)}`}
            />
            <div
              className={`absolute w-0.5 h-full z-[3] ${isPositive ? "bg-emerald-500" : "bg-red-500"}`}
              style={{ left: `${optBarRange.nowPct}%`, transform: "translateX(-50%)" }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span data-testid={`text-option-entry-${signal.id}`}>
              Entry <span className="font-semibold text-foreground">${entryMark.toFixed(2)}</span>
            </span>
            <span data-testid={`text-option-mark-${signal.id}`}>
              Now <span className={`font-semibold ${changeColor}`}>${liveMid.toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
        {liveBid != null && liveAsk != null && (
          <span data-testid={`text-option-ba-${signal.id}`}>
            <span className="font-semibold">${liveBid.toFixed(2)}</span>×<span className="font-semibold">${liveAsk.toFixed(2)}</span>
            {spreadDollar != null && (
              <span className={`ml-0.5 ${spreadDollar > 0.10 ? "text-amber-500" : ""}`}>
                (${spreadDollar.toFixed(2)})
              </span>
            )}
          </span>
        )}
        {liveOI != null && (
          <span data-testid={`text-option-oi-${signal.id}`}>
            OI: <span className="font-semibold">{liveOI.toLocaleString()}</span>
          </span>
        )}
        {liveVol != null && liveVol > 0 && (
          <span data-testid={`text-option-vol-${signal.id}`}>
            Vol: <span className="font-semibold">{liveVol.toLocaleString()}</span>
          </span>
        )}
        {delta != null && (
          <span data-testid={`text-option-delta-${signal.id}`}>
            Δ <span className="font-semibold">{delta.toFixed(2)}</span>
          </span>
        )}
        {iv != null && (
          <span data-testid={`text-option-iv-${signal.id}`}>
            IV <span className="font-semibold">{(iv * 100).toFixed(1)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}

function InstrumentPanel({ signal }: { signal: SignalApi }) {
  const isActive = signal.activationStatus === "ACTIVE";
  if (!isActive) return null;

  const letfSuggestion = signal.leveragedEtfJson as LeveragedEtfSuggestion | null;
  const instrType = signal.instrumentType ?? "OPTION";
  const instrLive = signal.instrumentLive;
  const opts = signal.optionsJson as OptionsData | null;
  const hasOptions = opts?.tradable && opts?.candidate;

  const instrumentMutation = useMutation({
    mutationFn: async ({ instrumentType, instrumentTicker }: { instrumentType: string; instrumentTicker: string | null }) => {
      await apiRequest("POST", `/api/signals/${signal.id}/instrument`, { instrumentType, instrumentTicker });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
    },
  });

  const validOptionTicker = opts?.candidate?.contractSymbol ?? null;

  const handleSwitch = (type: string) => {
    let ticker: string | null = null;
    if (type === "LEVERAGED_ETF" && letfSuggestion) {
      ticker = letfSuggestion.ticker;
    } else if (type === "OPTION" && validOptionTicker) {
      ticker = validOptionTicker;
    }
    instrumentMutation.mutate({ instrumentType: type, instrumentTicker: ticker });
  };

  const showLetfOption = !!letfSuggestion;

  return (
    <div className="flex items-center gap-1 text-[10px]" data-testid={`instrument-selector-${signal.id}`}>
      <span className="text-muted-foreground font-medium mr-0.5">Trade via:</span>
      {hasOptions && validOptionTicker && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleSwitch("OPTION")}
          className={`h-5 px-1.5 py-0 text-[10px] ${instrType === "OPTION" ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold" : "text-muted-foreground"}`}
          data-testid={`btn-instr-option-${signal.id}`}
        >
          Option
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleSwitch("SHARES")}
        className={`h-5 px-1.5 py-0 text-[10px] ${instrType === "SHARES" ? "bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold" : "text-muted-foreground"}`}
        data-testid={`btn-instr-shares-${signal.id}`}
      >
        Shares
      </Button>
      {showLetfOption && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleSwitch("LEVERAGED_ETF")}
          className={`h-5 px-1.5 py-0 text-[10px] ${instrType === "LEVERAGED_ETF" ? "bg-purple-500/20 text-purple-600 dark:text-purple-400 font-semibold" : "text-muted-foreground"}`}
          data-testid={`btn-instr-letf-${signal.id}`}
        >
          {letfSuggestion!.ticker} ({letfSuggestion!.leverage}x)
        </Button>
      )}
      {instrumentMutation.isPending && (
        <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}

function LetfLivePanel({ signal }: { signal: SignalApi }) {
  const instrLive = signal.instrumentLive;
  const letfSuggestion = signal.leveragedEtfJson as LeveragedEtfSuggestion | null;
  const isActive = signal.activationStatus === "ACTIVE";
  if (!isActive || !letfSuggestion) return null;

  const hasLivePnl = instrLive && instrLive.entryPrice != null && instrLive.priceNow != null;
  const isPositive = (instrLive?.changeAbs ?? 0) >= 0;
  const changeColor = isPositive ? "text-emerald-500" : "text-red-500";
  const panelBg = hasLivePnl
    ? (isPositive ? "bg-purple-500/5 border-purple-500/20" : "bg-red-500/5 border-red-500/20")
    : "bg-purple-500/5 border-purple-500/15";

  const barRange = hasLivePnl ? (() => {
    const entry = instrLive!.entryPrice!;
    const now = instrLive!.priceNow!;
    const pctChange = (now - entry) / entry;
    const scale = 0.15;
    const nowPct = 50 + (pctChange / scale) * 45;
    const clampedNow = Math.max(3, Math.min(97, nowPct));
    const fillL = Math.min(50, clampedNow);
    const fillW = Math.abs(clampedNow - 50);
    return { entryPct: 50, nowPct: clampedNow, fillL, fillW };
  })() : null;

  return (
    <div className={`rounded-md border p-2.5 space-y-2 ${panelBg}`} data-testid={`panel-letf-${signal.id}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-purple-600 dark:text-purple-400">
            {letfSuggestion.ticker} · {letfSuggestion.leverage}x {letfSuggestion.direction}
          </span>
          {instrLive?.stale && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-500 font-medium">delayed</span>
          )}
          {instrLive?.wideSpread && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/20 text-red-500 font-medium">wide spread</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasLivePnl && instrLive!.changeAbs != null && instrLive!.changePct != null && (
            <span className={`text-xs font-bold ${changeColor}`} data-testid={`text-letf-change-${signal.id}`}>
              {instrLive!.changeAbs >= 0 ? "+" : ""}{instrLive!.changeAbs.toFixed(2)} ({instrLive!.changePct >= 0 ? "+" : ""}{instrLive!.changePct.toFixed(1)}%)
            </span>
          )}
          {instrLive?.priceNow != null && (
            <span className="text-sm font-bold" data-testid={`text-letf-price-${signal.id}`}>
              ${instrLive.priceNow.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {hasLivePnl && barRange && (
        <div data-testid={`bar-letf-progress-${signal.id}`}>
          <div className="relative h-2.5 rounded-full bg-muted">
            {barRange.fillW > 0 && (
              <div
                className={`absolute h-full rounded-full transition-all duration-300 ${isPositive ? "bg-purple-400/50 dark:bg-purple-500/40" : "bg-red-400/50 dark:bg-red-500/40"}`}
                style={{ left: `${barRange.fillL}%`, width: `${Math.min(barRange.fillW, 100 - barRange.fillL)}%` }}
              />
            )}
            <div
              className="absolute w-2 h-2 rounded-full bg-muted-foreground/80 border-2 border-background top-[1px] z-[2]"
              style={{ left: `${barRange.entryPct}%`, transform: "translateX(-50%)" }}
              title={`Entry: $${instrLive!.entryPrice!.toFixed(2)}`}
            />
            <div
              className={`absolute w-0.5 h-full z-[3] ${isPositive ? "bg-purple-500" : "bg-red-500"}`}
              style={{ left: `${barRange.nowPct}%`, transform: "translateX(-50%)" }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span data-testid={`text-letf-entry-${signal.id}`}>
              Entry <span className="font-semibold text-foreground">${instrLive!.entryPrice!.toFixed(2)}</span>
            </span>
            <span data-testid={`text-letf-now-${signal.id}`}>
              Now <span className={`font-semibold ${changeColor}`}>${instrLive!.priceNow!.toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}

      {instrLive && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
          {instrLive.bid != null && instrLive.ask != null && (
            <span data-testid={`text-letf-bidask-${signal.id}`}>
              ${instrLive.bid.toFixed(2)}×${instrLive.ask.toFixed(2)}
              {instrLive.spread != null && (
                <span className="text-muted-foreground"> (${instrLive.spread.toFixed(2)})</span>
              )}
            </span>
          )}
          {instrLive.spreadPct != null && (
            <span>
              Spread: <span className={`font-semibold ${instrLive.spreadPct > 0.005 ? "text-amber-500" : ""}`}>{(instrLive.spreadPct * 100).toFixed(2)}%</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
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

  const keyPrices = [targetPrice, resolvedEntry, resolvedStop];
  if (currentPrice != null) keyPrices.push(currentPrice);
  const rawMin = Math.min(...keyPrices);
  const rawMax = Math.max(...keyPrices);
  const rawRange = rawMax - rawMin || 1;
  const pad = rawRange * 0.12;
  const priceMin = rawMin - pad;
  const priceMax = rawMax + pad;
  const range = priceMax - priceMin;

  const toPercent = (price: number) => Math.max(0, Math.min(100, ((price - priceMin) / range) * 100));

  const stopPct = toPercent(resolvedStop);
  const entryPct = toPercent(resolvedEntry);
  const targetPct = toPercent(targetPrice);

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
    <div data-testid={`progress-bar-${signal.id}`}>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">LOW</span>
        <span
          className={`text-[9px] font-semibold tracking-wide ${isSell ? "text-red-400" : "text-emerald-500"}`}
          data-testid={`label-profit-dir-${signal.id}`}
        >
          {isSell ? "← Profit" : "Profit →"}
        </span>
        <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider">HIGH</span>
      </div>

      {currentPct != null && currentPrice != null && (
        <div className="relative h-4 mb-0.5">
          <div
            className="absolute z-30"
            style={{
              left: `${currentPct}%`,
              transform:
                nowPillAnchor === "center" ? "translateX(-50%)" : nowPillAnchor === "right" ? "translateX(-90%)" : "translateX(-10%)",
              bottom: 0,
            }}
            data-testid={`marker-now-${signal.id}`}
          >
            <span
              className={`text-[9px] font-bold px-1.5 py-[2px] whitespace-nowrap leading-tight inline-flex items-center gap-0.5 shadow-sm ${
                beyondStop
                  ? "bg-red-700 text-white rounded animate-pulse"
                  : pastTarget
                    ? "bg-emerald-700 text-white rounded ring-1 ring-emerald-400"
                    : isWinning
                      ? "bg-emerald-700 text-white rounded"
                      : "bg-red-600 text-white rounded"
              }`}
              data-testid={`text-now-price-${signal.id}`}
            >
              {pastTarget && "✓ "}
              {currentPrice.toFixed(2)}
              {delta != null && <span className="opacity-80 ml-0.5">({delta >= 0 ? "+" : ""}{delta.toFixed(2)})</span>}
              {currentClamped && " ⚠"}
            </span>
          </div>
        </div>
      )}

      <div className="relative h-3 rounded-full bg-muted">
        {progressFillLeft != null && progressFillWidth != null && progressFillWidth > 0 && (
          <div
            className={`absolute h-full rounded-full transition-all duration-300 ${
              isWinning ? "bg-emerald-400/50 dark:bg-emerald-500/40" : "bg-red-400/50 dark:bg-red-500/40"
            }`}
            style={{ left: `${progressFillLeft}%`, width: `${Math.min(progressFillWidth, 100 - progressFillLeft)}%` }}
            data-testid={`fill-progress-${signal.id}`}
          />
        )}

        <div
          className="absolute w-1.5 h-full rounded-sm bg-red-400/70 dark:bg-red-400/60 z-[1]"
          style={{ left: `${stopPct}%`, transform: "translateX(-50%)" }}
          title={`Stop: ${resolvedStop.toFixed(2)}`}
          data-testid={`marker-stop-${signal.id}`}
        />

        <div
          className="absolute w-2.5 h-2.5 rounded-full bg-muted-foreground/80 border-2 border-background top-[1px] z-[2]"
          style={{ left: `${entryPct}%`, transform: "translateX(-50%)" }}
          title={`Entry: ${resolvedEntry.toFixed(2)}`}
          data-testid={`marker-entry-${signal.id}`}
        />

        <div
          className={`absolute w-2.5 h-2.5 rounded-full top-[1px] border-2 border-background z-[2] ${isSell ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ left: `${targetPct}%`, transform: "translateX(-50%)" }}
          title={`T1: ${targetPrice.toFixed(2)}`}
          data-testid={`marker-target-${signal.id}`}
        />

        {currentPct != null && (
          <div
            className={`absolute w-0.5 h-full z-[3] ${beyondStop ? "bg-red-500" : isWinning ? "bg-emerald-500" : "bg-amber-500"}`}
            style={{ left: `${currentPct}%`, transform: "translateX(-50%)" }}
          />
        )}
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground px-0.5 mt-1">
        {isSell ? (
          <>
            <span title={`T1: ${targetPrice.toFixed(2)}`}>T1 {targetPrice.toFixed(2)} <span className="text-emerald-500/70">(Reward)</span></span>
            <span title={`Entry: ${resolvedEntry.toFixed(2)}`}>Entry {resolvedEntry.toFixed(2)}</span>
            <span title={`Stop: ${resolvedStop.toFixed(2)}`}>Stop {resolvedStop.toFixed(2)} <span className="text-red-400/70">(Risk)</span></span>
          </>
        ) : (
          <>
            <span title={`Stop: ${resolvedStop.toFixed(2)}`}>Stop {resolvedStop.toFixed(2)} <span className="text-red-400/70">(Risk)</span></span>
            <span title={`Entry: ${resolvedEntry.toFixed(2)}`}>Entry {resolvedEntry.toFixed(2)}</span>
            <span title={`T1: ${targetPrice.toFixed(2)}`}>T1 {targetPrice.toFixed(2)} <span className="text-emerald-500/70">(Reward)</span></span>
          </>
        )}
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

function getTradeHealth(signal: SignalApi): { state: "good" | "neutral" | "bad"; title: string; Icon: typeof ThumbsUp | typeof ThumbsDown | typeof CircleDot; className: string } {
  const tp = signal.tradePlanJson as TradePlan | null;
  const isSell = tp?.bias === "SELL" || (!tp && (signal.direction.toLowerCase().includes("down") || signal.direction === "SELL"));
  const rNow = signal.live?.rNow ?? null;
  const progress = signal.live?.progressToTarget ?? null;
  const currentPrice = signal.live?.currentPrice ?? null;
  const stopPrice = signal.stopPrice ?? null;

  const beyondStop = currentPrice != null && stopPrice != null && (
    (isSell && currentPrice > stopPrice) || (!isSell && currentPrice < stopPrice)
  );

  if (beyondStop || (rNow != null && rNow <= -0.25)) {
    return { state: "bad", title: "Trade Health: Bad", Icon: ThumbsDown, className: "bg-red-500/10 text-red-500" };
  }
  if (rNow != null && rNow >= 0.25 && progress != null && progress >= 0.25) {
    return { state: "good", title: "Trade Health: Good", Icon: ThumbsUp, className: "bg-emerald-500/10 text-emerald-500" };
  }
  return { state: "neutral", title: "Trade Health: Neutral", Icon: CircleDot, className: "bg-yellow-500/10 text-yellow-500" };
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
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-1 text-lg font-bold ${biasColor}`}>
              {isBuy ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
              <span data-testid={`text-bias-${signal.id}`}>{biasLabel}</span>
            </div>
            <Link href={`/symbol/${signal.ticker}`}>
              <span className="text-base font-bold cursor-pointer" data-testid={`text-ticker-${signal.id}`}>
                {signal.ticker}
              </span>
            </Link>
            {getTierBadge(signal.tier)}
            <OptionsBadge signal={signal} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-bold ${getQualityColor(signal.qualityScore)}`} data-testid={`text-quality-${signal.id}`}>
              Q{signal.qualityScore}
            </span>
            {(() => {
              const health = getTradeHealth(signal);
              return (
                <span
                  className={`inline-flex items-center justify-center rounded-full p-1 ${health.className}`}
                  title={health.title}
                  data-testid={`trade-health-${signal.id}`}
                >
                  <health.Icon className="w-4 h-4" />
                </span>
              );
            })()}
            <Link href={`/symbol/${signal.ticker}`}>
              <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-view-signal-${signal.id}`}>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {(() => {
          const rNow = live?.rNow;
          const stockPositive = rNow != null ? rNow >= 0 : true;
          const stockBg = stockPositive ? "bg-emerald-500/5 border-emerald-500/20" : "bg-red-500/5 border-red-500/20";
          return (
            <div className={`rounded-md border p-2.5 space-y-2 ${stockBg}`} data-testid={`panel-stock-${signal.id}`}>
              {live?.currentPrice != null ? (
                <div className="flex items-center justify-between gap-2 flex-wrap text-xs" data-testid={`live-strip-${signal.id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm" data-testid={`text-current-${signal.id}`}>
                      ${live.currentPrice.toFixed(2)}
                    </span>
                    {rNow != null && (
                      <span className={`font-semibold ${rNow >= 0 ? "text-emerald-500" : "text-red-500"}`} data-testid={`text-rnow-${signal.id}`}>
                        {rNow.toFixed(2)}R
                      </span>
                    )}
                    <span className="text-muted-foreground" data-testid={`text-progress-${signal.id}`}>
                      {Math.round(live.progressToTarget * 100)}% to target
                    </span>
                    {live.activeMinutes != null && (
                      <span className="text-muted-foreground" data-testid={`text-active-min-${signal.id}`}>
                        {live.activeMinutes}m active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {live.distToTargetAtr != null && (
                      <span data-testid={`text-to-t1-${signal.id}`}>
                        T1: {live.distToTargetAtr.toFixed(1)} ATR
                      </span>
                    )}
                    {live.distToStopAtr != null && (
                      <span data-testid={`text-to-stop-${signal.id}`}>
                        Stop: {live.distToStopAtr.toFixed(1)} ATR
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground" data-testid={`badge-live-unavailable-${signal.id}`}>
                  Live price unavailable
                </div>
              )}

              {signal.activationStatus === "ACTIVE" && (signal.entryPriceAtActivation == null || signal.stopPrice == null) ? (
                <Badge variant="outline" className="text-[10px] text-muted-foreground" data-testid={`badge-incomplete-${signal.id}`}>
                  Live trade data incomplete
                </Badge>
              ) : (
                <ProgressBar signal={signal} currentPrice={live?.currentPrice} />
              )}
            </div>
          );
        })()}

        <OptionsPanel signal={signal} />

        <LetfLivePanel signal={signal} />

        <InstrumentPanel signal={signal} />

        <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
          {signal.activatedTs && (
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {new Date(signal.activatedTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ET
            </span>
          )}
          {signal.pHit60 != null && (
            <span data-testid={`text-early-hit-${signal.id}`}>
              p60 <span className={`font-semibold ${getProbColor(signal.pHit60)}`}>{(signal.pHit60 * 100).toFixed(0)}%</span>
            </span>
          )}
          {signal.pHit390 != null && (
            <span data-testid={`text-same-day-${signal.id}`}>
              p390 <span className={`font-semibold ${getProbColor(signal.pHit390)}`}>{(signal.pHit390 * 100).toFixed(0)}%</span>
            </span>
          )}
          {paceLabel && (
            <Badge
              variant="outline"
              className={`text-[9px] py-0 ${paceLabel === "On pace" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : "bg-amber-500/10 text-amber-600 border-amber-500/20"}`}
              data-testid={`badge-pace-${signal.id}`}
            >
              {paceLabel}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function OnDeckCard({ signal }: { signal: SignalApi }) {
  const tp = signal.tradePlanJson as TradePlan | null;
  const isBuy = tp?.bias === "BUY" || (!tp && !signal.direction.toLowerCase().includes("down") && signal.direction !== "SELL");
  const biasLabel = isBuy ? "BUY" : "SELL";
  const biasColor = isBuy ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";

  const P = signal.live?.currentPrice ?? null;
  const trig = signal.entryTriggerPrice ?? null;
  const t1 = tp?.t1 ?? signal.magnetPrice;
  const stop = signal.stopPrice ?? null;

  const distToTrigger =
    P != null && trig != null
      ? (isBuy ? (trig - P) : (P - trig))
      : null;

  const rrToT1 =
    trig != null && stop != null
      ? (isBuy ? ((t1 - trig) / (trig - stop)) : ((trig - t1) / (stop - trig)))
      : null;

  const isNearTrigger = distToTrigger != null && distToTrigger <= 0.20;

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
            <OptionsBadge signal={signal} />
          </div>
          <span className={`text-xs font-bold ${getQualityColor(signal.qualityScore)}`} data-testid={`text-quality-${signal.id}`}>
            Q{signal.qualityScore}
          </span>
        </div>

        <div className="rounded-md bg-muted/50 p-2 font-mono text-xs" data-testid={`text-one-line-${signal.id}`}>
          {oneLinePlan(signal) || `${biasLabel} bias → magnet ${signal.magnetPrice.toFixed(2)}`}
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap rounded-md bg-muted/40 p-2">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            {P != null ? (
              <span className="font-semibold" data-testid={`text-current-${signal.id}`}>
                Current: {P.toFixed(2)}
              </span>
            ) : (
              <span className="text-muted-foreground">Current: —</span>
            )}

            {trig != null ? (
              <span className="text-muted-foreground" data-testid={`text-trig-${signal.id}`}>
                Trigger: <span className="font-semibold">{trig.toFixed(2)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Trigger: —</span>
            )}

            {distToTrigger != null ? (
              <span className="text-muted-foreground" data-testid={`text-dist-trigger-${signal.id}`}>
                To Trigger:{" "}
                <span className={`font-semibold ${isNearTrigger ? "text-amber-500" : ""}`}>
                  {distToTrigger >= 0 ? distToTrigger.toFixed(2) : "0.00"}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">To Trigger: —</span>
            )}

            {rrToT1 != null && Number.isFinite(rrToT1) ? (
              <span className="text-muted-foreground" data-testid={`text-rr-${signal.id}`}>
                RR to T1: <span className="font-semibold">{rrToT1.toFixed(2)}R</span>
              </span>
            ) : (
              <span className="text-muted-foreground">RR to T1: —</span>
            )}
          </div>

          {isNearTrigger && (
            <Badge className="text-[10px]" variant="secondary" data-testid={`badge-near-trigger-${signal.id}`}>
              Near Trigger
            </Badge>
          )}
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

        <OptionsPanel signal={signal} />

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
  const [showAll, setShowAll] = useState(false);
  const [q80Only, setQ80Only] = useState(false);

  const { data: profiles } = useQuery<SignalProfile[]>({
    queryKey: ["/api/profiles"],
  });

  const { data: activeProfile } = useQuery<SignalProfile | null>({
    queryKey: ["/api/profiles/active"],
  });

  const { data: setupStats } = useQuery<SetupExpectancy[]>({
    queryKey: ["/api/setup-stats"],
  });

  const activateProfile = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/profiles/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/profiles/active"] });
      toast({ title: "Profile activated" });
    },
  });

  const { data: signals, isLoading: signalsLoading } = useQuery<SignalApi[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 30000,
  });

  const letfPopulatedRef = useRef(false);
  useEffect(() => {
    if (!signals || letfPopulatedRef.current) return;
    const needLetf = signals.filter(s =>
      (s.status === "pending" || s.status === "active") && !s.leveragedEtfJson
    );
    if (needLetf.length > 0) {
      letfPopulatedRef.current = true;
      apiRequest("POST", "/api/signals/batch-letf")
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/signals"] }))
        .catch(() => {});
    }
  }, [signals]);

  const statsProfileParam = showAll ? "all" : (activeProfile?.id ?? "all");
  const { data: stats, isLoading: statsLoading } = useQuery<{
    activeCount: number;
    hitRate60d: number;
    hits60d: number;
    misses60d: number;
    totalSignals: number;
    lastRefresh: string | null;
    hitRateBySetup: Record<string, { hits: number; total: number; rate: number }>;
    topSignalsToday: Signal[];
  }>({
    queryKey: ["/api/stats", statsProfileParam],
    queryFn: () => fetch(`/api/stats?profileId=${statsProfileParam}`).then(r => r.json()),
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
    mutationFn: () => apiRequest("POST", "/api/scheduler/run", { job: "autoNow" }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/state"] });
      toast({ title: "Data refreshed", description: `${data.job} scan complete (${data.summary?.durationMs ?? 0}ms)` });
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

  const { data: schedulerState } = useQuery<{
    authorModeEnabled: boolean;
    lastAfterCloseRunTs: string | null;
    lastPreOpenRunTs: string | null;
    lastLiveMonitorRunTs: string | null;
    lastRunSummaryJson: any;
    nextAfterCloseTs: string;
    nextPreOpenTs: string;
    nowCT: string;
    liveStatus: "Running" | "Idle";
  }>({
    queryKey: ["/api/scheduler/state"],
    refetchInterval: 30000,
  });

  const schedulerToggle = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("POST", "/api/scheduler/toggle", { authorModeEnabled: enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/state"] });
    },
  });

  const schedulerRun = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scheduler/run", { job: "autoNow" }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/scheduler/state"] });
      toast({ title: `${data.job} scan complete`, description: `Duration: ${data.summary?.durationMs ?? 0}ms` });
    },
    onError: (error: Error) => {
      toast({ title: "Job run failed", description: error.message, variant: "destructive" });
    },
  });

  const allSignals = signals ?? [];
  const dateFilter = getDateRange(timeRange);

  const matchesDate = (targetDate: string) => {
    if (!dateFilter) return true;
    if (dateFilter.type === "exact") return targetDate === dateFilter.date;
    return targetDate >= dateFilter.date;
  };

  const distToTrigger = (s: SignalApi) => {
    const stp = s.tradePlanJson as TradePlan | null;
    const isBuy = stp?.bias === "BUY" || (!stp && !s.direction.toLowerCase().includes("down") && s.direction !== "SELL");
    const P = s.live?.currentPrice;
    const trig = s.entryTriggerPrice;
    if (P == null || trig == null) return Number.POSITIVE_INFINITY;
    return isBuy ? (trig - P) : (P - trig);
  };

  const overallStats = (setupStats ?? []).filter(s => s.ticker === null);
  const statsMap = new Map(overallStats.map(s => [s.setupType, s]));

  const passesProfile = (s: SignalApi, profile: SignalProfile | null | undefined): boolean => {
    if (!profile) return true;
    if (!profile.allowedSetups.includes(s.setupType)) return false;
    const tierRank = TIER_ORDER[s.tier] ?? 3;
    const minTierRank = TIER_ORDER[profile.minTier] ?? 3;
    if (tierRank > minTierRank) return false;
    if (s.qualityScore < profile.minQualityScore) return false;
    const stat = statsMap.get(s.setupType);
    if (stat) {
      if (profile.minSampleSize > 0 && stat.sampleSize < profile.minSampleSize) return false;
      if (profile.minHitRate > 0 && stat.winRate < profile.minHitRate) return false;
      if (profile.minExpectancyR > 0 && stat.expectancyR < profile.minExpectancyR) return false;
    } else if (profile.minSampleSize > 0 || profile.minHitRate > 0 || profile.minExpectancyR > 0) {
      return false;
    }
    return true;
  };

  const pendingSignals = allSignals
    .filter(s => s.status === "pending")
    .filter(s => timeRange === "today" || matchesDate(s.targetDate))
    .sort((a, b) => {
      const tierDiff = (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
      if (tierDiff !== 0) return tierDiff;
      const qualDiff = b.qualityScore - a.qualityScore;
      if (qualDiff !== 0) return qualDiff;
      return distToTrigger(a) - distToTrigger(b);
    });

  const qFilter = (s: SignalApi) => !q80Only || s.qualityScore >= 80;

  const allActiveSignals = allSignals.filter(s => s.status === "pending" && s.activationStatus === "ACTIVE");
  const tradeNowSignals = (showAll ? allActiveSignals : allActiveSignals.filter(s => passesProfile(s, activeProfile)))
    .filter(qFilter)
    .sort((a, b) => {
      const tierDiff = (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
      if (tierDiff !== 0) return tierDiff;
      const qualDiff = b.qualityScore - a.qualityScore;
      if (qualDiff !== 0) return qualDiff;
      return distToTrigger(a) - distToTrigger(b);
    });
  const hiddenActiveByProfile = allActiveSignals.length - tradeNowSignals.length;
  const filteredPending = (showAll ? pendingSignals : pendingSignals.filter(s => passesProfile(s, activeProfile))).filter(qFilter);
  const onDeckSignals = filteredPending.filter(s => s.activationStatus !== "ACTIVE");
  const hiddenByProfile = pendingSignals.filter(s => s.activationStatus !== "ACTIVE").length - onDeckSignals.length;

  const getEffectiveStatus = (s: Signal) => {
    if (s.activationStatus === "INVALIDATED") return "invalidated";
    return s.status;
  };

  const resolvedSignals = allSignals
    .filter(s => s.status !== "pending" || s.activationStatus === "INVALIDATED")
    .filter(s => !showAll ? passesProfile(s, activeProfile) : true)
    .filter(qFilter)
    .filter(s => filterTier === "all" || s.tier === filterTier)
    .filter(s => filterSetup === "all" || s.setupType === filterSetup)
    .filter(s => filterTicker === "all" || s.ticker === filterTicker)
    .filter(s => {
      if (filterStatus === "all") return true;
      return getEffectiveStatus(s) === filterStatus;
    })
    .sort((a, b) => {
      const dateA = a.asofDate ?? a.targetDate;
      const dateB = b.asofDate ?? b.targetDate;
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      const tierDiff = (TIER_ORDER[a.tier] ?? 3) - (TIER_ORDER[b.tier] ?? 3);
      if (tierDiff !== 0) return tierDiff;
      return b.qualityScore - a.qualityScore;
    });

  const uniqueTickers = Array.from(new Set(allSignals.map(s => s.ticker))).sort();
  const hitCount60d = stats?.hits60d ?? 0;
  const missCount60d = stats?.misses60d ?? 0;
  const hitCountAll = stats?.hitRateBySetup
    ? Object.values(stats.hitRateBySetup).reduce((sum, d) => sum + d.hits, 0)
    : allSignals.filter(s => s.status === "hit").length;
  const missCountAll = stats?.hitRateBySetup
    ? Object.values(stats.hitRateBySetup).reduce((sum, d) => sum + (d.total - d.hits), 0)
    : allSignals.filter(s => s.status === "miss").length;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {tradeNowSignals.length > 0
                ? `${tradeNowSignals.length} activated trade${tradeNowSignals.length === 1 ? "" : "s"} ready to act on`
                : filteredPending.length > 0
                ? `${filteredPending.length} signal${filteredPending.length === 1 ? "" : "s"} on deck, awaiting entry triggers`
                : "Refresh data to scan for new setups"
              }
            </p>
          </div>
          {profiles && profiles.length > 0 && (
            <Select
              value={activeProfile?.id?.toString() ?? ""}
              onValueChange={(val) => activateProfile.mutate(parseInt(val, 10))}
            >
              <SelectTrigger className="w-[200px] h-8 text-xs" data-testid="select-profile">
                <Filter className="w-3 h-3 mr-1" />
                <SelectValue placeholder="Select profile" />
              </SelectTrigger>
              <SelectContent>
                {[...profiles].sort((a, b) => {
                  const tierRank: Record<string, number> = { "A+": 5, "A": 4, "B": 3, "C": 2 };
                  const aTier = tierRank[a.minTier] ?? 1;
                  const bTier = tierRank[b.minTier] ?? 1;
                  if (bTier !== aTier) return bTier - aTier;
                  if ((b.minQualityScore ?? 0) !== (a.minQualityScore ?? 0)) return (b.minQualityScore ?? 0) - (a.minQualityScore ?? 0);
                  return (b.minHitRate ?? 0) - (a.minHitRate ?? 0);
                }).map(p => (
                  <SelectItem key={p.id} value={p.id.toString()} data-testid={`option-profile-${p.id}`}>
                    {p.name} {p.isPinned ? "📌" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant={showAll ? "secondary" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setShowAll(!showAll)}
            data-testid="button-show-all"
          >
            <Eye className="w-3 h-3 mr-1" />
            {showAll ? "Showing All" : "Profile Active"}
            {!showAll && hiddenByProfile > 0 && (
              <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0">{hiddenByProfile} hidden</Badge>
            )}
          </Button>
          <Button
            variant={q80Only ? "secondary" : "ghost"}
            size="sm"
            className={`text-xs h-7 ${q80Only ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30" : ""}`}
            onClick={() => setQ80Only(!q80Only)}
            data-testid="button-q80-toggle"
          >
            Q80+
          </Button>
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
                {range === "today" ? "Active" : range === "week" ? "Week" : "All"}
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
            {refreshMutation.isPending ? "Refreshing..." : "Refresh (Manual)"}
          </Button>
          {schedulerState && (
            <Sheet>
              <SheetTrigger asChild>
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium cursor-pointer hover:bg-muted/60 transition-colors"
                  data-testid="button-author-mode-pill"
                >
                  <span className={`w-2 h-2 rounded-full ${schedulerState.liveStatus === "Running" ? "bg-emerald-500 animate-pulse" : "bg-gray-400"}`} />
                  <Pen className="w-3 h-3" />
                  <span>Author</span>
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[340px] sm:w-[380px]">
                <SheetHeader>
                  <SheetTitle>Author Mode</SheetTitle>
                  <SheetDescription>
                    Automated signal scanning and monitoring schedule.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Pen className="w-4 h-4 text-primary" />
                      <span className="font-medium text-sm">Author Mode</span>
                    </div>
                    <Switch
                      checked={schedulerState.authorModeEnabled}
                      onCheckedChange={(v) => schedulerToggle.mutate(v)}
                      data-testid="switch-author-mode"
                    />
                  </div>

                  {!schedulerState.authorModeEnabled && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
                      Author Mode is off. No scheduled scans will run.
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => schedulerRun.mutate()}
                    disabled={schedulerRun.isPending}
                    data-testid="button-run-now"
                  >
                    <Play className="w-4 h-4 mr-1.5" />
                    {schedulerRun.isPending ? "Running..." : "Run Now (Manual Override)"}
                  </Button>

                  <Separator />

                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Live Status</span>
                      <Badge variant={schedulerState.liveStatus === "Running" ? "default" : "secondary"} className="text-[10px]" data-testid="badge-live-status">
                        {schedulerState.liveStatus}
                      </Badge>
                    </div>

                    <Separator />

                    <div className="space-y-1.5">
                      <span className="font-medium text-muted-foreground">Schedule</span>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">After Close</span>
                        <span>3:10 PM CT</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pre-Open</span>
                        <span>8:20 AM CT</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Live Monitor</span>
                        <span>Every 60s (RTH)</span>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-1.5">
                      <span className="font-medium text-muted-foreground">Next Runs</span>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">After Close</span>
                        <span data-testid="text-next-after-close">{new Date(schedulerState.nextAfterCloseTs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pre-Open</span>
                        <span data-testid="text-next-pre-open">{new Date(schedulerState.nextPreOpenTs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-1.5">
                      <span className="font-medium text-muted-foreground">Last Runs</span>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">After Close</span>
                        <span data-testid="text-last-after-close">{schedulerState.lastAfterCloseRunTs ? new Date(schedulerState.lastAfterCloseRunTs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "Never"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pre-Open</span>
                        <span data-testid="text-last-pre-open">{schedulerState.lastPreOpenRunTs ? new Date(schedulerState.lastPreOpenRunTs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "Never"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Live Tick</span>
                        <span data-testid="text-last-live">{schedulerState.lastLiveMonitorRunTs ? new Date(schedulerState.lastLiveMonitorRunTs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "Never"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>

      {activeProfile && !showAll && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border text-xs text-muted-foreground" data-testid="banner-profile">
          <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          <span className="font-medium text-foreground">{activeProfile.name}</span>
          <span className="hidden sm:inline">—</span>
          <span className="hidden sm:inline">
            Setups {activeProfile.allowedSetups.join(",")}
            {activeProfile.minTier !== "C" && ` · Tier ${TIER_LABELS[activeProfile.minTier] ?? activeProfile.minTier}+`}
            {activeProfile.minQualityScore > 0 && ` · Q≥${activeProfile.minQualityScore}`}
            {activeProfile.minHitRate > 0 && ` · WR≥${(activeProfile.minHitRate * 100).toFixed(0)}%`}
            {activeProfile.minExpectancyR > 0 && ` · EV≥${activeProfile.minExpectancyR}R`}
            {activeProfile.minSampleSize > 0 && ` · N≥${activeProfile.minSampleSize}`}
          </span>
        </div>
      )}

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
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Profile Hit Rate
                </CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-stat-hit-rate">
                  {stats?.hitRate60d ? `${(stats.hitRate60d * 100).toFixed(1)}%` : "N/A"}
                </div>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                  {stats?.hitRate60d && stats.hitRate60d > 0.5 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                  {hitCount60d} hits / {missCount60d} misses
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Last 60 days · {showAll ? "all setups" : (activeProfile?.name ?? "all setups")}
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
          {hiddenActiveByProfile > 0 && !showAll && (
            <span className="text-xs text-muted-foreground">({hiddenActiveByProfile} hidden by profile)</span>
          )}
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
        ) : (() => {
          const isBuySignal = (s: SignalApi) => {
            const tp = s.tradePlanJson as TradePlan | null;
            return tp?.bias === "BUY" || (!tp && !s.direction.toLowerCase().includes("down") && s.direction !== "SELL");
          };
          const bullish = onDeckSignals
            .filter(s => isBuySignal(s))
            .sort((a, b) => b.qualityScore - a.qualityScore);
          const bearish = onDeckSignals
            .filter(s => !isBuySignal(s))
            .sort((a, b) => b.qualityScore - a.qualityScore);
          return (
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide" data-testid="text-bullish-header">Bullish</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{bullish.length}</Badge>
                </div>
                {bullish.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No bullish signals</p>
                ) : (
                  bullish.map(signal => (
                    <OnDeckCard key={signal.id} signal={signal} />
                  ))
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide" data-testid="text-bearish-header">Bearish</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{bearish.length}</Badge>
                </div>
                {bearish.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No bearish signals</p>
                ) : (
                  bearish.map(signal => (
                    <OnDeckCard key={signal.id} signal={signal} />
                  ))
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {stats?.hitRateBySetup && Object.keys(stats.hitRateBySetup).length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Setup Hit Rates <span className="font-normal text-muted-foreground/60">(all-time)</span></h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {Object.entries(stats.hitRateBySetup).sort(([a], [b]) => a.localeCompare(b)).map(([setup, data]) => (
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
