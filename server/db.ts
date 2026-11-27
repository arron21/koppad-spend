import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const requireModule = createRequire(import.meta.url);

export interface AsyncDbDriver {
  readonly backend: 'postgres' | 'sqlite' | 'ephemeral_json';
  initSchema(): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export function getPostgresUrl(): string | null {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.NEON_DATABASE_URL,
  ];
  for (const c of candidates) {
    if (c && c.trim()) return c.trim();
  }
  // Also support custom-prefixed Vercel Storage integrations (e.g. KOPPAD_DATABASE_URL / KOPPAD_POSTGRES_URL)
  for (const [key, val] of Object.entries(process.env)) {
    if (
      val &&
      val.trim().startsWith('postgres') &&
      (/(DATABASE_URL|POSTGRES_URL)$/i.test(key))
    ) {
      return val.trim();
    }
  }
  return null;
}

function toPgParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

class PostgresDriver implements AsyncDbDriver {
  public readonly backend = 'postgres' as const;
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const isLocal =
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    this.pool = new pg.Pool({
      connectionString,
      max: 5,
      ssl: isLocal ? undefined : { rejectUnauthorized: false },
    });
  }

  public async initSchema(): Promise<void> {
    await this.pool.query(`
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
        amount DOUBLE PRECISION NOT NULL,
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
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        added_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  public async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const res = await this.pool.query(toPgParams(sql), params);
    return { changes: res.rowCount ?? 0 };
  }

  public async get<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    const res = await this.pool.query(toPgParams(sql), params);
    return (res.rows[0] as T | undefined) ?? undefined;
  }

  public async all<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const res = await this.pool.query(toPgParams(sql), params);
    return res.rows as T[];
  }
}

interface SyncStmt {
  run: (...params: unknown[]) => { changes: number };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface SyncSqliteLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => SyncStmt;
}

class LocalSqliteDriver implements AsyncDbDriver {
  public readonly backend = 'sqlite' as const;
  private sqlite: SyncSqliteLike;

  constructor(sqlite: SyncSqliteLike) {
    this.sqlite = sqlite;
  }

  public async initSchema(): Promise<void> {
    this.sqlite.exec(`
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

  public async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const res = this.sqlite.prepare(sql).run(...params);
    return { changes: Number(res.changes ?? 0) };
  }

  public async get<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    return (this.sqlite.prepare(sql).get(...params) as T | undefined) ?? undefined;
  }

  public async all<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    return this.sqlite.prepare(sql).all(...params) as T[];
  }
}

interface JsonStore {
  accounts: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  daily_notes: Array<Record<string, unknown>>;
  settings: Array<{ key: string; value: string }>;
  sync_logs: Array<Record<string, unknown>>;
  nextLogId: number;
}

class EphemeralJsonDriver implements AsyncDbDriver {
  public readonly backend = 'ephemeral_json' as const;
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
      // Ignore corrupted /tmp file
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
      // Ignore write failures
    }
  }

  public async initSchema(): Promise<void> {}

  public async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const q = sql.replace(/\s+/g, ' ').trim();

    if (/^DELETE FROM transactions$/i.test(q)) {
      this.store.transactions = [];
      this.save();
      return { changes: 1 };
    }
    if (/^DELETE FROM accounts$/i.test(q)) {
      this.store.accounts = [];
      this.save();
      return { changes: 1 };
    }
    if (/^DELETE FROM daily_notes$/i.test(q)) {
      this.store.daily_notes = [];
      this.save();
      return { changes: 1 };
    }
    if (/^DELETE FROM sync_logs$/i.test(q)) {
      this.store.sync_logs = [];
      this.save();
      return { changes: 1 };
    }

    if (/^INSERT INTO settings/i.test(q)) {
      const [key, value] = params as [string, string];
      const existing = this.store.settings.find((s) => s.key === key);
      if (existing) {
        if (/DO NOTHING/i.test(q)) return { changes: 0 };
        existing.value = value;
      } else {
        this.store.settings.push({ key, value });
      }
      this.save();
      return { changes: 1 };
    }

    if (/^INSERT INTO sync_logs/i.test(q)) {
      const [source, status, added_count, skipped_count, message, created_at] = params;
      this.store.sync_logs.push({
        id: this.store.nextLogId++,
        source,
        status,
        added_count,
        skipped_count,
        message,
        created_at,
      });
      this.save();
      return { changes: 1 };
    }

    if (/^INSERT INTO accounts/i.test(q)) {
      const doNothing = /DO NOTHING/i.test(q);
      const id = String(params[0]);
      if (doNothing && this.store.accounts.some((a) => a.id === id)) {
        return { changes: 0 };
      }
      if (params.length === 7) {
        const [accId, name, institution, mask, type, last_synced_at, created_at] = params;
        this.store.accounts.push({
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
        this.store.accounts.push({
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
      this.save();
      return { changes: 1 };
    }

    if (/^UPDATE accounts SET sync_cursor = \?, last_synced_at = \? WHERE id = \?/i.test(q)) {
      const [sync_cursor, last_synced_at, id] = params;
      const acct = this.store.accounts.find((a) => a.id === id);
      if (!acct) return { changes: 0 };
      acct.sync_cursor = sync_cursor;
      acct.last_synced_at = last_synced_at;
      this.save();
      return { changes: 1 };
    }

    if (/^UPDATE accounts SET last_synced_at = \? WHERE id = \?/i.test(q)) {
      const [last_synced_at, id] = params;
      const acct = this.store.accounts.find((a) => a.id === id);
      if (!acct) return { changes: 0 };
      acct.last_synced_at = last_synced_at;
      this.save();
      return { changes: 1 };
    }

    if (/^DELETE FROM accounts WHERE id = \?/i.test(q)) {
      const [id] = params;
      const before = this.store.accounts.length;
      this.store.accounts = this.store.accounts.filter((a) => a.id !== id);
      const changes = before - this.store.accounts.length;
      if (changes > 0) {
        for (const tx of this.store.transactions) {
          if (tx.account_id === id) tx.account_id = null;
        }
        this.save();
      }
      return { changes };
    }

    if (/^INSERT INTO transactions/i.test(q)) {
      const doNothing = /DO NOTHING/i.test(q);
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
        this.store.transactions.some(
          (t) => t.dedupe_hash === txObj.dedupe_hash || t.id === txObj.id
        )
      ) {
        if (doNothing) return { changes: 0 };
        throw new Error('Duplicate transaction');
      }

      this.store.transactions.push(txObj);
      this.save();
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
      const tx = this.store.transactions.find((t) => t.id === id);
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
      this.save();
      return { changes: 1 };
    }

    if (/^DELETE FROM transactions WHERE id = \?/i.test(q)) {
      const [id] = params;
      const before = this.store.transactions.length;
      this.store.transactions = this.store.transactions.filter((t) => t.id !== id);
      const changes = before - this.store.transactions.length;
      if (changes > 0) this.save();
      return { changes };
    }

    if (/^DELETE FROM transactions WHERE account_id = \?/i.test(q)) {
      const [accountId] = params;
      const before = this.store.transactions.length;
      this.store.transactions = this.store.transactions.filter((t) => t.account_id !== accountId);
      const changes = before - this.store.transactions.length;
      if (changes > 0) this.save();
      return { changes };
    }

    if (/INTO daily_notes/i.test(q)) {
      const doNothing = /DO NOTHING/i.test(q);
      const [date, note, updated_at] = params;
      const existing = this.store.daily_notes.find((n) => n.date === date);
      if (existing) {
        if (doNothing) return { changes: 0 };
        existing.note = note;
        existing.updated_at = updated_at;
      } else {
        this.store.daily_notes.push({ date, note, updated_at });
      }
      this.save();
      return { changes: 1 };
    }

    return { changes: 0 };
  }

  public async get<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | undefined> {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT COUNT\(\*\) as c FROM transactions/i.test(q)) {
      return { c: this.store.transactions.length } as unknown as T;
    }
    if (/^SELECT COUNT\(\*\) as c FROM accounts/i.test(q)) {
      return { c: this.store.accounts.length } as unknown as T;
    }
    if (/^SELECT 1 FROM transactions WHERE dedupe_hash = \?/i.test(q)) {
      const [hash] = params;
      return (this.store.transactions.some((t) => t.dedupe_hash === hash)
        ? { '?column?': 1 }
        : undefined) as unknown as T | undefined;
    }
    if (/^SELECT id FROM accounts WHERE name = \? AND source = 'csv'/i.test(q)) {
      const [name] = params;
      const found = this.store.accounts.find((a) => a.name === name && a.source === 'csv');
      return (found ? { id: found.id } : undefined) as unknown as T | undefined;
    }
    if (/^SELECT \* FROM accounts WHERE source = 'mock_plaid' AND plaid_item_id = \?/i.test(q)) {
      const [itemId] = params;
      return this.store.accounts.find(
        (a) => a.source === 'mock_plaid' && a.plaid_item_id === itemId
      ) as unknown as T | undefined;
    }
    if (/^SELECT \* FROM accounts WHERE id = \?/i.test(q)) {
      const [id] = params;
      return this.store.accounts.find((a) => a.id === id) as unknown as T | undefined;
    }
    if (/^SELECT \* FROM transactions WHERE id = \?/i.test(q)) {
      const [id] = params;
      return this.store.transactions.find((t) => t.id === id) as unknown as T | undefined;
    }
    if (/^SELECT COALESCE\(SUM\(amount\), 0\) as total FROM transactions/i.test(q)) {
      const [start, end] = params as [string, string];
      const total = this.store.transactions
        .filter((t) => t.is_excluded === 0 && String(t.date) >= start && String(t.date) <= end)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      return { total } as unknown as T;
    }
    if (/^SELECT note, updated_at FROM daily_notes WHERE date = \?/i.test(q)) {
      const [date] = params;
      return this.store.daily_notes.find((n) => n.date === date) as unknown as T | undefined;
    }
    return undefined;
  }

  public async all<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (/^SELECT key, value FROM settings/i.test(q)) {
      return [...this.store.settings] as unknown as T[];
    }
    if (/FROM sync_logs ORDER BY id DESC LIMIT 12/i.test(q)) {
      return [...this.store.sync_logs]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, 12) as unknown as T[];
    }
    if (/^SELECT \* FROM accounts WHERE source IN \('plaid', 'mock_plaid'\)/i.test(q)) {
      return this.store.accounts.filter(
        (a) => a.source === 'plaid' || a.source === 'mock_plaid'
      ) as unknown as T[];
    }
    if (/FROM accounts a ORDER BY a\.created_at DESC/i.test(q)) {
      return [...this.store.accounts]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((a) => ({
          ...a,
          tx_count: this.store.transactions.filter(
            (t) => t.account_id === a.id && t.is_excluded === 0
          ).length,
        })) as unknown as T[];
    }
    if (/SELECT date, COUNT\(\*\) as "purchaseCount"/i.test(q)) {
      const [start, end] = params as [string, string];
      const map = new Map<string, { date: string; purchaseCount: number; totalSpent: number }>();
      for (const t of this.store.transactions) {
        const d = String(t.date);
        if (t.is_excluded === 0 && d >= start && d <= end) {
          const cur = map.get(d) ?? { date: d, purchaseCount: 0, totalSpent: 0 };
          cur.purchaseCount += 1;
          cur.totalSpent = Math.round((cur.totalSpent + Number(t.amount)) * 100) / 100;
          map.set(d, cur);
        }
      }
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)) as unknown as T[];
    }
    if (/SELECT date, COUNT\(\*\) as "hiddenCount"/i.test(q)) {
      const [start, end] = params as [string, string];
      const map = new Map<string, { date: string; hiddenCount: number }>();
      for (const t of this.store.transactions) {
        const d = String(t.date);
        if (t.is_excluded === 1 && d >= start && d <= end) {
          const cur = map.get(d) ?? { date: d, hiddenCount: 0 };
          cur.hiddenCount += 1;
          map.set(d, cur);
        }
      }
      return Array.from(map.values()) as unknown as T[];
    }
    if (/^SELECT \* FROM transactions WHERE date = \?/i.test(q)) {
      const [date] = params;
      return this.store.transactions
        .filter((t) => t.date === date)
        .sort(
          (a, b) =>
            String(a.created_at).localeCompare(String(b.created_at)) ||
            String(a.id).localeCompare(String(b.id))
        ) as unknown as T[];
    }
    if (/SELECT date, category, ROUND\(CAST\(SUM\(amount\) AS NUMERIC\), 2\) as total|SELECT date, category, SUM\(amount\) as total/i.test(q)) {
      const [start, end] = params as [string, string];
      const map = new Map<string, { date: string; category: string; total: number }>();
      for (const t of this.store.transactions) {
        const d = String(t.date);
        const cat = String(t.category);
        if (t.is_excluded === 0 && d >= start && d <= end) {
          const key = `${d}:${cat}`;
          const cur = map.get(key) ?? { date: d, category: cat, total: 0 };
          cur.total = Math.round((cur.total + Number(t.amount)) * 100) / 100;
          map.set(key, cur);
        }
      }
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)) as unknown as T[];
    }
    return [];
  }
}

function createDriver(): AsyncDbDriver {
  const pgUrl = getPostgresUrl();
  if (pgUrl) {
    return new PostgresDriver(pgUrl);
  }

  const dataDir = process.env.VERCEL
    ? path.join('/tmp', 'koppad-data')
    : path.resolve(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  if (!process.env.VERCEL) {
    try {
      const sqliteMod = requireModule('node:sqlite') as {
        DatabaseSync: new (p: string) => SyncSqliteLike;
      };
      const sqliteDb = new sqliteMod.DatabaseSync(path.join(dataDir, 'koppad.db'));
      sqliteDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      return new LocalSqliteDriver(sqliteDb);
    } catch {
      // Fallback to JSON if node:sqlite unavailable
    }
  }

  return new EphemeralJsonDriver(path.join(dataDir, 'koppad.json'));
}

export const db: AsyncDbDriver = createDriver();

let schemaInitPromise: Promise<void> | null = null;

export function ensureDatabaseReady(onReady?: () => Promise<void>): Promise<void> {
  if (!schemaInitPromise) {
    schemaInitPromise = (async () => {
      await db.initSchema();
      const defaults: Array<[string, string]> = [
        ['monthly_budget', '2100'],
        ['daily_target_override', ''],
        ['sync_mode', 'sunset'],
        ['sunset_sync_time', '21:00'],
        ['captain_persona', 'auto'],
      ];
      for (const [key, value] of defaults) {
        await db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
          [key, value]
        );
      }
      if (onReady) {
        await onReady();
      }
    })().catch((err) => {
      schemaInitPromise = null;
      throw err;
    });
  }
  return schemaInitPromise;
}

export interface AppSettings {
  monthlyBudget: number;
  dailyTargetOverride: number | null;
  syncMode: 'sunset' | 'hourly' | 'manual';
  sunsetSyncTime: string;
  captainPersona: 'auto' | 'alph' | 'brittany' | 'charlie';
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
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

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const upsertSql =
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
  if (
    patch.monthlyBudget !== undefined &&
    Number.isFinite(patch.monthlyBudget) &&
    patch.monthlyBudget > 0
  ) {
    await db.run(upsertSql, [
      'monthly_budget',
      String(Math.round(patch.monthlyBudget * 100) / 100),
    ]);
  }
  if (patch.dailyTargetOverride !== undefined) {
    await db.run(upsertSql, [
      'daily_target_override',
      patch.dailyTargetOverride && patch.dailyTargetOverride > 0
        ? String(Math.round(patch.dailyTargetOverride * 100) / 100)
        : '',
    ]);
  }
  if (patch.syncMode !== undefined) {
    await db.run(upsertSql, ['sync_mode', patch.syncMode]);
  }
  if (patch.sunsetSyncTime !== undefined && /^\d{2}:\d{2}$/.test(patch.sunsetSyncTime)) {
    await db.run(upsertSql, ['sunset_sync_time', patch.sunsetSyncTime]);
  }
  if (patch.captainPersona !== undefined) {
    await db.run(upsertSql, ['captain_persona', patch.captainPersona]);
  }
  return getSettings();
}

export async function logSync(
  source: string,
  status: 'success' | 'error',
  addedCount: number,
  skippedCount: number,
  message: string
): Promise<void> {
  await db.run(
    `INSERT INTO sync_logs (source, status, added_count, skipped_count, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [source, status, addedCount, skippedCount, message, new Date().toISOString()]
  );
}
