import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.VERCEL
  ? path.join('/tmp', 'koppad-data')
  : path.resolve(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'koppad.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export function initDatabase(): void {
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
