# SITU GOAT Trader — Feature ↔ File Map

This document maps every major feature to the specific files and key functions/exports that implement it.

---

## 1. Setup Detection (Patterns A–F)

| File | Key Exports | Role |
|---|---|---|
| `server/lib/rules.ts` | `detectAllSetups()`, `detectSetupA()`, `detectSetupB()`, `detectSetupC()`, `detectSetupD()`, `detectSetupE()`, `detectSetupF()` | Core pattern detection logic for each setup type |
| `shared/schema.ts` | `signals` table definition | Schema defining setup types and signal structure |
| `server/storage.ts` | Signal CRUD methods | Signal persistence layer |
| `server/routes.ts` | `POST /api/refresh` | API endpoint triggering full scan |
| `server/jobs/jobFunctions.ts` | `runAfterCloseScan()` | Scheduled scan orchestration |
| `client/src/pages/dashboard.tsx` | Signal table rendering, scan trigger button | UI for viewing/triggering scans |
| `client/src/pages/guide.tsx` | Setup type documentation | User-facing setup descriptions |

---

## 2. Quality Scoring (0–100)

| File | Key Exports | Role |
|---|---|---|
| `server/lib/quality.ts` | `computeQualityScore()`, `qualityScoreToTier()`, `computeAvgDollarVolume()` | Computes 6-component score and tier |
| `server/lib/confidence.ts` | `computeConfidence()`, `computeATR()`, `computeAvgVolume()` | Raw confidence and technical inputs |
| `shared/schema.ts` | `quality_score`, `tier`, `quality_breakdown` columns | Schema for score storage |
| `server/storage.ts` | Signal update methods | Persists quality updates |
| `client/src/pages/dashboard.tsx` | Quality score badge, tier display, breakdown popover | UI display of scores |

---

## 3. Expectancy Engine

| File | Key Exports | Role |
|---|---|---|
| `server/lib/expectancy.ts` | `computeRMultiples()`, `aggregateExpectancy()`, `computeAndStoreExpectancy()`, `recomputeAllExpectancy()`, `getSetupAlertCategory()` | R-multiple calculations, grading, category assignment |
| `shared/schema.ts` | `setup_expectancy` table | Schema for expectancy stats |
| `server/storage.ts` | Expectancy CRUD methods | Expectancy persistence |
| `server/routes.ts` | `GET /api/setup-stats`, `GET /api/setup-stats/all`, `GET /api/setup-stats/:setupType`, `POST /api/setup-stats/recompute` | API endpoints |
| `client/src/pages/optimization.tsx` | Grading tables, radar chart, category management | Intelligence dashboard UI |

**Tradeability grades:** CLEAN / CAUTION / AVOID  
**Categories:** PRIMARY / SECONDARY / OFF

---

## 4. Time-to-Hit Probability Engine

| File | Key Exports | Role |
|---|---|---|
| `server/lib/backtest.ts` | `runBacktest()`, `computeProbabilities()`, `computeAndStoreTimeToHitStats()` | Generates time-to-hit distributions from historical data |
| `shared/schema.ts` | `time_to_hit_stats` table, `p_hit_60/120/390` signal columns | Schema for probability data |
| `server/storage.ts` | Time-to-hit stats CRUD | Persistence layer |
| `server/lib/quality.ts` | `computeQualityScore()` — TimeScore component (0–25 points) | Uses p60/p390 in quality scoring |
| `server/routes.ts` | `GET /api/time-to-hit-stats/:ticker/:setup`, `GET /api/time-to-hit-stats` | API endpoints |
| `client/src/pages/symbol-detail.tsx` | Time-to-hit visualization | Per-ticker probability display |

---

## 5. Signal Activation Engine

| File | Key Exports | Role |
|---|---|---|
| `server/lib/activation.ts` | `runActivationScan()` | Entry trigger detection, stop management, state transitions |
| `shared/schema.ts` | `activation_status`, `stop_price`, `stop_stage`, `entry_trigger_price` columns | Activation state schema |
| `server/storage.ts` | Signal update methods | State persistence |
| `server/routes.ts` | `POST /api/activation/scan` | Manual activation scan endpoint |
| `server/jobs/jobFunctions.ts` | `runLiveMonitorTick()` | Scheduled activation checks |
| `client/src/pages/dashboard.tsx` | Activation status badges, activate/deactivate buttons | UI controls |

---

## 6. Stop Management

| File | Key Exports | Role |
|---|---|---|
| `server/lib/activation.ts` | `runActivationScan()` — stop management logic within | Volatility stop, BE stop, time stop logic; delegates IBKR stop modifications to ibkrOrders |
| `server/lib/ibkr.ts` | `modifyStopPrice()` | Modify IBKR stop order price |
| `server/lib/ibkrOrders.ts` | `applyBeStop()`, `applyTimeStop()`, `monitorActiveTrade()`, `monitorActiveTrades()` | BE/TIME_STOP stop management with IBKR + Discord, monitor single trade (TP1/TP2/stop fills) |
| `shared/schema.ts` | `stop_price`, `stop_stage`, `stop_moved_to_be_ts`, `time_stop_triggered_ts` | Stop state columns |
| `server/lib/validate.ts` | `filterRTHBars()`, `timestampToET()` | RTH constraint for stop evaluation |
| `client/src/pages/dashboard.tsx` | Stop stage indicator | Visual stop status |

---

## 7. IBKR Integration (Trade Execution)

| File | Key Exports | Role |
|---|---|---|
| `server/lib/ibkr.ts` | `connectIBKR()`, `disconnectIBKR()`, `isConnected()`, `getPositions()`, `getAccountSummary()`, `getOrderStatus()`, `getNextOrderId()`, `makeContract()`, `placeMarketOrder()`, `placeLimitOrder()`, `placeStopOrder()`, `cancelOrder()`, `modifyStopPrice()`, `getIBApi()` | Connection, account data, order primitives |
| `server/lib/ibkrOrders.ts` | `executeTradeForSignal()`, `monitorActiveTrade()`, `monitorActiveTrades()`, `closeTradeManually()`, `getIbkrDashboardData()` | High-level trade execution, single-trade monitoring, and management |
| `shared/schema.ts` | `ibkr_trades` table, `ibkr_state` table | Trade and connection state schema |
| `server/storage.ts` | IBKR trade and state CRUD | Persistence layer |
| `server/routes.ts` | `POST /api/ibkr/connect`, `POST /api/ibkr/disconnect`, `GET /api/ibkr/status`, `GET /api/ibkr/dashboard`, `POST /api/ibkr/execute`, `POST /api/ibkr/close/:tradeId`, `GET /api/ibkr/trades`, `POST /api/ibkr/monitor` | API endpoints |
| `client/src/pages/ibkr-dashboard.tsx` | Connection status, positions, orders, trade history | IBKR management UI |

---

## 8. Discord Alerts (Triple-Channel) & Discord Trades Page

| File | Key Exports | Role |
|---|---|---|
| `server/lib/discord.ts` | `postOptionsAlert()`, `postLetfAlert()`, `postSharesAlert()`, `postTradeUpdate()` (incl. RAISE_STOP event), `sendTestLetfAlert()` | Webhook message construction and delivery; template-first rendering with hardcoded fallback |
| `server/lib/embedTemplateDefaults.ts` | `getDefaultTemplates()`, `AVAILABLE_VARIABLES`, `INSTRUMENT_TYPES`, `EVENT_TYPES` | 24 default embed templates (4 instruments × 6 events) with variable definitions |
| `server/lib/embedTemplateEngine.ts` | `renderTemplate()`, `getTemplateForEvent()`, `seedDefaultTemplates()` | Template rendering engine — resolves `{{variables}}`, converts colors, seeds DB |
| `server/lib/alerts.ts` | `runAlerts()` | Alert lifecycle detection and routing |
| `shared/schema.ts` | `embed_templates` table; `discord_trade_logs` table; `alert_state`, `next_alert_eligible_at` signal columns; `discord_alert_sent`, `discord_update_sent` trade columns | Template + alert state + audit log schema |
| `server/storage.ts` | `getEmbedTemplates()`, `getEmbedTemplate()`, `upsertEmbedTemplate()`, `updateEmbedTemplate()`, `insertDiscordTradeLog()`, `getDiscordTradeLogs()` | Persistence |
| `server/routes.ts` | `GET /api/embed-templates`, `PUT /api/embed-templates/:id`, `POST /api/embed-templates/seed`, `POST /api/embed-templates/reset/:id`, `POST /api/embed-templates/preview`, `GET /api/embed-templates/variables`, `GET /api/discord-trades`, `POST /api/discord/test-options`, `POST /api/discord/test-letf` | API endpoints |
| `client/src/pages/discord-trades.tsx` | `DiscordTradesPage`, `TradeLogsTab`, `EmbedTemplatesTab`, `EmbedPreview` | Discord trade logs + embed template editor with preview, tabs, filters |

**Channel Routing:**
- `DISCORD_GOAT_ALERTS_WEBHOOK` → Options trades
- `DISCORD_GOAT_SWINGS_WEBHOOK` → Leveraged ETF swing trades
- `DISCORD_GOAT_SHARES_WEBHOOK` → Shares trades

---

## 9. Options Enrichment

| File | Key Exports | Role |
|---|---|---|
| `server/lib/options.ts` | `enrichPendingSignalsWithOptions()` | Contract selection, OI/spread checks, batch enrichment |
| `server/lib/polygon.ts` | `fetchOptionsChain()`, `fetchOptionContractDetails()`, `fetchOptionQuote()`, `fetchOptionSnapshot()`, `fetchOptionNbbo()`, `fetchOptionLastTrade()`, `fetchOptionMarkAtTime()`, `fetchOptionMark()` | Options data from Polygon.io |
| `server/lib/optionMonitor.ts` | `refreshOptionQuotesForActiveSignals()`, `getOptionLiveData()`, `startOptionMonitor()`, `stopOptionMonitor()` | Real-time option position tracking |
| `shared/schema.ts` | `options_json`, `option_contract_ticker`, `option_entry_mark` signal columns | Options data schema |
| `server/routes.ts` | `POST /api/signals/enrich-options`, `POST /api/options/refresh`, `GET /api/dev/option-quote` | API endpoints |

---

## 10. Leveraged ETF System

| File | Key Exports | Role |
|---|---|---|
| `server/lib/leveragedEtf.ts` | `selectBestLeveragedEtf()`, `fetchStockNbbo()`, `hasLeveragedEtfMapping()` | ETF selection, leverage-adjusted pricing |
| `server/lib/letfMonitor.ts` | `refreshLetfQuotesForActiveSignals()`, `getLetfLiveData()`, `startLetfMonitor()`, `stopLetfMonitor()` | LETF position monitoring |
| `shared/schema.ts` | `leveraged_etf_json`, `instrument_type`, `instrument_ticker` signal columns | LETF data schema |
| `server/lib/discord.ts` | `postLetfAlert()` | LETF-specific Discord embeds (underlying prices, leverage info) |
| `server/routes.ts` | `POST /api/signals/:id/instrument`, `POST /api/signals/batch-letf`, `POST /api/signals/:id/suggest-letf` | API endpoints |

---

## 11. Universe Management

| File | Key Exports | Role |
|---|---|---|
| `server/lib/universe.ts` | `rebuildUniverse()`, `getUniverseStatus()` | Auto-discovery, ranking by dollar volume |
| `server/lib/polygon.ts` | `fetchGroupedDaily()` | Source data for universe scanning |
| `shared/schema.ts` | `universe_members` table, `ticker_stats` table | Schema |
| `server/storage.ts` | Universe and ticker stats CRUD | Persistence |
| `server/routes.ts` | `POST /api/universe/rebuild`, `GET /api/universe/status` | API endpoints |
| `client/src/pages/settings.tsx` | Universe builder section | Configuration UI |

---

## 12. Author Mode (Scheduler)

| File | Key Exports | Role |
|---|---|---|
| `server/jobs/scheduler.ts` | `initScheduler()`, `reconfigureJobs()`, `runAutoNow()` | Cron registration, Author Mode toggle, holiday/weekend gating |
| `server/jobs/jobFunctions.ts` | `runAfterCloseScan()`, `runPreOpenScan()`, `runLiveMonitorTick()` | Job implementations |
| `server/lib/calendar.ts` | `isTradingDay()`, `nextTradingDay()`, `prevTradingDay()`, `getDayOfWeek()`, `getTradingDaysBack()` | Market calendar for job gating |
| `shared/schema.ts` | `scheduler_state` table | Scheduler config schema |
| `server/storage.ts` | Scheduler state CRUD | State persistence |
| `server/routes.ts` | `GET /api/scheduler/state`, `POST /api/scheduler/toggle`, `POST /api/scheduler/run` | API endpoints |
| `client/src/pages/settings.tsx` | Author Mode controls, job toggles, manual trigger buttons | Configuration UI |

---

## 13. Performance Dashboard

| File | Key Exports | Role |
|---|---|---|
| `client/src/pages/performance.tsx` | Performance page component | P&L analytics, charts, trade history |
| `server/routes.ts` | `GET /api/performance/analysis` | Analytics endpoint with time window params |
| `server/storage.ts` | Performance query methods with exclusive time windows | Data retrieval with time windowing |

**Features mapped:**
- Exclusive time windows (30d, 31–60d, 61–90d, Total)
- Equity curve (Recharts LineChart)
- Daily P&L (Recharts BarChart)
- Instrument breakdown (Options/Shares/LETF)
- Trade history table with sorting
- Activated Only toggle (filters to On Deck → Active trades only)

---

## 13c. ROI Insights

| File | Key Exports | Role |
|---|---|---|
| `client/src/pages/roi-insights.tsx` | ROI Insights page component | Backtest edge analysis, strategy simulation |
| `server/routes.ts` | `GET /api/performance/roi-insights` | Setup rankings, top/avoid tickers, instrument P&L |

**Features mapped:**
- Setup rankings with activated win rates and lift
- Recommended strategy P&L (best setup + top tickers + activated trades)
- Instrument comparison: Shares (1x baseline), LETF (3x leverage), Options (5x leverage) — all with proportional stop losses
- Strategy equity curve and daily P&L charts
- Quality score breakdown by bucket
- Top tickers / avoid list tables
- 1-trade-per-day selection guide
- Filterable by setup type

---

## 13b. Performance ½ Study (Split Take-Profit)

| File | Key Exports | Role |
|---|---|---|
| `client/src/pages/performance-half.tsx` | PerformanceHalfPage component | Split ½ study comparison page |
| `server/routes.ts` | `GET /api/performance-half/analysis` | Split ½ analytics endpoint |
| `client/src/components/app-sidebar.tsx` | Sidebar nav entry | Navigation link |
| `client/src/App.tsx` | Route `/performance-half` | Route registration |

**Features mapped:**
- Compares T1-Only (100% exit at T1) vs Split ½ (50% at halfway, 50% at T1)
- Comparison banner with delta P&L and winner badge
- Dual equity curve overlay (T1-Only green solid vs Split ½ purple dashed)
- Trade history with halfway price, T1 price, ½ Hit status, and PARTIAL outcome
- MFE-based halfway hit detection for missed trades
- Activated Only channel: filters to trades where the conservative entry trigger (breakout + retest) fired. For backtests, uses simulated activation via `checkEntryTrigger` against intraday bars; for live signals, uses activatedTs/activationStatus. Backfill endpoint enriches existing backtests with activation data
- Market Hours channel: filters to trades resolved during RTH (9:30 AM – 4:00 PM ET) using hitTs for live signals and timeToHitMin for backtests, with separate comparison banner, model cards, and equity curve
- Period filter (30/60/90/120 days) scopes all sections
- Period-scoped summaries and curves (30d/60d/90d/91+/Total)

---

## 14. Optimization Dashboard

| File | Key Exports | Role |
|---|---|---|
| `client/src/pages/optimization.tsx` | Optimization page component | Setup grading, radar chart, category management |
| `server/lib/expectancy.ts` | `recomputeAllExpectancy()`, `getSetupAlertCategory()` | Grading logic |
| `server/routes.ts` | `GET /api/setup-stats`, `GET /api/setup-stats/all`, `GET /api/setup-stats/:setupType`, `POST /api/setup-stats/recompute` | API endpoints |
| `server/storage.ts` | Expectancy and category CRUD | Persistence |

---

## 15. Signal Profiles

| File | Key Exports | Role |
|---|---|---|
| `shared/schema.ts` | `signal_profiles` table | Profile schema |
| `server/storage.ts` | Profile CRUD methods | Persistence |
| `server/routes.ts` | `GET /api/profiles`, `GET /api/profiles/active`, `POST /api/profiles`, `PUT /api/profiles/:id`, `DELETE /api/profiles/:id`, `POST /api/profiles/:id/activate` | API endpoints |
| `client/src/pages/settings.tsx` | Profile creation/edit forms | Configuration UI |
| `client/src/pages/dashboard.tsx` | Profile selector dropdown | Quick filter switching |

---

## 16. Market Data (Polygon.io)

| File | Key Exports | Role |
|---|---|---|
| `server/lib/polygon.ts` | `fetchDailyBars()`, `fetchIntradayBars()`, `fetchGroupedDaily()`, `fetchSnapshot()`, `fetchStockPriceAtTime()` + all option fetch functions | API client for market and options data |
| `shared/schema.ts` | `daily_bars`, `intraday_bars` tables | Cache schema |
| `server/storage.ts` | Bar data CRUD | Cache persistence |

---

## 17. RTH Validation

| File | Key Exports | Role |
|---|---|---|
| `server/lib/validate.ts` | `filterRTHBars()`, `timestampToET()`, `validateMagnetTouch()`, `computeMAEMFE()` | Price/time validation and MAE/MFE |
| `server/lib/calendar.ts` | `isTradingDay()` | Trading day checks |
| `server/lib/activation.ts` | `runActivationScan()` — RTH-gated | Activation only during RTH |

---

## 18. Backtesting

| File | Key Exports | Role |
|---|---|---|
| `server/lib/backtest.ts` | `runBacktest()`, `computeProbabilities()`, `computeAndStoreTimeToHitStats()` | Historical testing and probability engine |
| `server/jobs/backtestWorker.ts` | `startBacktestWorker()`, `autoStartBacktestWorker()`, `pauseBacktestWorker()`, `resumeBacktestWorker()`, `isBacktestWorkerRunning()`, `isBacktestWorkerPaused()` | Background worker for bulk backtesting all tickers × 6 setups |
| `shared/schema.ts` | `backtests` table, `backtest_jobs` table | Results schema and job state schema |
| `server/storage.ts` | Backtest CRUD, BacktestJob CRUD | Persistence |
| `server/routes.ts` | `POST /api/backtest/run`, `GET /api/backtests`, `POST /api/backtest/jobs/start`, `POST /api/backtest/jobs/pause`, `POST /api/backtest/jobs/resume`, `POST /api/backtest/jobs/cancel`, `GET /api/backtest/jobs/status` | API endpoints |
| `client/src/pages/backtest.tsx` | Backtest results display | Results UI |
| `client/src/pages/optimization.tsx` | Backtest worker progress card | Worker control UI with progress tracking |
| `client/src/pages/symbol-detail.tsx` | Per-ticker backtest section | Symbol-level backtest view |

**Backtest Worker features:**
- Processes all universe tickers × 6 setups (A–F) incrementally
- Checkpoint-based resumption via completedPairs array
- Rate-limited Polygon API access (250ms spacing, exponential backoff)
- Pause/resume/cancel controls from UI
- Auto-resumes incomplete jobs on app restart

---

## 19. Trade Plan Generation

| File | Key Exports | Role |
|---|---|---|
| `server/lib/tradeplan.ts` | `generateTradePlan()` | Entry, stop, target calculation |
| `shared/schema.ts` | `trade_plan_json` signal column | Trade plan storage |
| `client/src/pages/dashboard.tsx` | Trade plan display in signal detail | UI rendering |

---

## 20. Symbol Detail Page

| File | Key Exports | Role |
|---|---|---|
| `client/src/pages/symbol-detail.tsx` | Symbol detail page component | Price chart, signals, backtests, expectancy |
| `server/routes.ts` | `GET /api/symbol/:ticker`, `GET /api/signals`, `GET /api/backtests`, `GET /api/time-to-hit-stats/:ticker/:setup` | Data APIs |
| `server/storage.ts` | Per-ticker query methods | Data retrieval |

---

## 21. Multi-Instrument Profit Windows

| File | Key Exports | Role |
|---|---|---|
| `server/lib/profitWindows.ts` | `computeAllProfitWindows()`, `computeInstrumentWindows()`, `computeExecutionCosts()`, `getTimingRecommendations()` | Core engine: 4 instrument profiles (SHARES/LETF/OPTIONS/LETF_OPTIONS), R-multiple windowed stats, equity curves, execution cost modeling with liquidity tiers, timing recommendations |
| `server/routes.ts` | `GET /api/performance/profit-windows` | API endpoint merging signals + backtests into TradeInputs |
| `client/src/pages/profit-windows.tsx` | Profit Windows page component | Instrument comparison cards, side-by-side table, per-instrument tabs with charts, execution analysis, timing recs |
| `client/src/components/app-sidebar.tsx` | Nav item for Profit Windows | Sidebar navigation entry |

**Instrument Profiles:** SHARES (1x), LETF (3x, RTH-only, -100% cap), OPTIONS (5x, RTH-only, -100% cap), LETF_OPTIONS (15x, RTH-only, -100% cap)  
**Liquidity Tiers:** ULTRA / HIGH / MEDIUM / LOW with different spread factors  
**Timing Windows:** 7 intraday windows with cost multipliers (optimal at 10:00-11:30 ET, avoid pre-open)  
**Data Source:** Live signals only by default (backtests opt-in via toggle)  
**Optimization Filters:** Min Win Rate, Min Expectancy R, Min Sample Size (per-ticker/setup level); data summary shows filtering breakdown

---

## 22. Testing & Robustness

| File | Key Exports | Role |
|---|---|---|
| `server/lib/reliability.ts` | `computeReliabilitySummary()`, `runFeesSlippageTest()`, `runOutOfSampleTest()`, `runWalkForwardTest()`, `runMonteCarloTest()`, `runStressTest()`, `runParameterSweep()`, `runStopSensitivityTest()`, `runRegimeAnalysis()` | 8 robustness test implementations + 10-gate reliability summary computation |
| `shared/schema.ts` | `robustness_runs` table, `ReliabilitySummary`, `ReliabilityGate`, `RegimeBreakdown` types | Schema for robustness run tracking and reliability types |
| `server/storage.ts` | Robustness runs CRUD methods | Persistence for robustness test executions |
| `server/routes.ts` | `GET /api/analysis/reliability`, `GET /api/analysis/robustness-runs`, `POST /api/analysis/robustness/run`, `POST /api/analysis/robustness/run-all`, `POST /api/settings/assumptions`, `POST /api/settings/forward-validation/start`, `POST /api/settings/forward-validation/stop` | API endpoints for reliability analysis, robustness testing, cost assumptions, and forward validation |
| `client/src/pages/optimization.tsx` | ReliabilitySummaryCard, RegimeSummaryCard | Reliability summary and regime breakdown display |
| `client/src/pages/backtest.tsx` | Test Coverage Checklist, Assumption Badges | Robustness validation checklist and active assumption indicators |
| `client/src/pages/settings.tsx` | Cost Assumptions card, Forward Validation card | Configuration for fees/slippage and forward validation controls |
| `client/src/pages/guide.tsx` | Reliability interpretation section | User-facing documentation for reliability scoring |

**8 Robustness Tests:** Fees & Slippage, Out-of-Sample, Walk-Forward, Monte Carlo, Stress Test, Parameter Sweep, Stop Sensitivity, Regime Analysis
**Reliability Summary:** 10-gate scoring system aggregating all robustness test results

---

## 23. Theme & UI Framework

| File | Role |
|---|---|
| `client/src/components/theme-provider.tsx` | Dark/light mode provider with localStorage sync |
| `client/src/components/theme-toggle.tsx` | Theme toggle button |
| `client/src/components/app-sidebar.tsx` | Navigation sidebar with page links |
| `client/src/components/disclaimer-banner.tsx` | Legal disclaimer banner |
| `client/src/components/ui/*.tsx` (37 files) | Shadcn UI component library |
| `client/src/hooks/use-toast.ts` | Toast notification system |
| `client/src/hooks/use-mobile.tsx` | Mobile breakpoint detection |
| `client/src/lib/queryClient.ts` | TanStack Query configuration |
| `client/src/lib/utils.ts` | Utility functions (cn class merger) |
| `tailwind.config.ts` | Tailwind CSS configuration |

---

## Quick Reference: File → Features

| File | Features Touching This File |
|---|---|
| `shared/schema.ts` | ALL features (central schema) |
| `server/storage.ts` | ALL features (persistence layer) |
| `server/routes.ts` | ALL features (API layer) |
| `server/lib/rules.ts` | Setup Detection |
| `server/lib/quality.ts` | Quality Scoring, Time-to-Hit |
| `server/lib/expectancy.ts` | Expectancy, Optimization |
| `server/lib/activation.ts` | Activation, Stop Management |
| `server/lib/alerts.ts` | Discord Alerts |
| `server/lib/discord.ts` | Discord Alerts, Discord Trades, IBKR Integration |
| `server/lib/embedTemplateDefaults.ts` | Discord Alerts (24 default embed templates) |
| `server/lib/embedTemplateEngine.ts` | Discord Alerts (template rendering engine) |
| `client/src/pages/discord-trades.tsx` | Discord Trades, Embed Template Editor |
| `server/lib/ibkr.ts` | IBKR Integration |
| `server/lib/ibkrOrders.ts` | IBKR Integration, Stop Management |
| `server/lib/polygon.ts` | Market Data, Universe, Options, Backtesting |
| `server/lib/barCache/` | Bar Cache (persistent SQLite + in-memory) |
| `server/lib/options.ts` | Options Enrichment |
| `server/lib/leveragedEtf.ts` | LETF System |
| `server/lib/universe.ts` | Universe Management |
| `server/lib/backtest.ts` | Backtesting, Time-to-Hit |
| `server/lib/calendar.ts` | Author Mode, RTH Validation |
| `server/lib/confidence.ts` | Quality Scoring (ATR, confidence inputs) |
| `server/lib/validate.ts` | RTH Validation, MAE/MFE |
| `server/lib/tradeplan.ts` | Trade Plan Generation |
| `server/lib/optionMonitor.ts` | Options Live Monitoring |
| `server/lib/letfMonitor.ts` | LETF Live Monitoring |
| `server/lib/reliability.ts` | Testing & Robustness (8 tests + reliability summary) |
| `server/jobs/scheduler.ts` | Author Mode |
| `server/jobs/jobFunctions.ts` | Author Mode, Setup Detection, Activation |
| `server/jobs/backtestWorker.ts` | Backtesting (bulk worker) |
| `client/src/pages/dashboard.tsx` | Dashboard, Signals, Profiles, Activation |
| `client/src/pages/performance.tsx` | Performance Analytics |
| `client/src/pages/performance-half.tsx` | Performance ½ Study (Split TP) |
| `client/src/pages/profit-windows.tsx` | Multi-Instrument Profit Windows |
| `server/lib/profitWindows.ts` | Profit Windows (computation engine) |
| `client/src/pages/optimization.tsx` | Optimization, Expectancy, Testing & Robustness |
| `client/src/pages/settings.tsx` | Settings, Profiles, Universe, Author Mode, Testing & Robustness |
| `client/src/pages/symbol-detail.tsx` | Symbol Detail, Backtesting |
| `client/src/pages/backtest.tsx` | Backtesting, Testing & Robustness |
| `client/src/pages/ibkr-dashboard.tsx` | IBKR Integration |
| `client/src/pages/guide.tsx` | Setup Documentation, Testing & Robustness |
