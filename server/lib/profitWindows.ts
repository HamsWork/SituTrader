import { isTradingDay } from "./calendar";

export interface TradeInput {
  r_multiple: number;
  entry_ts: number;
  exit_ts: number;
  symbol: string;
  entry_price: number;
  timeframe: string;
}

interface InstrumentProfile {
  name: string;
  leverage: number;
  rth_only: boolean;
  loss_cap: number | null;
  fee_per_trade: number;
}

const INSTRUMENT_PROFILES: Record<string, InstrumentProfile> = {
  SHARES: { name: "Shares", leverage: 1, rth_only: false, loss_cap: null, fee_per_trade: 0 },
  LETF: { name: "Leveraged ETF (3x)", leverage: 3, rth_only: true, loss_cap: -1, fee_per_trade: 0 },
  OPTIONS: { name: "Options (5x)", leverage: 5, rth_only: true, loss_cap: -1, fee_per_trade: 1.30 },
  LETF_OPTIONS: { name: "LETF Options (15x)", leverage: 15, rth_only: true, loss_cap: -1, fee_per_trade: 1.30 },
};

type LiquidityTier = "ULTRA_LIQUID" | "HIGH_LIQUID" | "MEDIUM_LIQUID" | "LOW_LIQUID";

const ULTRA_LIQUID_SYMBOLS = new Set(["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD"]);
const HIGH_LIQUID_SYMBOLS = new Set(["JPM", "BAC", "V", "NFLX", "WMT", "DIS", "COST", "HD", "PG", "JNJ", "UNH", "MA", "CRM", "ORCL", "INTC", "PYPL", "ADBE", "CSCO", "AVGO", "PEP", "KO", "MRK", "ABBV", "LLY", "XOM", "CVX"]);
const MEDIUM_LIQUID_SYMBOLS = new Set(["CRWD", "DDOG", "NET", "SNOW", "PLTR", "SOFI", "ROKU", "SHOP", "SQ", "AFRM", "COIN", "UBER", "LYFT", "DASH", "RIVN", "LCID", "NIO", "MARA", "RIOT", "ARM"]);

interface TierConfig {
  spread_bps: number;
  slippage_bps: number;
  fill_rate: number;
  options_spread_mult: number;
  letf_options_spread_mult: number;
}

const TIER_CONFIGS: Record<LiquidityTier, TierConfig> = {
  ULTRA_LIQUID: { spread_bps: 3, slippage_bps: 2, fill_rate: 0.99, options_spread_mult: 1.5, letf_options_spread_mult: 2.0 },
  HIGH_LIQUID: { spread_bps: 8, slippage_bps: 5, fill_rate: 0.97, options_spread_mult: 2.5, letf_options_spread_mult: 3.5 },
  MEDIUM_LIQUID: { spread_bps: 15, slippage_bps: 10, fill_rate: 0.93, options_spread_mult: 4.0, letf_options_spread_mult: 6.0 },
  LOW_LIQUID: { spread_bps: 30, slippage_bps: 20, fill_rate: 0.85, options_spread_mult: 7.0, letf_options_spread_mult: 10.0 },
};

interface TimingWindow {
  label: string;
  start: string;
  end: string;
  spread_factor: number;
}

const TIMING_WINDOWS: TimingWindow[] = [
  { label: "Avoid: Open", start: "09:30", end: "09:45", spread_factor: 2.5 },
  { label: "Caution: Post-Open", start: "09:45", end: "10:00", spread_factor: 1.5 },
  { label: "Optimal: Morning", start: "10:00", end: "11:30", spread_factor: 1.0 },
  { label: "Acceptable: Midday", start: "11:30", end: "14:00", spread_factor: 1.3 },
  { label: "Optimal: Afternoon", start: "14:00", end: "15:30", spread_factor: 1.0 },
  { label: "Caution: Pre-Close", start: "15:30", end: "15:45", spread_factor: 1.4 },
  { label: "Avoid: Close", start: "15:45", end: "16:00", spread_factor: 1.8 },
];

const US_HOLIDAYS: Set<string> = new Set([
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
  "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26",
  "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

function isMarketDay(dateStr: string): boolean {
  if (US_HOLIDAYS.has(dateStr)) return false;
  const d = new Date(dateStr + "T12:00:00Z");
  const dow = d.getUTCDay();
  return dow >= 1 && dow <= 5;
}

function countTradingDays(startDate: Date, endDate: Date): number {
  let count = 0;
  const d = new Date(startDate);
  while (d <= endDate) {
    const ds = d.toISOString().slice(0, 10);
    if (isMarketDay(ds)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function getLiquidityTier(symbol: string): LiquidityTier {
  if (ULTRA_LIQUID_SYMBOLS.has(symbol)) return "ULTRA_LIQUID";
  if (HIGH_LIQUID_SYMBOLS.has(symbol)) return "HIGH_LIQUID";
  if (MEDIUM_LIQUID_SYMBOLS.has(symbol)) return "MEDIUM_LIQUID";
  return "LOW_LIQUID";
}

function isRTH(epochSec: number): boolean {
  const d = new Date(epochSec * 1000);
  const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = et.getHours();
  const m = et.getMinutes();
  const totalMin = h * 60 + m;
  return totalMin >= 570 && totalMin <= 960;
}

function isDailyTimeframe(tf: string): boolean {
  if (!tf) return true;
  const lower = tf.toLowerCase();
  return lower === "1d" || lower === "daily" || lower === "1w" || lower === "weekly" || lower === "d" || lower === "w";
}

interface WindowStats {
  window_days: number;
  trading_days: number;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_r: number;
  avg_r: number;
  total_pnl: number;
  avg_pnl: number;
  trades_per_day: number;
  daily_avg_pnl: number;
  profit_factor: number;
  best_trade_r: number;
  best_trade_pnl: number;
  worst_trade_r: number;
  worst_trade_pnl: number;
  max_drawdown_r: number;
  max_drawdown_pnl: number;
  equity_curve: { trade: number; cum_r: number; cum_pnl: number }[];
}

interface ExecutionWindow {
  window_days: number;
  retention_pct: number;
  realistic_pnl: number;
  theoretical_pnl: number;
  execution_cost_total: number;
  realistic_win_rate: number;
  realistic_profit_factor: number;
  realistic_max_drawdown_r: number;
  realistic_max_drawdown_pnl: number;
  avg_cost_per_trade: number;
  tier_breakdown: { tier: string; count: number; pct: number }[];
}

interface TimingRecommendation {
  windows: { label: string; start: string; end: string; spread_factor: number; effective_cost_mult: number }[];
  optimal_savings_pct: number;
  avoid_penalty_pct: number;
}

interface InstrumentResult {
  profile: InstrumentProfile;
  windows: WindowStats[];
  execution?: { windows: ExecutionWindow[]; timing: TimingRecommendation };
}

export interface ProfitWindowsResult {
  comparison: Record<string, InstrumentResult>;
  risk_per_trade: number;
  generated_at: string;
}

function computeWindowStats(
  adjustedRs: { r: number; symbol: string }[],
  windowDays: number,
  tradingDays: number,
  riskPerTrade: number
): WindowStats {
  const n = adjustedRs.length;
  if (n === 0) {
    return {
      window_days: windowDays, trading_days: tradingDays,
      total_trades: 0, wins: 0, losses: 0, win_rate: 0,
      total_r: 0, avg_r: 0, total_pnl: 0, avg_pnl: 0,
      trades_per_day: 0, daily_avg_pnl: 0, profit_factor: 0,
      best_trade_r: 0, best_trade_pnl: 0, worst_trade_r: 0, worst_trade_pnl: 0,
      max_drawdown_r: 0, max_drawdown_pnl: 0, equity_curve: [],
    };
  }

  const wins = adjustedRs.filter(t => t.r > 0).length;
  const losses = adjustedRs.filter(t => t.r <= 0).length;
  const totalR = adjustedRs.reduce((s, t) => s + t.r, 0);
  const grossWins = adjustedRs.filter(t => t.r > 0).reduce((s, t) => s + t.r, 0);
  const grossLosses = Math.abs(adjustedRs.filter(t => t.r <= 0).reduce((s, t) => s + t.r, 0));

  let maxR = -Infinity, minR = Infinity;
  for (const t of adjustedRs) {
    if (t.r > maxR) maxR = t.r;
    if (t.r < minR) minR = t.r;
  }

  let peak = 0, maxDD = 0, cumR = 0;
  const curve: { trade: number; cum_r: number; cum_pnl: number }[] = [];
  for (let i = 0; i < n; i++) {
    cumR += adjustedRs[i].r;
    if (cumR > peak) peak = cumR;
    const dd = peak - cumR;
    if (dd > maxDD) maxDD = dd;
    curve.push({ trade: i + 1, cum_r: Math.round(cumR * 100) / 100, cum_pnl: Math.round(cumR * riskPerTrade * 100) / 100 });
  }

  const last50 = curve.length > 50 ? curve.slice(curve.length - 50) : curve;

  return {
    window_days: windowDays,
    trading_days: tradingDays,
    total_trades: n,
    wins,
    losses,
    win_rate: Math.round((wins / n) * 1000) / 10,
    total_r: Math.round(totalR * 100) / 100,
    avg_r: Math.round((totalR / n) * 100) / 100,
    total_pnl: Math.round(totalR * riskPerTrade * 100) / 100,
    avg_pnl: Math.round((totalR / n) * riskPerTrade * 100) / 100,
    trades_per_day: tradingDays > 0 ? Math.round((n / tradingDays) * 100) / 100 : 0,
    daily_avg_pnl: tradingDays > 0 ? Math.round((totalR * riskPerTrade / tradingDays) * 100) / 100 : 0,
    profit_factor: grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : grossWins > 0 ? Infinity : 0,
    best_trade_r: Math.round(maxR * 100) / 100,
    best_trade_pnl: Math.round(maxR * riskPerTrade * 100) / 100,
    worst_trade_r: Math.round(minR * 100) / 100,
    worst_trade_pnl: Math.round(minR * riskPerTrade * 100) / 100,
    max_drawdown_r: Math.round(maxDD * 100) / 100,
    max_drawdown_pnl: Math.round(maxDD * riskPerTrade * 100) / 100,
    equity_curve: last50,
  };
}

function computeExecutionWindow(
  trades: { r: number; symbol: string; theoretical_r: number; cost_r: number; fill_rate: number; tier: LiquidityTier }[],
  windowDays: number,
  riskPerTrade: number
): ExecutionWindow {
  if (trades.length === 0) {
    return {
      window_days: windowDays, retention_pct: 0, realistic_pnl: 0, theoretical_pnl: 0,
      execution_cost_total: 0, realistic_win_rate: 0, realistic_profit_factor: 0,
      realistic_max_drawdown_r: 0, realistic_max_drawdown_pnl: 0,
      avg_cost_per_trade: 0, tier_breakdown: [],
    };
  }

  const theoreticalPnl = trades.reduce((s, t) => s + t.theoretical_r, 0) * riskPerTrade;
  const realisticPnl = trades.reduce((s, t) => s + t.r, 0) * riskPerTrade;
  const totalCost = trades.reduce((s, t) => s + t.cost_r, 0) * riskPerTrade;
  const realisticWins = trades.filter(t => t.r > 0).length;
  const grossW = trades.filter(t => t.r > 0).reduce((s, t) => s + t.r, 0);
  const grossL = Math.abs(trades.filter(t => t.r <= 0).reduce((s, t) => s + t.r, 0));

  let peak = 0, maxDD = 0, cum = 0;
  for (const t of trades) {
    cum += t.r;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) maxDD = dd;
  }

  const tierCounts: Record<string, number> = {};
  for (const t of trades) {
    tierCounts[t.tier] = (tierCounts[t.tier] || 0) + 1;
  }
  const tierBreakdown = Object.entries(tierCounts).map(([tier, count]) => ({
    tier,
    count,
    pct: Math.round((count / trades.length) * 1000) / 10,
  }));

  return {
    window_days: windowDays,
    retention_pct: theoreticalPnl !== 0 ? Math.round((realisticPnl / theoreticalPnl) * 1000) / 10 : 100,
    realistic_pnl: Math.round(realisticPnl * 100) / 100,
    theoretical_pnl: Math.round(theoreticalPnl * 100) / 100,
    execution_cost_total: Math.round(totalCost * 100) / 100,
    realistic_win_rate: Math.round((realisticWins / trades.length) * 1000) / 10,
    realistic_profit_factor: grossL > 0 ? Math.round((grossW / grossL) * 100) / 100 : grossW > 0 ? Infinity : 0,
    realistic_max_drawdown_r: Math.round(maxDD * 100) / 100,
    realistic_max_drawdown_pnl: Math.round(maxDD * riskPerTrade * 100) / 100,
    avg_cost_per_trade: Math.round((totalCost / trades.length) * 100) / 100,
    tier_breakdown: tierBreakdown,
  };
}

function computeTimingRecommendation(instrumentType: string): TimingRecommendation {
  const isLetfOptions = instrumentType === "LETF_OPTIONS";
  const windows = TIMING_WINDOWS.map(tw => {
    const effectiveMult = isLetfOptions ? tw.spread_factor * 1.3 : tw.spread_factor;
    return {
      label: tw.label,
      start: tw.start,
      end: tw.end,
      spread_factor: tw.spread_factor,
      effective_cost_mult: Math.round(effectiveMult * 100) / 100,
    };
  });

  const optimalCost = 1.0 * (isLetfOptions ? 1.3 : 1.0);
  const avoidCost = 2.5 * (isLetfOptions ? 1.3 : 1.0);
  const savings = Math.round(((avoidCost - optimalCost) / avoidCost) * 1000) / 10;
  const penalty = Math.round(((avoidCost - optimalCost) / optimalCost) * 1000) / 10;

  return { windows, optimal_savings_pct: savings, avoid_penalty_pct: penalty };
}

export function computeAllProfitWindows(
  trades: TradeInput[],
  riskPerTrade: number = 1000,
  windows: number[] = [30, 60, 90]
): ProfitWindowsResult {
  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);

  const comparison: Record<string, InstrumentResult> = {};

  for (const [instKey, profile] of Object.entries(INSTRUMENT_PROFILES)) {
    const windowResults: WindowStats[] = [];
    const execWindows: ExecutionWindow[] = [];
    const hasExecution = instKey === "OPTIONS" || instKey === "LETF_OPTIONS";

    for (const windowDays of windows) {
      const cutoffEpoch = nowEpoch - windowDays * 86400;
      const cutoffDate = new Date(cutoffEpoch * 1000);

      let windowTrades = trades.filter(t => t.exit_ts >= cutoffEpoch && t.exit_ts <= nowEpoch);

      if (profile.rth_only) {
        windowTrades = windowTrades.filter(t => {
          if (isDailyTimeframe(t.timeframe)) return true;
          return isRTH(t.entry_ts) && isRTH(t.exit_ts);
        });
      }

      const feeR = profile.fee_per_trade / riskPerTrade;

      const adjustedTrades = windowTrades.map(t => {
        let adjR = t.r_multiple * profile.leverage;
        if (profile.loss_cap !== null && adjR < 0) {
          adjR = Math.max(adjR, profile.loss_cap);
        }
        adjR -= feeR;
        return { r: Math.round(adjR * 10000) / 10000, symbol: t.symbol };
      });

      const tradingDays = countTradingDays(cutoffDate, now);
      windowResults.push(computeWindowStats(adjustedTrades, windowDays, tradingDays, riskPerTrade));

      if (hasExecution) {
        const spreadMultKey = instKey === "LETF_OPTIONS" ? "letf_options_spread_mult" : "options_spread_mult";

        const execTrades = windowTrades.map(t => {
          const tier = getLiquidityTier(t.symbol);
          const cfg = TIER_CONFIGS[tier];
          const spreadMult = cfg[spreadMultKey];
          const totalCostBps = (cfg.spread_bps * spreadMult) + cfg.slippage_bps;
          const costAsR = (totalCostBps / 10000) * profile.leverage * 2;

          let theoreticalR = t.r_multiple * profile.leverage;
          if (profile.loss_cap !== null && theoreticalR < 0) {
            theoreticalR = Math.max(theoreticalR, profile.loss_cap);
          }
          theoreticalR -= feeR;

          const realisticR = (theoreticalR - costAsR) * cfg.fill_rate;

          return {
            r: Math.round(realisticR * 10000) / 10000,
            symbol: t.symbol,
            theoretical_r: Math.round(theoreticalR * 10000) / 10000,
            cost_r: Math.round(costAsR * 10000) / 10000,
            fill_rate: cfg.fill_rate,
            tier,
          };
        });

        execWindows.push(computeExecutionWindow(execTrades, windowDays, riskPerTrade));
      }
    }

    const result: InstrumentResult = { profile, windows: windowResults };
    if (hasExecution) {
      result.execution = {
        windows: execWindows,
        timing: computeTimingRecommendation(instKey),
      };
    }
    comparison[instKey] = result;
  }

  return {
    comparison,
    risk_per_trade: riskPerTrade,
    generated_at: now.toISOString(),
  };
}
