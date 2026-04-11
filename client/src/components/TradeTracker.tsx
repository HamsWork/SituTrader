import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Shield,
  Radio,
  MessageSquare,
  Send,
  AlertTriangle,
} from "lucide-react";
import { SETUP_LABELS, type SetupType, TIER_LABELS } from "@shared/schema";
import { Link } from "wouter";

interface TradeItem {
  id: number;
  signalId: number;
  ticker: string;
  instrumentType: string;
  instrumentTicker: string | null;
  side: string;
  entryPrice: number | null;
  stopPrice: number | null;
  target1Price: number | null;
  target2Price: number | null;
  tp1FillPrice: number | null;
  tpHitLevel: number;
  status: string;
  discordAlertSent: boolean;
  discordChannel: string;
  tradesyncSent: boolean;
  tradesyncSentAt: string | null;
  createdAt: string;
  currentPrice: number | null;
}

interface SignalGroup {
  signal: {
    id: number;
    ticker: string;
    setupType: string;
    direction: string;
    tier: string;
    qualityScore: number;
    activatedTs: string | null;
    magnetPrice: number;
    entryPriceAtActivation: number | null;
  };
  trades: TradeItem[];
}

function getTierBadge(tier: string) {
  const label = TIER_LABELS[tier] || tier;
  switch (tier) {
    case "APLUS":
      return <Badge className="bg-amber-500 text-white">{label}</Badge>;
    case "A":
      return <Badge className="bg-emerald-600 text-white">{label}</Badge>;
    case "B":
      return <Badge variant="secondary">{label}</Badge>;
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "FILLED":
      return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px]">{status}</Badge>;
    case "SUBMITTED":
      return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 text-[10px]">{status}</Badge>;
    case "CLOSED":
      return <Badge className="bg-gray-500/15 text-gray-600 dark:text-gray-400 border border-gray-500/30 text-[10px]">{status}</Badge>;
    case "CANCELLED":
    case "ERROR":
      return <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px]">{status}</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

function getInstrumentLabel(type: string): string {
  switch (type) {
    case "SHARES": return "Shares";
    case "OPTION": return "Options";
    case "LEVERAGED_ETF": return "LETF";
    case "LETF_OPTIONS": return "LETF Opt";
    default: return type;
  }
}

function MilestoneBar({ entry, stop, t1, t2, tpHitLevel, side, currentPrice }: {
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  tpHitLevel: number;
  side: string;
  currentPrice: number | null;
}) {
  const isBuy = side === "BUY";
  const totalRange = Math.abs(t1 - entry);
  if (totalRange <= 0) return null;

  const targetLabel = tpHitLevel >= 1 ? "T2" : "T1";
  const activeTarget = tpHitLevel >= 1 ? t2 : t1;
  const activeRange = Math.abs(activeTarget - entry);

  const stopDist = Math.abs(stop - entry);
  const stopPct = activeRange > 0 ? Math.min((stopDist / activeRange) * 100, 40) : 20;

  let progress: number;
  if (tpHitLevel >= 2) {
    progress = 100;
  } else if (tpHitLevel >= 1 && currentPrice != null) {
    const t2Range = Math.abs(t2 - t1);
    const movedPastT1 = isBuy ? (currentPrice - t1) : (t1 - currentPrice);
    progress = t2Range > 0 ? Math.max(0, Math.min(100, (movedPastT1 / t2Range) * 100)) : 100;
  } else if (currentPrice != null) {
    const moved = isBuy ? (currentPrice - entry) : (entry - currentPrice);
    progress = activeRange > 0 ? Math.max(0, Math.min(100, (moved / activeRange) * 100)) : 0;
  } else {
    progress = 0;
  }

  const milestones = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const progressPctDisplay = Math.round(progress);

  return (
    <div className="w-full space-y-1" data-testid={`milestone-bar`}>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Entry ${entry.toFixed(2)}</span>
        <span className="flex items-center gap-1">
          {progressPctDisplay > 0 && progressPctDisplay < 100 && (
            <span className={`font-medium ${progress >= 50 ? "text-emerald-500" : "text-blue-500"}`}>
              {progressPctDisplay}%
            </span>
          )}
          {targetLabel} ${activeTarget.toFixed(2)}
        </span>
      </div>
      <div className="relative w-full h-6 rounded-full bg-muted/50 border overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-red-500/15 border-r border-red-500/30"
          style={{ width: `${stopPct}%` }}
        >
          <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-red-500 font-medium whitespace-nowrap">
            Stop
          </div>
        </div>

        <div
          className={`absolute top-0 h-full transition-all duration-500 ${
            progress >= 100 ? "bg-emerald-500/30" : progress > 50 ? "bg-blue-500/25" : "bg-blue-500/15"
          }`}
          style={{ left: `${stopPct}%`, width: `${Math.max(0, progress * (100 - stopPct) / 100)}%` }}
        />

        {milestones.map((m) => {
          const pos = stopPct + (m / 100) * (100 - stopPct);
          const isHit = progress >= m;
          return (
            <div
              key={m}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${pos}%` }}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${
                isHit ? "bg-emerald-500" : "bg-muted-foreground/30"
              }`} />
              {m % 50 === 0 && (
                <span className="absolute top-3 left-1/2 -translate-x-1/2 text-[7px] text-muted-foreground">
                  {m}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      {tpHitLevel >= 1 && (
        <div className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
          <Target className="w-3 h-3" /> T1 Hit @ ${t1.toFixed(2)}
          {tpHitLevel >= 2 && " · T2 Hit"}
        </div>
      )}
    </div>
  );
}

function TradeRow({ trade }: { trade: TradeItem }) {
  const entry = trade.entryPrice ?? 0;
  const stop = trade.stopPrice ?? 0;
  const t1 = trade.target1Price ?? 0;
  const t2 = trade.target2Price ?? 0;

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card" data-testid={`trade-row-${trade.id}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] font-mono">
            {getInstrumentLabel(trade.instrumentType)}
          </Badge>
          {trade.instrumentTicker && (
            <span className="text-xs font-mono text-muted-foreground">{trade.instrumentTicker}</span>
          )}
          {getStatusBadge(trade.status)}
        </div>
        <div className="flex items-center gap-2">
          {trade.discordAlertSent ? (
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] gap-1" data-testid={`badge-discord-live-${trade.id}`}>
              <MessageSquare className="w-2.5 h-2.5" />
              {trade.discordChannel}
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground" data-testid={`badge-discord-off-${trade.id}`}>
              <MessageSquare className="w-2.5 h-2.5" />
              {trade.discordChannel}
            </Badge>
          )}
          {trade.tradesyncSent && (
            <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 text-[10px] gap-1" data-testid={`badge-tradesync-${trade.id}`}>
              <Send className="w-2.5 h-2.5" />
              TradeSync
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-[11px]">
        <div>
          <span className="text-muted-foreground">Entry</span>
          <div className="font-mono font-medium">{entry > 0 ? `$${entry.toFixed(2)}` : "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Stop</span>
          <div className="font-mono font-medium text-red-500">{stop > 0 ? `$${stop.toFixed(2)}` : "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">T1</span>
          <div className="font-mono font-medium text-emerald-500">{t1 > 0 ? `$${t1.toFixed(2)}` : "—"}</div>
        </div>
        <div>
          <span className="text-muted-foreground">T2</span>
          <div className="font-mono font-medium text-emerald-600">{t2 > 0 ? `$${t2.toFixed(2)}` : "—"}</div>
        </div>
      </div>

      {entry > 0 && trade.currentPrice != null && (
        (() => {
          const isBuy = trade.side === "BUY";
          const pnlDollar = isBuy
            ? trade.currentPrice - entry
            : entry - trade.currentPrice;
          const pnlPct = (pnlDollar / entry) * 100;
          const isPositive = pnlDollar >= 0;
          return (
            <div className="flex items-center justify-between text-[11px] px-1" data-testid={`pnl-${trade.id}`}>
              <span className="text-muted-foreground">
                Now <span className="font-mono font-medium">${trade.currentPrice.toFixed(2)}</span>
              </span>
              <span className={`font-mono font-semibold ${isPositive ? "text-emerald-500" : "text-red-500"}`}>
                {isPositive ? "+" : ""}{pnlDollar.toFixed(2)} ({isPositive ? "+" : ""}{pnlPct.toFixed(1)}%)
              </span>
            </div>
          );
        })()
      )}

      {entry > 0 && t1 > 0 && stop > 0 && (
        <MilestoneBar
          entry={entry}
          stop={stop}
          t1={t1}
          t2={t2 > 0 ? t2 : t1}
          tpHitLevel={trade.tpHitLevel}
          side={trade.side}
          currentPrice={trade.currentPrice}
        />
      )}
    </div>
  );
}

function SignalGroupCard({ group }: { group: SignalGroup }) {
  const { signal, trades } = group;
  const isSell = signal.direction === "SELL";

  const instrumentOrder = ["SHARES", "OPTION", "LEVERAGED_ETF", "LETF_OPTIONS"];
  const sortedTrades = [...trades].sort(
    (a, b) => instrumentOrder.indexOf(a.instrumentType) - instrumentOrder.indexOf(b.instrumentType)
  );

  const activatedDate = signal.activatedTs
    ? new Date(signal.activatedTs).toLocaleDateString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <Card className="overflow-hidden" data-testid={`signal-group-${signal.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Link href={`/symbol/${signal.ticker}`}>
              <span className="text-lg font-bold cursor-pointer hover:underline" data-testid={`link-ticker-${signal.ticker}`}>
                {signal.ticker}
              </span>
            </Link>
            {getTierBadge(signal.tier)}
            <span className="text-xs text-muted-foreground">
              {signal.setupType}: {SETUP_LABELS[signal.setupType as SetupType] ?? signal.setupType}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isSell ? (
              <span className="flex items-center gap-1 text-red-500 dark:text-red-400 text-xs font-medium">
                <TrendingDown className="w-3.5 h-3.5" /> SHORT
              </span>
            ) : (
              <span className="flex items-center gap-1 text-emerald-500 text-xs font-medium">
                <TrendingUp className="w-3.5 h-3.5" /> LONG
              </span>
            )}
            <Badge variant="outline" className="text-[10px]">
              QS {signal.qualityScore}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
          {activatedDate && (
            <span className="flex items-center gap-1">
              <Radio className="w-3 h-3" /> Activated {activatedDate}
            </span>
          )}
          <span>
            <Target className="w-3 h-3 inline mr-0.5" />
            Magnet ${signal.magnetPrice.toFixed(2)}
          </span>
          {signal.entryPriceAtActivation && (
            <span>
              Entry ${signal.entryPriceAtActivation.toFixed(2)}
            </span>
          )}
          <span className="ml-auto text-[10px]">
            {trades.length} instrument{trades.length !== 1 ? "s" : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {sortedTrades.map((trade) => (
          <TradeRow key={trade.id} trade={trade} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function TradeTracker() {
  const { data, isLoading, isError } = useQuery<SignalGroup[]>({
    queryKey: ["/api/ibkr/trades-live"],
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-red-500/50" />
          <p className="text-red-500 font-medium" data-testid="text-trades-error">Failed to load trade data</p>
          <p className="text-xs text-muted-foreground mt-1">
            Check your connection and try refreshing the page
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground font-medium" data-testid="text-no-active-trades">No active BTOD trades</p>
          <p className="text-xs text-muted-foreground mt-1">
            Trades will appear here when signals activate and execute through BTOD
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalTrades = data.reduce((sum, g) => sum + g.trades.length, 0);
  const liveDiscord = data.reduce((sum, g) => sum + g.trades.filter(t => t.discordAlertSent).length, 0);
  const liveTradeSync = data.reduce((sum, g) => sum + g.trades.filter(t => t.tradesyncSent).length, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground">Signals</div>
            <div className="text-2xl font-bold" data-testid="stat-signal-count">{data.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground">Total Trades</div>
            <div className="text-2xl font-bold" data-testid="stat-trade-count">{totalTrades}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> Discord Live
            </div>
            <div className="text-2xl font-bold text-emerald-500" data-testid="stat-discord-live">{liveDiscord}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Send className="w-3 h-3" /> TradeSync
            </div>
            <div className="text-2xl font-bold text-blue-500" data-testid="stat-tradesync-count">{liveTradeSync}</div>
          </CardContent>
        </Card>
      </div>

      {data.map((group) => (
        <SignalGroupCard key={group.signal.id} group={group} />
      ))}
    </div>
  );
}
