import { storage } from "../storage";
import { computeRMultiples, aggregateExpectancy, type RMultipleResult } from "./expectancy";
import { computeATR } from "./confidence";
import type {
  BacktestDetail, Backtest, RobustnessRun, ReliabilitySummary, ReliabilityGate, RegimeBreakdown,
} from "@shared/schema";

const GATE_DEFS: { id: string; name: string; maxScore: number }[] = [
  { id: "fees_slippage", name: "Fees & Slippage", maxScore: 10 },
  { id: "out_of_sample", name: "Out-of-Sample Validation", maxScore: 15 },
  { id: "walk_forward", name: "Walk-Forward Test", maxScore: 10 },
  { id: "stress_test", name: "Stress Testing", maxScore: 10 },
  { id: "monte_carlo", name: "Monte Carlo Simulation", maxScore: 15 },
  { id: "parameter_sweep", name: "Parameter Sensitivity", maxScore: 10 },
  { id: "stop_sensitivity", name: "Stop Distance Sensitivity", maxScore: 10 },
  { id: "regime_analysis", name: "Regime-Aware Reporting", maxScore: 10 },
  { id: "forward_validation", name: "Forward Validation", maxScore: 5 },
  { id: "data_quality", name: "Data Quality & Coverage", maxScore: 5 },
];

export async function computeReliabilitySummary(): Promise<ReliabilitySummary> {
  const latestRuns = await storage.getAllLatestRobustnessRuns();
  const runMap = new Map<string, RobustnessRun>();
  for (const r of latestRuns) runMap.set(r.testType, r);

  const settings = await storage.getAllSettings();
  const allBacktests = await storage.getBacktests();
  const allExpectancy = await storage.getAllSetupExpectancy();

  const warnings: string[] = [];
  const gates: ReliabilityGate[] = [];

  for (const def of GATE_DEFS) {
    const run = runMap.get(def.id);
    let gate: ReliabilityGate;

    if (def.id === "fees_slippage") {
      gate = evaluateFeesSlippageGate(def, run, settings);
    } else if (def.id === "data_quality") {
      gate = evaluateDataQualityGate(def, allBacktests);
    } else if (def.id === "forward_validation") {
      gate = evaluateForwardValidationGate(def, settings);
    } else if (run) {
      gate = evaluateRunBasedGate(def, run);
    } else {
      gate = {
        id: def.id,
        name: def.name,
        status: "not_run",
        score: 0,
        maxScore: def.maxScore,
        details: "Test has not been run yet",
        lastRunAt: null,
      };
    }

    gates.push(gate);
  }

  const totalScore = gates.reduce((s, g) => s + g.score, 0);
  const maxTotal = gates.reduce((s, g) => s + g.maxScore, 0);
  const pct = maxTotal > 0 ? (totalScore / maxTotal) * 100 : 0;

  let overallGrade: string;
  if (pct >= 85) overallGrade = "A+";
  else if (pct >= 75) overallGrade = "A";
  else if (pct >= 60) overallGrade = "B";
  else if (pct >= 40) overallGrade = "C";
  else if (pct >= 20) overallGrade = "D";
  else overallGrade = "F";

  const notRunCount = gates.filter(g => g.status === "not_run").length;
  if (notRunCount > 3) warnings.push(`${notRunCount} of ${gates.length} robustness tests have not been run`);

  const failCount = gates.filter(g => g.status === "fail").length;
  if (failCount > 0) warnings.push(`${failCount} test gate(s) currently failing`);

  if (!settings["fees_per_trade"] && !settings["slippage_bps"]) {
    warnings.push("Fees & slippage assumptions not configured — backtest results may be overstated");
  }

  return {
    overallGrade,
    overallScore: Math.round(pct),
    gates,
    warnings,
    lastUpdated: new Date().toISOString(),
  };
}

function evaluateFeesSlippageGate(
  def: { id: string; name: string; maxScore: number },
  run: RobustnessRun | undefined,
  settings: Record<string, string>
): ReliabilityGate {
  const feesSet = !!settings["fees_per_trade"];
  const slippageSet = !!settings["slippage_bps"];

  if (!feesSet && !slippageSet) {
    return {
      id: def.id, name: def.name, status: "fail", score: 0, maxScore: def.maxScore,
      details: "No fees or slippage configured. Set in Settings > Assumptions.",
      lastRunAt: null,
    };
  }

  if (run && run.status === "completed") {
    const metrics = run.summaryMetrics as any;
    const degradation = metrics?.expectancyDegradation ?? 0;
    let score = def.maxScore;
    let status: ReliabilityGate["status"] = "pass";
    if (degradation > 0.5) { score = Math.round(def.maxScore * 0.3); status = "fail"; }
    else if (degradation > 0.2) { score = Math.round(def.maxScore * 0.7); status = "warn"; }
    return {
      id: def.id, name: def.name, status, score, maxScore: def.maxScore,
      details: `Expectancy degradation with costs: ${(degradation * 100).toFixed(1)}%`,
      lastRunAt: run.completedAt?.toISOString() ?? null,
    };
  }

  return {
    id: def.id, name: def.name, status: "warn", score: Math.round(def.maxScore * 0.5), maxScore: def.maxScore,
    details: `Fees/slippage configured (fees=$${settings["fees_per_trade"] ?? "0"}, slippage=${settings["slippage_bps"] ?? "0"}bps) but not yet applied to backtests`,
    lastRunAt: null,
  };
}

function evaluateDataQualityGate(
  def: { id: string; name: string; maxScore: number },
  allBacktests: Backtest[]
): ReliabilityGate {
  if (allBacktests.length === 0) {
    return {
      id: def.id, name: def.name, status: "fail", score: 0, maxScore: def.maxScore,
      details: "No backtests found. Run the backtest worker first.",
      lastRunAt: null,
    };
  }

  const totalOccurrences = allBacktests.reduce((s, bt) => s + bt.occurrences, 0);
  const setupTypes = new Set(allBacktests.map(bt => bt.setupType));
  const tickers = new Set(allBacktests.map(bt => bt.ticker));

  let score = 0;
  if (totalOccurrences >= 100) score += 2;
  else if (totalOccurrences >= 30) score += 1;
  if (setupTypes.size >= 4) score += 1;
  else if (setupTypes.size >= 2) score += 0.5;
  if (tickers.size >= 10) score += 2;
  else if (tickers.size >= 3) score += 1;

  score = Math.min(score, def.maxScore);

  let status: ReliabilityGate["status"] = "pass";
  if (score < def.maxScore * 0.4) status = "fail";
  else if (score < def.maxScore * 0.8) status = "warn";

  return {
    id: def.id, name: def.name, status, score: Math.round(score), maxScore: def.maxScore,
    details: `${totalOccurrences} occurrences across ${tickers.size} tickers and ${setupTypes.size} setups`,
    lastRunAt: null,
  };
}

function evaluateForwardValidationGate(
  def: { id: string; name: string; maxScore: number },
  settings: Record<string, string>
): ReliabilityGate {
  const startedAt = settings["forward_validation_start"];
  const lastCheckedAt = settings["forward_validation_last_check"];

  if (!startedAt) {
    return {
      id: def.id, name: def.name, status: "not_run", score: 0, maxScore: def.maxScore,
      details: "Forward validation not started. Enable in Settings.",
      lastRunAt: null,
    };
  }

  const startDate = new Date(startedAt);
  const daysSince = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  let score = 0;
  let status: ReliabilityGate["status"] = "warn";

  if (daysSince >= 30) { score = def.maxScore; status = "pass"; }
  else if (daysSince >= 14) { score = Math.round(def.maxScore * 0.7); status = "warn"; }
  else if (daysSince >= 7) { score = Math.round(def.maxScore * 0.4); status = "warn"; }
  else { score = 1; }

  return {
    id: def.id, name: def.name, status, score, maxScore: def.maxScore,
    details: `Forward validation running for ${daysSince} days (started ${startedAt})`,
    lastRunAt: lastCheckedAt ?? null,
  };
}

function evaluateRunBasedGate(
  def: { id: string; name: string; maxScore: number },
  run: RobustnessRun
): ReliabilityGate {
  if (run.status === "insufficient_data") {
    return {
      id: def.id, name: def.name, status: "insufficient_data", score: 0, maxScore: def.maxScore,
      details: run.errorMessage ?? "Insufficient data to run this test",
      lastRunAt: run.completedAt?.toISOString() ?? null,
    };
  }
  if (run.status === "failed") {
    return {
      id: def.id, name: def.name, status: "fail", score: 0, maxScore: def.maxScore,
      details: run.errorMessage ?? "Test failed with errors",
      lastRunAt: run.completedAt?.toISOString() ?? null,
    };
  }
  if (run.status === "running" || run.status === "pending") {
    return {
      id: def.id, name: def.name, status: "not_run", score: 0, maxScore: def.maxScore,
      details: "Test is currently running...",
      lastRunAt: null,
    };
  }

  const metrics = run.summaryMetrics as any;
  if (!metrics) {
    return {
      id: def.id, name: def.name, status: "warn", score: Math.round(def.maxScore * 0.5), maxScore: def.maxScore,
      details: "Test completed but no summary metrics available",
      lastRunAt: run.completedAt?.toISOString() ?? null,
    };
  }

  const score = Math.min(metrics.score ?? Math.round(def.maxScore * 0.5), def.maxScore);
  let status: ReliabilityGate["status"] = "pass";
  if (score < def.maxScore * 0.4) status = "fail";
  else if (score < def.maxScore * 0.8) status = "warn";

  return {
    id: def.id, name: def.name, status, score, maxScore: def.maxScore,
    details: metrics.summary ?? "Test completed",
    lastRunAt: run.completedAt?.toISOString() ?? null,
  };
}

export async function runFeesSlippageTest(
  feesPerTrade: number,
  slippageBps: number
): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "fees_slippage",
    scope: "global",
    parameters: { feesPerTrade, slippageBps },
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    if (allBacktests.length === 0) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: "No backtests available",
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    let totalTradesRaw = 0;
    let totalPnlRaw = 0;
    let totalPnlAdjusted = 0;
    let rawExpectancy = 0;
    let adjExpectancy = 0;

    const allRawR: RMultipleResult[] = [];
    const allAdjR: RMultipleResult[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details || details.length === 0) continue;

      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;

      const rms = computeRMultiples(details, atr);
      allRawR.push(...rms);

      const slippageFraction = slippageBps / 10000;
      const adjustedRms: RMultipleResult[] = rms.map(rm => {
        const entryPrice = details.find(d => d.entryPrice)?.entryPrice ?? 100;
        const stopDist = Math.max(0.25 * atr, entryPrice * 0.0015);
        const costR = ((feesPerTrade * 2) / entryPrice + slippageFraction * 2) * entryPrice / stopDist;
        return { ...rm, r: rm.r - costR };
      });
      allAdjR.push(...adjustedRms);
    }

    if (allRawR.length === 0) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: "No valid R-multiples from backtests",
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const rawStats = aggregateExpectancy(allRawR, "ALL", null);
    const adjStats = aggregateExpectancy(allAdjR, "ALL", null);

    rawExpectancy = rawStats.expectancyR;
    adjExpectancy = adjStats.expectancyR;

    const degradation = rawExpectancy > 0
      ? Math.max(0, (rawExpectancy - adjExpectancy) / rawExpectancy)
      : 0;

    let score = 10;
    if (degradation > 0.5) score = 3;
    else if (degradation > 0.3) score = 5;
    else if (degradation > 0.15) score = 7;

    const warningsList: string[] = [];
    if (adjExpectancy <= 0) warningsList.push("Adjusted expectancy is negative — edge may not survive real-world costs");
    if (degradation > 0.3) warningsList.push("High cost sensitivity — consider larger position sizes or lower-frequency setups");

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: {
        rawExpectancy,
        adjustedExpectancy: adjExpectancy,
        expectancyDegradation: degradation,
        rawWinRate: rawStats.winRate,
        adjustedWinRate: adjStats.winRate,
        rawProfitFactor: rawStats.profitFactor,
        adjustedProfitFactor: adjStats.profitFactor,
        sampleSize: allRawR.length,
        feesPerTrade,
        slippageBps,
        score,
        summary: `Expectancy: ${rawExpectancy.toFixed(2)}R → ${adjExpectancy.toFixed(2)}R (${(degradation * 100).toFixed(1)}% degradation)`,
      },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, {
      status: "failed",
      errorMessage: err.message,
      completedAt: new Date(),
    }) as RobustnessRun;
  }
}

export async function runOutOfSampleTest(splitRatio: number = 0.7): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "out_of_sample",
    scope: "global",
    parameters: { splitRatio },
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    if (allBacktests.length < 5) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allBacktests.length} backtests — need at least 5`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const allDetails: { detail: BacktestDetail; ticker: string; atr: number }[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;
      for (const d of details) {
        if (d.triggered) allDetails.push({ detail: d, ticker: bt.ticker, atr });
      }
    }

    if (allDetails.length < 20) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allDetails.length} triggered events — need at least 20`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    allDetails.sort((a, b) => a.detail.date.localeCompare(b.detail.date));

    const splitIdx = Math.floor(allDetails.length * splitRatio);
    const inSample = allDetails.slice(0, splitIdx);
    const outOfSample = allDetails.slice(splitIdx);

    const isRMs: RMultipleResult[] = [];
    for (const item of inSample) {
      const rms = computeRMultiples([item.detail], item.atr);
      isRMs.push(...rms);
    }

    const oosRMs: RMultipleResult[] = [];
    for (const item of outOfSample) {
      const rms = computeRMultiples([item.detail], item.atr);
      oosRMs.push(...rms);
    }

    const isStats = aggregateExpectancy(isRMs, "ALL", null);
    const oosStats = aggregateExpectancy(oosRMs, "ALL", null);

    const winRateDiff = Math.abs(isStats.winRate - oosStats.winRate);
    const expectancyDiff = Math.abs(isStats.expectancyR - oosStats.expectancyR);

    let score = 15;
    const warningsList: string[] = [];

    if (oosStats.expectancyR <= 0) {
      score = 3;
      warningsList.push("Out-of-sample expectancy is negative — possible overfit");
    } else if (expectancyDiff > 0.3) {
      score = 6;
      warningsList.push("Large expectancy gap between IS and OOS — possible overfit");
    } else if (expectancyDiff > 0.15) {
      score = 10;
      warningsList.push("Moderate expectancy gap between IS and OOS");
    }

    if (winRateDiff > 0.15) {
      score = Math.min(score, 8);
      warningsList.push("Win rate differs significantly between IS and OOS");
    }

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: {
        inSampleSize: isRMs.length,
        outOfSampleSize: oosRMs.length,
        isWinRate: isStats.winRate,
        oosWinRate: oosStats.winRate,
        isExpectancy: isStats.expectancyR,
        oosExpectancy: oosStats.expectancyR,
        isProfitFactor: isStats.profitFactor,
        oosProfitFactor: oosStats.profitFactor,
        winRateDiff,
        expectancyDiff,
        score,
        summary: `IS: ${isStats.expectancyR.toFixed(2)}R (n=${isRMs.length}) → OOS: ${oosStats.expectancyR.toFixed(2)}R (n=${oosRMs.length})`,
      },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, {
      status: "failed",
      errorMessage: err.message,
      completedAt: new Date(),
    }) as RobustnessRun;
  }
}

export async function runWalkForwardTest(windowCount: number = 3): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "walk_forward",
    scope: "global",
    parameters: { windowCount },
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    const allDetails: { detail: BacktestDetail; ticker: string; atr: number }[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;
      for (const d of details) {
        if (d.triggered) allDetails.push({ detail: d, ticker: bt.ticker, atr });
      }
    }

    if (allDetails.length < windowCount * 10) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allDetails.length} events — need at least ${windowCount * 10} for ${windowCount} windows`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    allDetails.sort((a, b) => a.detail.date.localeCompare(b.detail.date));

    const windowSize = Math.floor(allDetails.length / windowCount);
    const windows: { isExpectancy: number; oosExpectancy: number; isWinRate: number; oosWinRate: number; isSample: number; oosSample: number }[] = [];

    for (let w = 0; w < windowCount - 1; w++) {
      const trainEnd = (w + 1) * windowSize;
      const testEnd = Math.min((w + 2) * windowSize, allDetails.length);
      const trainSet = allDetails.slice(0, trainEnd);
      const testSet = allDetails.slice(trainEnd, testEnd);

      const trainRMs: RMultipleResult[] = [];
      for (const item of trainSet) trainRMs.push(...computeRMultiples([item.detail], item.atr));

      const testRMs: RMultipleResult[] = [];
      for (const item of testSet) testRMs.push(...computeRMultiples([item.detail], item.atr));

      if (trainRMs.length > 0 && testRMs.length > 0) {
        const trainStats = aggregateExpectancy(trainRMs, "ALL", null);
        const testStats = aggregateExpectancy(testRMs, "ALL", null);
        windows.push({
          isExpectancy: trainStats.expectancyR,
          oosExpectancy: testStats.expectancyR,
          isWinRate: trainStats.winRate,
          oosWinRate: testStats.winRate,
          isSample: trainRMs.length,
          oosSample: testRMs.length,
        });
      }
    }

    if (windows.length === 0) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: "Could not form valid walk-forward windows",
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const avgOosExpectancy = windows.reduce((s, w) => s + w.oosExpectancy, 0) / windows.length;
    const consistency = windows.filter(w => w.oosExpectancy > 0).length / windows.length;

    let score = 10;
    const warningsList: string[] = [];

    if (avgOosExpectancy <= 0) { score = 2; warningsList.push("Average OOS expectancy is negative"); }
    else if (consistency < 0.5) { score = 4; warningsList.push("Less than half of walk-forward windows are profitable"); }
    else if (consistency < 0.75) { score = 7; warningsList.push("Some walk-forward windows show negative expectancy"); }

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: {
        windows,
        avgOosExpectancy,
        consistency,
        windowCount: windows.length,
        score,
        summary: `${windows.length} windows, consistency=${(consistency * 100).toFixed(0)}%, avg OOS expectancy=${avgOosExpectancy.toFixed(2)}R`,
      },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, {
      status: "failed",
      errorMessage: err.message,
      completedAt: new Date(),
    }) as RobustnessRun;
  }
}

export async function runMonteCarloTest(simulations: number = 1000): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "monte_carlo",
    scope: "global",
    parameters: { simulations },
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    const allRMs: RMultipleResult[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;
      allRMs.push(...computeRMultiples(details, atr));
    }

    if (allRMs.length < 30) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allRMs.length} R-multiples — need at least 30 for Monte Carlo`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const equityCurves: number[] = [];
    const maxDrawdowns: number[] = [];
    const finalReturns: number[] = [];

    for (let sim = 0; sim < simulations; sim++) {
      const shuffled = [...allRMs].sort(() => Math.random() - 0.5);
      let equity = 0;
      let peak = 0;
      let maxDD = 0;

      for (const rm of shuffled) {
        equity += rm.r;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDD) maxDD = dd;
      }

      finalReturns.push(equity);
      maxDrawdowns.push(maxDD);
    }

    finalReturns.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);

    const p5Return = finalReturns[Math.floor(simulations * 0.05)];
    const p50Return = finalReturns[Math.floor(simulations * 0.5)];
    const p95Return = finalReturns[Math.floor(simulations * 0.95)];
    const p95Drawdown = maxDrawdowns[Math.floor(simulations * 0.95)];
    const medianDrawdown = maxDrawdowns[Math.floor(simulations * 0.5)];
    const profitableRuns = finalReturns.filter(r => r > 0).length / simulations;

    let score = 15;
    const warningsList: string[] = [];

    if (p5Return <= -5) { score = 3; warningsList.push("5th percentile scenario shows severe losses"); }
    else if (p5Return <= 0) { score = 8; warningsList.push("5th percentile scenario is unprofitable"); }
    else if (p5Return > 0) { score = 15; }

    if (profitableRuns < 0.7) {
      score = Math.min(score, 7);
      warningsList.push(`Only ${(profitableRuns * 100).toFixed(0)}% of simulations are profitable`);
    }

    if (p95Drawdown > 10) {
      score = Math.min(score, 10);
      warningsList.push(`95th percentile drawdown is ${p95Drawdown.toFixed(1)}R — prepare for large drawdowns`);
    }

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: {
        simulations,
        p5Return: Math.round(p5Return * 100) / 100,
        p50Return: Math.round(p50Return * 100) / 100,
        p95Return: Math.round(p95Return * 100) / 100,
        p95Drawdown: Math.round(p95Drawdown * 100) / 100,
        medianDrawdown: Math.round(medianDrawdown * 100) / 100,
        profitableRuns: Math.round(profitableRuns * 1000) / 1000,
        sampleSize: allRMs.length,
        score,
        summary: `P5=${p5Return.toFixed(1)}R, P50=${p50Return.toFixed(1)}R, P95=${p95Return.toFixed(1)}R | ${(profitableRuns * 100).toFixed(0)}% profitable`,
      },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, {
      status: "failed",
      errorMessage: err.message,
      completedAt: new Date(),
    }) as RobustnessRun;
  }
}

export async function runStressTest(): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "stress_test",
    scope: "global",
    parameters: {},
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    const allDetails: { detail: BacktestDetail; ticker: string; atr: number; date: string }[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;
      for (const d of details) {
        if (d.triggered) allDetails.push({ detail: d, ticker: bt.ticker, atr, date: d.date });
      }
    }

    if (allDetails.length < 20) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allDetails.length} events — need at least 20`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const scenarios: { name: string; expectancy: number; winRate: number; sampleSize: number }[] = [];

    const rms = allDetails.map(item => {
      const r = computeRMultiples([item.detail], item.atr);
      return r[0];
    }).filter(Boolean);

    const baseStats = aggregateExpectancy(rms, "ALL", null);
    scenarios.push({ name: "Baseline", expectancy: baseStats.expectancyR, winRate: baseStats.winRate, sampleSize: baseStats.sampleSize });

    const doubleSlippage = rms.map(rm => ({ ...rm, r: rm.r - 0.1 }));
    const slipStats = aggregateExpectancy(doubleSlippage, "ALL", null);
    scenarios.push({ name: "2x Slippage", expectancy: slipStats.expectancyR, winRate: slipStats.winRate, sampleSize: slipStats.sampleSize });

    const halfWins = rms.map(rm => {
      if (rm.hit) return { ...rm, r: rm.r * 0.5 };
      return rm;
    });
    const halfWinStats = aggregateExpectancy(halfWins, "ALL", null);
    scenarios.push({ name: "Half Win Size", expectancy: halfWinStats.expectancyR, winRate: halfWinStats.winRate, sampleSize: halfWinStats.sampleSize });

    const worstQuartile = [...rms].sort((a, b) => a.r - b.r).slice(0, Math.ceil(rms.length * 0.25));
    const worstStats = aggregateExpectancy(worstQuartile, "ALL", null);
    scenarios.push({ name: "Worst 25% Trades", expectancy: worstStats.expectancyR, winRate: worstStats.winRate, sampleSize: worstStats.sampleSize });

    const survivingScenarios = scenarios.filter(s => s.expectancy > 0).length;
    let score = Math.round(10 * (survivingScenarios / scenarios.length));
    const warningsList: string[] = [];

    if (survivingScenarios < scenarios.length) {
      warningsList.push(`${scenarios.length - survivingScenarios} of ${scenarios.length} stress scenarios show negative expectancy`);
    }

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: { scenarios, survivingScenarios, totalScenarios: scenarios.length, score, summary: `${survivingScenarios}/${scenarios.length} stress scenarios profitable` },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, { status: "failed", errorMessage: err.message, completedAt: new Date() }) as RobustnessRun;
  }
}

export async function runParameterSweep(): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "parameter_sweep",
    scope: "global",
    parameters: {},
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    const allDetails: { detail: BacktestDetail; ticker: string; atr: number }[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;
      for (const d of details) {
        if (d.triggered) allDetails.push({ detail: d, ticker: bt.ticker, atr });
      }
    }

    if (allDetails.length < 20) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allDetails.length} events — need at least 20`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const stopMultipliers = [0.15, 0.20, 0.25, 0.30, 0.35, 0.40];
    const sweepResults: { stopMult: number; expectancy: number; winRate: number; profitFactor: number }[] = [];

    for (const mult of stopMultipliers) {
      const rms: RMultipleResult[] = [];
      for (const item of allDetails) {
        const d = item.detail;
        if (!d.entryPrice || d.entryPrice <= 0) continue;
        const stopDist = Math.max(mult * item.atr, d.entryPrice * 0.0015);
        if (stopDist <= 0) continue;
        const reward = Math.abs(d.magnetPrice - d.entryPrice);
        const maeR = d.mae != null ? (d.mae * d.entryPrice) / stopDist : 0;
        if (d.hit) {
          rms.push({ r: reward / stopDist, hit: true, maeR });
        } else {
          rms.push({ r: -1, hit: false, maeR });
        }
      }
      if (rms.length > 0) {
        const stats = aggregateExpectancy(rms, "ALL", null);
        sweepResults.push({ stopMult: mult, expectancy: stats.expectancyR, winRate: stats.winRate, profitFactor: stats.profitFactor });
      }
    }

    const profitableParams = sweepResults.filter(r => r.expectancy > 0).length;
    const consistency = profitableParams / sweepResults.length;

    let score = Math.round(10 * consistency);
    const warningsList: string[] = [];

    if (consistency < 0.5) warningsList.push("Less than half of parameter variations are profitable — high parameter sensitivity");
    const maxExp = Math.max(...sweepResults.map(r => r.expectancy));
    const minExp = Math.min(...sweepResults.map(r => r.expectancy));
    if (maxExp - minExp > 0.5) warningsList.push("Large expectancy range across parameters — results may be fragile");

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: { sweepResults, profitableParams, totalParams: sweepResults.length, consistency, score, summary: `${profitableParams}/${sweepResults.length} param variants profitable, consistency=${(consistency * 100).toFixed(0)}%` },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, { status: "failed", errorMessage: err.message, completedAt: new Date() }) as RobustnessRun;
  }
}

export async function runStopSensitivityTest(): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "stop_sensitivity",
    scope: "global",
    parameters: {},
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    const allDetails: { detail: BacktestDetail; ticker: string; atr: number }[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;
      for (const d of details) {
        if (d.triggered) allDetails.push({ detail: d, ticker: bt.ticker, atr });
      }
    }

    if (allDetails.length < 20) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allDetails.length} events — need at least 20`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const tighterStop = allDetails.map(item => {
      const d = item.detail;
      if (!d.mae) return null;
      const stopDist = Math.max(0.25 * item.atr, (d.entryPrice ?? 100) * 0.0015);
      const tighterStopDist = stopDist * 0.7;
      const wouldBeStoppedOut = d.mae * (d.entryPrice ?? 100) > tighterStopDist;
      return { hit: d.hit, stoppedByTighterStop: wouldBeStoppedOut };
    }).filter(Boolean) as { hit: boolean; stoppedByTighterStop: boolean }[];

    const stoppedOutCount = tighterStop.filter(t => t.stoppedByTighterStop).length;
    const winsLostToTighterStop = tighterStop.filter(t => t.hit && t.stoppedByTighterStop).length;

    const fragility = tighterStop.length > 0 ? stoppedOutCount / tighterStop.length : 0;
    const winLossRate = tighterStop.filter(t => t.hit).length > 0
      ? winsLostToTighterStop / tighterStop.filter(t => t.hit).length : 0;

    let score = 10;
    const warningsList: string[] = [];

    if (fragility > 0.5) { score = 3; warningsList.push("Very high stop sensitivity — over 50% of trades stopped out with 30% tighter stops"); }
    else if (fragility > 0.3) { score = 6; warningsList.push("Moderate stop sensitivity"); }
    else { score = 10; }

    if (winLossRate > 0.3) warningsList.push(`${(winLossRate * 100).toFixed(0)}% of winning trades would be lost with tighter stops`);

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: { stoppedOutCount, totalTrades: tighterStop.length, fragility, winsLostToTighterStop, winLossRate, score, summary: `${(fragility * 100).toFixed(0)}% fragility with 30% tighter stops, ${winsLostToTighterStop} wins would be lost` },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, { status: "failed", errorMessage: err.message, completedAt: new Date() }) as RobustnessRun;
  }
}

export async function runRegimeAnalysis(): Promise<RobustnessRun> {
  const run = await storage.createRobustnessRun({
    testType: "regime_analysis",
    scope: "global",
    parameters: {},
    status: "running",
    startedAt: new Date(),
  });

  try {
    const allBacktests = await storage.getBacktests();
    const allDetails: { detail: BacktestDetail; ticker: string; atr: number }[] = [];

    for (const bt of allBacktests) {
      const details = bt.details as BacktestDetail[] | null;
      if (!details) continue;
      const dailyBars = await storage.getDailyBars(bt.ticker);
      const atr = computeATR(dailyBars);
      if (atr <= 0) continue;

      for (const d of details) {
        if (!d.triggered) continue;
        const price = d.entryPrice ?? d.magnetPrice;
        const atrPct = (atr / price) * 100;
        allDetails.push({ detail: d, ticker: bt.ticker, atr });
      }
    }

    if (allDetails.length < 30) {
      return await storage.updateRobustnessRun(run.id, {
        status: "insufficient_data",
        errorMessage: `Only ${allDetails.length} events — need at least 30`,
        completedAt: new Date(),
      }) as RobustnessRun;
    }

    const atrPcts = allDetails.map(item => {
      const price = item.detail.entryPrice ?? item.detail.magnetPrice;
      return (item.atr / price) * 100;
    });
    atrPcts.sort((a, b) => a - b);
    const p33 = atrPcts[Math.floor(atrPcts.length * 0.33)];
    const p66 = atrPcts[Math.floor(atrPcts.length * 0.66)];

    const regimes: { regime: string; label: string; items: typeof allDetails }[] = [
      { regime: "low_vol", label: "Low Volatility", items: [] },
      { regime: "normal_vol", label: "Normal Volatility", items: [] },
      { regime: "high_vol", label: "High Volatility", items: [] },
    ];

    for (const item of allDetails) {
      const price = item.detail.entryPrice ?? item.detail.magnetPrice;
      const atrPct = (item.atr / price) * 100;
      if (atrPct <= p33) regimes[0].items.push(item);
      else if (atrPct <= p66) regimes[1].items.push(item);
      else regimes[2].items.push(item);
    }

    const breakdowns: RegimeBreakdown[] = [];

    for (const regime of regimes) {
      if (regime.items.length === 0) continue;
      const rms: RMultipleResult[] = [];
      for (const item of regime.items) {
        rms.push(...computeRMultiples([item.detail], item.atr));
      }
      const stats = aggregateExpectancy(rms, "ALL", null);
      breakdowns.push({
        regime: regime.regime,
        label: regime.label,
        sampleSize: rms.length,
        winRate: stats.winRate,
        expectancyR: stats.expectancyR,
        avgMaeR: stats.avgMaeR,
        hitRate: regime.items.filter(i => i.detail.hit).length / regime.items.length,
      });
    }

    const profitableRegimes = breakdowns.filter(b => b.expectancyR > 0).length;
    const consistency = breakdowns.length > 0 ? profitableRegimes / breakdowns.length : 0;

    let score = Math.round(10 * consistency);
    const warningsList: string[] = [];

    if (consistency < 0.5) warningsList.push("Strategy does not perform well across all volatility regimes");

    const bestRegime = breakdowns.reduce((best, b) => b.expectancyR > best.expectancyR ? b : best, breakdowns[0]);
    const worstRegime = breakdowns.reduce((worst, b) => b.expectancyR < worst.expectancyR ? b : worst, breakdowns[0]);

    if (bestRegime && worstRegime && (bestRegime.expectancyR - worstRegime.expectancyR) > 0.4) {
      warningsList.push(`Large performance gap between ${bestRegime.label} and ${worstRegime.label} regimes`);
    }

    return await storage.updateRobustnessRun(run.id, {
      status: "completed",
      summaryMetrics: { breakdowns, profitableRegimes, totalRegimes: breakdowns.length, consistency, score, summary: `${profitableRegimes}/${breakdowns.length} regimes profitable` },
      warnings: warningsList,
      completedAt: new Date(),
    }) as RobustnessRun;
  } catch (err: any) {
    return await storage.updateRobustnessRun(run.id, { status: "failed", errorMessage: err.message, completedAt: new Date() }) as RobustnessRun;
  }
}
