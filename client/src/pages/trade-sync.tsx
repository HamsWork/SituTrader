import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  History, Search, CheckCircle, XCircle, ChevronDown, ChevronUp, Copy, FileText,
  ArrowUpRight, ArrowDownRight, X, Send, Wifi, WifiOff
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TradeSyncSignal {
  id: string;
  status: string;
  createdAt: string;
  sourceAppName?: string;
  discordChannelId?: string;
  tradeSyncError?: string;
  tradeSyncResponse?: string;
  data: {
    ticker: string;
    instrument_type: string;
    direction: string;
    entry_price: number | string;
    stop_loss?: number | string;
    current_stop_loss?: number | string;
    time_stop?: string;
    expiration?: string;
    strike?: number | string;
    right?: string;
    trade_type?: string;
    auto_track?: boolean;
    status?: string;
    hit_targets?: Record<string, any>;
    current_tp_number?: number;
    remain_quantity?: number;
    underlying_ticker?: string;
    entry_option_price?: number | string;
    entry_underlying_price?: number | string;
    entry_letf_price?: number | string;
    leverage?: number;
    risk_value?: string;
    discord_webhook_url?: string;
    targets?: Record<string, {
      price?: number;
      percentage?: number;
      take_off_percent?: number;
      raise_stop_loss?: { price?: number; trailing_stop_percent?: number };
    }>;
  };
}

interface TradeSyncStatus {
  configured: boolean;
  reachable: boolean;
  enabled: boolean;
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function fmtPrice(p: number | string | null | undefined): string {
  const n = num(p);
  if (n === 0) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  } catch { return "Unknown"; }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return "—"; }
}

function getSignalStatus(signal: TradeSyncSignal): string {
  return (signal.data.status || signal.status || "unknown").toLowerCase();
}

function isCompleted(signal: TradeSyncSignal): boolean {
  const s = getSignalStatus(signal);
  return s === "completed";
}

function isActive(signal: TradeSyncSignal): boolean {
  const s = getSignalStatus(signal);
  return s === "active" || s === "tracking" || s === "submitted";
}

function isFailed(signal: TradeSyncSignal): boolean {
  const s = getSignalStatus(signal);
  return s === "stopped" || s === "stopped_out" || s === "cancelled" || s === "expired" || s === "error";
}

function isPositive(signal: TradeSyncSignal): boolean {
  return isCompleted(signal) || isActive(signal);
}

const SENSITIVE_KEYS = new Set(["discord_webhook_url"]);

function redactPayload(data: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key)) {
      result[key] = "***REDACTED***";
    } else {
      result[key] = value;
    }
  }
  return result;
}

type PreviewTab = "entry" | "tp_hit" | "sl_raised" | "sl_hit";

function DiscordPreviewModal({ signal, onClose }: { signal: TradeSyncSignal; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<PreviewTab>("entry");
  const d = signal.data;
  const entry = num(d.entry_price);
  const stopLoss = num(d.current_stop_loss ?? d.stop_loss);
  const stockPx = num(d.entry_underlying_price);
  const isOption = d.instrument_type === "Options" || d.instrument_type === "LETF Option";
  const isLETF = d.instrument_type === "LETF" || d.instrument_type === "LETF Option";

  const instrumentLabel = isLETF
    ? (isOption ? "LETF Option" : "LETF")
    : (isOption ? "Options" : "Shares");
  const title = `🚨 ${d.ticker} ${instrumentLabel} Entry`;

  const tabs: { key: PreviewTab; label: string }[] = [
    { key: "entry", label: "Entry Signal" },
    { key: "tp_hit", label: "Target Hit" },
    { key: "sl_raised", label: "SL Raised" },
    { key: "sl_hit", label: "Stop Loss Hit" },
  ];

  const tabColors: Record<PreviewTab, string> = {
    entry: "#22c55e",
    tp_hit: "#22c55e",
    sl_raised: "#f59e0b",
    sl_hit: "#ef4444",
  };

  function renderEntryEmbed() {
    return (
      <div className="space-y-3">
        <p className="font-bold text-white">{title}</p>

        {isOption ? (
          <>
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              <div>
                <span className="text-[#72767d] text-xs font-semibold">🟢 Ticker</span>
                <p className="text-white">{d.ticker}</p>
              </div>
              <div>
                <span className="text-[#72767d] text-xs font-semibold">📊 Stock Price</span>
                <p className="text-white">{fmtPrice(stockPx || entry)}</p>
              </div>
              <div>
                <span className="text-[#72767d] text-xs font-semibold">📈 Direction</span>
                <p className="text-white">{d.right === "C" ? "Call" : d.right === "P" ? "Put" : d.direction}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              <div>
                <span className="text-[#72767d] text-xs font-semibold">❌ Expiration</span>
                <p className="text-white">{d.expiration || "—"}</p>
              </div>
              <div>
                <span className="text-[#72767d] text-xs font-semibold">✍️ Strike</span>
                <p className="text-white">{d.strike || "—"} {d.right === "C" ? "Call" : d.right === "P" ? "Put" : ""}</p>
              </div>
              <div>
                <span className="text-[#72767d] text-xs font-semibold">💵 Option Price</span>
                <p className="text-white">{fmtPrice(d.entry_option_price ?? entry)}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-3 gap-x-4 gap-y-2">
            <div>
              <span className="text-[#72767d] text-xs font-semibold">🟢 Ticker</span>
              <p className="text-white">{d.ticker}</p>
            </div>
            <div>
              <span className="text-[#72767d] text-xs font-semibold">📊 Stock Price</span>
              <p className="text-white">{fmtPrice(stockPx || entry)}</p>
            </div>
            <div>
              <span className="text-[#72767d] text-xs font-semibold">📈 Direction</span>
              <p className="text-white">{d.direction}</p>
            </div>
          </div>
        )}

        {d.targets && Object.keys(d.targets).length > 0 && (
          <>
            <div>
              <p className="font-bold text-white flex items-center gap-1.5">
                <span>📋</span> Trade Plan
              </p>
              <p className="mt-1">
                <span>🎯</span>{" "}
                Targets: {Object.entries(d.targets).map(([key, t]) =>
                  `${fmtPrice(t.price)} (${key.toUpperCase()})`
                ).join(", ")}
              </p>
              <p>
                <span>🔴</span>{" "}
                Stop Loss: {fmtPrice(stopLoss)}
              </p>
              {d.time_stop && (
                <p><span>📅</span> Time Stop: {d.time_stop}</p>
              )}
            </div>

            <div>
              <p className="font-bold text-white flex items-center gap-1.5">
                <span>💰</span> Take Profit Plan
              </p>
              {Object.entries(d.targets).map(([key, t], i) => (
                <p key={key} className="text-xs mt-1 leading-relaxed">
                  {key.toUpperCase()}: At {fmtPrice(t.price)} take off {t.take_off_percent ?? 100}% of {i === 0 ? "position" : "remaining position"}
                  {t.raise_stop_loss?.price != null && ` and raise stop loss to ${fmtPrice(t.raise_stop_loss.price)}`}.
                </p>
              ))}
            </div>
          </>
        )}

        <p className="text-[10px] text-[#72767d] italic pt-1">
          Disclaimer: Not financial advice. Trade at your own risk.
        </p>
      </div>
    );
  }

  function renderTPHitEmbed() {
    const hitTargets = d.hit_targets ?? {};
    const hitKeys = Object.keys(hitTargets);
    if (hitKeys.length === 0) {
      return (
        <div className="space-y-3">
          <p className="font-bold text-white">🎯 {d.ticker} — No targets hit yet</p>
          <p className="text-[#72767d] text-sm">Waiting for target levels to be reached.</p>
        </div>
      );
    }

    const lastKey = hitKeys[hitKeys.length - 1];
    const lastHit = hitTargets[lastKey];
    const profitPct = lastHit?.profitPct != null ? num(lastHit.profitPct).toFixed(1) : "—";

    return (
      <div className="space-y-3">
        <p className="font-bold text-white">🎯 {d.ticker} {instrumentLabel} — {lastKey.toUpperCase()} HIT</p>

        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <div>
            <span className="text-[#72767d] text-xs font-semibold">🟢 Ticker</span>
            <p className="text-white">{d.ticker}</p>
          </div>
          <div>
            <span className="text-[#72767d] text-xs font-semibold">✅ ENTRY</span>
            <p className="text-white">{fmtPrice(entry)}</p>
          </div>
          <div>
            <span className="text-[#72767d] text-xs font-semibold">🎯 {lastKey.toUpperCase()} HIT</span>
            <p className="text-white">{fmtPrice(lastHit?.trackingPrice)}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <div>
            <span className="text-[#72767d] text-xs font-semibold">📈 DIRECTION</span>
            <p className="text-white">{d.direction}</p>
          </div>
          <div>
            <span className="text-[#72767d] text-xs font-semibold">💸 Profit</span>
            <p className="text-white">{profitPct}%</p>
          </div>
          {lastHit?.take_off_quantity != null && (
            <div>
              <span className="text-[#72767d] text-xs font-semibold">📦 Take Off</span>
              <p className="text-white">{lastHit.take_off_quantity}%</p>
            </div>
          )}
        </div>

        <p className="text-white">🚨 Status: {lastKey.toUpperCase()} REACHED 🚨</p>

        <p className="text-[10px] text-[#72767d] italic pt-1">
          Disclaimer: Not financial advice. Trade at your own risk.
        </p>
      </div>
    );
  }

  function renderSLRaisedEmbed() {
    const origSL = num(d.stop_loss);
    const currentSL = num(d.current_stop_loss);

    return (
      <div className="space-y-3">
        <p className="font-bold text-white">🛡️ {d.ticker} {instrumentLabel} — Stop Loss Raised</p>

        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <div>
            <span className="text-[#72767d] text-xs font-semibold">🟢 Ticker</span>
            <p className="text-white">{d.ticker}</p>
          </div>
          <div>
            <span className="text-[#72767d] text-xs font-semibold">🔴 Old SL</span>
            <p className="text-white">{fmtPrice(origSL)}</p>
          </div>
          <div>
            <span className="text-[#72767d] text-xs font-semibold">🟢 New SL</span>
            <p className="text-white">{fmtPrice(currentSL)}</p>
          </div>
        </div>

        <div>
          <p className="font-bold text-white flex items-center gap-1.5">
            <span>🛡️</span> Risk Management
          </p>
          <p className="text-xs mt-1 leading-relaxed">
            Stop loss raised from {fmtPrice(origSL)} to {fmtPrice(currentSL)} to secure gains while allowing room to run.
          </p>
        </div>

        <p className="text-[10px] text-[#72767d] italic pt-1">
          Disclaimer: Not financial advice. Trade at your own risk.
        </p>
      </div>
    );
  }

  function renderSLHitEmbed() {
    return (
      <div className="space-y-3">
        <p className="font-bold text-white">🛑 {d.ticker} {instrumentLabel} — Stop Loss HIT</p>

        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          <div>
            <span className="text-[#72767d] text-xs font-semibold">🟢 Ticker</span>
            <p className="text-white">{d.ticker}</p>
          </div>
          <div>
            <span className="text-[#72767d] text-xs font-semibold">✅ ENTRY</span>
            <p className="text-white">{fmtPrice(entry)}</p>
          </div>
          <div>
            <span className="text-[#72767d] text-xs font-semibold">🛑 Stop Hit</span>
            <p className="text-white">{fmtPrice(d.current_stop_loss ?? d.stop_loss)}</p>
          </div>
        </div>

        <p className="text-white">🚨 Status: POSITION CLOSED 🚨</p>

        <div>
          <p className="font-bold text-white flex items-center gap-1.5">
            <span>🛡️</span> Discipline Matters
          </p>
          <p className="text-xs mt-1 leading-relaxed">
            Following the plan keeps you in the game for winning trades
          </p>
        </div>

        <p className="text-[10px] text-[#72767d] italic pt-1">
          Disclaimer: Not financial advice. Trade at your own risk.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose} data-testid="modal-discord-preview">
      <div
        className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-[#2b2d31] border border-[#3a3d45] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#3a3d45]">
          <h3 className="text-sm font-semibold text-white">Discord Preview</h3>
          <button onClick={onClose} className="text-[#72767d] hover:text-white transition-colors" data-testid="button-close-preview">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-[#3a3d45]">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-[#5865f2] text-white"
                  : "bg-[#1e1f22] text-[#b5bac1] hover:bg-[#383a40] hover:text-white"
              }`}
              data-testid={`tab-${tab.key}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4 text-sm text-[#dcddde]">
          <p className="text-[#dcddde] text-sm font-medium mb-3">@everyone</p>
          <div className="flex gap-1">
            <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: tabColors[activeTab] }} />
            <div className="flex-1 pl-3">
              {activeTab === "entry" && renderEntryEmbed()}
              {activeTab === "tp_hit" && renderTPHitEmbed()}
              {activeTab === "sl_raised" && renderSLRaisedEmbed()}
              {activeTab === "sl_hit" && renderSLHitEmbed()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: TradeSyncSignal }) {
  const [expanded, setExpanded] = useState(false);
  const [showResponse, setShowResponse] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const { toast } = useToast();
  const d = signal.data;

  const entry = num(d.entry_price);
  const stopLoss = num(d.current_stop_loss ?? d.stop_loss);
  const stockPx = num(d.entry_underlying_price);
  const isOption = d.instrument_type === "Options" || d.instrument_type === "LETF Option";
  const isLong = d.direction === "Long" || d.direction === "Call";
  const DirIcon = isLong ? ArrowUpRight : ArrowDownRight;

  const status = getSignalStatus(signal);
  const succeeded = isPositive(signal);

  const contractSummary = isOption
    ? `${d.underlying_ticker || d.ticker} ${d.right === "C" ? "Call" : d.right === "P" ? "Put" : d.direction} $${d.strike} ${d.expiration || ""}`
    : `${d.ticker} ${d.instrument_type === "LETF" ? "LETF" : "shares"}`;

  const targetLabel = d.targets && Object.keys(d.targets).length > 0
    ? `${Object.keys(d.targets).length} targets`
    : "";

  const hitCount = d.hit_targets ? Object.keys(d.hit_targets).length : 0;

  function handleCopy() {
    const payload = JSON.stringify(redactPayload(signal.data), null, 2);
    navigator.clipboard.writeText(payload);
    toast({ title: "Copied to clipboard" });
  }

  return (
    <>
      <div
        className="rounded-lg border border-border bg-card overflow-hidden"
        data-testid={`card-signal-${signal.id}`}
      >
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                {succeeded ? (
                  <CheckCircle className="h-4 w-4 text-green-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <DirIcon className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="font-bold text-sm" data-testid={`text-ticker-${signal.id}`}>{d.ticker}</span>
              {d.trade_type && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-muted/50 text-muted-foreground border-border">
                  {d.trade_type.toLowerCase()}
                </Badge>
              )}
              <Badge
                className={`text-[10px] px-2 py-0 h-5 font-bold ${
                  isLong
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-red-600 text-white border-red-600"
                }`}
              >
                {d.direction.toUpperCase()}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-muted/50 text-muted-foreground border-border">
                entry
              </Badge>
              {(d.instrument_type === "LETF" || d.instrument_type === "LETF Option") && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-purple-500/20 text-purple-400 border-purple-500/30">
                  {d.instrument_type}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-time-${signal.id}`}>
              {fmtTime(signal.createdAt)}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-purple-500/10 text-purple-400 border-purple-500/30">
              {d.instrument_type}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 h-5 ${
                succeeded
                  ? "bg-green-500/10 text-green-400 border-green-500/30"
                  : "bg-red-500/10 text-red-400 border-red-500/30"
              }`}
            >
              {status}
            </Badge>
            {hitCount > 0 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                {hitCount} TP hit
              </Badge>
            )}
            {succeeded && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-green-500/10 text-green-400 border-green-500/30">
                verified
              </Badge>
            )}
            <span className="text-muted-foreground ml-auto text-[11px]">{contractSummary}</span>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Trigger </span>
              <span className="font-bold">{fmtPrice(stockPx || entry)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Entry </span>
              <span className="font-bold">{fmtPrice(entry)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Stop </span>
              <span className="font-bold text-red-400">{fmtPrice(stopLoss)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-4 py-2 flex items-center justify-between bg-muted/10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-toggle-payload-${signal.id}`}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Payload
            </button>
            <button
              onClick={() => setShowResponse(!showResponse)}
              className={`flex items-center gap-1 text-xs transition-colors ${
                signal.tradeSyncError
                  ? "text-red-400 hover:text-red-300"
                  : signal.tradeSyncResponse
                    ? "text-green-400 hover:text-green-300"
                    : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`button-toggle-response-${signal.id}`}
            >
              {showResponse ? <ChevronUp className="h-3 w-3" /> : <Send className="h-3 w-3" />}
              Response
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-copy-${signal.id}`}
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`button-preview-${signal.id}`}
            >
              <FileText className="h-3 w-3" />
              Discord Preview
            </button>
            <span className="text-xs text-muted-foreground" data-testid={`text-date-${signal.id}`}>
              {fmtDate(signal.createdAt)}
            </span>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border px-4 py-3 bg-muted/20">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground max-h-60 overflow-y-auto" data-testid={`payload-${signal.id}`}>
              {JSON.stringify(redactPayload(signal.data), null, 2)}
            </pre>
          </div>
        )}

        {showResponse && (
          <div className="border-t border-border px-4 py-3 bg-muted/20">
            {signal.tradeSyncError ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-red-400">Error</p>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-red-300 max-h-40 overflow-y-auto">
                  {signal.tradeSyncError}
                </pre>
              </div>
            ) : signal.tradeSyncResponse ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-green-400">Response</p>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-muted-foreground max-h-40 overflow-y-auto">
                  {signal.tradeSyncResponse}
                </pre>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No response data available.</p>
            )}
          </div>
        )}
      </div>

      {showPreview && (
        <DiscordPreviewModal signal={signal} onClose={() => setShowPreview(false)} />
      )}
    </>
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

export default function SignalHistoryPage() {
  const [search, setSearch] = useState("");

  const { data: trades, isLoading } = useQuery<TradeSyncSignal[]>({
    queryKey: ["/api/tradesync/trades"],
    refetchInterval: 30000,
  });

  const sorted = (trades ?? [])
    .filter(t => {
      if (!search.trim()) return true;
      const s = search.trim().toUpperCase();
      const ticker = (t.data.ticker || "").toUpperCase();
      const underlying = (t.data.underlying_ticker || "").toUpperCase();
      return ticker.includes(s) || underlying.includes(s);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const grouped: Record<string, TradeSyncSignal[]> = {};
  for (const signal of sorted) {
    const dateKey = fmtDate(signal.createdAt);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(signal);
  }

  const totalSent = trades?.length ?? 0;
  const completedCount = trades?.filter(t => isCompleted(t)).length ?? 0;
  const activeCount = trades?.filter(t => isActive(t)).length ?? 0;
  const failedCount = trades?.filter(t => isFailed(t)).length ?? 0;

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-3 sm:gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="page-signal-history">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" data-testid="text-page-title">
              Signal History
            </h1>
            <ConnectionBadge />
          </div>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Complete log of all trading signals sent to Trade Sync
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by ticker..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-search"
          />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-lg border border-border bg-card text-center py-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-bold" data-testid="text-total-sent">{totalSent}</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1">Total Sent</div>
        </div>
        <div className="rounded-lg border border-border bg-card text-center py-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-bold text-green-400" data-testid="text-completed-count">{completedCount}</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1">Completed</div>
        </div>
        <div className="rounded-lg border border-border bg-card text-center py-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-bold text-blue-400" data-testid="text-active-count">{activeCount}</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1">Active</div>
        </div>
        <div className="rounded-lg border border-border bg-card text-center py-3 sm:py-4">
          <div className="text-2xl sm:text-3xl font-bold text-red-400" data-testid="text-failed-count">{failedCount}</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground mt-1">Stopped</div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-signals">
          <History className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-sm font-semibold">No signals found</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {search
              ? "Try adjusting your search."
              : "Your signal history will appear here once signals are sent to Trade Sync."
            }
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([dateKey, dateSignals]) => {
            const okCount = dateSignals.filter(s => isPositive(s)).length;
            return (
              <div key={dateKey} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold" data-testid={`text-date-group-${dateKey}`}>{dateKey}</h3>
                  <span className="text-xs text-muted-foreground">
                    <span className="text-green-400">{okCount} ok</span>{" "}
                    {dateSignals.length} total
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {dateSignals.map(signal => (
                    <SignalCard key={signal.id} signal={signal} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
