import type { DailyBar, IntradayBar } from "@shared/schema";
import {
  detectSetupA,
  detectSetupB,
  detectSetupC,
  detectSetupD,
  detectSetupE,
  detectSetupF,
  detectAllSetups,
  type SetupResult,
} from "./rules";

function makeBar(overrides: Partial<DailyBar> & { date: string }): DailyBar {
  return {
    id: 0,
    ticker: "TEST",
    date: overrides.date,
    open: overrides.open ?? 100,
    high: overrides.high ?? 105,
    low: overrides.low ?? 95,
    close: overrides.close ?? 102,
    volume: overrides.volume ?? 1000000,
    vwap: overrides.vwap ?? null,
    source: "test",
  };
}

function makeIntradayBar(overrides: Partial<IntradayBar> & { ts: string }): IntradayBar {
  return {
    id: 0,
    ticker: "TEST",
    ts: overrides.ts,
    open: overrides.open ?? 100,
    high: overrides.high ?? 105,
    low: overrides.low ?? 95,
    close: overrides.close ?? 102,
    volume: overrides.volume ?? 500000,
    timeframe: overrides.timeframe ?? "5",
    source: "test",
  };
}

interface TestCaseResult {
  name: string;
  pass: boolean;
  expectDetect: boolean;
  detected: boolean;
  results: SetupResult[];
}

interface TestCase {
  name: string;
  expectDetect: boolean;
  run: () => { detected: boolean; results: SetupResult[] };
}

interface SetupGroupResult {
  passed: number;
  failed: number;
  tests: TestCaseResult[];
}

function runTestCase(tc: TestCase): TestCaseResult {
  const { detected, results } = tc.run();
  const pass = detected === tc.expectDetect;
  return { name: tc.name, pass, expectDetect: tc.expectDetect, detected, results };
}

function setupATests(): TestCase[] {
  return [
    {
      name: "A: Fri high < Thu high → should detect (down-to-magnet)",
      expectDetect: true,
      run: () => {
        const thu = makeBar({ date: "2026-04-02", high: 110, low: 98, close: 105 });
        const fri = makeBar({ date: "2026-04-03", high: 107, low: 96, close: 100 });
        const results = detectSetupA([thu, fri]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "A: Fri high >= Thu high → should NOT detect",
      expectDetect: false,
      run: () => {
        const thu = makeBar({ date: "2026-04-02", high: 110, low: 98, close: 105 });
        const fri = makeBar({ date: "2026-04-03", high: 112, low: 96, close: 108 });
        const results = detectSetupA([thu, fri]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "A: bars on Mon+Tue (not Thu+Fri) → should NOT detect",
      expectDetect: false,
      run: () => {
        const mon = makeBar({ date: "2026-04-06", high: 110, low: 98, close: 105 });
        const tue = makeBar({ date: "2026-04-07", high: 107, low: 96, close: 100 });
        const results = detectSetupA([mon, tue]);
        return { detected: results.length > 0, results };
      },
    },
  ];
}

function setupBTests(): TestCase[] {
  return [
    {
      name: "B: Wed high < Mon high → should detect (down-to-magnet)",
      expectDetect: true,
      run: () => {
        const mon = makeBar({ date: "2026-04-06", high: 115, low: 100, close: 110 });
        const tue = makeBar({ date: "2026-04-07", high: 112, low: 101, close: 108 });
        const wed = makeBar({ date: "2026-04-08", high: 111, low: 99, close: 105 });
        const results = detectSetupB([mon, tue, wed]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "B: Wed high >= Mon high → should NOT detect",
      expectDetect: false,
      run: () => {
        const mon = makeBar({ date: "2026-04-06", high: 110, low: 100, close: 108 });
        const tue = makeBar({ date: "2026-04-07", high: 112, low: 101, close: 109 });
        const wed = makeBar({ date: "2026-04-08", high: 113, low: 102, close: 111 });
        const results = detectSetupB([mon, tue, wed]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "B: no Mon in bars before Wed → should NOT detect",
      expectDetect: false,
      run: () => {
        const wed = makeBar({ date: "2026-04-08", high: 107, low: 99, close: 103 });
        const results = detectSetupB([wed]);
        return { detected: results.length > 0, results };
      },
    },
  ];
}

function setupCTests(): TestCase[] {
  return [
    {
      name: "C: gap up > 0.3% → should detect (down-to-magnet)",
      expectDetect: true,
      run: () => {
        const dailyBar = makeBar({ date: "2026-04-07", close: 100 });
        const intradayBar = makeIntradayBar({
          ts: "2026-04-08T14:30:00.000Z",
          close: 101,
        });
        const results = detectSetupC([dailyBar], [intradayBar]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "C: gap down > 0.3% → should detect (up-to-magnet)",
      expectDetect: true,
      run: () => {
        const dailyBar = makeBar({ date: "2026-04-07", close: 100 });
        const intradayBar = makeIntradayBar({
          ts: "2026-04-08T14:30:00.000Z",
          close: 99,
        });
        const results = detectSetupC([dailyBar], [intradayBar]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "C: gap < 0.3% → should NOT detect",
      expectDetect: false,
      run: () => {
        const dailyBar = makeBar({ date: "2026-04-07", close: 100 });
        const intradayBar = makeIntradayBar({
          ts: "2026-04-08T14:30:00.000Z",
          close: 100.2,
        });
        const results = detectSetupC([dailyBar], [intradayBar]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "C: no intraday bars → should NOT detect",
      expectDetect: false,
      run: () => {
        const dailyBar = makeBar({ date: "2026-04-07", close: 100 });
        const results = detectSetupC([dailyBar], []);
        return { detected: results.length > 0, results };
      },
    },
  ];
}

function setupDTests(): TestCase[] {
  return [
    {
      name: "D: inside day (today high < yesterday high AND today low > yesterday low) → should detect",
      expectDetect: true,
      run: () => {
        const yesterday = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const today = makeBar({ date: "2026-04-08", high: 108, low: 92, close: 100 });
        const results = detectSetupD([yesterday, today]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "D: today high >= yesterday high → should NOT detect",
      expectDetect: false,
      run: () => {
        const yesterday = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const today = makeBar({ date: "2026-04-08", high: 112, low: 92, close: 105 });
        const results = detectSetupD([yesterday, today]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "D: today low <= yesterday low → should NOT detect",
      expectDetect: false,
      run: () => {
        const yesterday = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const today = makeBar({ date: "2026-04-08", high: 108, low: 88, close: 98 });
        const results = detectSetupD([yesterday, today]);
        return { detected: results.length > 0, results };
      },
    },
  ];
}

function setupETests(): TestCase[] {
  return [
    {
      name: "E: always fires for any pair of consecutive bars → should detect",
      expectDetect: true,
      run: () => {
        const bar1 = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const bar2 = makeBar({ date: "2026-04-08", high: 115, low: 95, close: 105 });
        const results = detectSetupE([bar1, bar2]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "E: single bar → should NOT detect (needs at least 2 bars)",
      expectDetect: false,
      run: () => {
        const bar1 = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const results = detectSetupE([bar1]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "E: uses prev bar high/low as magnets, direction=both",
      expectDetect: true,
      run: () => {
        const bar1 = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const bar2 = makeBar({ date: "2026-04-08", high: 115, low: 95, close: 105 });
        const results = detectSetupE([bar1, bar2]);
        const ok =
          results.length === 1 &&
          results[0].magnetPrice === 110 &&
          results[0].magnetPrice2 === 90 &&
          results[0].direction === "both";
        return { detected: ok, results };
      },
    },
  ];
}

function setupFTests(): TestCase[] {
  return [
    {
      name: "F: close in top 35% of range + low near PDL → should detect",
      expectDetect: true,
      run: () => {
        const prev = makeBar({ date: "2026-04-07", high: 110, low: 100.00, close: 105 });
        const today = makeBar({ date: "2026-04-08", high: 110, low: 100.00, close: 108 });
        const results = detectSetupF([prev, today]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "F: close in top 35% of range + low near round number → should detect",
      expectDetect: true,
      run: () => {
        const prev = makeBar({ date: "2026-04-07", high: 115, low: 105, close: 110 });
        const today = makeBar({ date: "2026-04-08", high: 110, low: 100.00, close: 108 });
        const results = detectSetupF([prev, today]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "F: close position < 65% (low close) → should NOT detect",
      expectDetect: false,
      run: () => {
        const prev = makeBar({ date: "2026-04-07", high: 110, low: 95, close: 100 });
        const today = makeBar({ date: "2026-04-08", high: 110, low: 90, close: 95 });
        const results = detectSetupF([prev, today]);
        return { detected: results.length > 0, results };
      },
    },
    {
      name: "F: low not near PDL or round level → should NOT detect",
      expectDetect: false,
      run: () => {
        const prev = makeBar({ date: "2026-04-07", high: 115, low: 103.5, close: 110 });
        const today = makeBar({ date: "2026-04-08", high: 112, low: 106.3, close: 111 });
        const results = detectSetupF([prev, today]);
        return { detected: results.length > 0, results };
      },
    },
  ];
}

function detectAllSetupsTest(): TestCase[] {
  return [
    {
      name: "detectAllSetups: runs all enabled setups and aggregates results",
      expectDetect: true,
      run: () => {
        const thu = makeBar({ date: "2026-04-02", high: 110, low: 98, close: 105 });
        const fri = makeBar({ date: "2026-04-03", high: 107, low: 96, close: 100 });
        const yesterday = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const today = makeBar({ date: "2026-04-08", high: 108, low: 92, close: 100 });
        const intradayBar = makeIntradayBar({
          ts: "2026-04-08T14:30:00.000Z",
          close: 105,
        });
        const results = detectAllSetups(
          [thu, fri, yesterday, today],
          [intradayBar],
          ["A", "C", "D", "E"],
        );
        const setupTypes = results.map((r) => r.setupType);
        const hasA = setupTypes.includes("A");
        const hasC = setupTypes.includes("C");
        const hasD = setupTypes.includes("D");
        const hasE = setupTypes.includes("E");
        return { detected: hasA && hasC && hasD && hasE, results };
      },
    },
    {
      name: "detectAllSetups: respects enabledSetups filter",
      expectDetect: true,
      run: () => {
        const bar1 = makeBar({ date: "2026-04-07", high: 110, low: 90, close: 100 });
        const bar2 = makeBar({ date: "2026-04-08", high: 108, low: 92, close: 100 });
        const results = detectAllSetups([bar1, bar2], [], ["D"]);
        const allD = results.every((r) => r.setupType === "D");
        return { detected: results.length > 0 && allD, results };
      },
    },
  ];
}

export function runAllDetectSetupTests(): {
  summary: { total: number; passed: number; failed: number };
  setups: Record<string, SetupGroupResult>;
} {
  const allGroups: Record<string, TestCase[]> = {
    A: setupATests(),
    B: setupBTests(),
    C: setupCTests(),
    D: setupDTests(),
    E: setupETests(),
    F: setupFTests(),
    detectAllSetups: detectAllSetupsTest(),
  };

  let total = 0;
  let passed = 0;
  let failed = 0;
  const setups: Record<string, SetupGroupResult> = {};

  for (const [group, tests] of Object.entries(allGroups)) {
    const groupResults = tests.map(runTestCase);
    const groupPassed = groupResults.filter((r) => r.pass).length;
    const groupFailed = groupResults.filter((r) => !r.pass).length;
    total += groupResults.length;
    passed += groupPassed;
    failed += groupFailed;
    setups[group] = { passed: groupPassed, failed: groupFailed, tests: groupResults };
  }

  return { summary: { total, passed, failed }, setups };
}
