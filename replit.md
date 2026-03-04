# SITU GOAT Trader

## Overview
SITU GOAT Trader is a full-stack web application designed to identify multi-day "situational analysis" setups in stock markets. Its primary purpose is to generate actionable Buy/Sell bias signals, each accompanied by quantified hit rates. The application integrates real market data, providing a comprehensive system for traders. Key capabilities include a sophisticated quality scoring system (0-100) with tier-based alert routing, a time-to-hit probability engine, and a universe filtering mechanism. The business vision is to empower traders with data-driven insights, enhancing decision-making and potentially improving trading outcomes through automated signal generation and risk management tools.

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
- **Setup Detectors:** Implements 6 distinct multi-day situational analysis setups.
- **Signal Generation:** Produces signals with confidence scores and detailed trade plans.
- **Quality Scoring:** A 0-100 point system based on 6 components: Edge Strength, Magnet Distance, Liquidity, Movement Environment, Historical Hit Rate, and TimeScore.
- **TimeScore:** A 0-25 component derived from time-to-hit probabilities, with configurable modes.
- **Tier System:** Signals are categorized into tiers (A+, A, B, C) based on Quality Score and Time-to-Hit probabilities, influencing watchlist priority and alert routing.
- **Time-to-Hit Probability Engine:** Calculates probability distributions from backtested data.
- **Universe Builder & Filter:** Automatically discovers and ranks top N US tickers by dollar volume, with configurable parameters and liquidity filtering.
- **Alert Engine:** Manages alerts for various signal lifecycle events with tier-based routing and rate limiting.
- **Activation Engine:** Scans intraday bars for entry triggers, managing trade states and advanced stop management. Integrates with BTOD gate check.
- **Best Trade of the Day (BTOD):** Automated trade selection system guaranteeing one high-quality trade per day. Features pre-market ranking, dual-phase architecture (SELECTIVE/OPEN), and can spawn up to 4 simultaneous IBKR trades.
- **RTH Validation:** All trade validation and calculations are strictly confined to Regular Trading Hours (09:30-16:00 ET).
- **Optimization Engine:** Intelligence dashboard that identifies top-performing stocks, grades underperformers, ranks setup effectiveness, and provides time-to-hit distribution insights.
- **Performance Dashboard:** Capital risk analysis and P&L tracking, simulating trade outcomes with configurable position sizing.
- **ROI Insights:** Dedicated backtest edge analysis page showing setup rankings, instrument comparison with overlay equity curves, and P&L simulation.
- **Profit Windows:** Multi-instrument profit windows comparison using REAL Polygon.io data, with results cached in the DB.
- **Performance ½ Study:** Compares T1-Only vs Split ½ exit strategies.
- **Activation Simulation for Backtests:** Simulates On Deck → Active transitions for backtested trades using `checkEntryTrigger`.
- **Signal Profiles:** Customizable filter profiles to control dashboard visibility and alert eligibility.
- **Focus Mode:** Prioritizes setups based on expectancy and includes tradeability filtering.
- **Author Mode:** Automated scheduling for market scans, re-ranking, and activation checks.
- **Auto Leveraged ETF Mode:** Dynamically selects optimal instruments per signal.
- **IBKR Integration:** Facilitates full bracket order execution via Interactive Brokers TWS/Gateway.
- **Discord Alerts:** Triple-channel webhook system with lifecycle embeds for different instrument types. Includes color-coding and 1-per-day gates.
- **Embed Template System:** 24 editable Discord embed templates stored in `embed_templates` DB table, with `{{variable}}` placeholders.
- **Backtest Worker:** Background job system that processes all universe tickers × 6 setups incrementally, with checkpoint-based resumption and rate-limited Polygon API access.
- **Bar Cache:** Persistent two-tier caching system (`server/lib/barCache/`) using SQLite for on-disk storage and an in-memory layer.

## External Dependencies
- **Polygon.io:** Primary source for historical and real-time market data.
- **PostgreSQL:** Relational database for storing application data.
- **Drizzle ORM:** Used for interacting with the PostgreSQL database.
- **better-sqlite3:** SQLite driver used for the persistent bar cache.
- **@stoqey/ib:** Library for connecting and interacting with Interactive Brokers TWS/Gateway.
- **node-cron:** Used for scheduling automated tasks.
- **dayjs:** Utilized for date and time manipulations.
- **Discord Webhooks:** Used for sending real-time trade and alert notifications.