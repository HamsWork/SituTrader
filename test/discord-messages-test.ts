/**
 * Test script that posts all Discord message types to your webhooks.
 *
 * Usage:
 *   Set DISCORD_GOAT_ALERTS_WEBHOOK, DISCORD_GOAT_SWINGS_WEBHOOK, and/or DISCORD_GOAT_SHARES_WEBHOOK in .env (or export them),
 *   then run:
 *     npx tsx test/discord-messages-test.ts
 *
 *   Or with explicit URLs (no .env):
 *     DISCORD_GOAT_ALERTS_WEBHOOK=https://... DISCORD_GOAT_SWINGS_WEBHOOK=https://... DISCORD_GOAT_SHARES_WEBHOOK=https://... npx tsx test/discord-messages-test.ts
 *
 * Messages sent:
 *   - Options alert (alerts channel)
 *   - LETF swing alert (swings channel)
 *   - FILLED, TP1_HIT, TP2_HIT, TP3_HIT, RAISE_STOP, TIME_STOP, STOPPED_OUT, STOPPED_OUT_AFTER_TP, CLOSED (option + LETF variants where applicable)
 */

import "dotenv/config";
import {
  postOptionsAlert,
  postLetfAlert,
  postTradeUpdate,
  postSharesAlert,
} from "../server/lib/discord";
import type { Signal, IbkrTrade } from "@shared/schema";

function createMockTradePlan(overrides?: { t2?: number; t3?: number; bias?: "BUY" | "SELL" }) {
  return {
    bias: (overrides?.bias ?? "BUY") as "BUY" | "SELL",
    entryTrigger: "Breakout",
    invalidation: "Close below support",
    t1: 192,
    t2: overrides?.t2 ?? 198,
    t3: overrides?.t3,
    ...overrides,
  };
}

function createMockSignal(overrides: Partial<Signal> = {}): Signal {
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
    instrumentType: "OPTION",
    instrumentTicker: null,
    instrumentEntryPrice: null,
    leveragedEtfJson: null,
    createdAt: new Date(),
    ...overrides,
  } as Signal;
}

function createMockOptionSignal(): Signal {
  return createMockSignal({
    optionsJson: {
      candidate: { strike: "185", expiry: "2025-03-21", right: "C" },
    },
    optionEntryMark: 4.5,
    instrumentType: "OPTION",
  });
}

function createMockLetfSignal(): Signal {
  return createMockSignal({
    instrumentType: "LEVERAGED_ETF",
    instrumentTicker: "TQQQ",
    leveragedEtfJson: { ticker: "TQQQ", leverage: "3", direction: "BULL" },
  });
}

function createMockSharesSignal(): Signal {
  return createMockSignal({
    instrumentType: "SHARES",
    instrumentTicker: "AAPL",
    instrumentEntryPrice: 185.5,
  });
}

function createMockTrade(overrides: Partial<IbkrTrade> = {}): IbkrTrade {
  const base: IbkrTrade = {
    id: 1,
    signalId: 1,
    ticker: "AAPL",
    instrumentType: "OPTION",
    instrumentTicker: null,
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
    ibkrOrderId: null,
    ibkrStopOrderId: null,
    ibkrTp1OrderId: null,
    ibkrTp2OrderId: null,
    status: "FILLED",
    pnl: null,
    pnlPct: null,
    rMultiple: null,
    filledAt: null,
    closedAt: null,
    tp1FilledAt: null,
    tp2FilledAt: null,
    detailsJson: null,
    createdAt: new Date(),
  };
  return { ...base, ...overrides } as IbkrTrade;
}

async function runTest() {
  const alertsUrl = process.env.DISCORD_GOAT_ALERTS_WEBHOOK;
  const swingsUrl = process.env.DISCORD_GOAT_SWINGS_WEBHOOK;
  const sharesUrl = process.env.DISCORD_GOAT_SHARES_WEBHOOK;

  if (!alertsUrl && !swingsUrl && !sharesUrl) {
    console.error(
      "Set at least one of DISCORD_GOAT_ALERTS_WEBHOOK, DISCORD_GOAT_SWINGS_WEBHOOK, or DISCORD_GOAT_SHARES_WEBHOOK in .env (or environment)"
    );
    process.exit(1);
  }

  const tests: { name: string; fn: () => Promise<boolean> }[] = [];

  // --- Options channel ---
  if (alertsUrl) {
    tests.push({
      name: "Options Alert",
      fn: () => postOptionsAlert(createMockOptionSignal(), undefined, alertsUrl),
    });
    tests.push({
      name: "Trade Update FILLED (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({ instrumentType: "OPTION" }),
          "FILLED",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update TP1_HIT (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            tp1FillPrice: 192,
            stopPrice: 185.5,
          }),
          "TP1_HIT",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update TP2_HIT (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            tp1FillPrice: 192,
            tp2FillPrice: 198,
          }),
          "TP2_HIT",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update TP3_HIT (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            tp1FillPrice: 192,
            tp2FillPrice: 198,
            exitPrice: 200,
          }),
          "TP3_HIT",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update RAISE_STOP (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            stopPrice: 185.5,
            tp1FillPrice: 192,
          }),
          "RAISE_STOP",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update TIME_STOP (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            stopPrice: 181.5,
            detailsJson: {
              oldStopPrice: 182,
              underlyingNewStop: 181.5,
              timeStopTightenFactor: 0.5,
            },
          }),
          "TIME_STOP",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update STOPPED_OUT (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            exitPrice: 182,
            status: "CLOSED",
          }),
          "STOPPED_OUT",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update STOPPED_OUT_AFTER_TP (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            tp1FillPrice: 192,
            tp1PnlRealized: 350,
            exitPrice: 185.5,
            status: "CLOSED",
          }),
          "STOPPED_OUT_AFTER_TP",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update CLOSED profit (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            exitPrice: 195,
            pnl: 500,
            rMultiple: 1.5,
            status: "CLOSED",
          }),
          "CLOSED",
          alertsUrl
        ),
    });
    tests.push({
      name: "Trade Update CLOSED loss (Option)",
      fn: () =>
        postTradeUpdate(
          createMockOptionSignal(),
          createMockTrade({
            instrumentType: "OPTION",
            exitPrice: 181,
            pnl: -200,
            rMultiple: -0.5,
            status: "CLOSED",
          }),
          "CLOSED",
          alertsUrl
        ),
    });
  }

  // --- Swings (LETF) channel ---
  if (swingsUrl) {
    tests.push({
      name: "LETF Swing Alert",
      fn: () => postLetfAlert(createMockLetfSignal(), undefined, swingsUrl),
    });
    tests.push({
      name: "Trade Update FILLED (LETF)",
      fn: () =>
        postTradeUpdate(
          createMockLetfSignal(),
          createMockTrade({
            instrumentType: "LEVERAGED_ETF",
            instrumentTicker: "TQQQ",
            entryPrice: 52.1,
            stopPrice: 50.2,
          }),
          "FILLED",
          swingsUrl
        ),
    });
    tests.push({
      name: "Trade Update TP1_HIT (LETF)",
      fn: () =>
        postTradeUpdate(
          createMockLetfSignal(),
          createMockTrade({
            instrumentType: "LEVERAGED_ETF",
            instrumentTicker: "TQQQ",
            entryPrice: 52.1,
            tp1FillPrice: 54,
            stopPrice: 52.1,
          }),
          "TP1_HIT",
          swingsUrl
        ),
    });
    tests.push({
      name: "Trade Update RAISE_STOP (LETF)",
      fn: () =>
        postTradeUpdate(
          createMockLetfSignal(),
          createMockTrade({
            instrumentType: "LEVERAGED_ETF",
            instrumentTicker: "TQQQ",
            entryPrice: 52.1,
            stopPrice: 52.1,
            tp1FillPrice: 54,
          }),
          "RAISE_STOP",
          swingsUrl
        ),
    });
    tests.push({
      name: "Trade Update TIME_STOP (LETF)",
      fn: () =>
        postTradeUpdate(
          createMockLetfSignal(),
          createMockTrade({
            instrumentType: "LEVERAGED_ETF",
            instrumentTicker: "TQQQ",
            entryPrice: 52.1,
            stopPrice: 50.8,
            detailsJson: {
              oldStopPrice: 50.2,
              underlyingNewStop: 50.8,
              timeStopTightenFactor: 0.5,
            },
          }),
          "TIME_STOP",
          swingsUrl
        ),
    });
    tests.push({
      name: "Trade Update STOPPED_OUT (LETF)",
      fn: () =>
        postTradeUpdate(
          createMockLetfSignal(),
          createMockTrade({
            instrumentType: "LEVERAGED_ETF",
            instrumentTicker: "TQQQ",
            entryPrice: 52.1,
            exitPrice: 50.2,
            status: "CLOSED",
          }),
          "STOPPED_OUT",
          swingsUrl
        ),
    });
    tests.push({
      name: "Trade Update STOPPED_OUT_AFTER_TP (LETF)",
      fn: () =>
        postTradeUpdate(
          createMockLetfSignal(),
          createMockTrade({
            instrumentType: "LEVERAGED_ETF",
            instrumentTicker: "TQQQ",
            entryPrice: 52.1,
            tp1FillPrice: 54,
            tp1PnlRealized: 180,
            exitPrice: 52.1,
            status: "CLOSED",
          }),
          "STOPPED_OUT_AFTER_TP",
          swingsUrl
        ),
    });
    tests.push({
      name: "Trade Update CLOSED profit (LETF)",
      fn: () =>
        postTradeUpdate(
          createMockLetfSignal(),
          createMockTrade({
            instrumentType: "LEVERAGED_ETF",
            instrumentTicker: "TQQQ",
            entryPrice: 52.1,
            exitPrice: 56,
            pnl: 390,
            rMultiple: 2,
            status: "CLOSED",
          }),
          "CLOSED",
          swingsUrl
        ),
    });
  }

  // --- Shares channel ---
  if (sharesUrl) {
    tests.push({
      name: "Shares Alert",
      fn: () => postSharesAlert(createMockSharesSignal(), undefined, sharesUrl),
    });
    tests.push({
      name: "Trade Update FILLED (Shares)",
      fn: () =>
        postTradeUpdate(
          createMockSharesSignal(),
          createMockTrade({ instrumentType: "SHARES", instrumentTicker: "AAPL" }),
          "FILLED",
          sharesUrl
        ),
    });
    tests.push({
      name: "Trade Update TP1_HIT (Shares)",
      fn: () =>
        postTradeUpdate(
          createMockSharesSignal(),
          createMockTrade({
            instrumentType: "SHARES",
            instrumentTicker: "AAPL",
            tp1FillPrice: 192,
            stopPrice: 185.5,
          }),
          "TP1_HIT",
          sharesUrl
        ),
    });
    tests.push({
      name: "Trade Update STOPPED_OUT (Shares)",
      fn: () =>
        postTradeUpdate(
          createMockSharesSignal(),
          createMockTrade({
            instrumentType: "SHARES",
            instrumentTicker: "AAPL",
            exitPrice: 182,
            status: "CLOSED",
          }),
          "STOPPED_OUT",
          sharesUrl
        ),
    });
    tests.push({
      name: "Trade Update CLOSED profit (Shares)",
      fn: () =>
        postTradeUpdate(
          createMockSharesSignal(),
          createMockTrade({
            instrumentType: "SHARES",
            instrumentTicker: "AAPL",
            exitPrice: 195,
            pnl: 950,
            rMultiple: 2.5,
            status: "CLOSED",
          }),
          "CLOSED",
          sharesUrl
        ),
    });
  }

  console.log(`Running ${tests.length} Discord message tests...\n`);
  const delayMs = 500; // Space out requests to avoid Discord rate limit (~5 req/s per webhook)
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
