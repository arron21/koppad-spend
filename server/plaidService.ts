import crypto from 'node:crypto';
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
} from 'plaid';
import { db, logSync } from './db.ts';
import { decryptSensitiveToken, encryptSensitiveToken } from './auth.ts';
import { classifyTransaction, makeDedupeHash } from './categorizer.ts';

export interface MockBankPreset {
  id: string;
  institution: string;
  name: string;
  mask: string;
  type: 'credit' | 'debit';
  accent: string;
  description: string;
}

export const MOCK_BANK_PRESETS: MockBankPreset[] = [
  {
    id: 'chase_sapphire',
    institution: 'Chase',
    name: 'Sapphire Reserve',
    mask: '4821',
    type: 'credit',
    accent: '#38bdf8',
    description: 'Travel & dining credit card (Plaid Sandbox simulator)',
  },
  {
    id: 'bofa_debit',
    institution: 'Bank of America',
    name: 'Advantage Checking Debit',
    mask: '9042',
    type: 'debit',
    accent: '#ef4444',
    description: 'Primary debit checking card (Plaid Sandbox simulator)',
  },
  {
    id: 'amex_blue',
    institution: 'American Express',
    name: 'Blue Cash Everyday',
    mask: '1008',
    type: 'credit',
    accent: '#facc15',
    description: 'Groceries & online shopping card (Plaid Sandbox simulator)',
  },
  {
    id: 'capone_venture',
    institution: 'Capital One',
    name: 'Venture X Rewards',
    mask: '7319',
    type: 'credit',
    accent: '#f472b6',
    description: 'Everyday flat-rate rewards credit card (Plaid Sandbox simulator)',
  },
  {
    id: 'schwab_debit',
    institution: 'Charles Schwab',
    name: 'High Yield Investor Debit',
    mask: '5510',
    type: 'debit',
    accent: '#94a3b8',
    description: 'Fee-free ATM & everyday debit card (Plaid Sandbox simulator)',
  },
];

const SIMULATED_MERCHANTS: Array<{
  raw: string;
  min: number;
  max: number;
  plaidCat: string;
}> = [
  { raw: 'BLUE BOTTLE COFFEE #14', min: 5.5, max: 11.25, plaidCat: 'FOOD_AND_DRINK' },
  { raw: 'TRADER JOES #204', min: 18.4, max: 54.9, plaidCat: 'GROCERIES' },
  { raw: 'TST* MARUFUKU RAMEN', min: 19.5, max: 36.8, plaidCat: 'FOOD_AND_DRINK' },
  { raw: 'AMAZON.COM*MK84P2', min: 14.99, max: 62.5, plaidCat: 'GENERAL_MERCHANDISE' },
  { raw: 'SWEETGREEN SALAD BAR', min: 14.25, max: 21.5, plaidCat: 'FOOD_AND_DRINK' },
  { raw: 'NINTENDO ESHOP US', min: 9.99, max: 59.99, plaidCat: 'ENTERTAINMENT' },
  { raw: 'SHELL OIL 57442', min: 28.0, max: 52.0, plaidCat: 'TRANSPORTATION' },
  { raw: 'TARGET 00018244', min: 12.75, max: 48.2, plaidCat: 'GENERAL_MERCHANDISE' },
  { raw: 'UNIQLO USA ONLINE', min: 24.9, max: 59.9, plaidCat: 'GENERAL_MERCHANDISE' },
  { raw: 'AMC THEATRES ONLINE', min: 16.5, max: 32.0, plaidCat: 'ENTERTAINMENT' },
  { raw: 'WHOLE FOODS MARKET', min: 15.2, max: 46.8, plaidCat: 'GROCERIES' },
  { raw: 'UBER *TRIP HELP.UBER.COM', min: 11.4, max: 29.8, plaidCat: 'TRANSPORTATION' },
  { raw: 'BOBA GUYS SAN FRANCISCO', min: 6.75, max: 13.5, plaidCat: 'FOOD_AND_DRINK' },
  { raw: 'MUJI STATIONERY STORE', min: 8.5, max: 27.4, plaidCat: 'GENERAL_MERCHANDISE' },
];

export function isRealPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim());
}

function getPlaidClient(): PlaidApi | null {
  if (!isRealPlaidConfigured()) return null;
  const envName = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
  const basePath =
    envName === 'production'
      ? PlaidEnvironments.production
      : envName === 'development'
        ? PlaidEnvironments.development
        : PlaidEnvironments.sandbox;

  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID!.trim(),
        'PLAID-SECRET': process.env.PLAID_SECRET!.trim(),
      },
    },
  });
  return new PlaidApi(config);
}

export async function getPlaidStatus() {
  const realConfigured = isRealPlaidConfigured();
  const recentLogs = await db.all(
    'SELECT id, source, status, added_count, skipped_count, message, created_at FROM sync_logs ORDER BY id DESC LIMIT 12'
  );

  return {
    mode: realConfigured ? 'plaid_live' : 'local_sandbox',
    plaidEnv: process.env.PLAID_ENV || 'sandbox',
    realConfigured,
    dbBackend: db.backend,
    mockPresets: MOCK_BANK_PRESETS,
    recentLogs,
  };
}

export async function createPlaidLinkToken(originUrl?: string): Promise<{
  linkToken: string;
  mode: 'plaid_live' | 'local_sandbox';
  plaidEnv: string;
}> {
  const plaidEnv = (process.env.PLAID_ENV || 'sandbox').toLowerCase();
  const client = getPlaidClient();
  if (!client) {
    return {
      linkToken: `mock-link-sandbox-${crypto.randomUUID()}`,
      mode: 'local_sandbox',
      plaidEnv,
    };
  }

  const webhookUrl =
    process.env.PLAID_WEBHOOK_URL?.trim() ||
    (originUrl && originUrl.startsWith('https://') ? `${originUrl}/api/plaid/webhook` : undefined);
  const redirectUri = process.env.PLAID_REDIRECT_URI?.trim() || undefined;

  const response = await client.linkTokenCreate({
    user: { client_user_id: 'koppad-captain-local' },
    client_name: 'KopPad Ledger',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
    ...(redirectUri ? { redirect_uri: redirectUri } : {}),
  });

  return {
    linkToken: response.data.link_token,
    mode: 'plaid_live',
    plaidEnv,
  };
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function randomAmount(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

export async function linkMockAccount(presetId: string): Promise<{
  account: Record<string, unknown>;
  addedTransactions: number;
}> {
  const preset = MOCK_BANK_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error(`Unknown mock card preset: ${presetId}`);
  }

  const existing = await db.get<Record<string, unknown>>(
    "SELECT * FROM accounts WHERE source = 'mock_plaid' AND plaid_item_id = ?",
    [`mock_item_${preset.id}`]
  );

  if (existing) {
    return {
      account: sanitizeAccount(existing),
      addedTransactions: 0,
    };
  }

  const now = new Date().toISOString();
  const accountId = `acc_${crypto.randomUUID().slice(0, 10)}`;
  await db.run(
    `INSERT INTO accounts (
      id, name, institution, mask, type, source, plaid_item_id, plaid_access_token,
      plaid_account_id, sync_cursor, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'mock_plaid', ?, ?, ?, 'mock_cursor_1', ?, ?)`,
    [
      accountId,
      preset.name,
      preset.institution,
      preset.mask,
      preset.type,
      `mock_item_${preset.id}`,
      encryptSensitiveToken(`mock-access-${preset.id}`),
      `mock_acct_${preset.id}`,
      now,
      now,
    ]
  );

  const addedTransactions = await generateMockTransactionsForAccount(
    accountId,
    `${preset.name} ••${preset.mask}`,
    preset.type,
    4,
    3
  );

  await logSync(
    'mock_plaid',
    'success',
    addedTransactions,
    0,
    `Linked ${preset.institution} ${preset.name} (••${preset.mask}) via Local Sandbox and synced ${addedTransactions} purchases.`
  );

  const created = (await db.get<Record<string, unknown>>(
    'SELECT * FROM accounts WHERE id = ?',
    [accountId]
  ))!;
  return { account: sanitizeAccount(created), addedTransactions };
}

export async function exchangeRealPlaidPublicToken(
  publicToken: string,
  institutionName?: string
): Promise<{
  accounts: Record<string, unknown>[];
  addedTransactions: number;
}> {
  const client = getPlaidClient();
  if (!client) {
    throw new Error('Plaid credentials are not configured in environment variables.');
  }

  const exchangeRes = await client.itemPublicTokenExchange({ public_token: publicToken });
  const encryptedAccessToken = encryptSensitiveToken(exchangeRes.data.access_token);
  const itemId = exchangeRes.data.item_id;

  const accountsRes = await client.accountsGet({ access_token: exchangeRes.data.access_token });
  const now = new Date().toISOString();
  const createdAccounts: Record<string, unknown>[] = [];

  for (const acct of accountsRes.data.accounts) {
    const isCredit = acct.type === 'credit';
    const isDebit =
      acct.type === 'depository' && (acct.subtype === 'checking' || acct.subtype === 'savings');
    if (!isCredit && !isDebit) continue;

    const id = `plaid_${crypto.randomUUID().slice(0, 10)}`;
    await db.run(
      `INSERT INTO accounts (
        id, name, institution, mask, type, source, plaid_item_id, plaid_access_token,
        plaid_account_id, sync_cursor, last_synced_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'plaid', ?, ?, ?, NULL, ?, ?)`,
      [
        id,
        acct.name || acct.official_name || 'Connected Card',
        institutionName || 'Plaid Institution',
        acct.mask || '',
        isCredit ? 'credit' : 'debit',
        itemId,
        encryptedAccessToken,
        acct.account_id,
        now,
        now,
      ]
    );

    const row = (await db.get<Record<string, unknown>>(
      'SELECT * FROM accounts WHERE id = ?',
      [id]
    ))!;
    createdAccounts.push(sanitizeAccount(row));
  }

  const syncResult = await syncAllAccounts({ simulateMockPurchase: false, triggerSource: 'plaid' });
  return {
    accounts: createdAccounts,
    addedTransactions: syncResult.addedCount,
  };
}

async function generateMockTransactionsForAccount(
  accountId: string,
  accountLabel: string,
  cardType: 'credit' | 'debit',
  count: number,
  spreadDays: number
): Promise<number> {
  const insertSql = `
    INSERT INTO transactions (
      id, account_id, account_label, card_type, date, merchant, raw_description,
      amount, category, fruit_alias, source, external_id, dedupe_hash,
      is_excluded, exclude_reason, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mock_plaid', ?, ?, ?, ?, '', ?)
    ON CONFLICT (dedupe_hash) DO NOTHING
  `;

  const now = new Date();
  let added = 0;

  for (let i = 0; i < count; i++) {
    const pick = SIMULATED_MERCHANTS[Math.floor(Math.random() * SIMULATED_MERCHANTS.length)];
    const dayOffset = spreadDays === 0 ? 0 : Math.floor(Math.random() * (spreadDays + 1));
    const txDate = new Date(now);
    txDate.setDate(now.getDate() - dayOffset);
    const dateStr = formatLocalDate(txDate);
    const amount = randomAmount(pick.min, pick.max);
    const extId = `mock_tx_${crypto.randomUUID().slice(0, 12)}`;
    const hash = makeDedupeHash('mock_plaid', dateStr, amount, pick.raw, extId);
    const classified = classifyTransaction(pick.raw, amount, pick.plaidCat);

    const res = await db.run(insertSql, [
      `tx_${crypto.randomUUID().slice(0, 12)}`,
      accountId,
      accountLabel,
      cardType,
      dateStr,
      classified.merchant,
      pick.raw,
      amount,
      classified.category,
      classified.fruitAlias,
      extId,
      hash,
      classified.isExcluded ? 1 : 0,
      classified.excludeReason,
      now.toISOString(),
    ]);
    if (res.changes > 0) added++;
  }

  return added;
}

export async function syncAllAccounts(options?: {
  simulateMockPurchase?: boolean;
  triggerSource?: string;
}): Promise<{
  addedCount: number;
  skippedCount: number;
  syncedAccounts: number;
  message: string;
}> {
  const accounts = await db.all<{
    id: string;
    name: string;
    institution: string;
    mask: string;
    type: 'credit' | 'debit';
    source: 'plaid' | 'mock_plaid';
    plaid_item_id: string | null;
    plaid_access_token: string | null;
    plaid_account_id: string | null;
    sync_cursor: string | null;
  }>("SELECT * FROM accounts WHERE source IN ('plaid', 'mock_plaid')");

  if (accounts.length === 0) {
    return {
      addedCount: 0,
      skippedCount: 0,
      syncedAccounts: 0,
      message: 'No linked credit or debit cards yet. Connect a card or upload a CSV first.',
    };
  }

  let totalAdded = 0;
  let totalSkipped = 0;
  const now = new Date().toISOString();

  const plaidClient = getPlaidClient();
  const realAccounts = accounts.filter((a) => a.source === 'plaid' && a.plaid_access_token);
  const byItem = new Map<string, typeof realAccounts>();
  for (const a of realAccounts) {
    const key = a.plaid_item_id || a.id;
    const list = byItem.get(key) ?? [];
    list.push(a);
    byItem.set(key, list);
  }

  if (plaidClient) {
    const insertSql = `
      INSERT INTO transactions (
        id, account_id, account_label, card_type, date, merchant, raw_description,
        amount, category, fruit_alias, source, external_id, dedupe_hash,
        is_excluded, exclude_reason, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plaid', ?, ?, ?, ?, '', ?)
      ON CONFLICT (dedupe_hash) DO NOTHING
    `;

    for (const [, itemAccounts] of byItem) {
      const primary = itemAccounts[0];
      let cursor = primary.sync_cursor ?? undefined;
      let hasMore = true;

      try {
        const plainToken = decryptSensitiveToken(primary.plaid_access_token);
        if (!plainToken) continue;

        while (hasMore) {
          const res = await plaidClient.transactionsSync({
            access_token: plainToken,
            cursor,
          });
          const data = res.data;

          for (const tx of data.added) {
            const matchedAcct =
              itemAccounts.find((a) => a.plaid_account_id === tx.account_id) ?? primary;
            const label = matchedAcct.mask
              ? `${matchedAcct.name} ••${matchedAcct.mask}`
              : matchedAcct.name;
            const rawDesc = tx.merchant_name || tx.name;
            const roundedAmount = Math.round(tx.amount * 100) / 100;
            const hash = makeDedupeHash('plaid', tx.date, roundedAmount, rawDesc, tx.transaction_id);
            const classified = classifyTransaction(
              rawDesc,
              roundedAmount,
              tx.personal_finance_category?.primary ?? tx.category?.[0] ?? null
            );

            const inserted = await db.run(insertSql, [
              `tx_${crypto.randomUUID().slice(0, 12)}`,
              matchedAcct.id,
              label,
              matchedAcct.type,
              tx.date,
              classified.merchant,
              rawDesc,
              roundedAmount,
              classified.category,
              classified.fruitAlias,
              tx.transaction_id,
              hash,
              classified.isExcluded ? 1 : 0,
              classified.excludeReason,
              now,
            ]);
            if (inserted.changes > 0) totalAdded++;
            else totalSkipped++;
          }

          cursor = data.next_cursor;
          hasMore = data.has_more;
        }

        for (const a of itemAccounts) {
          await db.run('UPDATE accounts SET sync_cursor = ?, last_synced_at = ? WHERE id = ?', [
            cursor ?? null,
            now,
            a.id,
          ]);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Plaid sync failed';
        await logSync('plaid', 'error', 0, 0, `Plaid sync error for ${primary.institution}: ${msg}`);
      }
    }
  }

  const mockAccounts = accounts.filter((a) => a.source === 'mock_plaid');
  for (const acct of mockAccounts) {
    await db.run('UPDATE accounts SET last_synced_at = ? WHERE id = ?', [now, acct.id]);
  }
  if (mockAccounts.length > 0 && options?.simulateMockPurchase) {
    const chosen = mockAccounts[Math.floor(Math.random() * mockAccounts.length)];
    const label = chosen.mask ? `${chosen.name} ••${chosen.mask}` : chosen.name;
    const added = await generateMockTransactionsForAccount(chosen.id, label, chosen.type, 1, 0);
    totalAdded += added;
  }

  const trigger = options?.triggerSource || (plaidClient ? 'plaid' : 'mock_plaid');
  const message =
    totalAdded > 0
      ? `Synced ${accounts.length} card(s): +${totalAdded} new transaction${totalAdded === 1 ? '' : 's'} discovered.`
      : `Synced ${accounts.length} card(s): all transactions are up to date.`;

  await logSync(trigger, 'success', totalAdded, totalSkipped, message);

  return {
    addedCount: totalAdded,
    skippedCount: totalSkipped,
    syncedAccounts: accounts.length,
    message,
  };
}

export function sanitizeAccount(row: Record<string, unknown>): Record<string, unknown> {
  const { plaid_access_token: _secret, ...safe } = row;
  return safe;
}
