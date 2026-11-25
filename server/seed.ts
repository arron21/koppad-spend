import crypto from 'node:crypto';
import { db, logSync } from './db.ts';
import { classifyTransaction, makeDedupeHash } from './categorizer.ts';

function getDateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface SeedTx {
  daysAgo: number;
  card: 'credit' | 'debit';
  raw: string;
  amount: number;
  plaidCat?: string;
}

const DEMO_TRANSACTIONS: SeedTx[] = [
  // Today (Day 10 of Expedition) - Rich 5-purchase day-end showcase + 1 auto-excluded card payment
  { daysAgo: 0, card: 'credit', raw: 'BLUE BOTTLE COFFEE #14', amount: 6.75, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 0, card: 'debit', raw: 'TRADER JOES #204', amount: 24.4, plaidCat: 'GROCERIES' },
  { daysAgo: 0, card: 'credit', raw: 'TST* MARUFUKU RAMEN', amount: 21.85, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 0, card: 'debit', raw: 'BART TRANSIT CLIPPER', amount: 4.65, plaidCat: 'TRANSPORTATION' },
  { daysAgo: 0, card: 'credit', raw: 'MUJI STATIONERY STORE', amount: 11.2, plaidCat: 'GENERAL_MERCHANDISE' },
  { daysAgo: 0, card: 'debit', raw: 'CHASE CARD SERV AUTOPAY', amount: 420.0, plaidCat: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },

  // Yesterday (Splurge day!)
  { daysAgo: 1, card: 'credit', raw: 'NINTENDO ESHOP US', amount: 59.99, plaidCat: 'ENTERTAINMENT' },
  { daysAgo: 1, card: 'credit', raw: 'UNIQLO USA ONLINE', amount: 49.9, plaidCat: 'GENERAL_MERCHANDISE' },
  { daysAgo: 1, card: 'credit', raw: 'IZAKAYA RINTARO DINNER', amount: 36.4, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 1, card: 'debit', raw: 'BOBA GUYS SAN FRANCISCO', amount: 7.25, plaidCat: 'FOOD_AND_DRINK' },

  // 2 days ago (Frugal ration-saving day!)
  { daysAgo: 2, card: 'credit', raw: 'PEETS COFFEE & TEA', amount: 5.45, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 2, card: 'debit', raw: 'BART TRANSIT CLIPPER', amount: 9.3, plaidCat: 'TRANSPORTATION' },

  // 3 days ago
  { daysAgo: 3, card: 'debit', raw: 'WHOLE FOODS MARKET', amount: 44.18, plaidCat: 'GROCERIES' },
  { daysAgo: 3, card: 'credit', raw: 'SHELL OIL 57442', amount: 38.5, plaidCat: 'TRANSPORTATION' },
  { daysAgo: 3, card: 'credit', raw: 'SPOTIFY USA MONTHLY', amount: 11.99, plaidCat: 'ENTERTAINMENT' },

  // 4 days ago
  { daysAgo: 4, card: 'credit', raw: 'SWEETGREEN SALAD BAR', amount: 17.65, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 4, card: 'credit', raw: 'AMAZON.COM*MK84P2', amount: 32.8, plaidCat: 'GENERAL_MERCHANDISE' },
  { daysAgo: 4, card: 'debit', raw: 'DIRECT DEP KOPPAI CORP PAYROLL', amount: -2450.0, plaidCat: 'INCOME_WAGES' },

  // 5 days ago
  { daysAgo: 5, card: 'credit', raw: 'AMC THEATRES ONLINE', amount: 28.5, plaidCat: 'ENTERTAINMENT' },
  { daysAgo: 5, card: 'credit', raw: 'TARTINE BAKERY MORNING', amount: 13.4, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 5, card: 'debit', raw: 'H MART GROCERY', amount: 31.2, plaidCat: 'GROCERIES' },

  // 6 days ago
  { daysAgo: 6, card: 'debit', raw: 'XFINITY COMCAST INTERNET', amount: 65.0, plaidCat: 'RENT_AND_UTILITIES' },
  { daysAgo: 6, card: 'credit', raw: 'STARBUCKS STORE 04219', amount: 6.15, plaidCat: 'FOOD_AND_DRINK' },

  // 7 days ago
  { daysAgo: 7, card: 'credit', raw: 'TARGET 00018244', amount: 41.72, plaidCat: 'GENERAL_MERCHANDISE' },
  { daysAgo: 7, card: 'credit', raw: 'CHIPOTLE MEXICAN GRILL', amount: 14.95, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 7, card: 'debit', raw: 'ZELLE TRANSFER TO SAVINGS', amount: 250.0, plaidCat: 'TRANSFER_OUT' },

  // 8 days ago
  { daysAgo: 8, card: 'debit', raw: 'TRADER JOES #204', amount: 39.6, plaidCat: 'GROCERIES' },
  { daysAgo: 8, card: 'credit', raw: 'BARNES & NOBLE BOOKSHOP', amount: 22.99, plaidCat: 'ENTERTAINMENT' },

  // 9 days ago
  { daysAgo: 9, card: 'credit', raw: 'BLUE BOTTLE COFFEE #14', amount: 6.5, plaidCat: 'FOOD_AND_DRINK' },
  { daysAgo: 9, card: 'credit', raw: 'UBER *TRIP HELP.UBER.COM', amount: 18.4, plaidCat: 'TRANSPORTATION' },
  { daysAgo: 9, card: 'credit', raw: 'PIZZERIA DELFINA', amount: 29.75, plaidCat: 'FOOD_AND_DRINK' },
];

export function seedDemoData(force = false): { seeded: boolean; count: number } {
  if (!force) {
    const existingCount = (
      db.prepare('SELECT COUNT(*) as c FROM transactions').get() as { c: number }
    ).c;
    const existingAccounts = (
      db.prepare('SELECT COUNT(*) as c FROM accounts').get() as { c: number }
    ).c;
    if (existingCount > 0 || existingAccounts > 0) {
      return { seeded: false, count: 0 };
    }
  } else {
    db.exec('DELETE FROM transactions; DELETE FROM accounts; DELETE FROM daily_notes; DELETE FROM sync_logs;');
  }

  const now = new Date().toISOString();
  const creditId = 'acc_demo_chase_4821';
  const debitId = 'acc_demo_bofa_9042';

  db.prepare(
    `INSERT OR IGNORE INTO accounts (
      id, name, institution, mask, type, source, plaid_item_id, plaid_access_token,
      plaid_account_id, sync_cursor, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'mock_plaid', ?, ?, ?, 'mock_cursor_seed', ?, ?)`
  ).run(
    creditId,
    'Sapphire Reserve',
    'Chase',
    '4821',
    'credit',
    'mock_item_chase_sapphire',
    'mock-access-chase_sapphire',
    'mock_acct_chase_sapphire',
    now,
    now
  );

  db.prepare(
    `INSERT OR IGNORE INTO accounts (
      id, name, institution, mask, type, source, plaid_item_id, plaid_access_token,
      plaid_account_id, sync_cursor, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'mock_plaid', ?, ?, ?, 'mock_cursor_seed', ?, ?)`
  ).run(
    debitId,
    'Advantage Checking Debit',
    'Bank of America',
    '9042',
    'debit',
    'mock_item_bofa_debit',
    'mock-access-bofa_debit',
    'mock_acct_bofa_debit',
    now,
    now
  );

  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transactions (
      id, account_id, account_label, card_type, date, merchant, raw_description,
      amount, category, fruit_alias, source, external_id, dedupe_hash,
      is_excluded, exclude_reason, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mock_plaid', ?, ?, ?, ?, '', ?)
  `);

  let count = 0;
  for (let i = 0; i < DEMO_TRANSACTIONS.length; i++) {
    const item = DEMO_TRANSACTIONS[i];
    const date = getDateOffset(item.daysAgo);
    const accountId = item.card === 'credit' ? creditId : debitId;
    const accountLabel =
      item.card === 'credit' ? 'Sapphire Reserve ••4821' : 'Advantage Checking ••9042';
    const extId = `seed_tx_${i + 1}`;
    const hash = makeDedupeHash('mock_plaid', date, item.amount, item.raw, extId);
    const classified = classifyTransaction(item.raw, item.amount, item.plaidCat);

    const res = insertTx.run(
      `tx_${crypto.randomUUID().slice(0, 12)}`,
      accountId,
      accountLabel,
      item.card,
      date,
      classified.merchant,
      item.raw,
      item.amount,
      classified.category,
      classified.fruitAlias,
      extId,
      hash,
      classified.isExcluded ? 1 : 0,
      classified.excludeReason,
      now
    );
    if (res.changes > 0) count++;
  }

  // Add a charming sample Captain's Note on today & yesterday
  const upsertNote = db.prepare(
    'INSERT OR IGNORE INTO daily_notes (date, note, updated_at) VALUES (?, ?, ?)'
  );
  upsertNote.run(
    getDateOffset(0),
    'Stuck close to the daily budget target! Ramen lunch was worth every Poko.',
    now
  );
  upsertNote.run(
    getDateOffset(1),
    'Treated myself to a new game and Uniqlo jacket — need a couple lighter days to replenish rations.',
    now
  );

  logSync(
    'mock_plaid',
    'success',
    count,
    0,
    `Initialized KopPad Expedition with 2 sandbox cards and ${count} sample transactions across 10 days.`
  );

  return { seeded: true, count };
}
