import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  Clock,
  Target,
  AlertTriangle,
  Zap,
  BarChart3,
  Shield,
  Timer,
} from "lucide-react";

const setups = [
  {
    id: "F",
    name: "Weak Extreme",
    bias: "Bullish",
    biasColor: "text-emerald-500",
    icon: TrendingUp,
    summary:
      "Detects days where price closed in the upper 65%+ of its range near a key support level (previous day low or round number). This suggests buyers stepped in at support — signaling a likely bounce continuation.",
    rules: [
      "Today's close is in the upper 65% of the day's range",
      "Today's low is near the previous day's low (within 0.05%)",
      "OR today's low is near a round number (whole, half dollar)",
    ],
    direction: "Bullish — expecting price to hold support and push higher",
    bestTime:
      "First 60 minutes (p60). Weak extremes tend to resolve quickly at the open as overnight positioning plays out. If p60 is strong for this setup, watch the 9:30–10:30 AM window closely.",
    tradePlan:
      "Enter near the open, targeting the previous day's close or higher. Stop below the identified support level (previous day low or round number).",
    example:
      "Stock closes at $152.80 with a low of $150.00 (a round number) and the day's range was $150.00–$153.20. Close is in the upper 87% of range near round support — bullish bounce expected.",
  },
  {
    id: "C",
    name: "Gap Fill Magnet",
    bias: "Either",
    biasColor: "text-blue-500",
    icon: ArrowUpDown,
    summary:
      "When a stock gaps up or down significantly at the open, this setup expects the gap to fill — price gravitates back toward the previous close like a magnet.",
    rules: [
      "Gap between today's open and previous close exceeds the gap threshold (default 0.30%)",
      "Gap up = bearish fill (price pulls back down to prev close)",
      "Gap down = bullish fill (price pushes back up to prev close)",
    ],
    direction: "Counter-trend — fills the gap back to previous close",
    bestTime:
      "First 30–60 minutes. Gap fills are one of the most time-sensitive setups. Most gaps that will fill do so within the first hour. A high p30 or p60 is a strong confirmation signal.",
    tradePlan:
      "Enter shortly after the open in the direction of the gap fill. The magnet/target is the previous day's close. Stop is placed beyond the opening price (giving room for the initial gap extension).",
    example:
      "Stock closed at $200 yesterday, opens at $203 today (1.5% gap up). Setup expects price to pull back to $200. Enter short-biased, target $200, stop above $204.",
  },
  {
    id: "D",
    name: "Inside Day Expansion",
    bias: "Neutral",
    biasColor: "text-muted-foreground",
    icon: Zap,
    summary:
      "An inside day (today's high and low are both within yesterday's range) signals compression. The next day typically sees an expansion breakout — targeting the prior day's high or low.",
    rules: [
      "Today's high is below yesterday's high",
      "Today's low is above yesterday's low",
      "Both conditions must be true (full inside bar)",
    ],
    direction: "Both — breakout targets yesterday's high AND yesterday's low",
    bestTime:
      "First 60–120 minutes. The breakout direction often establishes within the first 1–2 hours. Watch p60 and p120 to gauge how quickly the expansion typically resolves.",
    tradePlan:
      "Two magnets: yesterday's high (upside target) and yesterday's low (downside target). Enter in the direction of the initial breakout. Stop on the opposite side of today's range.",
    example:
      "Yesterday's range was $95–$100. Today traded $96–$99 (inside day). Tomorrow expect a move to either $100 or $95.",
  },
  {
    id: "E",
    name: "PDH/PDL Sweep",
    bias: "Neutral",
    biasColor: "text-muted-foreground",
    icon: Target,
    summary:
      "Previous Day High (PDH) and Previous Day Low (PDL) are key levels that attract price. This setup watches for the next day to sweep (test) these levels.",
    rules: [
      "Tracks the previous day's high and low as magnet levels",
      "Next trading day is expected to test one or both levels",
      "Works on all tickers — universal price behavior",
    ],
    direction: "Both — targets PDH (upside) and PDL (downside)",
    bestTime:
      "Throughout the session. PDH/PDL sweeps can happen at any point during the day. Check p120 and p390 — if p390 is significantly higher than p60, the sweep tends to happen later in the session.",
    tradePlan:
      "Watch for price approaching PDH or PDL. The level itself is the target. Fade or join momentum depending on price action at the level. Tight stops just beyond the level.",
    example:
      "Yesterday's high was $155, low was $150. Today watch for price to reach $155 or $150 as magnet targets.",
  },
  {
    id: "A",
    name: "Thu-Fri-Mon Magnet",
    bias: "Bearish",
    biasColor: "text-red-500 dark:text-red-400",
    icon: TrendingDown,
    summary:
      "When Friday's high fails to exceed Thursday's high, it signals weakness heading into Monday. The magnet is Friday's low — price tends to get pulled down to that level on Monday.",
    rules: [
      "Thursday sets a high",
      "Friday's high is below Thursday's high (failed breakout)",
      "Monday is the target day — price pulled toward Friday's low",
    ],
    direction: "Bearish — expecting Monday to trade down toward Friday's low",
    bestTime:
      "First 60–120 minutes of Monday. The magnet pull is strongest at the start of the new week. A strong p60 means the pullback happens fast. If p120 is high but p60 is low, expect a slower grind down.",
    tradePlan:
      "Enter short-biased near Monday's open. Target is Friday's low. Stop above Thursday's high (the level that Friday failed to break).",
    example:
      "Thursday high: $110. Friday traded up to $108 but couldn't break $110, closed at $106 with a low of $104. Monday expect price pulled toward $104.",
  },
  {
    id: "B",
    name: "Mon-Wed-Thu Magnet",
    bias: "Bearish",
    biasColor: "text-red-500 dark:text-red-400",
    icon: TrendingDown,
    summary:
      "Similar to Setup A but mid-week. When Wednesday's high fails to exceed Monday's high, Thursday is the target day with a magnet pull toward Wednesday's low.",
    rules: [
      "Monday sets a high",
      "Wednesday's high is below Monday's high (failed breakout)",
      "Thursday is the target day — price pulled toward Wednesday's low",
    ],
    direction: "Bearish — expecting Thursday to trade down toward Wednesday's low",
    bestTime:
      "First 60–120 minutes of Thursday. Like Setup A, the magnet pull tends to resolve in the morning session. Check p60 for quick-hit probability.",
    tradePlan:
      "Enter short-biased near Thursday's open. Target is Wednesday's low. Stop above Monday's high.",
    example:
      "Monday high: $250. Wednesday traded up to $247 but couldn't break $250, closed at $244 with a low of $242. Thursday expect price pulled toward $242.",
  },
];

const concepts = [
  {
    title: "Quality Score (0–100)",
    icon: BarChart3,
    description:
      "Every signal gets a quality score from 0 to 100 based on 6 factors: edge strength (how strong the setup pattern is), magnet distance (how close price is to the target), liquidity (how actively the stock trades), movement environment (current volatility), historical hit rate (past performance of this setup on this ticker), and TimeScore (how quickly the setup tends to hit).",
  },
  {
    title: "Tier System",
    icon: Shield,
    description:
      "Signals are ranked into tiers: A+ (score 90+ with fast hit probability p60 >= 55%), A (score 80+ with strong same-day probability p120 >= 60%), B (score 70–79), and C (under 70). Higher tiers mean higher-confidence trades. Watchlist priority tickers get bumped up one tier.",
  },
  {
    title: "Time-to-Hit Probabilities",
    icon: Timer,
    description:
      "After backtesting, the system computes the probability that a setup hits its target within specific time windows: p15 (15 min), p30 (30 min), p60 (1 hour), p120 (2 hours), p240 (4 hours), and p390 (full session). Use these to decide how long to hold a trade and when to cut losses.",
  },
  {
    title: "TimeScore",
    icon: Clock,
    description:
      "A quality component (0–25 points) that rewards setups with fast resolution. In EARLY mode it weights p60 (first hour), in SAME_DAY mode it weights p390 (full session), and BLEND mode uses a mix of both. Configure this in Settings based on your trading style.",
  },
  {
    title: "Universe Filter",
    icon: Target,
    description:
      "Controls which tickers generate signals. WATCHLIST_ONLY limits to your priority list. LIQUIDITY_ONLY requires minimum dollar volume. HYBRID passes tickers that meet either condition. Signals from tickers outside the universe are marked but won't trigger alerts.",
  },
  {
    title: "Hit vs Miss",
    icon: AlertTriangle,
    description:
      "A 'hit' means price reached the magnet/target level during Regular Trading Hours (8:30 AM–3:00 PM CT). A 'miss' means the session ended without reaching the target. Both are final states — only 'pending' signals are still active.",
  },
];

const reliabilityGates = [
  {
    id: "fees_slippage",
    title: "Fees & Slippage",
    icon: BarChart3,
    description:
      "Tests whether your edge survives real-world trading costs including commissions, spread, and slippage. A strategy that only works in a zero-cost simulation is not tradeable.",
  },
  {
    id: "out_of_sample",
    title: "Out-of-Sample Validation",
    icon: Target,
    description:
      "Splits historical data into training and testing periods. The strategy is optimized on the training set and then evaluated on unseen test data to detect overfitting.",
  },
  {
    id: "walk_forward",
    title: "Walk-Forward Test",
    icon: Timer,
    description:
      "Uses a sliding window to repeatedly train and test the strategy across multiple time periods, simulating how it would adapt to changing market conditions over time.",
  },
  {
    id: "stress_test",
    title: "Stress Testing",
    icon: AlertTriangle,
    description:
      "Evaluates strategy performance under adverse market scenarios such as flash crashes, high-volatility spikes, and liquidity dry-ups to ensure it doesn't blow up in extreme conditions.",
  },
  {
    id: "monte_carlo",
    title: "Monte Carlo Simulation",
    icon: Zap,
    description:
      "Randomizes the sequence of trades thousands of times to assess the range of possible outcomes. Helps determine if results are statistically significant or just luck.",
  },
  {
    id: "parameter_sweep",
    title: "Parameter Sensitivity",
    icon: BarChart3,
    description:
      "Varies key parameters like stop distance, target multiples, and entry thresholds to check if performance is stable across a range of values or fragile to small changes.",
  },
  {
    id: "stop_sensitivity",
    title: "Stop Distance Sensitivity",
    icon: Shield,
    description:
      "Specifically tests what happens when stops are tightened or widened. A robust strategy should degrade gracefully rather than collapse when stop placement shifts slightly.",
  },
  {
    id: "regime_analysis",
    title: "Regime-Aware Reporting",
    icon: TrendingUp,
    description:
      "Breaks down performance by market volatility regime (low, normal, high). Reveals whether the strategy only works in one regime or maintains its edge across different environments.",
  },
  {
    id: "forward_validation",
    title: "Forward Validation",
    icon: Clock,
    description:
      "Tracks strategy performance in a paper or live forward-testing period after backtesting is complete. Confirms that historical results translate to real-time market behavior.",
  },
  {
    id: "data_quality",
    title: "Data Quality & Coverage",
    icon: Target,
    description:
      "Checks whether the backtest data has sufficient history, adequate sample size, and minimal gaps. Ensures results are not based on thin or unreliable data.",
  },
];

export default function GuidePage() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">
          Setup Guide
        </h1>
        <p className="text-sm text-muted-foreground">
          How each setup works, its directional bias, and the best time to trade
          it
        </p>
      </div>

      <div className="space-y-4">
        {setups.map((setup) => (
          <Card key={setup.id} data-testid={`card-setup-${setup.id}`}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted">
                  <setup.icon className={`w-4 h-4 ${setup.biasColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base">
                    {setup.id}: {setup.name}
                  </CardTitle>
                </div>
                <Badge
                  variant={
                    setup.bias === "Bullish"
                      ? "default"
                      : setup.bias === "Bearish"
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {setup.bias}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{setup.summary}</p>

              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Detection Rules
                  </h4>
                  <ul className="space-y-1">
                    {setup.rules.map((rule, i) => (
                      <li
                        key={i}
                        className="text-sm flex items-start gap-2"
                      >
                        <span className="text-muted-foreground mt-0.5 shrink-0">
                          {i + 1}.
                        </span>
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Separator />

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Direction
                    </h4>
                    <p className="text-sm">{setup.direction}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Best Time to Trade
                    </h4>
                    <p className="text-sm">{setup.bestTime}</p>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Trade Plan
                  </h4>
                  <p className="text-sm">{setup.tradePlan}</p>
                </div>

                <div className="rounded-md bg-muted/40 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Example
                  </h4>
                  <p className="text-sm">{setup.example}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3" data-testid="text-concepts-title">
          Key Concepts
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {concepts.map((concept) => (
            <Card key={concept.title} data-testid={`card-concept-${concept.title.replace(/[^a-zA-Z]/g, "-").toLowerCase()}`}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
                    <concept.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">
                      {concept.title}
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {concept.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3" data-testid="text-reliability-title">
          Reliability & Robustness
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          The system runs 10 validation gates to measure how robust your trading strategy is. Here's what each test means.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {reliabilityGates.map((gate) => (
            <Card key={gate.title} data-testid={`card-gate-${gate.id}`}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted shrink-0">
                    <gate.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-1">{gate.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{gate.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="mt-3" data-testid="card-grading-scale">
          <CardContent className="pt-4">
            <h3 className="text-sm font-semibold mb-1">Grading Scale</h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
              Each gate produces a pass/fail result. The overall reliability grade is based on the percentage of gates passed:
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge variant="default">A+ (85%+)</Badge>
              <Badge variant="default">A (75%+)</Badge>
              <Badge variant="secondary">B (60%+)</Badge>
              <Badge variant="secondary">C (40%+)</Badge>
              <Badge variant="secondary">D (20%+)</Badge>
              <Badge variant="destructive">F (&lt;20%)</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Higher scores indicate a more thoroughly validated and robust strategy.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
