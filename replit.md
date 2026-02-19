# Situational Signals

## Overview
A full-stack web application that detects multi-day "situational analysis" setups in stock markets and produces actionable Buy/Sell bias signals with quantified hit rates. Uses real market data from Polygon.io API. Includes a quality scoring system (0-100) with tier-based alert routing.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Recharts
- **Backend**: Express.js API server
- **Database**: PostgreSQL via Drizzle ORM
- **Data Source**: Polygon.io REST API for daily and intraday market bars

## Key Features
- **6 Setup Detectors**: Thu-Fri-Mon Magnet (A), Mon-Wed-Thu Magnet (B), Gap Fill (C), Inside Day Expansion (D), PDH/PDL Sweep (E), Weak Extreme (F)
- **Signal Generation**: Confidence scoring, trade plans with entry/stop/targets
- **Quality Scoring (0-100)**: 5-component system (edge strength, magnet distance, liquidity, movement environment, historical hit rate)
- **Tier System**: A+ (90-100), A (80-89), B (70-79), C (<70) with watchlist priority bumping
- **Alert Engine**: HIT/Approaching/New Signal/Miss events with tier-based routing and rate limiting
- **RTH Validation**: All hit/miss validation uses Regular Trading Hours only (09:30-16:00 ET)
- **Backtesting Engine**: Historical validation with MAE/MFE analytics
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
- `server/lib/quality.ts` - Quality scoring (0-100 scale) with tier mapping
- `server/lib/alerts.ts` - Alert engine with rate limiting and tier-based routing
- `server/lib/tradeplan.ts` - Trade plan generation
- `server/lib/backtest.ts` - Backtest engine
- `client/src/pages/` - React pages (dashboard, symbol-detail, backtest, settings)
- `client/src/components/` - Reusable UI components

## API Routes
- `GET /api/symbols` - List managed symbols
- `POST /api/symbols` - Add symbol
- `PATCH /api/symbols/:ticker` - Toggle enabled
- `DELETE /api/symbols/:ticker` - Remove symbol
- `GET /api/signals` - List signals (includes qualityScore, tier, alertState)
- `GET /api/stats` - Dashboard statistics (includes topSignalsToday)
- `GET /api/symbol/:ticker` - Symbol detail with bars, signals, coverage
- `POST /api/refresh` - Fetch market data, generate signals with quality scores
- `GET/POST /api/settings` - App settings (includes watchlistPriority, alert routing)
- `POST /api/backtest/run` - Run backtest
- `GET /api/backtests` - List backtest results
- `POST /api/alerts/run` - Scan pending signals and generate alert events
- `GET /api/alerts/events` - List alert events sorted by tier/quality

## Quality Score Components
- Edge Strength (0-35): Base score by setup type + trigger margin bonus
- Magnet Distance (0-25): Distance to magnet vs ATR(14) ratio
- Liquidity (0-15): Average dollar volume (20d)
- Movement Environment (0-15): True range vs avg + volume vs avg
- Historical Hit Rate (0-10): From resolved signals for ticker+setup

## Environment
- `POLYGON_API_KEY` - Required for market data
- `DATABASE_URL` - PostgreSQL connection (auto-configured)
- Default seed symbols: SPY, QQQ, NVDA, TSLA
