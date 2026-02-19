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
import { Plus, X, Search, Loader2, Bell, Star, Globe, Timer, Database, RefreshCw, Crosshair } from "lucide-react";
import type { Symbol } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

function formatDollarVol(val: number): string {
  if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [newTicker, setNewTicker] = useState("");

  const { data: symbolList, isLoading } = useQuery<Symbol[]>({
    queryKey: ["/api/symbols"],
  });

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });

  const { data: universeStatus } = useQuery<{
    lastRebuild: string | null;
    universeDate: string | null;
    memberCount: number;
    topTickers: { ticker: string; avgDollarVol20d: number; rank: number }[];
  }>({
    queryKey: ["/api/universe/status"],
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

  const rebuildUniverse = useMutation({
    mutationFn: () => apiRequest("POST", "/api/universe/rebuild", { force: true }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/universe/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/symbols"] });
      toast({
        title: "Universe rebuilt",
        description: `${data.included} tickers included in universe`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Universe rebuild failed", description: error.message, variant: "destructive" });
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
    liquidityThreshold: settings?.liquidityThreshold ?? "1000000000",
    topNUniverse: settings?.topNUniverse ?? "150",
    alertLiquidityGateEnabled: settings?.alertLiquidityGateEnabled ?? "true",
    timePriorityMode: settings?.timePriorityMode ?? "BLEND",
    focusMode: settings?.focusMode ?? "EXPECTANCY",
    focusWinRateThreshold: settings?.focusWinRateThreshold ?? "0.70",
    focusExpectancyThreshold: settings?.focusExpectancyThreshold ?? "0.15",
    focusMinSampleSize: settings?.focusMinSampleSize ?? "50",
    stopAtrMultiplier: settings?.stopAtrMultiplier ?? "0.25",
    stopManagementMode: settings?.stopManagementMode ?? "VOLATILITY_ONLY",
    beProgressThreshold: settings?.beProgressThreshold ?? "0.25",
    beRThreshold: settings?.beRThreshold ?? "0.5",
    timeStopMinutes: settings?.timeStopMinutes ?? "120",
    timeStopProgressThreshold: settings?.timeStopProgressThreshold ?? "0.15",
    timeStopTightenFactor: settings?.timeStopTightenFactor ?? "0.5",
  };

  const watchlistCount = symbolList?.filter(s => s.isWatchlist).length ?? 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure universe, symbols, trading parameters, and alert routing
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Universe Builder</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {universeStatus?.memberCount != null && (
              <Badge variant="outline" data-testid="badge-universe-count">
                {universeStatus.memberCount} tickers
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => rebuildUniverse.mutate()}
              disabled={rebuildUniverse.isPending}
              data-testid="button-rebuild-universe"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${rebuildUniverse.isPending ? "animate-spin" : ""}`} />
              {rebuildUniverse.isPending ? "Rebuilding..." : "Rebuild Now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Automatically discovers the most liquid US stocks by average dollar volume.
            The universe refreshes every 24 hours during data refresh, or click Rebuild Now.
          </p>

          {universeStatus?.lastRebuild && (
            <div className="text-xs text-muted-foreground" data-testid="text-universe-last-rebuild">
              Last rebuild: {new Date(universeStatus.lastRebuild).toLocaleString()}
              {universeStatus.universeDate && ` (${universeStatus.universeDate})`}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
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
                  <SelectItem value="HYBRID">Hybrid (watchlist + liquidity)</SelectItem>
                  <SelectItem value="WATCHLIST_ONLY">Watchlist Only</SelectItem>
                  <SelectItem value="LIQUIDITY_ONLY">Liquidity Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Top N Tickers</Label>
              <Select
                value={currentSettings.topNUniverse}
                onValueChange={(value) => saveSetting.mutate({ key: "topNUniverse", value })}
              >
                <SelectTrigger data-testid="select-top-n">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="150">150</SelectItem>
                  <SelectItem value="200">200</SelectItem>
                  <SelectItem value="300">300</SelectItem>
                  <SelectItem value="500">500</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Liquidity Floor (Alert Gate)</Label>
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

          <div className="space-y-2">
            <Label className="text-xs">Alert Liquidity Gate</Label>
            <Select
              value={currentSettings.alertLiquidityGateEnabled}
              onValueChange={(value) => saveSetting.mutate({ key: "alertLiquidityGateEnabled", value })}
            >
              <SelectTrigger data-testid="select-liquidity-gate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Enabled (suppress alerts for low-liquidity non-watchlist tickers)</SelectItem>
                <SelectItem value="false">Disabled (alert for all tickers)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {universeStatus?.topTickers && universeStatus.topTickers.length > 0 && (
            <div>
              <Label className="text-xs mb-2 block">Top Universe Members</Label>
              <div className="flex flex-wrap gap-1.5">
                {universeStatus.topTickers.map(t => (
                  <Badge key={t.ticker} variant="outline" className="text-[10px] gap-1" data-testid={`badge-universe-${t.ticker}`}>
                    #{t.rank} {t.ticker}
                    <span className="text-muted-foreground">{formatDollarVol(t.avgDollarVol20d)}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            <CardTitle className="text-sm">Watchlist</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{watchlistCount} watchlist / {symbolList?.length ?? 0} total</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Watchlist tickers are always scanned regardless of universe mode. They get tier bumps and bypass the liquidity gate for alerts.
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Add ticker to watchlist (e.g., AAPL)"
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

          <div className="min-h-[80px] max-h-[280px] overflow-y-auto rounded-md border p-3">
            {isLoading ? (
              <div className="flex items-center justify-center h-[80px] text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading symbols...
              </div>
            ) : !symbolList?.length ? (
              <div className="flex items-center justify-center h-[80px] text-sm text-muted-foreground">
                No symbols added yet
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {symbolList
                  .filter((sym) => sym.isWatchlist)
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

          <div className="space-y-2">
            <Label className="text-xs">Watchlist Priority Override (comma-separated)</Label>
            <Input
              value={currentSettings.watchlistPriority}
              onChange={(e) => saveSetting.mutate({ key: "watchlistPriority", value: e.target.value })}
              placeholder="SPY,QQQ,NVDA,TSLA"
              data-testid="input-watchlist-priority"
            />
            <p className="text-[10px] text-muted-foreground">
              These tickers get tier-bumped during quality scoring
            </p>
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
              <Label className="text-xs">Stop Baseline</Label>
              <Select
                value={currentSettings.stopMode}
                onValueChange={(value) => saveSetting.mutate({ key: "stopMode", value })}
              >
                <SelectTrigger data-testid="select-stop-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="atr">ATR-based</SelectItem>
                  <SelectItem value="fixed">Fixed (0.15% of price)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {currentSettings.stopMode === "atr" && (
            <div className="space-y-2">
              <Label className="text-xs">ATR Multiplier</Label>
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="2.0"
                value={currentSettings.stopAtrMultiplier}
                onChange={(e) => saveSetting.mutate({ key: "stopAtrMultiplier", value: e.target.value })}
                data-testid="input-stop-atr-multiplier"
              />
              <p className="text-[10px] text-muted-foreground">Stop distance = multiplier x ATR(14). Default 0.25.</p>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Stop Management</Label>
              <p className="text-xs text-muted-foreground mt-0.5">After entry, manage stops dynamically with break-even and time rules.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Management Mode</Label>
              <Select
                value={currentSettings.stopManagementMode}
                onValueChange={(value) => saveSetting.mutate({ key: "stopManagementMode", value })}
              >
                <SelectTrigger data-testid="select-stop-management-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VOLATILITY_ONLY">Volatility Only (no adjustment)</SelectItem>
                  <SelectItem value="VOLATILITY_BE">Volatility + Break-Even</SelectItem>
                  <SelectItem value="VOLATILITY_TIME">Volatility + Time Stop</SelectItem>
                  <SelectItem value="FULL">Full (Volatility + BE + Time)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(currentSettings.stopManagementMode === "VOLATILITY_BE" || currentSettings.stopManagementMode === "FULL") && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-xs font-medium">Break-Even Rules</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Progress Threshold</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0.1"
                      max="1.0"
                      value={currentSettings.beProgressThreshold}
                      onChange={(e) => saveSetting.mutate({ key: "beProgressThreshold", value: e.target.value })}
                      data-testid="input-be-progress"
                    />
                    <p className="text-[10px] text-muted-foreground">Move to BE at this % of target (0.25 = 25%)</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">R-Multiple Threshold</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="3.0"
                      value={currentSettings.beRThreshold}
                      onChange={(e) => saveSetting.mutate({ key: "beRThreshold", value: e.target.value })}
                      data-testid="input-be-r"
                    />
                    <p className="text-[10px] text-muted-foreground">Or move to BE at this R-multiple (0.5 = +0.5R)</p>
                  </div>
                </div>
              </div>
            )}

            {(currentSettings.stopManagementMode === "VOLATILITY_TIME" || currentSettings.stopManagementMode === "FULL") && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-xs font-medium">Time Stop Rules</p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Time Window (min)</Label>
                    <Input
                      type="number"
                      step="15"
                      min="30"
                      max="390"
                      value={currentSettings.timeStopMinutes}
                      onChange={(e) => saveSetting.mutate({ key: "timeStopMinutes", value: e.target.value })}
                      data-testid="input-time-stop-minutes"
                    />
                    <p className="text-[10px] text-muted-foreground">Minutes before time stop triggers</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Min Progress</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0.0"
                      max="1.0"
                      value={currentSettings.timeStopProgressThreshold}
                      onChange={(e) => saveSetting.mutate({ key: "timeStopProgressThreshold", value: e.target.value })}
                      data-testid="input-time-stop-progress"
                    />
                    <p className="text-[10px] text-muted-foreground">If below this progress, tighten stop</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tighten Factor</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="0.1"
                      max="1.0"
                      value={currentSettings.timeStopTightenFactor}
                      onChange={(e) => saveSetting.mutate({ key: "timeStopTightenFactor", value: e.target.value })}
                      data-testid="input-time-stop-tighten"
                    />
                    <p className="text-[10px] text-muted-foreground">New stop distance = factor x original (0.5 = halved)</p>
                  </div>
                </div>
              </div>
            )}
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
            <Crosshair className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Focus Mode</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Gates alerts based on setup-level expectancy statistics. Only setups categorized as PRIMARY or SECONDARY will generate alerts.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Focus Mode</Label>
              <Select
                value={currentSettings.focusMode}
                onValueChange={(value) => saveSetting.mutate({ key: "focusMode", value })}
              >
                <SelectTrigger data-testid="select-focus-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WIN_RATE">Win Rate (hit rate threshold)</SelectItem>
                  <SelectItem value="EXPECTANCY">Expectancy (R-multiple threshold)</SelectItem>
                  <SelectItem value="BARBELL">Barbell (top hit rate + top expectancy)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Min Sample Size</Label>
              <Input
                type="number"
                value={currentSettings.focusMinSampleSize}
                onChange={(e) => saveSetting.mutate({ key: "focusMinSampleSize", value: e.target.value })}
                data-testid="input-focus-min-sample"
              />
              <p className="text-[10px] text-muted-foreground">
                Setups below this sample count are categorized as OFF
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Win Rate Threshold</Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={currentSettings.focusWinRateThreshold}
                onChange={(e) => saveSetting.mutate({ key: "focusWinRateThreshold", value: e.target.value })}
                data-testid="input-focus-winrate"
              />
              <p className="text-[10px] text-muted-foreground">
                Used in WIN_RATE mode to gate alerts
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Expectancy Threshold (R)</Label>
              <Input
                type="number"
                step="0.05"
                value={currentSettings.focusExpectancyThreshold}
                onChange={(e) => saveSetting.mutate({ key: "focusExpectancyThreshold", value: e.target.value })}
                data-testid="input-focus-expectancy"
              />
              <p className="text-[10px] text-muted-foreground">
                Used in EXPECTANCY mode to gate alerts
              </p>
            </div>
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
