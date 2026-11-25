# KopPad Ledger — Pikmin 3 Day-End Spending Report

A full-stack personal spending tracker that emulates the **Pikmin 3** end-of-day S.S. Drake / KopPad results screen, revealing every credit and debit card purchase you made each day alongside animated **Budget Juice Reserve** bottles, a **5-Pikmin Category Breakdown & 14-Day Trend Graph**, and a reactive **Captain's Log**.

## Features

- **Animated Pikmin 3 Day-End Sequence**: Sundown liftoff header, one-by-one fruit-specimen purchase tally with rising Web Audio pentatonic pops/chimes, live rolling day-total odometer, **Replay / Step +1 / Skip to Summary**, and mute toggle.
- **Budget Juice Reserve (Rations Gauge)**: Maps your monthly budget and daily allowance onto 10 animated glass Koppai juice bottles showing remaining days of rations in the month.
- **5 Pikmin Squad Categories & 14-Day Graph**: Auto-categorizes merchants into Red (Dining), Yellow (Shopping), Blue (Groceries), Rock (Bills & Transit), and Winged (Fun & Travel), with interactive Total vs. By-Color SVG trend curves.
- **Smart CSV Statement Upload**: Drag-and-drop bank/card CSV importer with auto-column detection (Chase, Amex, BofA, Capital One, Apple Card, generic), sign convention selector, live preview, deduplication, and automatic filtering of transfers/income/card payments.
- **Automatic Credit & Debit Card Sync (Plaid + Local Sandbox)**:
  - Works out of the box in **Local Sandbox / Mock Sync mode** so you can link mock credit/debit cards and simulate live charges immediately.
  - Drop real `PLAID_CLIENT_ID` and `PLAID_SECRET` into `.env` (see `.env.example`) to activate official Plaid Link & cursor-paginated `/transactions/sync`.
- **Sunset Auto-Sync Scheduler**: Configurable `node-cron` server schedule (Daily Sunset Sync time, Hourly, or Manual Only).
- **SQLite Persistence**: Zero-config local SQLite database (`data/koppad.db`) powered by Node 22's built-in `node:sqlite`.

## Running Locally

```bash
npm install
npm --prefix client install
npm run dev
```

- Frontend (Vite): `http://localhost:5173`
- Backend API (Express): `http://localhost:3001`

### Enabling Real Plaid Credentials

Copy `.env.example` to `.env` and set:

```env
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox
```

Restart `npm run dev` — the **Link Credit / Debit Card** button will automatically launch the official Plaid Link widget.
