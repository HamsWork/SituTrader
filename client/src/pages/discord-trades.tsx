import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, MessageSquare, ChevronDown, ChevronRight } from "lucide-react";
import type { DiscordTradeLog } from "@shared/schema";

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

export default function DiscordTradesPage() {
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
    <div className="p-4 space-y-4" data-testid="page-discord-trades">
      <div className="flex items-center gap-3">
        <MessageSquare className="w-6 h-6 text-primary" />
        <h1 className="text-xl font-bold" data-testid="text-page-title">Discord Trade Logs</h1>
        <Badge variant="outline" className="ml-auto" data-testid="badge-log-count">
          {logs?.length ?? 0} logs
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
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
                  <>
                    <TableRow
                      key={log.id}
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
                          <EmbedPreview log={log} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmbedPreview({ log }: { log: DiscordTradeLog }) {
  const embed = log.embedJson as any;
  if (!embed) return <div className="p-3 text-sm text-muted-foreground">No embed data</div>;

  const colorHex = embed.color ? `#${embed.color.toString(16).padStart(6, "0")}` : "#5865f2";

  return (
    <div className="p-3 max-w-xl" data-testid={`embed-preview-${log.id}`}>
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
            <div className="text-[10px] text-muted-foreground pt-1 border-t">{embed.footer.text}</div>
          )}
          <div className="flex gap-4 text-[10px] text-muted-foreground pt-1">
            {log.discordMessageId && <span>Msg ID: {log.discordMessageId}</span>}
            {log.errorMessage && <span className="text-red-400">Error: {log.errorMessage}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
