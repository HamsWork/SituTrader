import { storage } from "../storage";
import { fetchSnapshot } from "./polygon";
import { computeATR } from "./confidence";
import { runActivationScan } from "./activation";
import { getSetupAlertCategory, type ExpectancyStats } from "./expectancy";
import { log } from "../index";
import type { Signal } from "@shared/schema";

export interface AlertEvent {
  signalId: number;
  ticker: string;
  type: "hit" | "approaching" | "new_signal" | "miss" | "activated" | "invalidated";
  tier: string;
  qualityScore: number;
  message: string;
  timestamp: string;
  routed: boolean;
}

const APPROACHING_ATR_BY_TIER: Record<string, number> = {
  APLUS: 0.10,
  A: 0.15,
  B: 0.20,
  C: 0.30,
};

const TIER_SETTING_KEYS: Record<string, string> = {
  APLUS: "alertTierAplus",
  A: "alertTierA",
  B: "alertTierB",
  C: "alertTierC",
};

function isWithinRTH(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  return totalMinutes >= 570 && totalMinutes <= 960;
}

function rateLimitMinutes(tier: string): number {
  if (tier === "APLUS") return 5;
  if (tier === "A") return 15;
  if (tier === "B") return 30;
  return 60;
}

function shouldRoute(tier: string, routingSettings: Record<string, string>): boolean {
  const settingKey = TIER_SETTING_KEYS[tier] ?? "alertTierC";
  const routing = routingSettings[settingKey] ?? "in-app";
  return routing !== "disabled";
}

function isInApp(tier: string, routingSettings: Record<string, string>): boolean {
  const settingKey = TIER_SETTING_KEYS[tier] ?? "alertTierC";
  const routing = routingSettings[settingKey] ?? "in-app";
  return routing === "in-app";
}

export async function runAlerts(): Promise<AlertEvent[]> {
  const events: AlertEvent[] = [];
  const now = new Date();
  const nowIso = now.toISOString();

  const settings = await storage.getAllSettings();
  const focusMode = settings.focusMode || "EXPECTANCY";
  const winRateThreshold = parseFloat(settings.focusWinRateThreshold || "0.70");
  const expectancyThreshold = parseFloat(settings.focusExpectancyThreshold || "0.15");

  let setupStatsData: ExpectancyStats[] = [];
  try {
    const overallStats = await storage.getOverallSetupExpectancy();
    setupStatsData = overallStats.map(s => ({
      setupType: s.setupType,
      ticker: s.ticker,
      sampleSize: s.sampleSize,
      winRate: s.winRate,
      avgWinR: s.avgWinR,
      avgLossR: s.avgLossR,
      medianR: s.medianR,
      expectancyR: s.expectancyR,
      profitFactor: s.profitFactor,
      avgMaeR: s.avgMaeR,
      medianMaeR: s.medianMaeR,
      tradeability: s.tradeability as "CLEAN" | "CAUTION" | "AVOID",
      category: s.category as "PRIMARY" | "SECONDARY" | "OFF",
    }));
  } catch {}

  const eligibleSignals = await storage.getAlertEligibleSignals();
  if (eligibleSignals.length === 0) return events;

  const tickerGroups = new Map<string, Signal[]>();
  for (const sig of eligibleSignals) {
    if (!tickerGroups.has(sig.ticker)) tickerGroups.set(sig.ticker, []);
    tickerGroups.get(sig.ticker)!.push(sig);
  }

  for (const ticker of Array.from(tickerGroups.keys())) {
    const sigs = tickerGroups.get(ticker)!;
    let currentPrice: number | null = null;
    try {
      const snap = await fetchSnapshot(ticker);
      if (snap && snap.lastPrice > 0) {
        currentPrice = snap.lastPrice;
      }
    } catch (err: any) {
      log(`Alert: failed to fetch snapshot for ${ticker}: ${err.message}`, "alerts");
      continue;
    }

    if (!currentPrice) continue;

    const dailyBars = await storage.getDailyBars(ticker);
    const atr = computeATR(dailyBars);

    for (const sig of sigs) {
      if (!sig.universePass) {
        if (sig.alertState === "new") {
          await storage.updateSignalAlert(sig.id, "disabled", null);
        }
        continue;
      }

      if (setupStatsData.length > 0) {
        const alertCategory = getSetupAlertCategory(
          sig.setupType, focusMode, setupStatsData,
          winRateThreshold, expectancyThreshold
        );
        if (alertCategory === "OFF") {
          if (sig.alertState === "new") {
            await storage.updateSignalAlert(sig.id, "focus_filtered", null);
          }
          continue;
        }
      }

      if (!shouldRoute(sig.tier, settings)) {
        if (sig.alertState === "new") {
          await storage.updateSignalAlert(sig.id, "disabled", null);
        }
        continue;
      }

      const distance = Math.abs(currentPrice - sig.magnetPrice);
      const routed = isInApp(sig.tier, settings);

      if (
        (sig.direction === "BUY" && currentPrice >= sig.magnetPrice) ||
        (sig.direction === "SELL" && currentPrice <= sig.magnetPrice)
      ) {
        events.push({
          signalId: sig.id,
          ticker,
          type: "hit",
          tier: sig.tier,
          qualityScore: sig.qualityScore,
          message: `HIT: ${ticker} ${sig.setupType} magnet ${sig.magnetPrice.toFixed(2)} touched at ${currentPrice.toFixed(2)}`,
          timestamp: nowIso,
          routed,
        });
        await storage.updateSignalStatus(sig.id, "hit", nowIso);
        await storage.updateSignalAlert(sig.id, "hit_alerted", null);
        continue;
      }

      const approachThreshold = APPROACHING_ATR_BY_TIER[sig.tier] ?? 0.30;
      if (atr > 0 && distance <= approachThreshold * atr) {
        if (sig.alertState === "approaching_alerted") continue;

        events.push({
          signalId: sig.id,
          ticker,
          type: "approaching",
          tier: sig.tier,
          qualityScore: sig.qualityScore,
          message: `APPROACHING: ${ticker} ${sig.setupType} price ${currentPrice.toFixed(2)} within ${(distance).toFixed(2)} of magnet ${sig.magnetPrice.toFixed(2)}`,
          timestamp: nowIso,
          routed,
        });

        const nextEligible = new Date(now.getTime() + rateLimitMinutes(sig.tier) * 60 * 1000).toISOString();
        await storage.updateSignalAlert(sig.id, "approaching_alerted", nextEligible);
        continue;
      }

      if (sig.alertState === "new") {
        if (sig.tier === "C" && !isWithinRTH()) continue;

        events.push({
          signalId: sig.id,
          ticker,
          type: "new_signal",
          tier: sig.tier,
          qualityScore: sig.qualityScore,
          message: `NEW: ${ticker} ${sig.setupType} signal - ${sig.direction} bias, magnet ${sig.magnetPrice.toFixed(2)}, Quality ${sig.qualityScore} (${sig.tier === "APLUS" ? "A+" : sig.tier})`,
          timestamp: nowIso,
          routed,
        });

        const nextEligible = new Date(now.getTime() + rateLimitMinutes(sig.tier) * 60 * 1000).toISOString();
        await storage.updateSignalAlert(sig.id, "notified", nextEligible);
      }
    }
  }

  try {
    const activationEvents = await runActivationScan();
    for (const ae of activationEvents) {
      const activationMinTier = settings.activationMinTier || "A";
      const tierRank: Record<string, number> = { APLUS: 0, A: 1, B: 2, C: 3 };
      const sigRank = tierRank[ae.tier] ?? 3;
      const minRank = tierRank[activationMinTier] ?? 1;
      const routed = sigRank <= minRank && shouldRoute(ae.tier, settings);
      events.push({
        signalId: ae.signalId,
        ticker: ae.ticker,
        type: ae.type === "invalidated" ? "invalidated" : "activated",
        tier: ae.tier,
        qualityScore: ae.qualityScore,
        message: ae.message,
        timestamp: ae.timestamp,
        routed,
      });
    }
  } catch (err: any) {
    log(`Alert: activation scan failed: ${err.message}`, "alerts");
  }

  log(`Alert scan complete: ${events.length} events generated (${events.filter(e => e.routed).length} routed)`, "alerts");
  return events;
}
