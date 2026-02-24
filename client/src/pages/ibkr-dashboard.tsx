import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Wifi, WifiOff, RefreshCw, DollarSign, TrendingUp, TrendingDown,
  BarChart3, X, Play, Square, Target, Shield, CheckCircle2, AlertTriangle
} from "lucide-react";

interface IbkrDashboardData {
  connected: boolean;
  account: {
    netLiquidation?: number;
    buyingPower?: number;
    totalCashValue?: number;
    unrealizedPnl?: number;
    realizedPnl?: number;
  };
  positions: Array<{
    account: string;
    symbol: string;
    secType: string;
    position: number;
    avgCost: number;
  }>;
  activeTrades: Array<any>;
  closedTrades: Array<any>;
  stats: {
    totalTrades: number;
    totalPnl: number;
    winRate: number;
    winCount: number;
    lossCount: number;
  };
}

function TpProgressBadges({ trade }: { trade: any }) {
  const level = trade.tpHitLevel ?? 0;
  return (
    <div className="flex items-center gap-1">
      <Badge
        variant={level >= 1 ? "default" : "outline"}
        className={`text-[9px] px-1 py-0 ${level >= 1 ? "bg-cyan-500 text-white" : "text-muted-foreground"}`}
        data-testid={`badge-tp1-${trade.id}`}
      >
        TP1 {level >= 1 ? "HIT" : "—"}
      </Badge>
      <Badge
        variant={level >= 2 ? "default" : "outline"}
        className={`text-[9px] px-1 py-0 ${level >= 2 ? "bg-purple-500 text-white" : "text-muted-foreground"}`}
        data-testid={`badge-tp2-${trade.id}`}
      >
        TP2 {level >= 2 ? "HIT" : "—"}
      </Badge>
      {trade.stopMovedToBe && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 text-amber-600 border-amber-500/30" data-testid={`badge-be-${trade.id}`}>
          <Shield className="w-2.5 h-2.5 mr-0.5" /> BE
        </Badge>
      )}
    </div>
  );
}

function parseOptionTicker(ticker: string | null | undefined): { strike: string; expiry: string; right: string } | null {
  if (!ticker) return null;
  const match = ticker.match(/O:(\w+?)(\d{6})([CP])(\d{8})/);
  if (!match) return null;
  const dateStr = match[2];
  const year = `20${dateStr.slice(0, 2)}`;
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);
  const strike = (parseInt(match[4]) / 1000).toString();
  return {
    strike,
    expiry: `${month}/${day}/${year}`,
    right: match[3] === "C" ? "Call" : "Put",
  };
}

function OptionEntryDisplay({ trade }: { trade: any }) {
  const isOption = trade.instrumentType === "OPTION";
  if (!isOption) {
    return (
      <div>
        <span className="text-muted-foreground">Entry</span>
        <div className="font-semibold">{trade.entryPrice != null ? `$${trade.entryPrice.toFixed(2)}` : "—"}</div>
      </div>
    );
  }

  const parsed = parseOptionTicker(trade.instrumentTicker);

  return (
    <div>
      <span className="text-muted-foreground">Entry</span>
      <div className="font-semibold">{trade.entryPrice != null ? `$${trade.entryPrice.toFixed(2)}` : "—"}</div>
      {parsed && (
        <div className="text-[10px] text-muted-foreground leading-tight">
          {parsed.strike} {parsed.right} {parsed.expiry}
        </div>
      )}
    </div>
  );
}

function OrderIdCell({ label, orderId }: { label: string; orderId?: number | null }) {
  if (!orderId) return null;
  return (
    <span className="text-[10px] text-muted-foreground">
      {label}: #{orderId}
    </span>
  );
}

export default function IbkrDashboard() {
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<IbkrDashboardData>({
    queryKey: ["/api/ibkr/dashboard"],
    refetchInterval: 5000,
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ibkr/connect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ibkr/dashboard"] });
      toast({ title: "IBKR connection initiated" });
    },
    onError: (err: any) => toast({ title: "Connection failed", description: err.message, variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ibkr/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ibkr/dashboard"] });
      toast({ title: "IBKR disconnected" });
    },
  });

  const closeTradeMutation = useMutation({
    mutationFn: (tradeId: number) => apiRequest("POST", `/api/ibkr/close/${tradeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ibkr/dashboard"] });
      toast({ title: "Trade closed" });
    },
    onError: (err: any) => toast({ title: "Close failed", description: err.message, variant: "destructive" }),
  });

  const monitorMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ibkr/monitor"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ibkr/dashboard"] });
      toast({ title: "Trade monitor updated" });
    },
  });

  const connected = data?.connected ?? false;
  const account = data?.account ?? {};
  const positions = data?.positions ?? [];
  const activeTrades = data?.activeTrades ?? [];
  const closedTrades = data?.closedTrades ?? [];
  const stats = data?.stats ?? { totalTrades: 0, totalPnl: 0, winRate: 0, winCount: 0, lossCount: 0 };

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto" data-testid="page-ibkr-dashboard">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-ibkr-title">IBKR Trading</h1>
          <p className="text-sm text-muted-foreground">Bracket orders with multi-TP progression</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={connected ? "default" : "destructive"} className="gap-1" data-testid="badge-ibkr-status">
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
          {!connected ? (
            <Button size="sm" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} data-testid="button-ibkr-connect">
              <Play className="w-3 h-3 mr-1" /> Connect
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => disconnectMutation.mutate()} data-testid="button-ibkr-disconnect">
              <Square className="w-3 h-3 mr-1" /> Disconnect
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => monitorMutation.mutate()} data-testid="button-ibkr-monitor">
            <RefreshCw className="w-3 h-3 mr-1" /> Monitor
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground">Net Liquidation</div>
            <div className="text-lg font-bold" data-testid="text-net-liquidation">
              {account.netLiquidation ? `$${account.netLiquidation.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground">Buying Power</div>
            <div className="text-lg font-bold" data-testid="text-buying-power">
              {account.buyingPower ? `$${account.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground">Unrealized P&L</div>
            <div className={`text-lg font-bold ${(account.unrealizedPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-unrealized-pnl">
              {account.unrealizedPnl != null ? `$${account.unrealizedPnl.toFixed(2)}` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground">Realized P&L</div>
            <div className={`text-lg font-bold ${(account.realizedPnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="text-realized-pnl">
              {account.realizedPnl != null ? `$${account.realizedPnl.toFixed(2)}` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="text-xs text-muted-foreground">Win Rate</div>
            <div className="text-lg font-bold" data-testid="text-win-rate">
              {stats.totalTrades > 0 ? `${stats.winRate.toFixed(0)}%` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {stats.winCount}W / {stats.lossCount}L
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" /> Active Trades ({activeTrades.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No active trades</p>
          ) : (
            <div className="space-y-3">
              {activeTrades.map((trade: any) => (
                <div key={trade.id} className="rounded-lg border p-3 space-y-2" data-testid={`card-active-trade-${trade.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{trade.ticker}</span>
                      {trade.instrumentType === "OPTION" && trade.instrumentTicker && (
                        <span className="text-[10px] text-muted-foreground font-mono">{trade.instrumentTicker.replace("O:", "")}</span>
                      )}
                      {trade.instrumentType === "LEVERAGED_ETF" && trade.instrumentTicker && trade.instrumentTicker !== trade.ticker && (
                        <span className="text-[10px] text-muted-foreground">via {trade.instrumentTicker}</span>
                      )}
                      <Badge variant={trade.side === "BUY" ? "default" : "destructive"} className="text-xs">
                        {trade.side}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{trade.instrumentType}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {trade.remainingQuantity}/{trade.originalQuantity} remaining
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TpProgressBadges trade={trade} />
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => closeTradeMutation.mutate(trade.id)}
                        disabled={closeTradeMutation.isPending}
                        data-testid={`button-close-trade-${trade.id}`}
                      >
                        <X className="w-3 h-3 mr-1" /> Close
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                    <OptionEntryDisplay trade={trade} />
                    <div>
                      <span className="text-muted-foreground">Stop</span>
                      <div className={`font-semibold ${trade.stopMovedToBe ? "text-amber-500" : "text-red-500"}`}>
                        ${trade.stopPrice?.toFixed(2) ?? "—"}
                        {trade.stopMovedToBe && " (BE)"}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">TP1</span>
                      <div className={`font-semibold ${trade.tpHitLevel >= 1 ? "text-cyan-500 line-through" : ""}`}>
                        ${trade.target1Price?.toFixed(2) ?? "—"}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">TP2</span>
                      <div className={`font-semibold ${trade.tpHitLevel >= 2 ? "text-purple-500 line-through" : ""}`}>
                        ${trade.target2Price?.toFixed(2) ?? "—"}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Running P&L</span>
                      <div className={`font-semibold ${(trade.pnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {trade.pnl != null ? `$${trade.pnl.toFixed(2)}` : "—"}
                      </div>
                    </div>
                  </div>

                  {trade.tpHitLevel >= 1 && (
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground bg-cyan-500/5 rounded p-1.5">
                      <CheckCircle2 className="w-3 h-3 text-cyan-500" />
                      <span>TP1 filled @ ${trade.tp1FillPrice?.toFixed(2) ?? "?"}</span>
                      <span>P&L: ${trade.tp1PnlRealized?.toFixed(2) ?? "?"}</span>
                      {trade.tp1FilledAt && <span>{new Date(trade.tp1FilledAt).toLocaleTimeString()}</span>}
                    </div>
                  )}

                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
                    <OrderIdCell label="Entry" orderId={trade.ibkrOrderId} />
                    <OrderIdCell label="Stop" orderId={trade.ibkrStopOrderId} />
                    <OrderIdCell label="TP1" orderId={trade.ibkrTp1OrderId} />
                    <OrderIdCell label="TP2" orderId={trade.ibkrTp2OrderId} />
                    {trade.filledAt && <span>Filled: {new Date(trade.filledAt).toLocaleTimeString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {positions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> IBKR Positions ({positions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Avg Cost</TableHead>
                  <TableHead>Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((pos: any, idx: number) => (
                  <TableRow key={idx} data-testid={`row-position-${idx}`}>
                    <TableCell className="font-medium">{pos.symbol}</TableCell>
                    <TableCell>{pos.secType}</TableCell>
                    <TableCell className={pos.position >= 0 ? "text-green-500" : "text-red-500"}>{pos.position}</TableCell>
                    <TableCell>${pos.avgCost?.toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{pos.account}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4" /> Trade History ({closedTrades.length})
            {stats.totalPnl !== 0 && (
              <Badge variant={stats.totalPnl >= 0 ? "default" : "destructive"}>
                Total: ${stats.totalPnl.toFixed(2)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {closedTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No closed trades yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead>TP Level</TableHead>
                  <TableHead>P&L</TableHead>
                  <TableHead>R</TableHead>
                  <TableHead>Closed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closedTrades.map((trade: any) => (
                  <TableRow key={trade.id} data-testid={`row-closed-trade-${trade.id}`}>
                    <TableCell className="font-medium">{trade.instrumentTicker || trade.ticker}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{trade.instrumentType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={trade.side === "BUY" ? "default" : "destructive"} className="text-xs">
                        {trade.side}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        ${trade.entryPrice?.toFixed(2) ?? "—"}
                        {trade.instrumentType === "OPTION" && (() => {
                          const p = parseOptionTicker(trade.instrumentTicker);
                          return p ? (
                            <div className="text-[10px] text-muted-foreground">{p.strike} {p.right} {p.expiry}</div>
                          ) : null;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>${trade.exitPrice?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell>
                      {trade.tpHitLevel === 2 ? (
                        <Badge className="text-[9px] bg-purple-500">Full TP</Badge>
                      ) : trade.tpHitLevel === 1 ? (
                        <Badge className="text-[9px] bg-cyan-500">TP1 + SL</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px]">SL</Badge>
                      )}
                    </TableCell>
                    <TableCell className={`font-medium ${(trade.pnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
                      {trade.pnl != null ? `$${trade.pnl.toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell>{trade.rMultiple?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {trade.closedAt ? new Date(trade.closedAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
