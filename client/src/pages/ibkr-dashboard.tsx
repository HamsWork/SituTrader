import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  BarChart3, X, Play, Square
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
          <p className="text-sm text-muted-foreground">Automated trade execution and monitoring</p>
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

      {/* Account Summary */}
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

      {/* Active Trades */}
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Stop</TableHead>
                  <TableHead>T1</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeTrades.map((trade: any) => (
                  <TableRow key={trade.id} data-testid={`row-trade-${trade.id}`}>
                    <TableCell className="font-medium">{trade.instrumentTicker || trade.ticker}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{trade.instrumentType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={trade.side === "BUY" ? "default" : "destructive"} className="text-xs">
                        {trade.side}
                      </Badge>
                    </TableCell>
                    <TableCell>{trade.quantity}</TableCell>
                    <TableCell>${trade.entryPrice?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell>${trade.stopPrice?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell>${trade.target1Price?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">#{trade.ibkrOrderId ?? "—"}</TableCell>
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* IBKR Positions */}
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

      {/* Closed Trades */}
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
                    <TableCell>${trade.entryPrice?.toFixed(2) ?? "—"}</TableCell>
                    <TableCell>${trade.exitPrice?.toFixed(2) ?? "—"}</TableCell>
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
