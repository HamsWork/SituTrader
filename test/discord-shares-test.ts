/**
 * Test script for Discord messages for SHARES (equity) alerts.
 *
 * Usage:
 *   Set DISCORD_GOAT_SHARES_WEBHOOK in .env or export it, then run:
 *     npx tsx test/discord-shares-test.ts
 *
 *   Or with explicit URL:
 *     DISCORD_GOAT_SHARES_WEBHOOK=https://discord.com/api/webhooks/... npx tsx test/discord-shares-test.ts
 *
 *   Optional: add shares webhook to Settings (discordGoatSharesWebhook); the script prefers env.
 *
 * Messages sent:
 *   - Shares alert (initial alert, with or without trade)
 *   - Trade update FILLED (shares)
 *   - Trade update TP1_HIT, STOPPED_OUT, CLOSED (shares)
 */

import "dotenv/config";
import {
  postSharesAlert,
  postTradeUpdate,
} from "../server/lib/discord";
import type { Signal, IbkrTrade } from "@shared/schema";

function createMockTradePlan(overrides?: { t2?: number; bias?: "BUY" | "SELL" }) {
  return {
    bias: (overrides?.bias ?? "BUY") as "BUY" | "SELL",
    entryTrigger: "Breakout",
    invalidation: "Close below support",
    t1: 192,
    t2: overrides?.t2 ?? 198,
    ...overrides,
  };
}

function createMockSharesSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 1,
    ticker: "AAPL",
    setupType: "SITU",
    asofDate: "2025-02-24",
    targetDate: "2025-02-24",
    targetDate2: null,
    targetDate3: null,
    magnetPrice: 190,
    magnetPrice2: null,
    direction: "LONG",
    confidence: 0.75,
    status: "active",
    hitTs: null,
    timeToHitMin: null,
    missReason: null,
    tradePlanJson: createMockTradePlan(),
    confidenceBreakdown: null,
    qualityScore: 85,
    tier: "A",
    alertState: "sent",
    nextAlertEligibleAt: null,
    qualityBreakdown: null,
    pHit60: null,
    pHit120: null,
    pHit390: null,
    timeScore: null,
    universePass: true,
    activationStatus: "ACTIVE",
    activatedTs: new Date().toISOString(),
    entryPriceAtActivation: 185.5,
    stopPrice: 182,
    entryTriggerPrice: 185,
    invalidationTs: null,
    stopStage: "INITIAL",
    stopMovedToBeTs: null,
    timeStopTriggeredTs: null,
    optionsJson: null,
    optionContractTicker: null,
    optionEntryMark: null,
    instrumentType: "SHARES",
    instrumentTicker: "AAPL",
    instrumentEntryPrice: 185.5,
    leveragedEtfJson: null,
    createdAt: new Date(),
    ...overrides,
  } as Signal;
}

function createMockSharesTrade(overrides: Partial<IbkrTrade> = {}): IbkrTrade {
  const base: IbkrTrade = {
    id: 1,
    signalId: 1,
    ticker: "AAPL",
    instrumentType: "SHARES",
    instrumentTicker: "AAPL",
    side: "BUY",
    quantity: 100,
    originalQuantity: 100,
    remainingQuantity: 100,
    tpHitLevel: 0,
    entryPrice: 185.5,
    exitPrice: null,
    stopPrice: 182,
    target1Price: 192,
    target2Price: 198,
    tp1FillPrice: null,
    tp2FillPrice: null,
    tp1PnlRealized: null,
    ibkrOrderId: 9001,
    ibkrStopOrderId: 9002,
    ibkrTp1OrderId: 9003,
    ibkrTp2OrderId: 9004,
    status: "FILLED",
    pnl: null,
    pnlPct: null,
    rMultiple: null,
    filledAt: new Date().toISOString(),
    closedAt: null,
    tp1FilledAt: null,
    tp2FilledAt: null,
    stopMovedToBe: false,
    discordAlertSent: false,
    discordUpdateSent: false,
    notes: null,
    detailsJson: null,
    createdAt: new Date(),
  };
  return { ...base, ...overrides } as IbkrTrade;
}

async function runTest() {
  const sharesUrl = process.env.DISCORD_GOAT_SHARES_WEBHOOK;

  if (!sharesUrl) {
    console.error(
      "Set DISCORD_GOAT_SHARES_WEBHOOK in .env or environment to test shares Discord messages."
    );
    console.error("Example: DISCORD_GOAT_SHARES_WEBHOOK=https://discord.com/api/webhooks/... npx tsx test/discord-shares-test.ts");
    process.exit(1);
  }

  const signal = createMockSharesSignal();
  const tests: { name: string; fn: () => Promise<boolean> }[] = [
    {
      name: "Shares Alert (signal only, no trade)",
      fn: () => postSharesAlert(signal, undefined, sharesUrl),
    },
    {
      name: "Shares Alert (with mock trade)",
      fn: () =>
        postSharesAlert(
          signal,
          createMockSharesTrade({ entryPrice: 185.5, stopPrice: 182 }),
          sharesUrl
        ),
    },
    {
      name: "Trade Update FILLED (Shares)",
      fn: () =>
        postTradeUpdate(
          signal,
          createMockSharesTrade(),
          "FILLED",
          sharesUrl
        ),
    },
    {
      name: "Trade Update TP1_HIT (Shares)",
      fn: () =>
        postTradeUpdate(
          signal,
          createMockSharesTrade({
            tp1FillPrice: 192,
            stopPrice: 185.5,
            tpHitLevel: 1,
          }),
          "TP1_HIT",
          sharesUrl
        ),
    },
    {
      name: "Trade Update STOPPED_OUT (Shares)",
      fn: () =>
        postTradeUpdate(
          signal,
          createMockSharesTrade({
            exitPrice: 182,
            status: "CLOSED",
            pnl: -350,
            rMultiple: -1,
          }),
          "STOPPED_OUT",
          sharesUrl
        ),
    },
    {
      name: "Trade Update CLOSED (Shares, profit)",
      fn: () =>
        postTradeUpdate(
          signal,
          createMockSharesTrade({
            exitPrice: 195,
            status: "CLOSED",
            pnl: 950,
            rMultiple: 2.5,
          }),
          "CLOSED",
          sharesUrl
        ),
    },
  ];

  console.log("Running shares Discord message tests...\n");
  const delayMs = 500;
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < tests.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const { name, fn } = tests[i];
    try {
      const result = await fn();
      if (result) {
        console.log(`  ✓ ${name}`);
        ok++;
      } else {
        console.log(`  ✗ ${name} (returned false)`);
        fail++;
      }
    } catch (e) {
      console.log(`  ✗ ${name}: ${(e as Error).message}`);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} sent, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

runTest();
