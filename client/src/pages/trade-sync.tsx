import { useQuery } from "@tanstack/react-query";
import { useState, Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowRightLeft, ChevronDown, ChevronRight, Wifi, WifiOff, Target, Shield, CheckCircle2 } from "lucide-react";

interface TradeSyncSignal {
  id: string;
  status: string;
  createdAt: string;
  sourceAppName?: string;
  discordChannelId?: string;
  data: {
    ticker: string;
    instrument_type: string;
    direction: string;
    entry_price: number;
    stop_loss?: number;
    current_stop_loss?: number;
    time_stop?: string;
    expiration?: string;
    strike?: number;
    right?: string;
    trade_type?: string;
    auto_track?: boolean;
    status?: string;
    hit_targets?: Record<string, any>;
    current_tp_number?: number;
    remain_quantity?: number;
    underlying_ticker?: string;
    entry_option_price?: number;
    entry_underlying_price?: number;
    entry_letf_price?: number;
    leverage?: number;
    targets?: Record<string, {
      price?: number;
      percentage?: number;
      take_off_percent?: number;
      raise_stop_loss?: { price?: number; trailing_stop_percent?: number };
    }>;
  };
}

interface TradeSyncTemplate {
  instrumentType: string;
  templates: Array<{
    type: string;
    label: string;
    template: string;
  }>;
}

interface TradeSyncStatus {
  configured: boolean;
  reachable: boolean;
  enabled: boolean;
}

function statusColor(status: string): string {
  const s = status?.toLowerCase() ?? "";
  if (s === "active" || s === "submitted" || s === "tracking") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (s === "closed" || s === "completed") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (s === "stopped" || s === "stopped_out") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (s === "cancelled" || s === "expired") return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  if (s === "partial") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

function instrumentColor(type: string): string {
  const t = type?.toLowerCase() ?? "";
  if (t === "options") return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  if (t === "shares") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (t === "letf") return "bg-cyan-500/20 text-cyan-400 border-cyan-500/30";
  if (t.includes("letf option")) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

function directionColor(dir: string): string {
  const d = dir?.toLowerCase() ?? "";
  if (d === "long" || d === "call") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (d === "short" || d === "put") return "bg-red-500/20 text-red-400 border-red-500/30";
  return "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

function fmtPrice(p: number | string | null | undefined): string {
  if (p == null) return "—";
  const n = typeof p === "string" ? parseFloat(p) : p;
  if (isNaN(n)) return "—";
  return `$${n.toFixed(2)}`;
}

export default function TradeSyncPage() {
  return (
    <div className="p-4 space-y-4" data-testid="page-trade-sync">
      <div className="flex items-center gap-3">
        <ArrowRightLeft className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold" data-testid="text-page-title">Trade Sync</h1>
        <ConnectionBadge />
      </div>

      <Tabs defaultValue="trades" className="w-full">
        <TabsList data-testid="tabs-tradesync">
          <TabsTrigger value="trades" data-testid="tab-trades">Trade History</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">Discord Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="trades">
          <TradeHistoryTab />
        </TabsContent>
        <TabsContent value="templates">
          <DiscordTemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConnectionBadge() {
  const { data: status } = useQuery<TradeSyncStatus>({
    queryKey: ["/api/tradesync/status"],
    refetchInterval: 30000,
  });

  if (!status) return null;

  const connected = status.configured && status.reachable;

  return (
    <Badge variant={connected ? "default" : "destructive"} className="gap-1" data-testid="badge-tradesync-status">
      {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
      {connected ? "Connected" : "Disconnected"}
    </Badge>
  );
}

function TradeHistoryTab() {
  const [instrumentFilter, setInstrumentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tickerFilter, setTickerFilter] = useState<string>("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const { data: trades, isLoading } = useQuery<TradeSyncSignal[]>({
    queryKey: ["/api/tradesync/trades"],
    refetchInterval: 30000,
  });

  const filtered = trades?.filter((t) => {
    if (instrumentFilter !== "all" && t.data.instrument_type?.toLowerCase() !== instrumentFilter) return false;
    if (statusFilter !== "all") {
      const s = (t.data.status || t.status || "").toLowerCase();
      if (s !== statusFilter) return false;
    }
    if (tickerFilter.trim()) {
      const search = tickerFilter.trim().toUpperCase();
      const ticker = (t.data.ticker || "").toUpperCase();
      const underlying = (t.data.underlying_ticker || "").toUpperCase();
      if (!ticker.includes(search) && !underlying.includes(search)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Filters</CardTitle>
            <Badge variant="outline" data-testid="badge-trade-count">
              {filtered?.length ?? 0} trades
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Select value={instrumentFilter} onValueChange={setInstrumentFilter}>
              <SelectTrigger className="w-40" data-testid="select-instrument-filter">
                <SelectValue placeholder="Instrument" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Instruments</SelectItem>
                <SelectItem value="options">Options</SelectItem>
                <SelectItem value="shares">Shares</SelectItem>
                <SelectItem value="letf">LETF</SelectItem>
                <SelectItem value="letf option">LETF Option</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="tracking">Tracking</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder="Ticker..."
              value={tickerFilter}
              onChange={(e) => setTickerFilter(e.target.value)}
              className="w-28"
              data-testid="input-ticker-filter"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : !filtered || filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="text-empty-state">
              No trades found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Instrument</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Stop</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead>TP Level</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((trade) => (
                  <Fragment key={trade.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedRow(expandedRow === trade.id ? null : trade.id)}
                      data-testid={`row-trade-${trade.id}`}
                    >
                      <TableCell>
                        {expandedRow === trade.id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {trade.createdAt ? new Date(trade.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </TableCell>
                      <TableCell className="font-mono font-semibold">
                        <div>
                          {trade.data.ticker}
                          {trade.data.underlying_ticker && trade.data.underlying_ticker !== trade.data.ticker && (
                            <div className="text-[10px] text-muted-foreground">{trade.data.underlying_ticker}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${instrumentColor(trade.data.instrument_type)}`}>
                          {trade.data.instrument_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${directionColor(trade.data.direction)}`}>
                          {trade.data.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{fmtPrice(trade.data.entry_price)}</TableCell>
                      <TableCell className="font-mono text-xs text-red-400">
                        {fmtPrice(trade.data.current_stop_loss ?? trade.data.stop_loss)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <TargetSummary targets={trade.data.targets} />
                      </TableCell>
                      <TableCell>
                        <TpLevel trade={trade} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{trade.data.trade_type ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${statusColor(trade.data.status || trade.status)}`}>
                          {trade.data.status || trade.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {expandedRow === trade.id && (
                      <TableRow key={`${trade.id}-expand`}>
                        <TableCell colSpan={11} className="bg-muted/30">
                          <TradeDetailPanel trade={trade} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TargetSummary({ targets }: { targets?: Record<string, any> }) {
  if (!targets || Object.keys(targets).length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-col gap-0.5">
      {Object.entries(targets).map(([key, t]) => (
        <span key={key} className="font-mono">
          <span className="text-muted-foreground uppercase">{key}:</span> {fmtPrice(t.price)}
        </span>
      ))}
    </div>
  );
}

function TpLevel({ trade }: { trade: TradeSyncSignal }) {
  const currentTp = trade.data.current_tp_number ?? 0;
  const hitTargets = trade.data.hit_targets ?? {};
  const numHit = Object.keys(hitTargets).length;
  const level = Math.max(currentTp, numHit);

  if (level === 0) return <span className="text-xs text-muted-foreground">—</span>;

  return (
    <div className="flex items-center gap-1">
      {level >= 1 && (
        <Badge className="text-[9px] px-1 py-0 bg-cyan-500 text-white">TP1</Badge>
      )}
      {level >= 2 && (
        <Badge className="text-[9px] px-1 py-0 bg-purple-500 text-white">TP2</Badge>
      )}
      {level >= 3 && (
        <Badge className="text-[9px] px-1 py-0 bg-emerald-500 text-white">TP3</Badge>
      )}
    </div>
  );
}

function TradeDetailPanel({ trade }: { trade: TradeSyncSignal }) {
  const d = trade.data;

  return (
    <div className="p-3 space-y-3 text-sm">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DetailItem label="Signal ID" value={trade.id.slice(0, 8) + "..."} mono />
        <DetailItem label="Source" value={trade.sourceAppName ?? "—"} />
        <DetailItem label="Auto Track" value={d.auto_track ? "Yes" : "No"} />
        <DetailItem label="Time Stop" value={d.time_stop ?? "—"} />
        <DetailItem label="Expiration" value={d.expiration ?? "—"} />
        {d.strike != null && <DetailItem label="Strike" value={`$${d.strike}`} mono />}
        {d.right && <DetailItem label="Right" value={d.right} />}
        {d.leverage != null && <DetailItem label="Leverage" value={`${d.leverage}x`} />}
        <DetailItem label="Remaining Qty" value={String(d.remain_quantity ?? "—")} />
      </div>

      {d.entry_underlying_price != null && (
        <div className="flex gap-4 text-xs">
          <span className="text-muted-foreground">Underlying Entry: <span className="font-mono text-foreground">{fmtPrice(d.entry_underlying_price)}</span></span>
          {d.entry_option_price != null && (
            <span className="text-muted-foreground">Option Entry: <span className="font-mono text-foreground">{fmtPrice(d.entry_option_price)}</span></span>
          )}
          {d.entry_letf_price != null && (
            <span className="text-muted-foreground">LETF Entry: <span className="font-mono text-foreground">{fmtPrice(d.entry_letf_price)}</span></span>
          )}
        </div>
      )}

      {d.targets && Object.keys(d.targets).length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Targets</span>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {Object.entries(d.targets).map(([key, t]) => {
              const isHit = d.hit_targets && key in d.hit_targets;
              return (
                <div key={key} className={`rounded border p-2 text-xs ${isHit ? "border-green-500/40 bg-green-500/5" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium uppercase">{key}</span>
                    {isHit && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                  </div>
                  <div className="font-mono">{fmtPrice(t.price)}</div>
                  {t.percentage != null && <div className="text-muted-foreground">{t.percentage.toFixed(1)}%</div>}
                  {t.take_off_percent != null && <div className="text-muted-foreground">Take off: {t.take_off_percent}%</div>}
                  {t.raise_stop_loss?.price != null && (
                    <div className="text-amber-400 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Raise SL → {fmtPrice(t.raise_stop_loss.price)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {d.current_stop_loss != null && d.stop_loss != null && d.current_stop_loss !== d.stop_loss && (
        <div className="flex items-center gap-2 text-xs bg-amber-500/5 rounded p-2 border border-amber-500/30">
          <Shield className="w-3 h-3 text-amber-500" />
          <span className="text-muted-foreground">Stop raised from {fmtPrice(d.stop_loss)} → {fmtPrice(d.current_stop_loss)}</span>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function DiscordTemplatesTab() {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const { data: templates, isLoading } = useQuery<TradeSyncTemplate[]>({
    queryKey: ["/api/tradesync/templates"],
    queryFn: async () => {
      const res = await fetch("/api/tradesync/templates");
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-templates">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground" data-testid="text-no-templates">No Discord templates found in Trade Sync.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {templates.map((group) => (
        <Card key={group.instrumentType}>
          <CardHeader
            className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setExpandedGroup(expandedGroup === group.instrumentType ? null : group.instrumentType)}
            data-testid={`card-template-group-${group.instrumentType}`}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Badge variant="outline" className={instrumentColor(group.instrumentType)}>
                  {group.instrumentType}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {group.templates.length} templates
                </span>
              </CardTitle>
              {expandedGroup === group.instrumentType ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          {expandedGroup === group.instrumentType && (
            <CardContent className="space-y-3">
              {group.templates.map((tmpl) => (
                <div key={tmpl.type} className="rounded border p-3 space-y-2" data-testid={`tmpl-${group.instrumentType}-${tmpl.type}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{tmpl.type}</Badge>
                    <span className="text-sm font-medium">{tmpl.label}</span>
                  </div>
                  <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
                    {tmpl.template}
                  </pre>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
