import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.VERCEL
  ? path.join('/tmp', 'koppad-data')
  : path.resolve(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export interface StatementLike {
  run: (...params: unknown[]) => { changes: number };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

export interface DbLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => StatementLike;
}

// Use Node's built-in node:sqlite when running locally on Node 22.5+, and gracefully
// fall back to a fast JSON-backed adapter on serverless Node runtimes (e.g. Vercel Node 20/22.0)
// where node:sqlite is not enabled.
interface JsonStore {
  accounts: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  daily_notes: Array<Record<string, unknown>>;
  settings: Array<{ key: string; value: string }>;
  sync_logs: Array<Record<string, unknown>>;
  nextLogId: number;
}

class JsonStoreAdapter implements DbLike {
  private filePath: string;
  private store: JsonStore;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.store = this.load();
  }

  private load(): JsonStore {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as JsonStore;
      }
    } catch {
      // Reset corrupted /tmp state if needed
    }
    return {
      accounts: [],
      transactions: [],
      daily_notes: [],
      settings: [],
      sync_logs: [],
      nextLogId: 1,
    };
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.store), 'utf8');
    } catch {
      // Ignore ephemeral write errors
    }
  }

  public exec(sql: string): void {
    if (/DELETE\s+FROM\s+transactions/i.test(sql)) this.store.transactions = [];
    if (/DELETE\s+FROM\s+accounts/i.test(sql)) this.store.accounts = [];
    if (/DELETE\s+FROM\s+daily_notes/i.test(sql)) this.store.daily_notes = [];
    if (/DELETE\s+FROM\s+sync_logs/i.test(sql)) this.store.sync_logs = [];
    this.save();
  }

  public prepare(sql: string): StatementLike {
    const q = sql.replace(/\s+/g, ' ').trim();
    const self = this;

    return {
      run(...params: unknown[]) {
        // Settings
        if (/^INSERT OR IGNORE INTO settings/i.test(q)) {
          const [key, value] = params as [string, string];
          if (!self.store.settings.some((s) => s.key === key)) {
            self.store.settings.push({ key, value });
            self.save();
            return { changes: 1 };
          }
          return { changes: 0 };
        }
        if (/^INSERT INTO settings/i.test(q)) {
          const [key, value] = params as [string, string];
          const existing = self.store.settings.find((s) => s.key === key);
          if (existing) existing.value = value;
          else self.store.settings.push({ key, value });
          self.save();
          return { changes: 1 };
        }

        // Sync logs
        if (/^INSERT INTO sync_logs/i.test(q)) {
          const [source, status, added_count, skipped_count, message, created_at] = params;
          self.store.sync_logs.push({
            id: self.store.nextLogId++,
            source,
            status,
            added_count,
            skipped_count,
            message,
            created_at,
          });
          self.save();
          return { changes: 1 };
        }

        // Accounts
        if (/^INSERT(?: OR IGNORE)? INTO accounts/i.test(q)) {
          const isIgnore = /OR IGNORE/i.test(q);
          const id = String(params[0]);
          if (isIgnore && self.store.accounts.some((a) => a.id === id)) {
            return { changes: 0 };
          }
          if (params.length === 7) {
            // CSV account insert
            const [accId, name, institution, mask, type, last_synced_at, created_at] = params;
            self.store.accounts.push({
              id: accId,
              name,
              institution,
              mask,
              type,
              source: 'csv',
              plaid_item_id: null,
              plaid_access_token: null,
              plaid_account_id: null,
              sync_cursor: null,
              last_synced_at,
              created_at,
            });
          } else {
            // Plaid / Mock Plaid account insert
            const sourceMatch = q.match(/'(mock_plaid|plaid)'/i);
            const source = sourceMatch ? sourceMatch[1] : 'mock_plaid';
            const cursorMatch = q.match(/'(mock_cursor_[^']+)'/);
            let idx = 0;
            const accId = params[idx++];
            const name = params[idx++];
            const institution = params[idx++];
            const mask = params[idx++];
            const type = params[idx++];
            const plaid_item_id = params[idx++];
            const plaid_access_token = params[idx++];
            const plaid_account_id = params[idx++];
            const sync_cursor = cursorMatch ? cursorMatch[1] : null;
            const last_synced_at = params[idx++];
            const created_at = params[idx++];
            self.store.accounts.push({
              id: accId,
              name,
              institution,
              mask,
              type,
              source,
              plaid_item_id,
              plaid_access_token,
              plaid_account_id,
              sync_cursor,
              last_synced_at,
              created_at,
            });
          }
          self.save();
          return { changes: 1 };
        }

        if (/^UPDATE accounts SET sync_cursor = \?, last_synced_at = \? WHERE id = \?/i.test(q)) {
          const [sync_cursor, last_synced_at, id] = params;
          const acct = self.store.accounts.find((a) => a.id === id);
          if (!acct) return { changes: 0 };
          acct.sync_cursor = sync_cursor;
          acct.last_synced_at = last_synced_at;
          self.save();
          return { changes: 1 };
        }

        if (/^UPDATE accounts SET last_synced_at = \? WHERE id = \?/i.test(q)) {
          const [last_synced_at, id] = params;
          const acct = self.store.accounts.find((a) => a.id === id);
          if (!acct) return { changes: 0 };
          acct.last_synced_at = last_synced_at;
          self.save();
          return { changes: 1 };
        }

        if (/^DELETE FROM accounts WHERE id = \?/i.test(q)) {
          const [id] = params;
          const before = self.store.accounts.length;
          self.store.accounts = self.store.accounts.filter((a) => a.id !== id);
          const changes = before - self.store.accounts.length;
          if (changes > 0) {
            for (const tx of self.store.transactions) {
              if (tx.account_id === id) tx.account_id = null;
            }
            self.save();
          }
          return { changes };
        }

        // Transactions
        if (/^INSERT(?: OR IGNORE)? INTO transactions/i.test(q)) {
          const isIgnore = /OR IGNORE/i.test(q);
          const sourceMatch = q.match(/'(csv|manual|mock_plaid|plaid)'/i);
          const source = sourceMatch ? sourceMatch[1] : 'manual';

          let txObj: Record<string, unknown>;
          if (source === 'manual') {
            const [
              id,
              account_label,
              card_type,
              date,
              merchant,
              raw_description,
              amount,
              category,
              fruit_alias,
              dedupe_hash,
              notes,
              created_at,
            ] = params;
            txObj = {
              id,
              account_id: null,
              account_label,
              card_type,
              date,
              merchant,
              raw_description,
              amount,
              category,
              fruit_alias,
              source: 'manual',
              external_id: null,
              dedupe_hash,
              is_excluded: 0,
              exclude_reason: null,
              notes,
              created_at,
            };
          } else if (source === 'csv') {
            const [
              id,
              account_id,
              account_label,
              card_type,
              date,
              merchant,
              raw_description,
              amount,
              category,
              fruit_alias,
              dedupe_hash,
              is_excluded,
              exclude_reason,
              created_at,
            ] = params;
            txObj = {
              id,
              account_id,
              account_label,
              card_type,
              date,
              merchant,
              raw_description,
              amount,
              category,
              fruit_alias,
              source: 'csv',
              external_id: null,
              dedupe_hash,
              is_excluded,
              exclude_reason,
              notes: '',
              created_at,
            };
          } else {
            const [
              id,
              account_id,
              account_label,
              card_type,
              date,
              merchant,
              raw_description,
              amount,
              category,
              fruit_alias,
              external_id,
              dedupe_hash,
              is_excluded,
              exclude_reason,
              created_at,
            ] = params;
            txObj = {
              id,
              account_id,
              account_label,
              card_type,
              date,
              merchant,
              raw_description,
              amount,
              category,
              fruit_alias,
              source,
              external_id,
              dedupe_hash,
              is_excluded,
              exclude_reason,
              notes: '',
              created_at,
            };
          }

          if (
            self.store.transactions.some(
              (t) => t.dedupe_hash === txObj.dedupe_hash || t.id === txObj.id
            )
          ) {
            if (isIgnore) return { changes: 0 };
            throw new Error('UNIQUE constraint failed: transactions.dedupe_hash');
          }

          self.store.transactions.push(txObj);
          self.save();
          return { changes: 1 };
        }

        if (/^UPDATE transactions SET/i.test(q)) {
          const [
            merchant,
            amount,
            category,
            fruit_alias,
            date,
            notes,
            is_excluded,
            exclude_reason,
            id,
          ] = params;
          const tx = self.store.transactions.find((t) => t.id === id);
          if (!tx) return { changes: 0 };
          Object.assign(tx, {
            merchant,
            amount,
            category,
            fruit_alias,
            date,
            notes,
            is_excluded,
            exclude_reason,
          });
          self.save();
          return { changes: 1 };
        }

        if (/^DELETE FROM transactions WHERE id = \?/i.test(q)) {
          const [id] = params;
          const before = self.store.transactions.length;
          self.store.transactions = self.store.transactions.filter((t) => t.id !== id);
          const changes = before - self.store.transactions.length;
          if (changes > 0) self.save();
          return { changes };
        }

        if (/^DELETE FROM transactions WHERE account_id = \?/i.test(q)) {
          const [accountId] = params;
          const before = self.store.transactions.length;
          self.store.transactions = self.store.transactions.filter(
            (t) => t.account_id !== accountId
          );
          const changes = before - self.store.transactions.length;
          if (changes > 0) self.save();
          return { changes };
        }

        // Daily notes
        if (/INTO daily_notes/i.test(q)) {
          const isIgnore = /OR IGNORE/i.test(q);
          const [date, note, updated_at] = params;
          const existing = self.store.daily_notes.find((n) => n.date === date);
          if (existing) {
            if (isIgnore) return { changes: 0 };
            existing.note = note;
            existing.updated_at = updated_at;
          } else {
            self.store.daily_notes.push({ date, note, updated_at });
          }
          self.save();
          return { changes: 1 };
        }

        return { changes: 0 };
      },

      get(...params: unknown[]) {
        if (/^SELECT COUNT\(\*\) as c FROM transactions/i.test(q)) {
          return { c: self.store.transactions.length };
        }
        if (/^SELECT COUNT\(\*\) as c FROM accounts/i.test(q)) {
          return { c: self.store.accounts.length };
        }
        if (/^SELECT 1 FROM transactions WHERE dedupe_hash = \?/i.test(q)) {
          const [hash] = params;
          return self.store.transactions.some((t) => t.dedupe_hash === hash)
            ? { 1: 1 }
            : undefined;
        }
        if (/^SELECT id FROM accounts WHERE name = \? AND source = 'csv'/i.test(q)) {
          const [name] = params;
          const found = self.store.accounts.find((a) => a.name === name && a.source === 'csv');
          return found ? { id: found.id } : undefined;
        }
        if (/^SELECT \* FROM accounts WHERE source = 'mock_plaid' AND plaid_item_id = \?/i.test(q)) {
          const [itemId] = params;
          return self.store.accounts.find(
            (a) => a.source === 'mock_plaid' && a.plaid_item_id === itemId
          );
        }
        if (/^SELECT \* FROM accounts WHERE id = \?/i.test(q)) {
          const [id] = params;
          return self.store.accounts.find((a) => a.id === id);
        }
        if (/^SELECT \* FROM transactions WHERE id = \?/i.test(q)) {
          const [id] = params;
          return self.store.transactions.find((t) => t.id === id);
        }
        if (/^SELECT COALESCE\(SUM\(amount\), 0\) as total FROM transactions/i.test(q)) {
          const [start, end] = params as [string, string];
          const total = self.store.transactions
            .filter((t) => t.is_excluded === 0 && String(t.date) >= start && String(t.date) <= end)
            .reduce((sum, t) => sum + Number(t.amount), 0);
          return { total };
        }
        if (/^SELECT note, updated_at FROM daily_notes WHERE date = \?/i.test(q)) {
          const [date] = params;
          return self.store.daily_notes.find((n) => n.date === date);
        }
        return undefined;
      },

      all(...params: unknown[]) {
        if (/^SELECT key, value FROM settings/i.test(q)) {
          return [...self.store.settings];
        }
        if (/FROM sync_logs ORDER BY id DESC LIMIT 12/i.test(q)) {
          return [...self.store.sync_logs]
            .sort((a, b) => Number(b.id) - Number(a.id))
            .slice(0, 12);
        }
        if (/^SELECT \* FROM accounts WHERE source IN \('plaid', 'mock_plaid'\)/i.test(q)) {
          return self.store.accounts.filter(
            (a) => a.source === 'plaid' || a.source === 'mock_plaid'
          );
        }
        if (/FROM accounts a ORDER BY a\.created_at DESC/i.test(q)) {
          return [...self.store.accounts]
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
            .map((a) => ({
              ...a,
              tx_count: self.store.transactions.filter(
                (t) => t.account_id === a.id && t.is_excluded === 0
              ).length,
            }));
        }
        if (/SELECT date, COUNT\(\*\) as purchaseCount, ROUND\(SUM\(amount\), 2\) as totalSpent/i.test(q)) {
          const [start, end] = params as [string, string];
          const map = new Map<string, { date: string; purchaseCount: number; totalSpent: number }>();
          for (const t of self.store.transactions) {
            const d = String(t.date);
            if (t.is_excluded === 0 && d >= start && d <= end) {
              const cur = map.get(d) ?? { date: d, purchaseCount: 0, totalSpent: 0 };
              cur.purchaseCount += 1;
              cur.totalSpent = Math.round((cur.totalSpent + Number(t.amount)) * 100) / 100;
              map.set(d, cur);
            }
          }
          return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
        }
        if (/SELECT date, COUNT\(\*\) as hiddenCount/i.test(q)) {
          const [start, end] = params as [string, string];
          const map = new Map<string, { date: string; hiddenCount: number }>();
          for (const t of self.store.transactions) {
            const d = String(t.date);
            if (t.is_excluded === 1 && d >= start && d <= end) {
              const cur = map.get(d) ?? { date: d, hiddenCount: 0 };
              cur.hiddenCount += 1;
              map.set(d, cur);
            }
          }
          return Array.from(map.values());
        }
        if (/^SELECT \* FROM transactions WHERE date = \?/i.test(q)) {
          const [date] = params;
          return self.store.transactions
            .filter((t) => t.date === date)
            .sort(
              (a, b) =>
                String(a.created_at).localeCompare(String(b.created_at)) ||
                String(a.id).localeCompare(String(b.id))
            );
        }
        if (/SELECT date, category, ROUND\(SUM\(amount\), 2\) as total/i.test(q)) {
          const [start, end] = params as [string, string];
          const map = new Map<string, { date: string; category: string; total: number }>();
          for (const t of self.store.transactions) {
            const d = String(t.date);
            const cat = String(t.category);
            if (t.is_excluded === 0 && d >= start && d <= end) {
              const key = `${d}:${cat}`;
              const cur = map.get(key) ?? { date: d, category: cat, total: 0 };
              cur.total = Math.round((cur.total + Number(t.amount)) * 100) / 100;
              map.set(key, cur);
            }
          }
          return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
        }
        return [];
      },
    };
  }
}

import { createRequire } from 'node:module';

const requireModule = createRequire(import.meta.url);

function createDb(): DbLike {
  if (!process.env.VERCEL) {
    try {
      const sqliteMod = requireModule('node:sqlite') as {
        DatabaseSync: new (p: string) => DbLike;
      };
      const dbPath = path.join(dataDir, 'koppad.db');
      const sqliteDb = new sqliteMod.DatabaseSync(dbPath);
      sqliteDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      return sqliteDb;
    } catch {
      // Fallback to JSON store if node:sqlite is unavailable on older Node versions
    }
  }
  const jsonPath = path.join(dataDir, 'koppad.json');
  return new JsonStoreAdapter(jsonPath);
}

export const db: DbLike = createDb();

export function initDatabase(): void {
  if (!process.env.VERCEL) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        mask TEXT DEFAULT '',
        type TEXT NOT NULL CHECK(type IN ('credit', 'debit')),
        source TEXT NOT NULL CHECK(source IN ('plaid', 'mock_plaid', 'csv', 'manual')),
        plaid_item_id TEXT,
        plaid_access_token TEXT,
        plaid_account_id TEXT,
        sync_cursor TEXT,
        last_synced_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        account_label TEXT NOT NULL,
        card_type TEXT NOT NULL CHECK(card_type IN ('credit', 'debit', 'cash')),
        date TEXT NOT NULL,
        merchant TEXT NOT NULL,
        raw_description TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('dining', 'shopping', 'groceries', 'bills', 'leisure')),
        fruit_alias TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('plaid', 'mock_plaid', 'csv', 'manual')),
        external_id TEXT,
        dedupe_hash TEXT NOT NULL UNIQUE,
        is_excluded INTEGER NOT NULL DEFAULT 0,
        exclude_reason TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_transactions_excluded ON transactions(is_excluded);
      CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);

      CREATE TABLE IF NOT EXISTS daily_notes (
        date TEXT PRIMARY KEY,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        added_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  const defaults: Array<[string, string]> = [
    ['monthly_budget', '2100'],
    ['daily_target_override', ''],
    ['sync_mode', 'sunset'],
    ['sunset_sync_time', '21:00'],
    ['captain_persona', 'auto'],
  ];

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of defaults) {
    insertSetting.run(key, value);
  }
}

export interface AppSettings {
  monthlyBudget: number;
  dailyTargetOverride: number | null;
  syncMode: 'sunset' | 'hourly' | 'manual';
  sunsetSyncTime: string;
  captainPersona: 'auto' | 'alph' | 'brittany' | 'charlie';
}

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const monthlyBudget = Number(map.get('monthly_budget') ?? '2100') || 2100;
  const rawOverride = map.get('daily_target_override') ?? '';
  const parsedOverride = rawOverride.trim() !== '' ? Number(rawOverride) : null;
  const syncModeRaw = map.get('sync_mode') ?? 'sunset';
  const syncMode: AppSettings['syncMode'] =
    syncModeRaw === 'hourly' || syncModeRaw === 'manual' ? syncModeRaw : 'sunset';
  const sunsetSyncTime = map.get('sunset_sync_time') ?? '21:00';
  const personaRaw = map.get('captain_persona') ?? 'auto';
  const captainPersona: AppSettings['captainPersona'] =
    personaRaw === 'alph' || personaRaw === 'brittany' || personaRaw === 'charlie'
      ? personaRaw
      : 'auto';

  return {
    monthlyBudget,
    dailyTargetOverride:
      parsedOverride !== null && Number.isFinite(parsedOverride) && parsedOverride > 0
        ? parsedOverride
        : null,
    syncMode,
    sunsetSyncTime,
    captainPersona,
  };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  if (patch.monthlyBudget !== undefined && Number.isFinite(patch.monthlyBudget) && patch.monthlyBudget > 0) {
    upsert.run('monthly_budget', String(Math.round(patch.monthlyBudget * 100) / 100));
  }
  if (patch.dailyTargetOverride !== undefined) {
    upsert.run(
      'daily_target_override',
      patch.dailyTargetOverride && patch.dailyTargetOverride > 0
        ? String(Math.round(patch.dailyTargetOverride * 100) / 100)
        : ''
    );
  }
  if (patch.syncMode !== undefined) {
    upsert.run('sync_mode', patch.syncMode);
  }
  if (patch.sunsetSyncTime !== undefined && /^\d{2}:\d{2}$/.test(patch.sunsetSyncTime)) {
    upsert.run('sunset_sync_time', patch.sunsetSyncTime);
  }
  if (patch.captainPersona !== undefined) {
    upsert.run('captain_persona', patch.captainPersona);
  }
  return getSettings();
}

export function logSync(
  source: string,
  status: 'success' | 'error',
  addedCount: number,
  skippedCount: number,
  message: string
): void {
  db.prepare(
    `INSERT INTO sync_logs (source, status, added_count, skipped_count, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(source, status, addedCount, skippedCount, message, new Date().toISOString());
}
