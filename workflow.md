# SITU GOAT Trader — Trade Lifecycle Workflow

## Phase 1: Signal Discovery (After Market Close)

Every weekday at **3:10 PM CT**, the after-close scan runs automatically (if Author Mode is on):

1. **Universe rebuild** — The system re-ranks the top US tickers by dollar volume to determine which stocks to scan.
2. **Setup detection** — It scans those tickers for 6 different multi-day pattern setups (labeled A through F). Each setup identifies a directional bias (Buy or Sell) with a magnet price (target) and stop level.
3. **Quality scoring** — Each detected setup gets a 0-100 Quality Score based on 6 components: Edge Strength, Magnet Distance, Liquidity, Movement Environment, Historical Hit Rate, and TimeScore.
4. **Signal creation** — Scored setups are saved to the database as new signals with status `pending` and activation status `NOT_ACTIVE`. They include a full trade plan (entry, stop, T1, T2 targets).

At this point, signals are just sitting in the database waiting for the next trading day. Think of them as a "watchlist" of potential trades.

---

## Phase 2: Pre-Market Ranking (8:20 AM CT)

The pre-open scan runs at **8:20 AM CT** each weekday:

1. **Stale signal cleanup** — Any signals from previous days that never activated are marked as `miss` (reason: TARGET_DATE_EXPIRED).
2. **Option enrichment** — Expired option contracts are replaced with fresh ones that have valid expiration dates, good open interest, and tight spreads.
3. **BTOD initialization** — This is the key step. The system:
   - Pulls all pending, not-yet-activated signals
   - Filters to only setups A, B, and C with a Quality Score of **62 or above**
   - Ranks them by Quality Score (highest first), then by setup type (A > B > C), then alphabetically by ticker
   - Selects the **Top 3** as the priority trades
   - Sets the BTOD phase to **SELECTIVE** and opens the execution gate

After this, the system knows: "Today, these 3 signals are my best opportunities. Focus on them first."

---

## Phase 3: Live Monitoring & Activation (8:30 AM – 3:00 PM CT)

Every **minute** during Regular Trading Hours, the live monitor tick runs:

### Step 3a: Price Monitoring
- The system fetches current price snapshots and 1-minute intraday bars from Polygon.io for every ticker that has a pending signal.

### Step 3b: Entry Trigger Check (`checkEntryTrigger`)
For each pending signal, the system checks if the price action has triggered an entry:

- **Conservative mode** (default): Requires a breakout past the previous bar's high/low, followed by a confirmation/retest pattern.
- **Aggressive mode**: Triggers on the first bar where the close moves in the direction of the bias (e.g., close > open for a Buy signal).

If the trigger fires, the signal transitions from `NOT_ACTIVE` → `ACTIVE`. The database is updated with:
- `activationStatus = "ACTIVE"`
- `activatedTs` (the exact time the trigger fired)
- `entryPriceAtActivation` (the price at trigger)
- `stopPrice`

### Step 3c: BTOD Execution Gate (`shouldExecuteActivation`)
Just because a signal activated doesn't mean it gets traded. Every activation must pass the BTOD gate:

**During SELECTIVE phase (before 10:00 AM CT):**
- Only the **Top 3** ranked signals are allowed to execute
- If signal #4 activates first, it's rejected — the system waits for one of the Top 3

**During OPEN phase (after 10:00 AM CT):**
- If no Top 3 signal activated by 10:00 AM, the system transitions to OPEN phase
- Now ANY eligible signal can execute (not just Top 3)
- But it must be a "fresh" activation — signals that activated before 10:00 AM are rejected as "stale" (this is the guard that Bug #2 was bypassing)

**Additional gate rules:**
- Maximum **2 trades per day**
- After the first trade executes, the gate closes
- The gate only re-opens for a second trade if the first trade closes (hits target or stop)

---

## Phase 4: Multi-Instrument Execution & Trade Sync

When a signal passes the BTOD gate, `executeBtodMultiInstrument` fires and spawns **up to 4 simultaneous trades**:

### Instrument Selection
| Instrument | Condition | Ticker Used |
|---|---|---|
| **Shares** | Always included | Stock ticker (e.g., AAPL) |
| **Options** | Valid contract ticker + quote exists | Stock ticker with option contract details |
| **LETF** (Leveraged ETF) | LETF ticker is defined for this stock | LETF ticker (e.g., TQQQ for QQQ) |
| **LETF Options** | LETF exists + ATM contract found (4-45 DTE, ~0.50 delta, 500+ OI) | LETF ticker with option contract details |

### Target Conversion
For each instrument, the stock-level entry/stop/T1/T2 prices are converted to instrument-specific prices:
- **Shares**: Same as stock prices
- **Options**: Converted using delta-based premium calculations
- **LETF**: Converted using the leverage multiplier applied to the stock's percentage move
- **LETF Options**: LETF prices further converted to option premiums via delta

### Sending to Trade Sync
Each instrument trade is packaged into a payload and sent to the Trade Sync API:

**What's in the payload:**
- `ticker`, `instrumentType`, `direction` (Long/Short or Call/Put)
- `entryPrice` — the activation price
- `targets` — T1 (50% take-off, then raise stop to break-even) and T2 (100% take-off)
- `stop_loss` — the ATR-based stop price
- `auto_track: true` — Trade Sync handles monitoring hits automatically
- For options: `expiration`, `strike`, `option_type`, `underlying_ticker`
- For LETF: `leverage`, `underlying_ticker`

**What Trade Sync does with it:**
- Sends Discord alerts to the appropriate channel (Shares, Options, LETF, or LETF Options webhook)
- Places bracket orders on IBKR (entry + stop + targets)
- Auto-tracks the trade: monitors for T1 hits (raises stop to break-even), T2 hits, and stop losses
- Sends lifecycle updates (ACTIVATED, TP1_HIT, CLOSED) back via Discord

**SITU GOAT's role ends here.** It is the signal source — it detects setups, ranks them, monitors for entry triggers, and sends the trade to Trade Sync. Everything after that (order execution, position management, alerts) is Trade Sync's responsibility.

---

## Visual Summary

```
After-Close (3:10 PM)     Pre-Open (8:20 AM)     RTH (8:30 AM - 3:00 PM)
┌─────────────────┐       ┌──────────────┐       ┌──────────────────────┐
│ Scan universe    │       │ Cleanup stale│       │ Every minute:        │
│ Detect setups    │──────▶│ Rank signals │──────▶│  Fetch prices        │
│ Score & save     │       │ Pick Top 3   │       │  Check entry trigger │
│ signals          │       │ Set SELECTIVE│       │  If activated:       │
└─────────────────┘       └──────────────┘       │   BTOD gate check    │
                                                  │   If approved:       │
                                                  │    Build 4 trades    │
                                                  │    Send to TradeSync │
                                                  │    Gate closes       │
                                                  └──────────────────────┘
```

---

## Key Files

| Component | File |
|---|---|
| Scheduler & cron orchestration | `server/jobs/scheduler.ts` |
| After-close / pre-open / live monitor logic | `server/jobs/jobFunctions.ts` |
| Entry trigger detection | `server/lib/signalHelper.ts` |
| Activation scan & post-activation | `server/lib/activation.ts` |
| BTOD ranking, phases, gate logic | `server/lib/btod.ts` |
| Trade Sync payload & transmission | `server/lib/tradesync.ts` |
| Polygon.io data fetching | `server/lib/polygon.ts` |
| Option enrichment & contract selection | `server/lib/options.ts` |
