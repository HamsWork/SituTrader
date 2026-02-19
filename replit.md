# Situational Signals

## Overview
A full-stack web application that detects multi-day "situational analysis" setups in stock markets and produces actionable Buy/Sell bias signals with quantified hit rates. Uses real market data from Polygon.io API.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI + Recharts
- **Backend**: Express.js API server
- **Database**: PostgreSQL via Drizzle ORM
- **Data Source**: Polygon.io REST API for daily and intraday market bars

## Key Features
- **6 Setup Detectors**: Thu-Fri-Mon Magnet (A), Mon-Wed-Thu Magnet (B), Gap Fill (C), Inside Day Expansion (D), PDH/PDL Sweep (E), Weak Extreme (F)
- **Signal Generation**: Confidence scoring, trade plans with entry/stop/targets
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
- `server/lib/confidence.ts` - Confidence scoring
- `server/lib/tradeplan.ts` - Trade plan generation
- `server/lib/backtest.ts` - Backtest engine
- `client/src/pages/` - React pages (dashboard, symbol-detail, backtest, settings)
- `client/src/components/` - Reusable UI components

## API Routes
- `GET /api/symbols` - List managed symbols
- `POST /api/symbols` - Add symbol
- `PATCH /api/symbols/:ticker` - Toggle enabled
- `DELETE /api/symbols/:ticker` - Remove symbol
- `GET /api/signals` - List signals
- `GET /api/stats` - Dashboard statistics
- `GET /api/symbol/:ticker` - Symbol detail with bars, signals, coverage
- `POST /api/refresh` - Fetch market data and generate signals
- `GET/POST /api/settings` - App settings
- `POST /api/backtest/run` - Run backtest
- `GET /api/backtests` - List backtest results

## Environment
- `POLYGON_API_KEY` - Required for market data
- `DATABASE_URL` - PostgreSQL connection (auto-configured)
- Default seed symbols: SPY, QQQ, NVDA, TSLA
