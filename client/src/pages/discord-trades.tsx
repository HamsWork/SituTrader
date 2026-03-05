import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback, Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Loader2, MessageSquare, ChevronDown, ChevronRight, Save, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DiscordTradeLog, EmbedTemplate } from "@shared/schema";

function eventColor(event: string): string {
  if (event === "FILLED") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (event.startsWith("TP")) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (event === "STOPPED_OUT") return "bg-red-500/20 text-red-400 border-red-500/30";
  if (event === "STOPPED_OUT_AFTER_TP") return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  if (event === "CLOSED") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (event === "RAISE_STOP" || event === "TIME_STOP") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

function channelBadge(channel: string) {
  const colors: Record<string, string> = {
    alerts: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    swings: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    shares: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  return colors[channel] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

function statusBadge(status: string) {
  if (status === "sent") return "bg-green-500/20 text-green-400 border-green-500/30";
  if (status === "failed") return "bg-red-500/20 text-red-400 border-red-500/30";
  return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
}

function fmtPrice(p: number | null | undefined): string {
  if (p == null) return "—";
  return `$${p.toFixed(2)}`;
}

const INSTRUMENT_LABELS: Record<string, string> = {
  OPTIONS: "Options",
  SHARES: "Shares",
  LEVERAGED_ETF: "Leveraged ETF",
  LETF_OPTIONS: "LETF Options",
};

const EVENT_LABELS: Record<string, string> = {
  FILLED: "Entry Fill",
  TP1_HIT: "TP1 Hit",
  TP2_HIT: "TP2 Hit",
  RAISE_STOP: "Raise Stop",
  STOPPED_OUT: "Stopped Out",
  CLOSED: "Trade Closed",
};

const INSTRUMENT_COLORS: Record<string, string> = {
  OPTIONS: "border-purple-500/40 bg-purple-500/5",
  SHARES: "border-blue-500/40 bg-blue-500/5",
  LEVERAGED_ETF: "border-cyan-500/40 bg-cyan-500/5",
  LETF_OPTIONS: "border-amber-500/40 bg-amber-500/5",
};

export default function DiscordTradesPage() {
  return (
    <div className="p-4 space-y-4" data-testid="page-discord-trades">
      <div className="flex items-center gap-3">
        <MessageSquare className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold" data-testid="text-page-title">Discord Trade Logs</h1>
      </div>

      <Tabs defaultValue="logs" className="w-full">
        <TabsList data-testid="tabs-discord">
          <TabsTrigger value="logs" data-testid="tab-logs">Trade Logs</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">Embed Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="logs">
          <TradeLogsTab />
        </TabsContent>
        <TabsContent value="templates">
          <EmbedTemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TradeLogsTab() {
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [tickerFilter, setTickerFilter] = useState<string>("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  queryParams.set("limit", "200");
  if (channelFilter !== "all") queryParams.set("channel", channelFilter);
  if (eventFilter !== "all") queryParams.set("event", eventFilter);
  if (tickerFilter.trim()) queryParams.set("ticker", tickerFilter.trim().toUpperCase());

  const { data: logs, isLoading } = useQuery<DiscordTradeLog[]>({
    queryKey: ["/api/discord-trades", channelFilter, eventFilter, tickerFilter],
    queryFn: async () => {
      const res = await fetch(`/api/discord-trades?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch Discord trade logs");
      return res.json();
    },
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Filters</CardTitle>
            <Badge variant="outline" data-testid="badge-log-count">
              {logs?.length ?? 0} logs
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-36" data-testid="select-channel-filter">
                <SelectValue placeholder="Channel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                <SelectItem value="alerts">Alerts (Options)</SelectItem>
                <SelectItem value="swings">Swings (LETF)</SelectItem>
                <SelectItem value="shares">Shares</SelectItem>
              </SelectContent>
            </Select>

            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="w-44" data-testid="select-event-filter">
                <SelectValue placeholder="Event" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="FILLED">Filled</SelectItem>
                <SelectItem value="TP1_HIT">TP1 Hit</SelectItem>
                <SelectItem value="TP2_HIT">TP2 Hit</SelectItem>
                <SelectItem value="TP3_HIT">TP3 Hit</SelectItem>
                <SelectItem value="STOPPED_OUT">Stopped Out</SelectItem>
                <SelectItem value="STOPPED_OUT_AFTER_TP">Stopped After TP</SelectItem>
                <SelectItem value="RAISE_STOP">Raise Stop</SelectItem>
                <SelectItem value="TIME_STOP">Time Stop</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
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
          ) : !logs || logs.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="text-empty-state">
              No Discord trade logs found
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Instrument</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Stop</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead>P&L %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IDs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                      data-testid={`row-discord-log-${log.id}`}
                    >
                      <TableCell>
                        {expandedRow === log.id ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap" data-testid={`text-time-${log.id}`}>
                        {log.createdAt ? new Date(log.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${eventColor(log.event)}`} data-testid={`badge-event-${log.id}`}>
                          {log.event}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${channelBadge(log.channel)}`} data-testid={`badge-channel-${log.id}`}>
                          {log.channel}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono font-semibold" data-testid={`text-ticker-${log.id}`}>
                        {log.ticker ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs" data-testid={`text-instrument-${log.id}`}>
                        <span className="text-muted-foreground">{log.instrumentType ?? "—"}</span>
                        {log.instrumentTicker && log.instrumentTicker !== log.ticker && (
                          <span className="ml-1 font-mono">{log.instrumentTicker}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-entry-${log.id}`}>{fmtPrice(log.entryPrice)}</TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-target-${log.id}`}>{fmtPrice(log.targetPrice)}</TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-stop-${log.id}`}>{fmtPrice(log.stopPrice)}</TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-exit-${log.id}`}>{fmtPrice(log.exitPrice)}</TableCell>
                      <TableCell className="font-mono text-xs" data-testid={`text-pnl-${log.id}`}>
                        {log.profitPct != null ? (
                          <span className={log.profitPct >= 0 ? "text-green-400" : "text-red-400"}>
                            {log.profitPct >= 0 ? "+" : ""}{log.profitPct.toFixed(1)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${statusBadge(log.webhookStatus)}`} data-testid={`badge-status-${log.id}`}>
                          {log.webhookStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground" data-testid={`text-ids-${log.id}`}>
                        {log.signalId && <span>S:{log.signalId}</span>}
                        {log.tradeId && <span className="ml-1">T:{log.tradeId}</span>}
                      </TableCell>
                    </TableRow>
                    {expandedRow === log.id && (
                      <TableRow key={`${log.id}-expand`}>
                        <TableCell colSpan={13} className="bg-muted/30">
                          <EmbedPreview embed={log.embedJson as any} messageId={log.discordMessageId} errorMessage={log.errorMessage} />
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

function EmbedTemplatesTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editJson, setEditJson] = useState<string>("");
  const [editName, setEditName] = useState<string>("");
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [instrumentFilter, setInstrumentFilter] = useState<string>("all");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: templates, isLoading } = useQuery<EmbedTemplate[]>({
    queryKey: ["/api/embed-templates"],
  });

  const { data: variables } = useQuery<Record<string, string>>({
    queryKey: ["/api/embed-templates/variables"],
  });

  const saveMutation = useMutation({
    mutationFn: async ({ id, embedJson, templateName }: { id: number; embedJson: any; templateName: string }) => {
      return apiRequest("PUT", `/api/embed-templates/${id}`, { embedJson, templateName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/embed-templates"] });
      toast({ title: "Template saved" });
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/embed-templates/reset/${id}`);
    },
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/embed-templates"] });
      const data = await res.json();
      if (data.embedJson) {
        setEditJson(JSON.stringify(data.embedJson, null, 2));
        setEditName(data.templateName);
      }
      toast({ title: "Template reset to default" });
    },
    onError: (err: any) => {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      return apiRequest("PUT", `/api/embed-templates/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/embed-templates"] });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/embed-templates/seed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/embed-templates"] });
      toast({ title: "Templates seeded" });
    },
  });

  const fetchPreview = useCallback(async (json: string, instrumentType?: string) => {
    try {
      const parsed = JSON.parse(json);
      setPreviewLoading(true);
      const res = await apiRequest("POST", "/api/embed-templates/preview", { embedJson: parsed, instrumentType });
      const data = await res.json();
      setPreviewData(data);
    } catch {
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const selectTemplate = (t: EmbedTemplate) => {
    setSelectedId(t.id);
    const json = JSON.stringify(t.embedJson, null, 2);
    setEditJson(json);
    setEditName(t.templateName);
    fetchPreview(json, t.instrumentType);
  };

  const handleSave = () => {
    if (!selectedId) return;
    try {
      const parsed = JSON.parse(editJson);
      saveMutation.mutate({ id: selectedId, embedJson: parsed, templateName: editName });
    } catch {
      toast({ title: "Invalid JSON", variant: "destructive" });
    }
  };

  const handleJsonChange = (val: string) => {
    setEditJson(val);
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    const instrumentType = templates?.find((t) => t.id === selectedId)?.instrumentType;
    previewDebounceRef.current = setTimeout(() => fetchPreview(val, instrumentType), 600);
  };

  const insertVariable = (varKey: string) => {
    try {
      navigator.clipboard.writeText(varKey);
      toast({ title: `Copied ${varKey}`, description: "Paste it into the JSON where you need it" });
    } catch {
      toast({ title: varKey, description: "Copy this variable into your JSON" });
    }
  };

  const filteredTemplates = templates?.filter((t) => {
    if (instrumentFilter !== "all" && t.instrumentType !== instrumentFilter) return false;
    if (eventFilter !== "all" && t.eventType !== eventFilter) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <p className="text-muted-foreground">No embed templates found.</p>
          <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-seed-templates">
            {seedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Seed Default Templates
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-4 space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Templates ({templates.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2">
              <Select value={instrumentFilter} onValueChange={setInstrumentFilter}>
                <SelectTrigger className="text-xs h-8" data-testid="select-tmpl-instrument">
                  <SelectValue placeholder="Instrument" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Instruments</SelectItem>
                  <SelectItem value="OPTIONS">Options</SelectItem>
                  <SelectItem value="SHARES">Shares</SelectItem>
                  <SelectItem value="LEVERAGED_ETF">Leveraged ETF</SelectItem>
                  <SelectItem value="LETF_OPTIONS">LETF Options</SelectItem>
                </SelectContent>
              </Select>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger className="text-xs h-8" data-testid="select-tmpl-event">
                  <SelectValue placeholder="Event" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="FILLED">Filled</SelectItem>
                  <SelectItem value="TP1_HIT">TP1 Hit</SelectItem>
                  <SelectItem value="TP2_HIT">TP2 Hit</SelectItem>
                  <SelectItem value="RAISE_STOP">Raise Stop</SelectItem>
                  <SelectItem value="STOPPED_OUT">Stopped Out</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {filteredTemplates?.map((t) => (
                <div
                  key={t.id}
                  className={`p-2 rounded cursor-pointer border text-xs transition-colors ${
                    selectedId === t.id
                      ? "border-primary bg-primary/10"
                      : `${INSTRUMENT_COLORS[t.instrumentType] || "border-border"} hover:bg-muted/50`
                  }`}
                  onClick={() => selectTemplate(t)}
                  data-testid={`tmpl-card-${t.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium truncate">{t.templateName}</span>
                    <Switch
                      checked={t.isActive}
                      onCheckedChange={(checked) => toggleMutation.mutate({ id: t.id, isActive: checked })}
                      className="scale-75"
                      data-testid={`switch-active-${t.id}`}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex gap-1 mt-1">
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {INSTRUMENT_LABELS[t.instrumentType] || t.instrumentType}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {EVENT_LABELS[t.eventType] || t.eventType}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="col-span-8 space-y-3">
        {selectedId ? (
          <>
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">Live Preview</CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resetMutation.mutate(selectedId)}
                      disabled={resetMutation.isPending}
                      data-testid="button-reset-template"
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={saveMutation.isPending}
                      data-testid="button-save-template"
                    >
                      <Save className="w-3 h-3 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {previewLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mr-2" />
                    <span className="text-sm text-muted-foreground">Updating preview...</span>
                  </div>
                ) : previewData ? (
                  <EmbedPreview embed={previewData} />
                ) : (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Preview will appear here as you edit
                  </div>
                )}
              </CardContent>
            </Card>

            {variables && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Insert Variable</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(variables).map(([key, desc]) => (
                      <Badge
                        key={key}
                        variant="outline"
                        className="cursor-pointer text-xs font-mono gap-1 px-2 py-1"
                        onClick={() => insertVariable(key)}
                        title={desc}
                        data-testid={`var-btn-${key.replace(/[{}]/g, "")}`}
                      >
                        {key}
                        <span className="text-muted-foreground text-[10px] font-sans hidden lg:inline">{desc}</span>
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Embed JSON</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Template Name</label>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 text-sm"
                    data-testid="input-template-name"
                  />
                </div>
                <div>
                  <Textarea
                    value={editJson}
                    onChange={(e) => handleJsonChange(e.target.value)}
                    className="font-mono text-xs min-h-[350px]"
                    data-testid="textarea-embed-json"
                  />
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a template from the left panel to edit
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function EmbedPreview({ embed, messageId, errorMessage }: { embed: any; messageId?: string | null; errorMessage?: string | null }) {
  if (!embed) return <div className="p-3 text-sm text-muted-foreground">No embed data</div>;

  const colorHex = typeof embed.color === "number"
    ? `#${embed.color.toString(16).padStart(6, "0")}`
    : typeof embed.color === "string" && embed.color.startsWith("#")
      ? embed.color
      : "#5865f2";

  return (
    <div className="p-3 max-w-xl" data-testid="embed-preview">
      <div className="rounded-md overflow-hidden border" style={{ borderLeftColor: colorHex, borderLeftWidth: "4px" }}>
        <div className="p-3 bg-card space-y-2">
          {embed.description && (
            <div className="text-sm font-medium">{embed.description.replace(/\*\*/g, "")}</div>
          )}
          {embed.fields && (
            <div className="grid grid-cols-3 gap-2">
              {embed.fields.map((f: any, i: number) => {
                if (f.name === "\u200b" && !f.value) return null;
                return (
                  <div key={i} className={f.inline !== false ? "col-span-1" : "col-span-3"}>
                    <div className="text-xs font-semibold text-muted-foreground">{f.name}</div>
                    <div className="text-xs whitespace-pre-wrap">{f.value || "\u200b"}</div>
                  </div>
                );
              })}
            </div>
          )}
          {embed.footer && (
            <div className="text-[10px] text-muted-foreground pt-1 border-t">
              {typeof embed.footer === "string" ? embed.footer : embed.footer.text}
            </div>
          )}
          {(messageId || errorMessage) && (
            <div className="flex gap-4 text-[10px] text-muted-foreground pt-1">
              {messageId && <span>Msg ID: {messageId}</span>}
              {errorMessage && <span className="text-red-400">Error: {errorMessage}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
