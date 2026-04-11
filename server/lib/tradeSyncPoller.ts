import { log } from "../index";
import { storage } from "../storage";
import { fetchSignalById, isTradeSyncEnabled } from "./tradesync";

const RTH_INTERVAL = 30_000;
const OFF_HOURS_INTERVAL = 5 * 60_000;
const TICK_CHECK_INTERVAL = 15_000;

let pollerInterval: ReturnType<typeof setInterval> | null = null;
let lastTickMs = 0;

function isRTH(): boolean {
  const now = new Date();
  const ct = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const hours = ct.getHours();
  const minutes = ct.getMinutes();
  const totalMin = hours * 60 + minutes;
  const day = ct.getDay();
  if (day === 0 || day === 6) return false;
  return totalMin >= 510 && totalMin <= 900;
}

async function pollTradeSyncStatuses(): Promise<number> {
  if (!isTradeSyncEnabled()) return 0;

  const trades = await storage.getActiveIbkrTrades();
  const tradesWithTsId = trades.filter(
    (t) => t.tradesyncSignalId != null && t.tradesyncSignalId !== "",
  );

  if (tradesWithTsId.length === 0) return 0;

  let updated = 0;

  const fetches = tradesWithTsId.map(async (trade) => {
    try {
      const tsId = trade.tradesyncSignalId!;
      const result = await fetchSignalById(tsId);

      if (!result.ok || !result.data) {
        log(`TS poller: fetch failed for trade ${trade.id} (ts_id=${tsId.slice(0,8)}): ${result.error ?? "no data"}`, "tsPoller");
        return;
      }

      const resp = result.data;
      const d = resp.data ?? {};

      const pnlPercent = (() => {
        const entryPrice = d.entry_instrument_price ?? d.entry_tracking_price ?? d.entry_price;
        const currentPrice = d.current_instrument_price ?? d.current_tracking_price;
        if (entryPrice && currentPrice && entryPrice > 0) {
          return ((currentPrice - entryPrice) / entryPrice) * 100;
        }
        return d.pnl_percent ?? null;
      })();

      await storage.upsertTradesyncSignalCache({
        tradesyncSignalId: tsId,
        ibkrTradeId: trade.id,
        signalId: trade.signalId,
        ticker: d.ticker ?? trade.ticker,
        instrumentType: d.instrument_type ?? trade.instrumentType,
        tsStatus: resp.status ?? d.status ?? "unknown",
        dataStatus: d.status ?? null,
        autoTrack: d.auto_track ?? false,
        currentStopLoss: d.current_stop_loss ?? null,
        currentTpNumber: d.current_tp_number ?? 0,
        trailingStopActive: d.milestone_trailing_stop_active ?? false,
        trailingStopHigh: d.milestone_trailing_stop_high ?? null,
        trailingStopPercent: d.milestone_trailing_stop_percent ?? null,
        currentTrackingPrice: d.current_tracking_price ?? null,
        currentInstrumentPrice: d.current_instrument_price ?? null,
        remainQuantity: d.remain_quantity ?? null,
        stopLossHit: d.stop_loss_hit ?? false,
        stopLossHitAt: d.stop_loss_hit_at ?? null,
        lastMilestoneAlerted: d.last_milestone_alerted ?? null,
        currentStopLossPercent: d.current_stop_loss_percent ?? null,
        pnlPercent,
        hitTargetsJson: d.hit_targets ?? null,
        targetsJson: d.targets ?? null,
        rawJson: resp,
      });

      updated++;
    } catch (err: any) {
      log(
        `TS poller error for trade ${trade.id} (ts_id=${trade.tradesyncSignalId}): ${err.message}`,
        "tsPoller",
      );
    }
  });

  await Promise.allSettled(fetches);
  return updated;
}

export function startTradeSyncPoller() {
  if (pollerInterval) return;

  log("Starting Trade Sync status poller...", "tsPoller");

  async function tick() {
    try {
      const now = Date.now();
      const rth = isRTH();
      const interval = rth ? RTH_INTERVAL : OFF_HOURS_INTERVAL;

      if (now - lastTickMs < interval) return;
      lastTickMs = now;

      const updated = await pollTradeSyncStatuses();
      log(`TS poller tick: updated ${updated} signal(s) (${rth ? "RTH" : "off-hours"})`, "tsPoller");
    } catch (err: any) {
      log(`TS poller tick error: ${err.message}`, "tsPoller");
    }
  }

  pollerInterval = setInterval(tick, TICK_CHECK_INTERVAL);
  setTimeout(tick, 8_000);
}

export function stopTradeSyncPoller() {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
    log("Trade Sync poller stopped", "tsPoller");
  }
}
