# SITU GOAT Trader

## Overview
A full-stack web application that detects multi-day "situational analysis" setups in stock markets and produces actionable Buy/Sell bias signals with quantified hit rates. Uses real market data from Polygon.io API. Includes a quality scoring system (0-100) with tier-based alert routing, time-to-hit probability engine, and universe filtering.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Recharts
- **Backend**: Express.js API server
- **Database**: PostgreSQL via Drizzle ORM
- **Data Source**: Polygon.io REST API for daily and intraday market bars

## Key Features
- **6 Setup Detectors**: Thu-Fri-Mon Magnet (A), Mon-Wed-Thu Magnet (B), Gap Fill (C), Inside Day Expansion (D), PDH/PDL Sweep (E), Weak Extreme (F)
- **Signal Generation**: Confidence scoring, trade plans with entry/stop/targets
- **Quality Scoring (0-100)**: 6-component system (edge strength, magnet distance, liquidity, movement environment, historical hit rate, TimeScore)
- **TimeScore (0-25)**: Uses time-to-hit probabilities (p60/p390) with configurable mode (EARLY/SAME_DAY/BLEND)
- **Tier System**: A+ (quality>=90 AND p60>=0.55), A (quality>=80 AND p120>=0.60), B (70-79), C (<70) with watchlist priority bumping
- **Time-to-Hit Probability Engine**: Computes p15/p30/p60/p120/p240/p390 distributions from backtest data
- **Universe Builder**: Auto-discovers top N (default 150) US tickers by 20-day avg dollar volume via Polygon grouped daily endpoint. Configurable Top N (50-500), 24-hour rebuild cache, alert liquidity gate
- **Universe Filter**: WATCHLIST_ONLY, LIQUIDITY_ONLY, HYBRID modes with configurable liquidity threshold
- **Alert Engine**: HIT/Approaching/New Signal/Miss/Activated events with tier-based routing, rate limiting, and universe_pass filtering
- **Activation Engine**: Entry trigger scanning that checks intraday bars against trade plan conditions, tracks ACTIVE/NOT_ACTIVE/INVALIDATED states. 3-part stop management: volatility baseline (configurable ATR multiplier), break-even protection (moves stop to entry after +0.5R or 25% progress), time stops (tightens stop if no meaningful progress by configurable window). Stop stages: INITIAL/BE/TIME_TIGHTENED. Management modes: VOLATILITY_ONLY, VOLATILITY_BE, VOLATILITY_TIME, FULL.
- **RTH Validation**: All hit/miss validation uses Regular Trading Hours only (09:30-16:00 ET)
- **Backtesting Engine**: Historical validation with MAE/MFE analytics, time-to-hit histograms
- **Signal Profiles**: Saved filter profiles that control dashboard visibility + alert eligibility. Each profile defines: allowed setups, min tier, min quality score, min sample size, min hit rate, min expectancy, time priority mode. Dropdown + banner on dashboard. "Show All" toggle bypasses profile filter. 3 default profiles seeded: Win-Rate Focus (A/B), Balanced, Home Run. Never deletes signal data — profiles only change what you see.
- **Focus Mode**: Expectancy-based setup prioritization with 3 modes (WIN_RATE, EXPECTANCY, BARBELL). Gates alerts by setup category (PRIMARY/SECONDARY/OFF). Includes MAE-based tradeability filtering (CLEAN/CAUTION/AVOID).
- **Author Mode**: Hougaard-style 3-window automation with single master toggle. After Close (3:10 PM CT): full scan generating tomorrow's signals. Pre-Open (8:20 AM CT): re-rank and activation check. Live Monitor (every 60s during RTH 8:30 AM-3:00 PM CT): activation + alerts for active signals. Uses node-cron + dayjs timezone. Holiday/weekend gating via NYSE calendar. Compact header pill with Sheet for details. "Run Now (Manual Override)" uses autoNow logic (context-aware job selection).
- **Auto Leveraged ETF Mode**: Per-signal instrument selection between Options/Shares/Best LETF. Mapping table covers major indices (SPY→SPXL/SPXS, QQQ→TQQQ/SQQQ, etc.) and sector ETFs. Liquidity scoring via Polygon NBBO (spread, volume, stale checks). Auto-selects best LETF on activation (prefers 3x over 2x if liquid). Per-card Trade Via selector (Option/Shares/LETF) with entry price capture. Live tracking in 30s refresh cycle with P&L display.
- **Market Calendar**: NYSE holiday-aware date handling
- **IBKR Integration**: Full bracket order execution via Interactive Brokers TWS/Gateway using @stoqey/ib. Entry (MKT) + Stop (STP) + TP1 limit (partial close) + TP2 limit (remaining). Fill detection polling, auto stop-to-BE on TP1 fill, multi-TP progression tracking (tpHitLevel 0→1→2). LETF trades monitor underlying price for TP levels. Keep-alive with 30s position polling and auto-reconnect. "Trade Now" button on dashboard cards. Manual close via IBKR Dashboard.
- **Discord Alerts**: Dual-channel webhook posting with lifecycle embeds. GOAT Alerts channel for options, GOAT Swings for LETF. Color-coded events: green (entry fill), cyan (TP1 partial), purple (TP2 full close), red (stop loss), orange (BE stop after TP1), gold (stop moved). Full P&L and R-multiple in trade update embeds.

## Project Structure
- `shared/schema.ts` - Database schema and TypeScript types
- `server/routes.ts` - API endpoints
- `server/storage.ts` - Database access layer
- `server/lib/polygon.ts` - Polygon.io API client with caching
- `server/lib/calendar.ts` - Market calendar helpers
- `server/lib/rules.ts` - Setup detection logic
- `server/lib/validate.ts` - RTH intraday validation
- `server/lib/confidence.ts` - Confidence scoring (0-1 scale)
- `server/lib/quality.ts` - Quality scoring (0-100 scale) with TimeScore component and tier mapping
- `server/lib/alerts.ts` - Alert engine with rate limiting, tier-based routing, universe_pass check
- `server/lib/activation.ts` - Activation engine: entry trigger scanning, ACTIVE/NOT_ACTIVE/INVALIDATED tracking
- `server/lib/options.ts` - Options enrichment: fetches ATM contracts (6-25 DTE), validates OI/spread, attaches options_json to pending signals
- `server/lib/optionMonitor.ts` - Option price monitor: server-side polling for ACTIVE signal option quotes (NBBO → last trade fallback), entry mark capture, change tracking
- `server/lib/leveragedEtf.ts` - Leveraged ETF module: mapping table, NBBO liquidity scoring, auto-selection algorithm (3x preferred over 2x if liquid)
- `server/lib/tradeplan.ts` - Trade plan generation
- `server/lib/backtest.ts` - Backtest engine with time-to-hit probability computation
- `server/lib/expectancy.ts` - Expectancy computation: R-multiples, profit factor, tradeability, setup categorization
- `server/lib/universe.ts` - Universe builder: Polygon grouped daily, ranking, top N persistence, 24h cache
- `server/lib/ibkr.ts` - IBKR connection management: connect/disconnect, order placement (MKT/LMT/STP), position tracking, account summary
- `server/lib/ibkrOrders.ts` - Trade execution: executeTradeForSignal, monitorActiveTrades, closeTradeManually, getIbkrDashboardData
- `server/lib/discord.ts` - Discord webhook posting: options alerts, LETF swing alerts, trade updates (fill/stop/BE/close)
- `server/jobs/scheduler.ts` - Auto scheduler: 3 cron jobs (afterClose/preOpen/liveMonitor) with timezone + holiday gating
- `server/jobs/jobFunctions.ts` - Job implementations wiring into existing scan/activation/alert logic + IBKR trade monitoring
- `client/src/pages/` - React pages (dashboard, symbol-detail, backtest, settings, ibkr-dashboard)
- `client/src/components/` - Reusable UI components

## API Routes
- `GET /api/symbols` - List managed symbols
- `POST /api/symbols` - Add symbol
- `PATCH /api/symbols/:ticker` - Toggle enabled
- `DELETE /api/symbols/:ticker` - Remove symbol
- `GET /api/signals` - List signals (includes qualityScore, tier, alertState, pHit60, pHit120, pHit390, timeScore, universePass). ACTIVE signals hydrated with `live` object (currentPrice, activeMinutes, progressToTarget, rNow, distToTargetAtr, distToStopAtr, atr14) and `optionLive` object (bid/ask/mark/spread/stale/optionEntryMark/optionChangeAbs/optionChangePct). Auto-refetches every 30s on dashboard.
- `GET /api/stats` - Dashboard statistics (includes topSignalsToday)
- `GET /api/symbol/:ticker` - Symbol detail with bars, signals, coverage
- `POST /api/refresh` - Fetch market data, generate signals with quality scores and time-to-hit stats
- `GET/POST /api/settings` - App settings (includes watchlistPriority, alert routing, universeMode, liquidityThreshold, timePriorityMode)
- `POST /api/backtest/run` - Run backtest (auto-computes time-to-hit stats after each run)
- `GET /api/backtests` - List backtest results
- `GET /api/time-to-hit-stats/:ticker/:setup` - Get per-ticker time-to-hit stats
- `GET /api/time-to-hit-stats?setup=X` - Get overall time-to-hit stats for a setup type
- `POST /api/activation/scan` - Scan pending signals for entry trigger activation
- `POST /api/alerts/run` - Scan pending signals and generate alert events
- `GET /api/alerts/events` - List alert events sorted by tier/quality
- `POST /api/universe/rebuild` - Rebuild liquidity universe (force=true bypasses 24h cache)
- `GET /api/universe/status` - Universe status (lastRebuild, memberCount, topTickers)
- `GET /api/setup-stats` - Overall setup expectancy stats (R-multiples, profit factor, category)
- `GET /api/setup-stats/:setupType` - Per-ticker breakdown for a setup type
- `POST /api/setup-stats/recompute` - Force recompute all expectancy stats from backtest data
- `GET /api/profiles` - List all signal profiles
- `GET /api/profiles/active` - Get currently active profile
- `POST /api/profiles` - Create new profile
- `PUT /api/profiles/:id` - Update profile
- `DELETE /api/profiles/:id` - Delete profile
- `POST /api/profiles/:id/activate` - Set profile as active (deactivates others)
- `GET /api/scheduler/state` - Scheduler state (authorModeEnabled, last/next run times, liveStatus)
- `POST /api/scheduler/toggle` - Toggle Author Mode ({ authorModeEnabled: boolean })
- `POST /api/scheduler/run` - Manual run with autoNow context-aware job selection
- `POST /api/signals/enrich-options` - Run options enrichment on pending signals ({ force?: boolean, minOI?: number, maxSpread?: number })
- `GET /api/dev/option-quote?contract=O:...` - Dev test: fetch NBBO mark/bid/ask/spread/stale for any option contract
- `POST /api/options/refresh` - Force refresh option quotes for all ACTIVE signals
- `POST /api/signals/:id/instrument` - Switch instrument type (OPTION/SHARES/LEVERAGED_ETF) with entry price capture
- `POST /api/signals/:id/suggest-letf` - Auto-suggest best leveraged ETF for a signal
- `POST /api/ibkr/connect` - Connect to IBKR TWS/Gateway
- `POST /api/ibkr/disconnect` - Disconnect from IBKR
- `GET /api/ibkr/status` - IBKR connection status
- `GET /api/ibkr/dashboard` - Full IBKR dashboard data (account, positions, trades, stats)
- `POST /api/ibkr/execute` - Execute trade for signal ({ signalId, quantity })
- `POST /api/ibkr/close/:tradeId` - Manually close a trade
- `GET /api/ibkr/trades` - List all IBKR trades
- `POST /api/ibkr/monitor` - Run trade monitor cycle (stop updates, BE moves)

## Quality Score Components
- Edge Strength (0-35): Base score by setup type + trigger margin bonus
- Magnet Distance (0-25): Distance to magnet vs ATR(14) ratio
- Liquidity (0-15): Average dollar volume (20d)
- Movement Environment (0-15): True range vs avg + volume vs avg
- Historical Hit Rate (0-10): From resolved signals for ticker+setup
- TimeScore (0-25): From time-to-hit probabilities. EARLY: 25*p60, SAME_DAY: 25*p390, BLEND: 15*p60+10*p390

## Database Tables
- `symbols` - Managed tickers (includes isWatchlist flag to distinguish manual watchlist from auto-discovered)
- `daily_bars` - OHLCV daily data
- `intraday_bars` - OHLCV intraday data
- `signals` - Generated signals with quality/tier/alert/probability/activation fields (includes stop_price, entry_trigger_price, invalidation_ts, stop_stage, stop_moved_to_be_ts, time_stop_triggered_ts, options_json, option_contract_ticker, option_entry_mark)
- `backtests` - Backtest results with details
- `time_to_hit_stats` - Probability distributions per ticker+setup (p15..p390)
- `universe_members` - Universe membership per date (universeDate, ticker, avgDollarVol20d, rank, included)
- `ticker_stats` - Latest ticker statistics (avgDollarVol20d, avgVol20d, atr14, lastPrice)
- `setup_expectancy` - Setup-level expectancy stats (R-multiples, profit factor, tradeability, category per setup type/ticker)
- `signal_profiles` - Saved filter profiles (name, allowedSetups[], minTier, minQualityScore, minSampleSize, minHitRate, minExpectancyR, timePriorityMode, isPinned, isActive)
- `app_settings` - Key-value settings (includes focusMode, focusWinRateThreshold, focusExpectancyThreshold, focusMinSampleSize)
- `scheduler_state` - Scheduler configuration and run history (single row, key="default")
- `ibkr_trades` - IBKR trade records (signalId, ticker, instrumentType, side, quantity, originalQuantity, remainingQuantity, tpHitLevel, entryPrice, exitPrice, stopPrice, target1Price, target2Price, tp1FillPrice, tp2FillPrice, tp1PnlRealized, ibkrOrderId, ibkrStopOrderId, ibkrTp1OrderId, ibkrTp2OrderId, status, pnl, rMultiple, stopMovedToBe)
- `ibkr_state` - IBKR connection state (single row, key="default")

## Environment
- `POLYGON_API_KEY` - Required for market data
- `DATABASE_URL` - PostgreSQL connection (auto-configured)
- `IBKR_HOST` - IBKR Gateway host (default: 127.0.0.1, overridable via settings page)
- `IBKR_PORT` - IBKR Gateway port (default: 4003, overridable via settings page)
- `IBKR_CLIENT_ID` - IBKR client ID (default: 1)
- `DISCORD_GOAT_ALERTS_WEBHOOK` - Discord webhook for options alerts (overridable via settings page)
- `DISCORD_GOAT_SWINGS_WEBHOOK` - Discord webhook for LETF swing alerts (overridable via settings page)
- Default seed symbols: SPY, QQQ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, TSLA, ARM, AMD, PLTR, NFLX, DIS, LLY, UNH, BABA
