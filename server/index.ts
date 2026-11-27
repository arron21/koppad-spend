import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkLoginRateLimit,
  clearFailedLogin,
  clearSessionCookie,
  createSessionToken,
  isAuthEnabled,
  isRequestAuthenticated,
  recordFailedLogin,
  requireAuthMiddleware,
  setSessionCookie,
  verifyPassword,
} from './auth.ts';
import { db, ensureDatabaseReady, getSettings, updateSettings } from './db.ts';
import { classifyTransaction, makeDedupeHash, pickFruitAlias } from './categorizer.ts';
import type { PikminCategory } from './categorizer.ts';
import { importCsv, previewCsv } from './csvImporter.ts';
import {
  createPlaidLinkToken,
  exchangeRealPlaidPublicToken,
  getPlaidStatus,
  linkMockAccount,
  sanitizeAccount,
  syncAllAccounts,
} from './plaidService.ts';
import { getSchedulerStatus, rescheduleAutoSync } from './scheduler.ts';
import { clearAllTransactionsAndAccounts, seedDemoData } from './seed.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Ensure database schema & initial seed are ready before handling API calls
app.use('/api', async (_req, res, next) => {
  try {
    await ensureDatabaseReady(async () => {
      await seedDemoData(false);
      if (!process.env.VERCEL) {
        await rescheduleAutoSync();
      }
    });
    next();
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Database initialization error',
    });
  }
});

interface TxRow {
  id: string;
  account_id: string | null;
  account_label: string;
  card_type: 'credit' | 'debit' | 'cash';
  date: string;
  merchant: string;
  raw_description: string;
  amount: number;
  category: PikminCategory;
  fruit_alias: string;
  source: string;
  external_id: string | null;
  dedupe_hash: string;
  is_excluded: number;
  exclude_reason: string | null;
  notes: string;
  created_at: string;
}

function getTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month1Based: number): number {
  return new Date(year, month1Based, 0).getDate();
}

function shiftDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function generateCaptainDebrief(params: {
  date: string;
  dayTotal: number;
  dailyTarget: number;
  purchaseCount: number;
  topPurchase: TxRow | null;
  topCategory: PikminCategory | null;
  rationsDaysRemaining: number;
  daysLeftInMonth: number;
  persona: 'auto' | 'alph' | 'brittany' | 'charlie';
}) {
  const {
    dayTotal,
    dailyTarget,
    purchaseCount,
    topPurchase,
    topCategory,
    rationsDaysRemaining,
    daysLeftInMonth,
    persona,
  } = params;

  const ratio = dailyTarget > 0 ? dayTotal / dailyTarget : 0;

  let captain: 'alph' | 'brittany' | 'charlie';
  if (persona !== 'auto') {
    captain = persona;
  } else if (purchaseCount === 0 || ratio <= 0.72) {
    captain = 'brittany';
  } else if (ratio > 1.25 || rationsDaysRemaining < daysLeftInMonth * 0.75) {
    captain = 'charlie';
  } else {
    captain = 'alph';
  }

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  let headline = '';
  let body = '';

  if (purchaseCount === 0) {
    headline = 'Zero-Spend Conservation Day!';
    body =
      captain === 'brittany'
        ? `Not a single drop of budget juice spent today! That gives the S.S. Drake ${rationsDaysRemaining.toFixed(1)} days of rations remaining. Keep it up and we'll return to Koppai with full tanks!`
        : captain === 'charlie'
          ? `Outstanding discipline out there! Zero purchases logged on the KopPad today, leaving ${rationsDaysRemaining.toFixed(1)} days of budget rations intact.`
          : `Telemetry confirms zero outflows today. Budget reserves remain steady at ${rationsDaysRemaining.toFixed(1)} days of rations.`;
  } else if (ratio <= 0.72) {
    headline = 'Rations Conserved Ahead of Schedule!';
    body = `We logged ${purchaseCount} purchase${purchaseCount === 1 ? '' : 's'} totaling ${fmt(dayTotal)} — comfortably below our ${fmt(dailyTarget)} daily target. ${
      topPurchase ? `Our biggest specimen was ${topPurchase.merchant} (${fmt(topPurchase.amount)}). ` : ''
    }We still have ${rationsDaysRemaining.toFixed(1)} days of budget juice in the hold!`;
  } else if (ratio <= 1.1) {
    headline = 'Steady Expedition Spending';
    body = `Solid day on PNF-404: ${purchaseCount} purchase${purchaseCount === 1 ? '' : 's'} came to ${fmt(dayTotal)} against a ${fmt(dailyTarget)} daily target. ${
      topPurchase ? `${topPurchase.merchant} led the tally at ${fmt(topPurchase.amount)}. ` : ''
    }Monthly juice reserves stand at ${rationsDaysRemaining.toFixed(1)} days (${daysLeftInMonth} days left in the month).`;
  } else {
    const over = dayTotal - dailyTarget;
    const catNames: Record<PikminCategory, string> = {
      dining: 'Red (Dining)',
      shopping: 'Yellow (Shopping)',
      groceries: 'Blue (Groceries)',
      bills: 'Rock (Bills & Transit)',
      leisure: 'Winged (Leisure)',
    };
    headline = 'High-Drain Expedition Alert!';
    body = `Whoa! Today's ${purchaseCount} purchases hit ${fmt(dayTotal)} (${fmt(over)} over the ${fmt(dailyTarget)} daily ration). ${
      topPurchase ? `The heaviest haul was ${topPurchase.merchant} at ${fmt(topPurchase.amount)}` : ''
    }${topCategory ? ` with ${catNames[topCategory]} leading the squad` : ''}. Keep the next couple days lean to protect our ${rationsDaysRemaining.toFixed(1)} remaining days of juice!`;
  }

  const titles: Record<'alph' | 'brittany' | 'charlie', { name: string; role: string }> = {
    alph: { name: 'Alph', role: 'Lead Engineer' },
    brittany: { name: 'Brittany', role: 'Botanist & Rations Chief' },
    charlie: { name: 'Captain Charlie', role: 'Expedition Commander' },
  };

  return {
    captain,
    captainName: titles[captain].name,
    captainRole: titles[captain].role,
    headline,
    body,
  };
}

// ======================================================
// PUBLIC ROUTES (Health, Auth, Cron, Plaid Webhook)
// ======================================================
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    today: getTodayIso(),
    authEnabled: isAuthEnabled(),
    dbBackend: db.backend,
    plaidEnv: (process.env.PLAID_ENV || 'sandbox').trim().toLowerCase(),
    plaidConfigured: Boolean(
      process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim()
    ),
  });
});

app.post('/api/plaid/webhook', async (req, res) => {
  const code = req.body?.webhook_code;
  if (
    code === 'SYNC_UPDATES_AVAILABLE' ||
    code === 'DEFAULT_UPDATE' ||
    code === 'INITIAL_UPDATE' ||
    code === 'HISTORICAL_UPDATE'
  ) {
    try {
      await syncAllAccounts({ simulateMockPurchase: false, triggerSource: 'plaid_webhook' });
    } catch {
      // Acknowledge webhook cleanly even if transient sync error occurs
    }
  }
  res.json({ received: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    authEnabled: isAuthEnabled(),
    authenticated: isRequestAuthenticated(req),
    dbBackend: db.backend,
  });
});

app.post('/api/auth/login', (req, res) => {
  const ip =
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : req.socket.remoteAddress) || 'unknown';

  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    res.status(429).json({
      error: `Too many failed attempts. Try again in ${limit.retryAfterSec}s.`,
    });
    return;
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!verifyPassword(password)) {
    recordFailedLogin(ip);
    res.status(401).json({ error: 'Invalid KopPad security passcode.' });
    return;
  }

  clearFailedLogin(ip);
  const token = createSessionToken();
  setSessionCookie(res, token);
  res.json({ ok: true, authenticated: true });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true, authenticated: false });
});

// Vercel Cron endpoint for scheduled Sunset Sync (authenticates via CRON_SECRET)
app.get('/api/cron/sunset-sync', async (req, res) => {
  const secret = process.env.CRON_SECRET?.trim();
  const isVercelCronHeader = req.headers['x-vercel-cron'] === '1';
  if (secret) {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized cron trigger' });
      return;
    }
  } else if (isAuthEnabled() && !isVercelCronHeader && !isRequestAuthenticated(req)) {
    res.status(401).json({ error: 'Unauthorized cron trigger' });
    return;
  }

  try {
    const result = await syncAllAccounts({
      simulateMockPurchase: false,
      triggerSource: 'vercel_cron',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Scheduled Sunset Sync failed',
    });
  }
});

// ======================================================
// PROTECTED KOPPAD API ROUTES
// ======================================================
app.use('/api', requireAuthMiddleware);

// List days with spending summaries for a given month (YYYY-MM)
app.get('/api/days', async (req, res) => {
  const today = getTodayIso();
  const monthParam =
    typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : today.slice(0, 7);

  const [year, month] = monthParam.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, month);
  const startDate = `${monthParam}-01`;
  const endDate = `${monthParam}-${String(daysInMonth).padStart(2, '0')}`;

  const rows = await db.all<{
    date: string;
    purchaseCount: number | string;
    totalSpent: number | string;
  }>(
    `SELECT date,
            COUNT(*) as "purchaseCount",
            SUM(amount) as "totalSpent"
     FROM transactions
     WHERE date >= ? AND date <= ? AND is_excluded = 0
     GROUP BY date
     ORDER BY date ASC`,
    [startDate, endDate]
  );

  const hiddenRows = await db.all<{ date: string; hiddenCount: number | string }>(
    `SELECT date, COUNT(*) as "hiddenCount"
     FROM transactions
     WHERE date >= ? AND date <= ? AND is_excluded = 1
     GROUP BY date`,
    [startDate, endDate]
  );

  const hiddenMap = new Map(hiddenRows.map((r) => [r.date, Number(r.hiddenCount)]));
  const spentMap = new Map(rows.map((r) => [r.date, r]));

  const settings = await getSettings();
  const dailyTarget = settings.dailyTargetOverride ?? settings.monthlyBudget / daysInMonth;

  const days = [];
  let monthTotal = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${monthParam}-${String(d).padStart(2, '0')}`;
    const info = spentMap.get(iso);
    const totalSpent = info ? Number(info.totalSpent) : 0;
    monthTotal += totalSpent;
    days.push({
      date: iso,
      dayNumber: d,
      purchaseCount: info ? Number(info.purchaseCount) : 0,
      hiddenCount: hiddenMap.get(iso) ?? 0,
      totalSpent: Math.round(totalSpent * 100) / 100,
      isToday: iso === today,
      isFuture: iso > today,
    });
  }

  res.json({
    month: monthParam,
    today,
    daysInMonth,
    monthlyBudget: settings.monthlyBudget,
    dailyTarget: Math.round(dailyTarget * 100) / 100,
    monthTotal: Math.round(monthTotal * 100) / 100,
    days,
  });
});

// Full Pikmin 3 Day-End Report for a specific date
app.get('/api/day/:date', async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    return;
  }

  const [year, month, dayOfMonth] = date.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, month);
  const monthPrefix = date.slice(0, 7);
  const monthStart = `${monthPrefix}-01`;

  const rawRows = await db.all<TxRow>(
    `SELECT * FROM transactions WHERE date = ? ORDER BY created_at ASC, id ASC`,
    [date]
  );
  const allDayRows = rawRows.map((r) => ({
    ...r,
    amount: Number(r.amount),
    is_excluded: Number(r.is_excluded),
  }));

  const purchases = allDayRows.filter((t) => t.is_excluded === 0);
  const excluded = allDayRows.filter((t) => t.is_excluded === 1);

  const dayTotal = Math.round(purchases.reduce((acc, tx) => acc + tx.amount, 0) * 100) / 100;

  const categories: Record<PikminCategory, { total: number; count: number }> = {
    dining: { total: 0, count: 0 },
    shopping: { total: 0, count: 0 },
    groceries: { total: 0, count: 0 },
    bills: { total: 0, count: 0 },
    leisure: { total: 0, count: 0 },
  };

  let topPurchase: TxRow | null = null;
  for (const tx of purchases) {
    categories[tx.category].total =
      Math.round((categories[tx.category].total + tx.amount) * 100) / 100;
    categories[tx.category].count += 1;
    if (!topPurchase || tx.amount > topPurchase.amount) {
      topPurchase = tx;
    }
  }

  let topCategory: PikminCategory | null = null;
  let topCatVal = 0;
  for (const [cat, stats] of Object.entries(categories) as Array<
    [PikminCategory, { total: number; count: number }]
  >) {
    if (stats.total > topCatVal) {
      topCatVal = stats.total;
      topCategory = cat;
    }
  }

  const monthSumRow = await db.get<{ total: number | string }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE date >= ? AND date <= ? AND is_excluded = 0`,
    [monthStart, date]
  );
  const monthSpentToDate = Math.round(Number(monthSumRow?.total ?? 0) * 100) / 100;

  const settings = await getSettings();
  const dailyTarget =
    Math.round((settings.dailyTargetOverride ?? settings.monthlyBudget / daysInMonth) * 100) / 100;
  const monthRemainingDollars = Math.max(
    0,
    Math.round((settings.monthlyBudget - monthSpentToDate) * 100) / 100
  );
  const daysLeftInMonth = Math.max(0, daysInMonth - dayOfMonth);
  const rationsDaysRemaining =
    dailyTarget > 0 ? Math.round((monthRemainingDollars / dailyTarget) * 10) / 10 : 0;

  const spentBeforeToday = Math.max(0, monthSpentToDate - dayTotal);
  const remainingBeforeToday = Math.max(0, settings.monthlyBudget - spentBeforeToday);
  const rationsBeforeToday =
    dailyTarget > 0 ? Math.round((remainingBeforeToday / dailyTarget) * 10) / 10 : 0;

  let rationStatus: 'abundant' | 'healthy' | 'caution' | 'critical' = 'healthy';
  if (monthSpentToDate > settings.monthlyBudget || dayTotal > dailyTarget * 1.8) {
    rationStatus = 'critical';
  } else if (dayTotal > dailyTarget * 1.08 || rationsDaysRemaining < daysLeftInMonth * 0.75) {
    rationStatus = 'caution';
  } else if (dayTotal <= dailyTarget * 0.75 && rationsDaysRemaining >= daysLeftInMonth) {
    rationStatus = 'abundant';
  }

  const trendStart = shiftDate(date, -13);
  const trendRows = await db.all<{
    date: string;
    category: PikminCategory;
    total: number | string;
  }>(
    `SELECT date, category, SUM(amount) as total
     FROM transactions
     WHERE date >= ? AND date <= ? AND is_excluded = 0
     GROUP BY date, category
     ORDER BY date ASC`,
    [trendStart, date]
  );

  const trendByDate = new Map<
    string,
    {
      date: string;
      dayLabel: string;
      total: number;
      dining: number;
      shopping: number;
      groceries: number;
      bills: number;
      leisure: number;
    }
  >();

  for (let offset = -13; offset <= 0; offset++) {
    const dStr = shiftDate(date, offset);
    const [, mm, dd] = dStr.split('-');
    trendByDate.set(dStr, {
      date: dStr,
      dayLabel: `${Number(mm)}/${Number(dd)}`,
      total: 0,
      dining: 0,
      shopping: 0,
      groceries: 0,
      bills: 0,
      leisure: 0,
    });
  }

  for (const r of trendRows) {
    const entry = trendByDate.get(r.date);
    if (entry) {
      entry[r.category] = Math.round((entry[r.category] + Number(r.total)) * 100) / 100;
      entry.total = Math.round((entry.total + Number(r.total)) * 100) / 100;
    }
  }

  const noteRow = await db.get<{ note: string; updated_at: string }>(
    'SELECT note, updated_at FROM daily_notes WHERE date = ?',
    [date]
  );

  const debrief = generateCaptainDebrief({
    date,
    dayTotal,
    dailyTarget,
    purchaseCount: purchases.length,
    topPurchase,
    topCategory,
    rationsDaysRemaining,
    daysLeftInMonth,
    persona: settings.captainPersona,
  });

  const creditTotal =
    Math.round(
      purchases.filter((t) => t.card_type === 'credit').reduce((a, b) => a + b.amount, 0) * 100
    ) / 100;
  const debitTotal =
    Math.round(
      purchases.filter((t) => t.card_type === 'debit').reduce((a, b) => a + b.amount, 0) * 100
    ) / 100;
  const cashTotal =
    Math.round(
      purchases.filter((t) => t.card_type === 'cash').reduce((a, b) => a + b.amount, 0) * 100
    ) / 100;

  res.json({
    date,
    dayOfMonth,
    daysInMonth,
    daysLeftInMonth,
    purchases,
    excluded,
    summary: {
      dayTotal,
      purchaseCount: purchases.length,
      excludedCount: excluded.length,
      creditTotal,
      debitTotal,
      cashTotal,
      dailyTarget,
      monthlyBudget: settings.monthlyBudget,
      monthSpentToDate,
      monthRemainingDollars,
      rationsDaysRemaining,
      rationsBeforeToday,
      rationStatus,
    },
    categories,
    trend: Array.from(trendByDate.values()),
    debrief,
    note: noteRow?.note ?? '',
  });
});

// Save daily Captain's note
app.put('/api/day/:date/note', async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Invalid date' });
    return;
  }
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 1000) : '';
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO daily_notes (date, note, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
    [date, note, now]
  );
  res.json({ date, note, updatedAt: now });
});

// Manual quick-add purchase
app.post('/api/transactions', async (req, res) => {
  const { date, merchant, amount, category, cardType, accountLabel, notes } = req.body ?? {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'Valid YYYY-MM-DD date is required.' });
    return;
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) {
    res.status(400).json({ error: 'A valid non-zero dollar amount is required.' });
    return;
  }
  const cleanMerchant = String(merchant || '').trim();
  if (!cleanMerchant) {
    res.status(400).json({ error: 'Merchant or purchase name is required.' });
    return;
  }

  const validCategories: PikminCategory[] = ['dining', 'shopping', 'groceries', 'bills', 'leisure'];
  const classified = classifyTransaction(cleanMerchant, parsedAmount);
  const finalCategory: PikminCategory = validCategories.includes(category)
    ? category
    : classified.category;
  const finalCardType: 'credit' | 'debit' | 'cash' =
    cardType === 'debit' || cardType === 'cash' ? cardType : 'credit';
  const finalLabel =
    typeof accountLabel === 'string' && accountLabel.trim()
      ? accountLabel.trim()
      : finalCardType === 'debit'
        ? 'Manual Debit Card'
        : finalCardType === 'cash'
          ? 'Cash / Pokos'
          : 'Manual Credit Card';

  const id = `tx_${crypto.randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const roundedAmount = Math.round(parsedAmount * 100) / 100;
  const dedupeHash = makeDedupeHash('manual', date, roundedAmount, cleanMerchant, id);
  const fruitAlias = pickFruitAlias(finalCategory, `${cleanMerchant}:${id}`);

  await db.run(
    `INSERT INTO transactions (
      id, account_id, account_label, card_type, date, merchant, raw_description,
      amount, category, fruit_alias, source, external_id, dedupe_hash,
      is_excluded, exclude_reason, notes, created_at
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?, 0, NULL, ?, ?)`,
    [
      id,
      finalLabel,
      finalCardType,
      date,
      cleanMerchant,
      cleanMerchant,
      roundedAmount,
      finalCategory,
      fruitAlias,
      dedupeHash,
      typeof notes === 'string' ? notes.slice(0, 300) : '',
      now,
    ]
  );

  const created = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
  res.status(201).json(created);
});

// Edit a transaction
app.patch('/api/transactions/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await db.get<TxRow>('SELECT * FROM transactions WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  const validCategories: PikminCategory[] = ['dining', 'shopping', 'groceries', 'bills', 'leisure'];
  const nextMerchant =
    typeof req.body?.merchant === 'string' && req.body.merchant.trim()
      ? req.body.merchant.trim().slice(0, 80)
      : existing.merchant;
  const nextAmount =
    req.body?.amount !== undefined && Number.isFinite(Number(req.body.amount))
      ? Math.round(Number(req.body.amount) * 100) / 100
      : Number(existing.amount);
  const nextCategory: PikminCategory = validCategories.includes(req.body?.category)
    ? req.body.category
    : existing.category;
  const nextDate =
    typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
      ? req.body.date
      : existing.date;
  const nextNotes =
    typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 300) : existing.notes;
  const nextExcluded =
    req.body?.is_excluded !== undefined
      ? req.body.is_excluded
        ? 1
        : 0
      : Number(existing.is_excluded);
  const nextReason =
    req.body?.is_excluded !== undefined
      ? nextExcluded
        ? existing.exclude_reason || 'manual'
        : null
      : existing.exclude_reason;
  const nextFruitAlias =
    nextCategory !== existing.category
      ? pickFruitAlias(nextCategory, `${nextMerchant}:${id}`)
      : existing.fruit_alias;

  await db.run(
    `UPDATE transactions
     SET merchant = ?, amount = ?, category = ?, fruit_alias = ?, date = ?,
         notes = ?, is_excluded = ?, exclude_reason = ?
     WHERE id = ?`,
    [
      nextMerchant,
      nextAmount,
      nextCategory,
      nextFruitAlias,
      nextDate,
      nextNotes,
      nextExcluded,
      nextReason,
      id,
    ]
  );

  const updated = await db.get('SELECT * FROM transactions WHERE id = ?', [id]);
  res.json(updated);
});

// Delete a transaction
app.delete('/api/transactions/:id', async (req, res) => {
  const result = await db.run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }
  res.json({ deleted: true });
});

// CSV Preview
app.post('/api/csv/preview', upload.single('file'), async (req, res) => {
  try {
    const csvText = req.file
      ? req.file.buffer.toString('utf8')
      : typeof req.body?.csvText === 'string'
        ? req.body.csvText
        : '';

    if (!csvText.trim()) {
      res.status(400).json({ error: 'CSV content is empty.' });
      return;
    }

    const accountLabel =
      typeof req.body?.accountLabel === 'string' ? req.body.accountLabel : 'Uploaded Card CSV';
    const mapping =
      typeof req.body?.mapping === 'string'
        ? JSON.parse(req.body.mapping)
        : req.body?.mapping || undefined;

    const preview = await previewCsv(csvText, accountLabel, mapping);
    res.json(preview);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to parse CSV file.',
    });
  }
});

// CSV Import
app.post('/api/csv/import', upload.single('file'), async (req, res) => {
  try {
    const csvText = req.file
      ? req.file.buffer.toString('utf8')
      : typeof req.body?.csvText === 'string'
        ? req.body.csvText
        : '';

    if (!csvText.trim()) {
      res.status(400).json({ error: 'CSV content is empty.' });
      return;
    }

    const accountLabel =
      typeof req.body?.accountLabel === 'string' && req.body.accountLabel.trim()
        ? req.body.accountLabel.trim()
        : 'Uploaded Card CSV';
    const cardType: 'credit' | 'debit' = req.body?.cardType === 'debit' ? 'debit' : 'credit';
    const mapping =
      typeof req.body?.mapping === 'string'
        ? JSON.parse(req.body.mapping)
        : req.body?.mapping || undefined;

    const result = await importCsv(csvText, { accountLabel, cardType, mapping });
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to import CSV file.',
    });
  }
});

// Accounts management
app.get('/api/accounts', async (_req, res) => {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT a.*,
            (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id AND t.is_excluded = 0) as tx_count
     FROM accounts a
     ORDER BY a.created_at DESC`
  );
  res.json(
    rows.map((r) => ({
      ...sanitizeAccount(r),
      tx_count: Number(r.tx_count ?? 0),
    }))
  );
});

app.delete('/api/accounts/:id', async (req, res) => {
  const { id } = req.params;
  const deleteTxs = req.query.deleteTransactions === 'true';
  if (deleteTxs) {
    await db.run('DELETE FROM transactions WHERE account_id = ?', [id]);
  }
  const result = await db.run('DELETE FROM accounts WHERE id = ?', [id]);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json({ disconnected: true });
});

// Plaid & Local Sandbox Bank Sync endpoints
app.get('/api/plaid/status', async (_req, res) => {
  const [status, scheduler] = await Promise.all([getPlaidStatus(), getSchedulerStatus()]);
  res.json({
    ...status,
    scheduler,
  });
});

app.post('/api/plaid/link-token', async (req, res) => {
  try {
    const origin =
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const result = await createPlaidLinkToken(origin);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unable to create Plaid Link token',
    });
  }
});

app.post('/api/plaid/exchange', async (req, res) => {
  try {
    const { publicToken, institutionName, mockPresetId } = req.body ?? {};
    if (mockPresetId) {
      const result = await linkMockAccount(String(mockPresetId));
      res.json(result);
      return;
    }
    if (!publicToken) {
      res.status(400).json({ error: 'Either publicToken or mockPresetId is required.' });
      return;
    }
    const result = await exchangeRealPlaidPublicToken(String(publicToken), institutionName);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unable to link bank account',
    });
  }
});

app.post('/api/plaid/sync', async (req, res) => {
  try {
    const simulateMockPurchase = Boolean(req.body?.simulateNewPurchase);
    const result = await syncAllAccounts({
      simulateMockPurchase,
      triggerSource: 'manual_sync',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Sync failed',
    });
  }
});

// Settings & Sunset Sync scheduler
app.get('/api/settings', async (_req, res) => {
  const [settings, scheduler] = await Promise.all([getSettings(), getSchedulerStatus()]);
  res.json({
    ...settings,
    scheduler,
  });
});

app.put('/api/settings', async (req, res) => {
  const updated = await updateSettings({
    monthlyBudget:
      req.body?.monthlyBudget !== undefined ? Number(req.body.monthlyBudget) : undefined,
    dailyTargetOverride:
      req.body?.dailyTargetOverride === null || req.body?.dailyTargetOverride === ''
        ? null
        : req.body?.dailyTargetOverride !== undefined
          ? Number(req.body.dailyTargetOverride)
          : undefined,
    syncMode: req.body?.syncMode,
    sunsetSyncTime: req.body?.sunsetSyncTime,
    captainPersona: req.body?.captainPersona,
  });
  const scheduler = await rescheduleAutoSync();
  res.json({ ...updated, scheduler });
});

// Reset demo expedition data OR wipe all data cleanly for personal start
app.post('/api/demo/reset', async (req, res) => {
  if (req.body?.clearOnly) {
    await clearAllTransactionsAndAccounts();
    res.json({ cleared: true, count: 0 });
    return;
  }
  const result = await seedDemoData(true);
  res.json(result);
});

// Serve built client in production (non-Vercel self-hosted mode)
const clientDist = path.resolve(__dirname, '..', 'dist');
if (!process.env.VERCEL && process.env.NODE_ENV === 'production' && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT) || 3001;
  ensureDatabaseReady(async () => {
    await seedDemoData(false);
    await rescheduleAutoSync();
  })
    .then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`KopPad Spend API listening on http://localhost:${PORT} (${db.backend})`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize KopPad database:', err);
      process.exit(1);
    });
}

export default app;
