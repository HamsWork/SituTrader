import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, X, Search, Loader2, Bell, Star, Globe, Timer } from "lucide-react";
import type { Symbol } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function SettingsPage() {
  const { toast } = useToast();
  const [newTicker, setNewTicker] = useState("");

  const { data: symbolList, isLoading } = useQuery<Symbol[]>({
    queryKey: ["/api/symbols"],
  });

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });

  const addSymbol = useMutation({
    mutationFn: () => apiRequest("POST", "/api/symbols", { ticker: newTicker.toUpperCase().trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/symbols"] });
      setNewTicker("");
      toast({ title: "Symbol added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add symbol", description: error.message, variant: "destructive" });
    },
  });

  const deleteSymbol = useMutation({
    mutationFn: (ticker: string) => apiRequest("DELETE", `/api/symbols/${ticker}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/symbols"] });
      toast({ title: "Symbol removed" });
    },
  });

  const saveSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiRequest("POST", "/api/settings", { key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Setting saved" });
    },
  });

  const currentSettings = {
    intradayTimeframe: settings?.intradayTimeframe ?? "5",
    gapThreshold: settings?.gapThreshold ?? "0.30",
    entryMode: settings?.entryMode ?? "conservative",
    stopMode: settings?.stopMode ?? "atr",
    sessionStart: settings?.sessionStart ?? "09:30",
    sessionEnd: settings?.sessionEnd ?? "16:00",
    watchlistPriority: settings?.watchlistPriority ?? "SPY,QQQ,NVDA,TSLA",
    alertTierAplus: settings?.alertTierAplus ?? "in-app",
    alertTierA: settings?.alertTierA ?? "in-app",
    alertTierB: settings?.alertTierB ?? "in-app",
    alertTierC: settings?.alertTierC ?? "log-only",
    universeMode: settings?.universeMode ?? "HYBRID",
    liquidityThreshold: settings?.liquidityThreshold ?? "250000000",
    timePriorityMode: settings?.timePriorityMode ?? "BLEND",
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure symbols, trading parameters, and session hours
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm">Managed Symbols</CardTitle>
          <Badge variant="outline">{symbolList?.length ?? 0} tickers</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search or add ticker (e.g., AAPL)"
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTicker.trim()) addSymbol.mutate();
                }}
                className="pl-9"
                data-testid="input-new-ticker"
              />
            </div>
            <Button
              onClick={() => addSymbol.mutate()}
              disabled={!newTicker.trim() || addSymbol.isPending}
              data-testid="button-add-ticker"
            >
              {addSymbol.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-1" />
              )}
              Add
            </Button>
          </div>

          <div className="min-h-[120px] max-h-[320px] overflow-y-auto rounded-md border p-3">
            {isLoading ? (
              <div className="flex items-center justify-center h-[100px] text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading symbols...
              </div>
            ) : !symbolList?.length ? (
              <div className="flex items-center justify-center h-[100px] text-sm text-muted-foreground">
                No symbols added yet
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {symbolList
                  .filter((sym) => !newTicker || sym.ticker.includes(newTicker.trim()))
                  .map((sym) => (
                    <Badge
                      key={sym.ticker}
                      variant="secondary"
                      className="gap-1 pr-1 text-sm"
                      data-testid={`badge-symbol-${sym.ticker}`}
                    >
                      {sym.ticker}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 ml-0.5 rounded-full hover-elevate"
                        onClick={() => deleteSymbol.mutate(sym.ticker)}
                        data-testid={`button-delete-${sym.ticker}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </Badge>
                  ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Trading Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Intraday Timeframe</Label>
              <Select
                value={currentSettings.intradayTimeframe}
                onValueChange={(value) => saveSetting.mutate({ key: "intradayTimeframe", value })}
              >
                <SelectTrigger data-testid="select-timeframe">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 minute</SelectItem>
                  <SelectItem value="5">5 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Gap Threshold (%)</Label>
              <Input
                type="number"
                step="0.05"
                value={currentSettings.gapThreshold}
                onChange={(e) => saveSetting.mutate({ key: "gapThreshold", value: e.target.value })}
                data-testid="input-gap-threshold"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Entry Mode</Label>
              <Select
                value={currentSettings.entryMode}
                onValueChange={(value) => saveSetting.mutate({ key: "entryMode", value })}
              >
                <SelectTrigger data-testid="select-entry-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conservative">Conservative</SelectItem>
                  <SelectItem value="aggressive">Aggressive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Stop Mode</Label>
              <Select
                value={currentSettings.stopMode}
                onValueChange={(value) => saveSetting.mutate({ key: "stopMode", value })}
              >
                <SelectTrigger data-testid="select-stop-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="atr">ATR-based (0.25 * ATR)</SelectItem>
                  <SelectItem value="fixed">Fixed (0.15% of price)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">RTH Start (ET)</Label>
              <Input
                value={currentSettings.sessionStart}
                onChange={(e) => saveSetting.mutate({ key: "sessionStart", value: e.target.value })}
                placeholder="09:30"
                data-testid="input-session-start"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">RTH End (ET)</Label>
              <Input
                value={currentSettings.sessionEnd}
                onChange={(e) => saveSetting.mutate({ key: "sessionEnd", value: e.target.value })}
                placeholder="16:00"
                data-testid="input-session-end"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            <CardTitle className="text-sm">Watchlist Priority</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Tickers on the priority watchlist get bumped one tier up when scoring signals.
          </p>
          <div className="space-y-2">
            <Label className="text-xs">Priority Tickers (comma-separated)</Label>
            <Input
              value={currentSettings.watchlistPriority}
              onChange={(e) => saveSetting.mutate({ key: "watchlistPriority", value: e.target.value })}
              placeholder="SPY,QQQ,NVDA,TSLA"
              data-testid="input-watchlist-priority"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Universe Filter</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Controls which tickers are eligible for signal generation and alerts.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Universe Mode</Label>
              <Select
                value={currentSettings.universeMode}
                onValueChange={(value) => saveSetting.mutate({ key: "universeMode", value })}
              >
                <SelectTrigger data-testid="select-universe-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HYBRID">Hybrid (watchlist OR liquidity)</SelectItem>
                  <SelectItem value="WATCHLIST_ONLY">Watchlist Only</SelectItem>
                  <SelectItem value="LIQUIDITY_ONLY">Liquidity Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Liquidity Threshold (20d Avg $ Vol)</Label>
              <Select
                value={currentSettings.liquidityThreshold}
                onValueChange={(value) => saveSetting.mutate({ key: "liquidityThreshold", value })}
              >
                <SelectTrigger data-testid="select-liquidity-threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="100000000">$100M</SelectItem>
                  <SelectItem value="250000000">$250M</SelectItem>
                  <SelectItem value="500000000">$500M</SelectItem>
                  <SelectItem value="1000000000">$1B</SelectItem>
                  <SelectItem value="5000000000">$5B</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Time Priority Mode</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Controls how the TimeScore quality component weights early vs same-day hit probabilities.
          </p>
          <div className="space-y-2">
            <Label className="text-xs">Mode</Label>
            <Select
              value={currentSettings.timePriorityMode}
              onValueChange={(value) => saveSetting.mutate({ key: "timePriorityMode", value })}
            >
              <SelectTrigger data-testid="select-time-priority-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BLEND">Blend (15*p60 + 10*p390)</SelectItem>
                <SelectItem value="EARLY">Early (25*p60)</SelectItem>
                <SelectItem value="SAME_DAY">Same Day (25*p390)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Alert Routing</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Configure how alerts are routed for each quality tier.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">A+ Tier (90-100)</Label>
              <Select
                value={currentSettings.alertTierAplus}
                onValueChange={(value) => saveSetting.mutate({ key: "alertTierAplus", value })}
              >
                <SelectTrigger data-testid="select-alert-aplus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in-app">In-App</SelectItem>
                  <SelectItem value="log-only">Log Only</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">A Tier (80-89)</Label>
              <Select
                value={currentSettings.alertTierA}
                onValueChange={(value) => saveSetting.mutate({ key: "alertTierA", value })}
              >
                <SelectTrigger data-testid="select-alert-a">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in-app">In-App</SelectItem>
                  <SelectItem value="log-only">Log Only</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">B Tier (70-79)</Label>
              <Select
                value={currentSettings.alertTierB}
                onValueChange={(value) => saveSetting.mutate({ key: "alertTierB", value })}
              >
                <SelectTrigger data-testid="select-alert-b">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in-app">In-App</SelectItem>
                  <SelectItem value="log-only">Log Only</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">C Tier (under 70)</Label>
              <Select
                value={currentSettings.alertTierC}
                onValueChange={(value) => saveSetting.mutate({ key: "alertTierC", value })}
              >
                <SelectTrigger data-testid="select-alert-c">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in-app">In-App</SelectItem>
                  <SelectItem value="log-only">Log Only</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
