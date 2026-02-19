import { storage } from "../storage";
import { fetchGroupedDaily } from "./polygon";
import { getTradingDaysBack, formatDate } from "./calendar";
import { log } from "../index";

interface TickerDayData {
  close: number;
  volume: number;
  high: number;
  low: number;
  dollarVol: number;
}

function isValidTicker(ticker: string): boolean {
  if (!ticker || ticker.length > 5) return false;
  if (/[^A-Z]/.test(ticker)) return false;
  if (ticker.length === 1) return false;
  return true;
}

export async function rebuildUniverse(options?: {
  topN?: number;
  liquidityFloor?: number;
  force?: boolean;
}): Promise<{ date: string; total: number; included: number }> {
  const topN = options?.topN ?? 150;
  const liquidityFloor = options?.liquidityFloor ?? 1_000_000_000;
  const force = options?.force ?? false;

  const lastRebuild = await storage.getSetting("lastUniverseRebuild");
  if (!force && lastRebuild) {
    const lastTime = new Date(lastRebuild).getTime();
    const hoursSince = (Date.now() - lastTime) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      const latestDate = await storage.getLatestUniverseDate();
      const members = latestDate ? await storage.getUniverseMembers(latestDate) : [];
      log(`Universe rebuild skipped (${hoursSince.toFixed(1)}h since last)`, "universe");
      return { date: latestDate ?? "", total: members.length, included: members.filter(m => m.included).length };
    }
  }

  const today = formatDate(new Date());
  const daysBack = getTradingDaysBack(today, 5);
  const tradingDays: string[] = [];

  let d = new Date(daysBack);
  const end = new Date(today);
  while (d <= end) {
    const ds = formatDate(d);
    tradingDays.push(ds);
    d.setDate(d.getDate() + 1);
  }

  const recentDays = tradingDays.slice(-5);

  log(`Universe rebuild: fetching grouped daily for ${recentDays.length} days...`, "universe");

  const tickerData = new Map<string, TickerDayData[]>();

  for (const day of recentDays) {
    try {
      const bars = await fetchGroupedDaily(day);
      log(`Grouped daily ${day}: ${bars.length} tickers`, "universe");

      for (const bar of bars) {
        const ticker = bar.T;
        if (!ticker || !isValidTicker(ticker)) continue;
        if (!bar.c || bar.c < 5 || !bar.v || bar.v < 100000) continue;

        if (!tickerData.has(ticker)) {
          tickerData.set(ticker, []);
        }
        tickerData.get(ticker)!.push({
          close: bar.c,
          volume: bar.v,
          high: bar.h,
          low: bar.l,
          dollarVol: bar.c * bar.v,
        });
      }
    } catch (err: any) {
      log(`Error fetching grouped daily for ${day}: ${err.message}`, "universe");
    }
  }

  log(`Universe rebuild: computing rankings for ${tickerData.size} tickers...`, "universe");

  const rankings: { ticker: string; avgDollarVol: number; avgVol: number; atr: number; lastPrice: number }[] = [];

  tickerData.forEach((days: TickerDayData[], ticker: string) => {
    if (days.length < 2) return;

    const avgDollarVol = days.reduce((s: number, d: TickerDayData) => s + d.dollarVol, 0) / days.length;
    const avgVol = days.reduce((s: number, d: TickerDayData) => s + d.volume, 0) / days.length;
    const atr = days.reduce((s: number, d: TickerDayData) => s + (d.high - d.low), 0) / days.length;
    const lastPrice = days[days.length - 1].close;

    rankings.push({ ticker, avgDollarVol, avgVol, atr, lastPrice });
  });

  rankings.sort((a, b) => b.avgDollarVol - a.avgDollarVol);

  const universeDate = today;
  await storage.clearUniverseDate(universeDate);

  const topMembers = rankings.slice(0, Math.max(topN, 500));
  let includedCount = 0;

  const existingSymbols = await storage.getSymbols();
  const existingTickers = new Set(existingSymbols.map(s => s.ticker));

  for (let i = 0; i < topMembers.length; i++) {
    const r = topMembers[i];
    const included = i < topN;
    if (included) includedCount++;

    await storage.upsertUniverseMember({
      universeDate,
      ticker: r.ticker,
      avgDollarVol20d: r.avgDollarVol,
      rank: i + 1,
      included,
    });

    await storage.upsertTickerStats({
      ticker: r.ticker,
      avgDollarVol20d: r.avgDollarVol,
      avgVol20d: r.avgVol,
      atr14: r.atr,
      lastPrice: r.lastPrice,
    });

    if (included && !existingTickers.has(r.ticker)) {
      await storage.upsertSymbol(r.ticker, true, false);
      existingTickers.add(r.ticker);
    }
  }

  await storage.setSetting("lastUniverseRebuild", new Date().toISOString());

  log(`Universe rebuild complete: ${includedCount} tickers included out of ${topMembers.length} ranked`, "universe");

  return { date: universeDate, total: topMembers.length, included: includedCount };
}

export async function getUniverseStatus(): Promise<{
  lastRebuild: string | null;
  universeDate: string | null;
  memberCount: number;
  topTickers: { ticker: string; avgDollarVol20d: number; rank: number }[];
}> {
  const lastRebuild = await storage.getSetting("lastUniverseRebuild");
  const universeDate = await storage.getLatestUniverseDate();

  let memberCount = 0;
  let topTickers: { ticker: string; avgDollarVol20d: number; rank: number }[] = [];

  if (universeDate) {
    const members = await storage.getUniverseMembers(universeDate);
    memberCount = members.length;
    topTickers = members.slice(0, 20).map(m => ({
      ticker: m.ticker,
      avgDollarVol20d: m.avgDollarVol20d,
      rank: m.rank,
    }));
  }

  return { lastRebuild, universeDate, memberCount, topTickers };
}
