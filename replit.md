# Situational Signals

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
- **Activation Engine**: Entry trigger scanning that checks intraday bars against trade plan conditions, tracks ACTIVE/NOT_ACTIVE/INVALIDATED states
- **RTH Validation**: All hit/miss validation uses Regular Trading Hours only (09:30-16:00 ET)
- **Backtesting Engine**: Historical validation with MAE/MFE analytics, time-to-hit histograms
- **Focus Mode**: Expectancy-based setup prioritization with 3 modes (WIN_RATE, EXPECTANCY, BARBELL). Gates alerts by setup category (PRIMARY/SECONDARY/OFF). Includes MAE-based tradeability filtering (CLEAN/CAUTION/AVOID).
- **Market Calendar**: NYSE holiday-aware date handling

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
- `server/lib/tradeplan.ts` - Trade plan generation
- `server/lib/backtest.ts` - Backtest engine with time-to-hit probability computation
- `server/lib/expectancy.ts` - Expectancy computation: R-multiples, profit factor, tradeability, setup categorization
- `server/lib/universe.ts` - Universe builder: Polygon grouped daily, ranking, top N persistence, 24h cache
- `client/src/pages/` - React pages (dashboard, symbol-detail, backtest, settings)
- `client/src/components/` - Reusable UI components

## API Routes
- `GET /api/symbols` - List managed symbols
- `POST /api/symbols` - Add symbol
- `PATCH /api/symbols/:ticker` - Toggle enabled
- `DELETE /api/symbols/:ticker` - Remove symbol
- `GET /api/signals` - List signals (includes qualityScore, tier, alertState, pHit60, pHit120, pHit390, timeScore, universePass)
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
- `signals` - Generated signals with quality/tier/alert/probability/activation fields (includes stop_price, entry_trigger_price, invalidation_ts)
- `backtests` - Backtest results with details
- `time_to_hit_stats` - Probability distributions per ticker+setup (p15..p390)
- `universe_members` - Universe membership per date (universeDate, ticker, avgDollarVol20d, rank, included)
- `ticker_stats` - Latest ticker statistics (avgDollarVol20d, avgVol20d, atr14, lastPrice)
- `setup_expectancy` - Setup-level expectancy stats (R-multiples, profit factor, tradeability, category per setup type/ticker)
- `app_settings` - Key-value settings (includes focusMode, focusWinRateThreshold, focusExpectancyThreshold, focusMinSampleSize)

## Environment
- `POLYGON_API_KEY` - Required for market data
- `DATABASE_URL` - PostgreSQL connection (auto-configured)
- Default seed symbols: SPY, QQQ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, TSLA, ARM, AMD, PLTR, NFLX, DIS, LLY, UNH, BABA
