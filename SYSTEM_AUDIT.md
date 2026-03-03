# SITU GOAT Trader — System Audit

**Audit Date:** 2026-03-03  
**Codebase Size:** ~24,200 lines of TypeScript/TSX across 75 source files  
**Architecture:** Full-stack TypeScript (React + Express + PostgreSQL)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                           │
│  React 18 · TypeScript · Tailwind CSS · Shadcn UI · Recharts       │
│  Wouter routing · TanStack Query v5 · Framer Motion                │
│  9 Pages: Dashboard, Performance, Profit Windows, Optimization,    │
│           Settings, Symbol Detail, Backtest, IBKR Dashboard, Guide │
├─────────────────────────────────────────────────────────────────────┤
│                      EXPRESS API SERVER                             │
│  2,132-line routes.ts · 950-line storage.ts · Drizzle ORM          │
│  Session management · CORS · JSON body parsing                     │
├─────────────────────────────────────────────────────────────────────┤
│                      SERVICE LAYER (server/lib/)                   │
│  rules.ts · quality.ts · expectancy.ts · activation.ts             │
│  alerts.ts · ibkrOrders.ts · ibkr.ts · discord.ts                  │
│  polygon.ts · universe.ts · options.ts · leveragedEtf.ts           │
│  optionMonitor.ts · letfMonitor.ts · backtest.ts · calendar.ts     │
│  confidence.ts · tradeplan.ts · validate.ts · profitWindows.ts     │
│  reliability.ts · barCache/ (SQLite persistent bar cache)          │
│  embedTemplateDefaults.ts · embedTemplateEngine.ts                 │
├─────────────────────────────────────────────────────────────────────┤
│                      SCHEDULER & WORKERS (server/jobs/)            │
│  scheduler.ts (241 lines) · jobFunctions.ts (307 lines)           │
│  backtestWorker.ts (174 lines) · node-cron · Author Mode          │
├─────────────────────────────────────────────────────────────────────┤
│                      DATABASE (PostgreSQL)                         │
│  17 tables · Drizzle ORM · Neon-backed                             │
│  signals · backtests · ibkr_trades · daily_bars · intraday_bars    │
│  scheduler_state · universe_members · ticker_stats                  │
│  setup_expectancy · signal_profiles · symbols · app_settings       │
│  ibkr_state · time_to_hit_stats · backtest_jobs · robustness_runs  │
├─────────────────────────────────────────────────────────────────────┤
│                    EXTERNAL INTEGRATIONS                           │
│  Polygon.io (market data) · IBKR TWS/Gateway (trade execution)    │
│  Discord Webhooks (dual-channel alerts)                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Schema (17 Tables)

### 2.1 `signals` (Core — 40 columns)
The central table. Stores every detected setup with full lifecycle tracking.

| Key Columns | Purpose |
|---|---|
| `id`, `ticker`, `setup_type` | Identity: serial PK, stock symbol, setup A–F |
| `asof_date`, `target_date`, `target_date_2`, `target_date_3` | Temporal: detection date and up to 3 target dates |
| `magnet_price`, `magnet_price_2`, `direction` | Trade thesis: price targets and expected direction |
| `confidence`, `quality_score`, `tier` | Scoring: raw confidence (0–1), quality (0–100), tier (A+/A/B/C) |
| `quality_breakdown`, `confidence_breakdown` | JSONB detailed component scores |
| `status`, `alert_state` | Lifecycle: pending/hit/missed/expired; new/alerted/approaching |
| `activation_status`, `activated_ts`, `entry_price_at_activation` | Activation engine state |
| `stop_price`, `stop_stage`, `stop_moved_to_be_ts`, `time_stop_triggered_ts` | Stop management |
| `entry_trigger_price`, `invalidation_ts` | Entry and invalidation tracking |
| `instrument_type`, `instrument_ticker`, `instrument_entry_price` | Instrument routing (OPTION/SHARES/LETF) |
| `options_json`, `option_contract_ticker`, `option_entry_mark` | Options enrichment data |
| `leveraged_etf_json` | LETF selection data |
| `p_hit_60`, `p_hit_120`, `p_hit_390`, `time_score`, `time_to_hit_min` | Time-to-hit probability data |
| `universe_pass`, `trade_plan_json` | Universe filter result and full trade plan |

### 2.2 `backtests` (17 columns)
Historical backtest results per ticker/setup combination. Tracks occurrences, hits, hit rate, timing stats, MAE/MFE, and detailed JSONB results.

### 2.3 `ibkr_trades` (30 columns)
IBKR trade execution records with multi-TP progression (tp_hit_level 0→1→2), partial fills (original_quantity vs remaining_quantity), separate TP1/TP2 fill prices and timestamps, P&L tracking, and Discord alert state.

### 2.4 `daily_bars` / `intraday_bars`
Market data cache from Polygon.io. Daily bars (9 columns) store OHLCV+VWAP per date. Intraday bars (10 columns) store per-timestamp data with configurable timeframe (default 5-min).

### 2.5 `scheduler_state` (Single-row config, 11 columns)
Author Mode configuration: master `author_mode_enabled` toggle, per-job toggles (after_close, pre_open, live_monitor), last run timestamps, next scheduled times, and run summary JSON.

### 2.6 `universe_members` (6 columns)
Ranked universe snapshots by date. Each member has ticker, dollar volume, rank, and inclusion flag.

### 2.7 `ticker_stats` (7 columns)
Per-ticker technical statistics: 20-day average dollar volume, 20-day average volume, 14-period ATR, last price.

### 2.8 `setup_expectancy` (14 columns)
Expectancy statistics per setup_type (optionally per ticker): sample size, win rate, average win/loss R-multiples, median R, expectancy R, profit factor, MAE stats, tradeability grade (CLEAN/CAUTION/AVOID), and category (PRIMARY/SECONDARY/OFF).

### 2.9 `signal_profiles` (13 columns)
Customizable filter profiles with: allowed setups, min tier, min quality score, min sample size, min hit rate, min expectancy R, time priority mode, stop mode, and active/pinned flags.

### 2.10 `symbols` (4 columns)
Watchlist symbols with enabled flag and watchlist membership.

### 2.11 `discord_trade_logs` (17 columns)
Audit trail for every Discord webhook post. Tracks event type (FILLED/TP1_HIT/TP2_HIT/STOPPED_OUT/etc), channel (alerts/swings/shares), instrument type/ticker, all prices shown in the embed (entry/target/stop/exit), profit %, full embed JSON payload, webhook status (sent/failed), Discord message ID, and foreign keys to `ibkr_trades` and `signals`.

### 2.12 `embed_templates` (6 columns)
Editable Discord embed templates. 24 templates (4 instrument types × 6 event types). Each stores a full embed JSON with `{{variable}}` placeholders that get rendered at alert time. Templates can be toggled active/inactive and reset to defaults. Instrument types: OPTIONS, SHARES, LEVERAGED_ETF, LETF_OPTIONS. Event types: FILLED, TP1_HIT, TP2_HIT, RAISE_STOP, STOPPED_OUT, CLOSED.

### 2.13 `app_settings` (3 columns)
Key-value store for application-wide settings.

### 2.13 `ibkr_state` (Single-row, 13 columns)
IBKR connection state: connected flag, timestamps, account info (net liquidation, buying power, cash, P&L), and JSON arrays of current positions and orders.

### 2.14 `time_to_hit_stats` (12 columns)
Time-to-hit probability distributions per ticker/setup: cumulative probabilities at 15/30/60/120/240/390 minutes, with median time.

### 2.15 `backtest_jobs` (13 columns)
Background backtest worker job state. Tracks job lifecycle (pending/running/paused/completed/failed/cancelled), progress (completedCombos/totalCombos), setup types being processed, completed pairs array for checkpoint-based resumption, current ticker/setup, and error tracking.

### 2.16 `robustness_runs` (9 columns)
Tracks all robustness test executions with parameters, status, and summary metrics.

| Key Columns | Purpose |
|---|---|
| `id` (serial PK) | Unique run identifier |
| `testType`, `scope` | Type of robustness test and scope of execution |
| `parameters` (JSONB) | Input parameters for the test run |
| `status` | Run lifecycle: pending/running/completed/failed |
| `summaryMetrics` (JSONB) | Computed results and metrics from the test |
| `startedAt`, `completedAt` | Execution timing |
| `createdAt` | Record creation timestamp |

---

## 3. Service Layer Deep Dive

### 3.1 Setup Detection (`server/lib/rules.ts` — 179 lines)
Implements 6 distinct multi-day situational analysis detectors:

| Setup | Name | Pattern |
|---|---|---|
| **A** | Thu-Fri-Mon Magnet | Thursday close → Friday range → Monday target |
| **B** | Mon-Wed-Thu Magnet | Monday open → Wednesday range → Thursday target |
| **C** | Gap Fill | Overnight gap detection → fill probability → same-day target |
| **D** | Inside Day | Narrow-range day → breakout direction → next-day target |
| **E** | PDH/PDL Sweep | Previous day high/low sweep → reversal target |
| **F** | Weak Extreme | Weak high/low pattern → mean reversion target |

**Exports:** `detectAllSetups()`, `detectSetupA()`, `detectSetupB()`, `detectSetupC()`, `detectSetupD()`, `detectSetupE()`, `detectSetupF()`

### 3.2 Quality Scoring (`server/lib/quality.ts` — 124 lines)
0–100 point system with 6 weighted components:

| Component | Max Points | Source |
|---|---|---|
| Edge Strength | 20 | Backtest hit rate relative to baseline |
| Magnet Distance | 15 | Distance to target relative to ATR |
| Liquidity | 15 | Dollar volume ranking in universe |
| Movement Environment | 15 | Recent volatility and trend alignment |
| Historical Hit Rate | 10 | Raw backtest hit rate |
| TimeScore | 25 | Time-to-hit probability (p60/p390), configurable mode |

**Tier assignment:** A+ (≥85), A (≥70), B (≥55), C (<55).

**Exports:** `computeQualityScore()`, `qualityScoreToTier()`, `computeAvgDollarVolume()`

### 3.3 Expectancy Engine (`server/lib/expectancy.ts` — 312 lines)
Calculates R-multiple based statistics from resolved signals:
- Win rate, avg win R, avg loss R, median R, expectancy R
- Profit factor (gross wins / gross losses)
- MAE analysis (maximum adverse excursion in R-terms)
- Tradeability grades: CLEAN, CAUTION, AVOID based on composite score
- Category assignment: PRIMARY (high expectancy + clean), SECONDARY, OFF

**Exports:** `computeRMultiples()`, `aggregateExpectancy()`, `computeAndStoreExpectancy()`, `recomputeAllExpectancy()`, `getSetupAlertCategory()`

### 3.4 Activation Engine (`server/lib/activation.ts` — 608 lines)
Monitors intraday price action for entry triggers:
- Conservative mode: Price must cross entry trigger level with confirming bar
- Aggressive mode: First touch of trigger level activates
- Manages state transitions: NOT_ACTIVE → ACTIVE → INVALIDATED
- Stop management: Initial stop → BE stop (after TP1) → Time stop
- Volatility-based stop calculation using ATR
- **BE stop wired to IBKR:** When BE condition is met, modifies the IBKR stop order price and sends a RAISE_STOP Discord alert

**Exports:** `runActivationScan()`

### 3.5 Alert Engine (`server/lib/alerts.ts` — 281 lines)
Lifecycle event detection and routing:
- Events: NEW_SIGNAL, APPROACHING, HIT_T1, MISS, ACTIVATED
- Tier-based routing: A+ and A tier signals get priority alerts
- Rate limiting via `next_alert_eligible_at` timestamp
- Integrates with Discord dual-channel system

**Exports:** `runAlerts()`

### 3.6 Discord Integration (`server/lib/discord.ts` — 888 lines)
Triple-channel webhook system with instrument-price consistency:
- **GOAT Alerts:** Options trades → `DISCORD_GOAT_ALERTS_WEBHOOK`
- **GOAT Swings:** Leveraged ETF trades → `DISCORD_GOAT_SWINGS_WEBHOOK`
- **GOAT Shares:** Shares trades → `DISCORD_GOAT_SHARES_WEBHOOK`
- Color-coded embeds: GREEN (profit/TP hit), RED (stop/loss), GOLD (BE stop/RAISE_STOP, TIME_STOP)
- Entry/TP1/TP2/Close lifecycle embeds with full P&L and R-multiple
- All alerts use instrument prices consistently (option prices for options, LETF prices for LETFs, stock prices for shares)
- Stock price shown as supplementary reference in LETF/option alerts
- Every Discord post logged to `discord_trade_logs` table with full embed payload, webhook status, and Discord message ID
- Webhook sends use `?wait=true` to capture Discord message IDs

**Exports:** `postOptionsAlert()`, `postLetfAlert()`, `postSharesAlert()`, `postTradeUpdate()`, `sendTestLetfAlert()`

### 3.7 IBKR Integration (`server/lib/ibkr.ts` — 434 lines, `ibkrOrders.ts` — 720 lines)
Full Interactive Brokers TWS/Gateway integration:

**`ibkr.ts` exports:** `connectIBKR()`, `disconnectIBKR()`, `isConnected()`, `getPositions()`, `getAccountSummary()`, `getOrderStatus()`, `getNextOrderId()`, `makeContract()`, `placeMarketOrder()`, `placeLimitOrder()`, `placeStopOrder()`, `cancelOrder()`, `modifyStopPrice()`, `getIBApi()`

**`ibkrOrders.ts` exports:** `executeTradeForSignal()`, `applyBeStop()`, `applyTimeStop()`, `monitorActiveTrade()`, `monitorActiveTrades()`, `closeTradeManually()`, `getIbkrDashboardData()`

### 3.8 Polygon.io Integration (`server/lib/polygon.ts` — 551 lines)
Market data provider with extensive API surface:

**Exports:** `fetchDailyBars()`, `fetchIntradayBars()`, `fetchDailyBarsCached()`, `fetchIntradayBarsCached()`, `fetchGroupedDaily()`, `fetchOptionsChain()`, `fetchOptionContractDetails()`, `fetchOptionQuote()`, `fetchOptionSnapshot()`, `fetchSnapshot()`, `fetchOptionNbbo()`, `fetchOptionLastTrade()`, `fetchOptionMarkAtTime()`, `fetchStockPriceAtTime()`, `fetchOptionMark()`

### 3.8.1 Bar Cache (`server/lib/barCache/` — 403 lines total)
Persistent two-tier bar cache system (SQLite + in-memory):
- **SQLite on-disk** (`bar_cache.db`): WAL mode, permanent storage, survives restarts
- **In-memory**: 5-minute TTL, 500-entry cap, FIFO eviction
- **Incremental fetch**: Only fetches missing bars from API, never re-fetches cached data
- **Per-series locking**: Prevents stampede on concurrent requests for same symbol/timeframe
- **Staleness thresholds**: Configurable per timeframe (1m: 120s → 1d: 14400s)

**Files:** `types.ts`, `staleness.ts`, `memoryCache.ts`, `db.ts`, `locks.ts`, `getBars.ts`, `index.ts`
**Exports:** `getBars()`, `getBarCacheStats()`, `openBarCacheDb()`, `getStalenessSeconds()`, `memClear()`
**Endpoint:** `GET /stats/bar-cache` — returns cache stats (total bars, symbols, DB size, timestamps, WAL mode)

### 3.9 Options Enrichment (`server/lib/options.ts` — 320 lines)
Options contract selection and enrichment:
- Finds optimal strike/expiry based on signal direction and target
- OI (open interest) and spread checks for liquidity
- Contract ticker formatting for IBKR compatibility
- Mark price estimation for position sizing

**Exports:** `enrichPendingSignalsWithOptions()`

### 3.10 Leveraged ETF System (`server/lib/leveragedEtf.ts` — 379 lines)
Dynamic instrument selection:
- 3x BULL/BEAR ETF mapping for major tickers
- Automatic selection based on signal direction
- Leverage-adjusted entry/stop/target calculation
- Real-time stock NBBO for pricing

**Exports:** `selectBestLeveragedEtf()`, `fetchStockNbbo()`, `hasLeveragedEtfMapping()`

### 3.11 Universe Management (`server/lib/universe.ts` — 169 lines)
Automatic ticker discovery and ranking:
- Scans all US equities via Polygon grouped daily endpoint
- Ranks by 20-day average dollar volume
- Configurable top-N (default 150)
- Liquidity filtering for signal eligibility

**Exports:** `rebuildUniverse()`, `getUniverseStatus()`

### 3.12 Reliability & Robustness (`server/lib/reliability.ts` — 994 lines)
Comprehensive robustness testing framework with 8 test implementations and a 10-gate reliability summary:

| Test | Function | Purpose |
|---|---|---|
| Fees & Slippage | `runFeesSlippageTest()` | Tests strategy edge survival after realistic execution costs |
| Out-of-Sample | `runOutOfSampleTest()` | Train/test split validation to detect overfitting |
| Walk-Forward | `runWalkForwardTest()` | Rolling window optimization with out-of-sample validation |
| Monte Carlo | `runMonteCarloTest()` | Randomized trade sequence simulation for drawdown distributions |
| Stress Test | `runStressTest()` | Performance under extreme market conditions |
| Parameter Sweep | `runParameterSweep()` | Sensitivity analysis across parameter variations |
| Stop Sensitivity | `runStopSensitivityTest()` | Stop-loss placement robustness analysis |
| Regime Analysis | `runRegimeAnalysis()` | Performance breakdown by market regime (bull/bear/sideways) |

**Exports:** `computeReliabilitySummary()`, `runFeesSlippageTest()`, `runOutOfSampleTest()`, `runWalkForwardTest()`, `runMonteCarloTest()`, `runStressTest()`, `runParameterSweep()`, `runStopSensitivityTest()`, `runRegimeAnalysis()`

### 3.13 Additional Modules
- **`backtest.ts`** (221 lines): `runBacktest()`, `computeProbabilities()`, `computeAndStoreTimeToHitStats()`
- **`calendar.ts`** (81 lines): `isTradingDay()`, `nextTradingDay()`, `prevTradingDay()`, `formatDate()`, `getDayOfWeek()`, `addDays()`, `getTradingDaysBack()`
- **`confidence.ts`** (68 lines): `computeConfidence()`, `computeATR()`, `computeAvgVolume()`
- **`tradeplan.ts`** (51 lines): `generateTradePlan()`
- **`validate.ts`** (85 lines): `filterRTHBars()`, `timestampToET()`, `validateMagnetTouch()`, `computeMAEMFE()`
- **`optionMonitor.ts`** (130 lines): `refreshOptionQuotesForActiveSignals()`, `getOptionLiveData()`, `startOptionMonitor()`, `stopOptionMonitor()`
- **`letfMonitor.ts`** (160 lines): `refreshLetfQuotesForActiveSignals()`, `getLetfLiveData()`, `startLetfMonitor()`, `stopLetfMonitor()`

---

## 4. Scheduler / Author Mode

### Architecture (`server/jobs/scheduler.ts` — 241 lines, `jobFunctions.ts` — 307 lines, `backtestWorker.ts` — 174 lines)

Three distinct scheduled job types orchestrated by node-cron, plus a background backtest worker:

| Job | Schedule | Function |
|---|---|---|
| **After-Close Scan** | 15:10 CT (20:10 UTC) | `runAfterCloseScan()` |
| **Pre-Open Rescore** | 08:20 CT (14:20 UTC) | `runPreOpenScan()` |
| **Live Monitor** | Every minute during RTH | `runLiveMonitorTick()` |

**Scheduler exports:** `initScheduler()`, `reconfigureJobs()`, `runAutoNow()`

**Backtest Worker exports:** `startBacktestWorker()`, `autoStartBacktestWorker()`, `pauseBacktestWorker()`, `resumeBacktestWorker()`, `isBacktestWorkerRunning()`, `isBacktestWorkerPaused()`

Features:
- Per-job enable/disable toggles
- Holiday and weekend gating via `calendar.ts`
- Run summary logging to `scheduler_state`
- Master `author_mode_enabled` toggle
- Background backtest worker processes all tickers × 6 setups incrementally
- Checkpoint-based resumption: saves completedPairs array for restart recovery
- Rate-limited Polygon API access (250ms min spacing, exponential backoff on 429s)
- Auto-resumes incomplete jobs on app boot

---

## 5. Frontend Architecture

### 5.1 Routing (`client/src/App.tsx` — 67 lines)
Wouter-based routing with sidebar navigation:

| Route | Page | Lines |
|---|---|---|
| `/` | Dashboard | 1,869 |
| `/settings` | Settings | 985 |
| `/optimization` | Optimization | 1,002 |
| `/performance` | Performance | 596 |
| `/performance-half` | Performance ½ Study | 950 |
| `/symbol/:ticker` | Symbol Detail | 560 |
| `/backtest` | Backtest | 647 |
| `/ibkr` | IBKR Dashboard | 401 |
| `/guide` | Guide | 432 |

### 5.2 Dashboard (`client/src/pages/dashboard.tsx` — 1,869 lines)
The primary interface. Features:
- Signal table with filtering (setup type, tier, status, direction)
- Auto-refresh system: 60-second interval + on-focus + on-load
- Live status indicator (green dot) replacing manual refresh button
- Signal profile selector for quick filter switching
- Inline signal activation/deactivation controls
- Signal detail expansion with trade plan and quality breakdown
- Quick actions: scan, rescore, activate checks

### 5.3 Performance (`client/src/pages/performance.tsx` — 596 lines)
P&L analytics with exclusive time windows:
- Lookback periods: 30 days, 31–60 days, 61–90 days, Total
- Equity curve chart (Recharts)
- Daily P&L bar chart
- Instrument breakdown (Options/Shares/Leveraged ETF)
- Full trade history table with sorting
- KPI cards: capital required, ROI, win rate, best/worst trades

### 5.4 Optimization (`client/src/pages/optimization.tsx` — 1,002 lines)
Intelligence dashboard for setup grading:
- Backtest worker progress card with start/pause/resume/cancel controls
- Per-ticker grading: A+ through F based on expectancy
- Setup comparison radar chart
- PRIMARY/SECONDARY/OFF category management
- Filterable by setup type
- "Avoid Zone" highlighting for poor performers
- Tradeability grades with visual indicators
- ReliabilitySummaryCard with 10-gate scoring
- RegimeSummaryCard with market regime breakdown

### 5.5 Settings (`client/src/pages/settings.tsx` — 985 lines)
Configuration management:
- Universe builder: top-N, minimum dollar volume, manual additions
- Watchlist management
- Signal profile CRUD
- Trading parameters: position size, stop modes, entry modes
- Author Mode scheduler controls
- IBKR connection settings
- Cost Assumptions (fees/slippage configuration)
- Forward Validation start/stop controls

### 5.6 Symbol Detail (`client/src/pages/symbol-detail.tsx` — 560 lines)
Per-ticker deep dive:
- Price chart with magnet levels overlay
- Signal history timeline
- Backtest results
- Expectancy statistics
- Active trade status

### 5.7 IBKR Dashboard (`client/src/pages/ibkr-dashboard.tsx` — 401 lines)
Trade management interface:
- Connection status and account summary
- Active positions with real-time P&L
- Open orders management
- Trade history with multi-TP progression tracking
- Manual trade close functionality

### 5.8 Backtest (`client/src/pages/backtest.tsx` — 647 lines)
Backtest results and analysis interface.
- Test Coverage Checklist for robustness validation
- Assumption Badges showing active cost/slippage parameters

---

## 6. API Routes Summary (`server/routes.ts` — 2,096 lines)

### Signal Profiles
- `GET /api/profiles` — List all profiles
- `GET /api/profiles/active` — Get active profile
- `POST /api/profiles` — Create profile
- `PUT /api/profiles/:id` — Update profile
- `DELETE /api/profiles/:id` — Delete profile
- `POST /api/profiles/:id/activate` — Set active profile

### Symbols / Watchlist
- `GET /api/symbols` — List symbols
- `POST /api/symbols` — Add symbol
- `PATCH /api/symbols/:ticker` — Update symbol
- `DELETE /api/symbols/:ticker` — Remove symbol

### Signals
- `GET /api/signals` — List signals with filtering

### Stats & Symbol Detail
- `GET /api/stats` — Aggregate statistics
- `GET /api/symbol/:ticker` — Symbol detail data

### Scan & Refresh
- `POST /api/refresh` — Full market scan/refresh

### Settings
- `GET /api/settings` — Get app settings
- `POST /api/settings` — Update settings

### Backtesting & Time-to-Hit
- `POST /api/backtest/run` — Run backtest
- `GET /api/time-to-hit-stats/:ticker/:setup` — Time-to-hit for specific ticker/setup
- `GET /api/time-to-hit-stats` — All time-to-hit stats
- `GET /api/backtests` — Get all backtests

### Backtest Worker
- `POST /api/backtest/jobs/start` — Start backtest worker (all tickers × 6 setups)
- `POST /api/backtest/jobs/pause` — Pause worker
- `POST /api/backtest/jobs/resume` — Resume worker
- `POST /api/backtest/jobs/cancel` — Cancel active job
- `GET /api/backtest/jobs/status` — Worker status and job progress

### Activation & Alerts
- `POST /api/activation/scan` — Run activation scan
- `POST /api/alerts/run` — Run alert processing
- `GET /api/alerts/events` — Get alert events

### Universe
- `POST /api/universe/rebuild` — Rebuild universe
- `GET /api/universe/status` — Universe status

### Setup Expectancy (Optimization)
- `GET /api/setup-stats` — Overall setup stats
- `GET /api/setup-stats/all` — All setup stats
- `GET /api/setup-stats/:setupType` — Per-setup stats
- `POST /api/setup-stats/recompute` — Recompute all expectancy

### Options
- `POST /api/signals/enrich-options` — Enrich signals with options data
- `GET /api/dev/option-quote` — Dev option quote lookup
- `POST /api/options/refresh` — Refresh option quotes

### Instruments
- `POST /api/signals/:id/instrument` — Set signal instrument type
- `POST /api/signals/batch-letf` — Batch LETF assignment
- `POST /api/signals/:id/suggest-letf` — Suggest LETF for signal

### Scheduler
- `GET /api/scheduler/state` — Scheduler state
- `POST /api/scheduler/toggle` — Toggle scheduler settings
- `POST /api/scheduler/run` — Manually run scheduled job

### IBKR
- `POST /api/ibkr/connect` — Connect to IBKR
- `POST /api/ibkr/disconnect` — Disconnect from IBKR
- `GET /api/ibkr/status` — Connection status
- `GET /api/ibkr/dashboard` — Dashboard data
- `POST /api/ibkr/execute` — Execute trade
- `POST /api/ibkr/close/:tradeId` — Close trade
- `GET /api/ibkr/trades` — Trade records
- `POST /api/ibkr/monitor` — Run trade monitor

### Discord
- `GET /api/discord-trades` — Discord trade logs with filtering (channel, event, ticker)
- `GET /api/embed-templates` — All 24 editable embed templates
- `GET /api/embed-templates/variables` — Available template placeholder variables
- `PUT /api/embed-templates/:id` — Update template (embedJson, templateName, isActive)
- `POST /api/embed-templates/seed` — Seed default templates
- `POST /api/embed-templates/reset/:id` — Reset template to default
- `POST /api/embed-templates/preview` — Render template with sample data
- `POST /api/discord/test-options` — Test options webhook
- `POST /api/discord/test-letf` — Test LETF webhook

### Performance
- `GET /api/performance/analysis` — P&L analytics with time window params
- `GET /api/performance-half/analysis` — Split ½ study: 50% at halfway, 50% at T1 vs T1-only comparison
- `POST /api/backtests/backfill-activation` — Enriches existing backtest details with activation simulation data

### Reliability & Robustness
- `GET /api/analysis/reliability` — Compute and return reliability summary with 10-gate scoring
- `GET /api/analysis/robustness-runs` — List robustness test runs, optional testType filter
- `POST /api/analysis/robustness/run` — Execute a single robustness test by type
- `POST /api/analysis/robustness/run-all` — Execute all 8 robustness tests sequentially

### Cost Assumptions & Forward Validation
- `POST /api/settings/assumptions` — Save fees/slippage cost assumptions
- `POST /api/settings/forward-validation/start` — Start forward validation tracking
- `POST /api/settings/forward-validation/stop` — Stop forward validation tracking

---

## 7. Data Flow

```
Polygon.io API
    │
    ├──[Grouped Daily]──→ Universe Builder ──→ universe_members
    │                                          ticker_stats
    ├──[Daily Bars]──→ daily_bars cache
    │                     │
    │                     └──→ Setup Detectors (A–F)
    │                              │
    │                              └──→ signals (status: pending)
    │                                      │
    │                              ┌───────┴───────┐
    │                              │               │
    │                     Quality Scorer    Backtest Engine
    │                     (0–100 score)    (hit rate, timing)
    │                              │               │
    │                              └───────┬───────┘
    │                                      │
    │                              Expectancy Engine
    │                              (R-multiples, grades)
    │                                      │
    │                              Tier Assignment
    │                              (A+, A, B, C)
    │                                      │
    ├──[Intraday Bars]──→ Activation Engine
    │                     (entry trigger monitoring)
    │                              │
    │                     ┌────────┴────────┐
    │                     │                 │
    │              Options Enrichment  LETF Selection
    │              (strike, OI check)  (3x BULL/BEAR)
    │                     │                 │
    │                     └────────┬────────┘
    │                              │
    │                     IBKR Order Engine
    │                     (bracket orders)
    │                              │
    │                     ┌────────┴────────┐
    │                     │                 │
    │              GOAT Alerts       GOAT Swings
    │              (Options)         (LETF)
    │              Discord           Discord
    │
    └──[Live Quotes]──→ Position Monitors
                        (P&L, stop management)
```

---

## 8. Key Technical Decisions

| Decision | Rationale |
|---|---|
| **Exclusive time windows** (30d, 31–60d, 61–90d) | Prevents double-counting trades across periods; reveals period-specific performance |
| **Dual instrument routing** | Options for directional plays, LETF for swing positions; different risk profiles and Discord channels |
| **RTH-only validation** | All calculations constrained to 09:30–16:00 ET to avoid pre/post-market noise |
| **Tier-based alert routing** | Prevents alert fatigue; A+/A signals get priority notification |
| **Quality Score as composite** | 6 independent components prevent gaming; TimeScore gives recency weighting |
| **R-multiple framework** | Normalizes P&L across different position sizes and price levels |
| **Universe auto-discovery** | Top 150 by dollar volume ensures liquidity; reduces manual ticker management |
| **Single-row config tables** | `scheduler_state` and `ibkr_state` use single-row pattern for atomic state management |

---

## 9. External Dependencies

| Dependency | Version | Purpose |
|---|---|---|
| `@stoqey/ib` | ^1.5.3 | IBKR TWS/Gateway API client |
| `node-cron` | ^4.2.1 | Author Mode job scheduling |
| `dayjs` | ^1.11.19 | Date/time manipulation with timezone support |
| `recharts` | ^2.15.2 | Charting (equity curve, P&L, radar charts) |
| `drizzle-orm` | ^0.39.3 | PostgreSQL ORM with type-safe queries |
| `pg` | ^8.16.3 | PostgreSQL client driver |
| `express` | ^5.0.1 | HTTP server framework |
| `wouter` | ^3.3.5 | Frontend routing |
| `@tanstack/react-query` | ^5.60.5 | Data fetching and caching |
| `zod` | ^3.24.2 | Schema validation |
| `framer-motion` | ^11.13.1 | UI animations |
| `ws` | ^8.18.0 | WebSocket support |

---

## 10. Environment & Secrets

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (auto-provided) |
| `POLYGON_API_KEY` | Polygon.io market data API |
| `SESSION_SECRET` | Express session encryption |
| `DISCORD_GOAT_SWINGS_WEBHOOK` | Discord webhook for LETF swing alerts |
| `DISCORD_GOAT_ALERTS_WEBHOOK` | Discord webhook for options alerts (not yet configured) |

---

## 11. Known Issues (Observed)

1. **Browser console errors:** `Invalid hook call` warning and `validateDOMNesting` error in Performance page — a `<Badge>` component renders a `<div>` inside a `<p>` tag.
2. **LSP diagnostics:** 11 TypeScript errors in `client/src/pages/settings.tsx` (type-related).
3. **IBKR connection loop:** Continuous reconnection attempts every ~15 seconds to `162.218.114.93:4003` — expected behavior when TWS/Gateway is not running.
4. **Missing secret:** `DISCORD_GOAT_ALERTS_WEBHOOK` not configured.

---

## 12. Codebase Statistics

| Metric | Value |
|---|---|
| Total source files | 72 |
| Total lines of code | ~22,400 |
| Backend lib modules | 20 |
| Frontend pages | 9 (including not-found) |
| UI components | 37 (Shadcn) |
| Database tables | 16 |
| API endpoints | ~57 |
| Setup types | 6 (A–F) |
| Quality score components | 6 |
| Robustness tests | 8 |
| Largest file | `routes.ts` (2,096 lines) |
| Second largest | `dashboard.tsx` (1,870 lines) |
