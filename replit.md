# SITU GOAT Trader

## Overview
SITU GOAT Trader is a full-stack web application designed to identify multi-day "situational analysis" setups in stock markets. Its primary purpose is to generate actionable Buy/Sell bias signals, each accompanied by quantified hit rates. The application integrates real market data from Polygon.io, providing a comprehensive system for traders. Key capabilities include a sophisticated quality scoring system (0-100) with tier-based alert routing, a time-to-hit probability engine, and a universe filtering mechanism. The business vision is to empower traders with data-driven insights, enhancing decision-making and potentially improving trading outcomes through automated signal generation and risk management tools.

## User Preferences
I prefer clear and direct communication. I value iterative development with regular updates on progress. Before implementing any major architectural changes or significant feature additions, please ask for my approval. I expect detailed explanations for complex technical decisions. Do not make changes to files within the `server/lib` directory without explicit instruction.

## System Architecture
The application follows a full-stack architecture.

**UI/UX Decisions:**
- **Frontend:** Built with React, TypeScript, Tailwind CSS, Shadcn UI, and Recharts, focusing on a modern and responsive user interface.
- **Design Approach:** The UI is designed for clarity and ease of use, presenting complex trading data in an accessible format.

**Technical Implementations:**
- **Backend:** An Express.js API server handles all business logic and data processing.
- **Database:** PostgreSQL is used for data persistence, managed via Drizzle ORM.
- **Data Source:** Market data (daily and intraday bars) is sourced from the Polygon.io REST API.

**Feature Specifications & System Design Choices:**
- **Setup Detectors:** Implements 6 distinct multi-day situational analysis setups (e.g., Thu-Fri-Mon Magnet, Gap Fill, Weak Extreme).
- **Signal Generation:** Produces signals with confidence scores and detailed trade plans (entry, stop, targets).
- **Quality Scoring:** A 0-100 point system based on 6 components: Edge Strength, Magnet Distance, Liquidity, Movement Environment, Historical Hit Rate, and TimeScore.
- **TimeScore:** A 0-25 component derived from time-to-hit probabilities (p60/p390), with configurable modes (EARLY/SAME_DAY/BLEND).
- **Tier System:** Signals are categorized into tiers (A+, A, B, C) based on Quality Score and Time-to-Hit probabilities, influencing watchlist priority and alert routing.
- **Time-to-Hit Probability Engine:** Calculates probability distributions (p15/p30/p60/p120/p240/p390) from backtested data.
- **Universe Builder & Filter:** Automatically discovers and ranks top N US tickers by dollar volume, with configurable parameters and liquidity filtering.
- **Alert Engine:** Manages alerts for various signal lifecycle events (HIT, Approaching, New Signal, Miss, Activated) with tier-based routing and rate limiting.
- **Activation Engine:** Scans intraday bars for entry triggers, managing trade states (ACTIVE/NOT_ACTIVE/INVALIDATED) and advanced stop management (volatility baseline, break-even protection, time stops).
- **RTH Validation:** All trade validation and calculations are strictly confined to Regular Trading Hours (09:30-16:00 ET).
- **Optimization Engine:** Intelligence dashboard (formerly Backtest) that identifies top-performing stocks, grades underperformers, ranks setup effectiveness, and provides time-to-hit distribution insights. Features KPI overview cards, per-ticker grading (A+ through F), setup comparison radar chart, and "Avoid Zone" highlighting for consistently poor performers. Filterable by setup type. Backed by expectancy stats (win rate, R-multiples, profit factor, tradeability grades).
- **Performance Dashboard:** Capital risk analysis and P&L tracking. Simulates trade outcomes from all resolved signals with configurable position sizing ($1000 default). Features lookback period selection (30/60/90/120 days), equity curve, daily P&L chart, instrument breakdown (Options/Shares/Leveraged ETF), and full trade history table. Shows capital required, ROI, win rate, best/worst trades per period. Includes "Activated Only" toggle to filter to trades that moved from On Deck → Active during market hours (uses activation status for live signals, simulated entry trigger for backtest trades).
- **ROI Insights:** Dedicated backtest edge analysis page showing setup rankings with activated win rates and lift, instrument comparison (Shares vs Leveraged ETF 3x vs Options ~5x) with overlay equity curves and per-instrument KPI tabs, recommended strategy P&L simulation (best setup + top tickers + activated), quality score breakdown, top/avoid ticker lists, and 1-trade-per-day selection guide with instrument recommendation. Filterable by setup type.
- **Performance ½ Study:** Split take-profit comparison page. Compares T1-Only (100% exit at T1) vs Split ½ (50% of shares at halfway point between entry and T1, remaining 50% at T1 or stop). Once halfway is hit, stop moves to break-even on remaining shares — PARTIAL trades exit remaining 50% at $0 P&L. Features comparison banner with delta P&L and winner badge, dual equity curve overlay, trade details table with halfway price and PARTIAL outcomes. MFE-based halfway hit detection for missed trades. Period-scoped.
- **Activation Simulation for Backtests:** The `checkEntryTrigger` function (conservative mode: breakout + retest) is now exported from `activation.ts` and used in `backtest.ts` to simulate On Deck → Active transitions for backtested trades. Results stored as `activated`, `activationPrice`, `activationTs` fields in `BacktestDetail`. Existing backtests can be enriched via `POST /api/backtests/backfill-activation` which processes each detail record against stored intraday bars. The Activated Only channel on Performance ½ Study uses this data to show only trades where the entry trigger would have fired.
- **Signal Profiles:** Customizable filter profiles to control dashboard visibility and alert eligibility based on various signal parameters.
- **Focus Mode:** Prioritizes setups based on expectancy (WIN_RATE, EXPECTANCY, BARBELL modes) and includes tradeability filtering.
- **Author Mode:** Automated scheduling for market scans, re-ranking, and activation checks throughout the trading day, with holiday/weekend gating.
- **Auto Leveraged ETF Mode:** Dynamically selects optimal instruments (Options/Shares/LETF) per signal, considering liquidity and leverage, with real-time P&L tracking.
- **IBKR Integration:** Facilitates full bracket order execution (Entry, Stop, TP1, TP2) via Interactive Brokers TWS/Gateway, including fill detection, stop management, and position monitoring.
- **Discord Alerts:** Triple-channel webhook system with lifecycle embeds. GOAT Alerts channel (DISCORD_GOAT_ALERTS_WEBHOOK) for Options trades, GOAT Swings channel (DISCORD_GOAT_SWINGS_WEBHOOK) for Leveraged ETF swing trades, GOAT Shares channel (DISCORD_GOAT_SHARES_WEBHOOK) for Shares trades. Color-coded: GREEN (entry fill, TP1/TP2/TP3 hits, trade closed with profit), RED (stop loss, trade closed with loss), GOLD (stopped at BE after TP1). Trade Closed embeds only fire on manual closes via dashboard. BE stop move communicated in TP1 embed Risk Management section. Leveraged ETF alerts display underlying stock prices for Entry/TP/Stop fields (not ETF prices), with separate Leveraged ETF ticker, leverage, and entry price fields. Options alerts show strike/expiry/option price. Shares alerts show ticker, entry price, and instrument type. Full P&L and R-multiple in closing embeds. 1-per-day gate: max 1 OPTION + 1 LEVERAGED_ETF + 1 SHARES trade per calendar day ET, independent of each other.
- **Embed Template System:** 24 editable Discord embed templates (4 instrument types × 6 event types) stored in `embed_templates` DB table. Templates use `{{variable}}` placeholders (26 variables available) that are resolved at alert time. Template editor UI on Discord Trades page with JSON editing, live preview, toggle active/inactive, and reset-to-default. `postTradeUpdate()` in discord.ts uses template-first rendering with hardcoded fallback. Templates auto-seeded on startup.

- **Backtest Worker:** Background job system that processes all universe tickers × 6 setups (A–F) incrementally. Features checkpoint-based resumption, rate-limited Polygon API access, pause/resume/cancel controls, and auto-resume on app restart. Progress tracked in `backtest_jobs` table.

## Standard Operating Procedure (SOP)

### Mandatory: System Audit Update on Every Change
**After completing ANY code changes**, the following audit files MUST be updated before marking the task as complete:

1. **`SYSTEM_AUDIT.md`** — Human-readable system architecture document
   - Update affected sections: line counts, table counts, new modules/exports, new API routes, architecture diagram if structural changes
   - Update the audit date to current date

2. **`SYSTEM_AUDIT.json`** — Machine-readable audit data
   - Update metadata (date, line counts, file counts)
   - Add/update table definitions, API endpoints, module entries, scheduler/worker entries
   - Keep all numeric values accurate (line counts, column counts)

3. **`FEATURE_FILE_MAP.md`** — Feature-to-file mapping
   - Update affected feature sections with new/changed files and exports
   - Update the Quick Reference table at the bottom if new files are added

4. **`replit.md`** — Project memory and preferences
   - Update feature descriptions if new capabilities are added
   - Add new external dependencies if introduced

### What Triggers an Audit Update
- New database tables or columns added
- New API endpoints created
- New files or modules added
- Significant line count changes (>50 lines) in existing files
- New features or sub-features implemented
- New external dependencies added
- Architecture changes (new workers, schedulers, integrations)

### Audit Update Checklist
- [ ] Date updated in SYSTEM_AUDIT.md and SYSTEM_AUDIT.json
- [ ] Line counts verified with `wc -l` for changed files
- [ ] New tables documented with column count, PK, purpose, key columns
- [ ] New API endpoints listed with method, path, and purpose
- [ ] New module exports documented
- [ ] Feature file map updated for affected features
- [ ] Quick Reference table updated if new files added
- [ ] replit.md updated if new features or dependencies added

- **Bar Cache:** Persistent two-tier caching system (`server/lib/barCache/`) using SQLite (`bar_cache.db`) for permanent on-disk storage and a 5-minute in-memory layer. All bar fetches go through `fetchDailyBarsCached`/`fetchIntradayBarsCached` which use incremental fetching, per-series locking, and configurable staleness thresholds. Stats available at `GET /stats/bar-cache`.

## External Dependencies
- **Polygon.io:** Primary source for historical and real-time market data (daily and intraday bars, grouped daily endpoint).
- **PostgreSQL:** Relational database for storing application data.
- **Drizzle ORM:** Used for interacting with the PostgreSQL database.
- **better-sqlite3:** SQLite driver used for the persistent bar cache (`bar_cache.db`).
- **@stoqey/ib:** Library for connecting and interacting with Interactive Brokers TWS/Gateway for trade execution.
- **node-cron:** Used for scheduling automated tasks in Author Mode.
- **dayjs:** Utilized for date and time manipulations, especially for timezone handling and market calendar logic.
- **Discord Webhooks:** Used for sending real-time trade and alert notifications to Discord channels.

## Retired Studies (Reference Only)

### T2 Split-Exit Model (Retired March 2026)
**Conclusion:** T1-only exit strategy outperforms split-exit by ~420% across 63,340 resolved trades. The system uses 100% exit at T1.

**T2 Pricing Methodology (for future reference):**
- For signals with explicit T2: stored in `tradePlanJson.t2` (generated by trade plan builder)
- For backtests without explicit T2: T2 = T1 + 30% of reward distance (i.e., `magnetPrice ± reward * 0.3`)
- Split-exit model: 50% of shares exit at T1, remaining 50% rides to T2 or exits at break-even
- T2 hit detection for live trades: IBKR `tpHitLevel >= 2`
- T2 hit detection for backtests: MFE-based — `mfe * entryPrice >= |t2Price - entryPrice|` (MFE stored as decimal ratio, e.g., 0.012 = 1.2%)
- Study results: T2 hit rate was 62.6% (18,510 hits / 11,043 misses), but the halved T1 profits on T2 misses outweighed the extra T2 leg profit ($99,926)
- T1-only P&L: +$19,503 vs Split-exit P&L: -$62,484