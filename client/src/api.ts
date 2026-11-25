import type {
  AccountRecord,
  AppSettings,
  CsvColumnMapping,
  CsvPreviewResponse,
  DayReportResponse,
  MonthDaysResponse,
  PikminCategory,
  PlaidStatusResponse,
  Transaction,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getHealth: () => request<{ ok: boolean; today: string }>('/api/health'),

  getMonthDays: (month?: string) =>
    request<MonthDaysResponse>(month ? `/api/days?month=${encodeURIComponent(month)}` : '/api/days'),

  getDayReport: (date: string) =>
    request<DayReportResponse>(`/api/day/${encodeURIComponent(date)}`),

  saveDayNote: (date: string, note: string) =>
    request<{ date: string; note: string }>(`/api/day/${encodeURIComponent(date)}/note`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }),

  createTransaction: (payload: {
    date: string;
    merchant: string;
    amount: number;
    category: PikminCategory;
    cardType: 'credit' | 'debit' | 'cash';
    accountLabel?: string;
    notes?: string;
  }) =>
    request<Transaction>('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  updateTransaction: (
    id: string,
    patch: Partial<{
      merchant: string;
      amount: number;
      category: PikminCategory;
      date: string;
      notes: string;
      is_excluded: boolean;
    }>
  ) =>
    request<Transaction>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deleteTransaction: (id: string) =>
    request<{ deleted: boolean }>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  previewCsv: (payload: {
    csvText: string;
    accountLabel: string;
    mapping?: Partial<CsvColumnMapping>;
  }) =>
    request<CsvPreviewResponse>('/api/csv/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  importCsv: (payload: {
    csvText: string;
    accountLabel: string;
    cardType: 'credit' | 'debit';
    mapping?: Partial<CsvColumnMapping>;
  }) =>
    request<{
      addedCount: number;
      skippedDuplicates: number;
      excludedCount: number;
      accountId: string;
      affectedDates: string[];
    }>('/api/csv/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  getAccounts: () => request<AccountRecord[]>('/api/accounts'),

  disconnectAccount: (id: string, deleteTransactions = false) =>
    request<{ disconnected: boolean }>(
      `/api/accounts/${encodeURIComponent(id)}?deleteTransactions=${deleteTransactions}`,
      { method: 'DELETE' }
    ),

  getPlaidStatus: () => request<PlaidStatusResponse>('/api/plaid/status'),

  createPlaidLinkToken: () =>
    request<{ linkToken: string; mode: 'plaid_live' | 'local_sandbox' }>('/api/plaid/link-token', {
      method: 'POST',
    }),

  linkMockCard: (mockPresetId: string) =>
    request<{ account: AccountRecord; addedTransactions: number }>('/api/plaid/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mockPresetId }),
    }),

  exchangePlaidPublicToken: (publicToken: string, institutionName?: string) =>
    request<{ accounts: AccountRecord[]; addedTransactions: number }>('/api/plaid/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicToken, institutionName }),
    }),

  syncCards: (simulateNewPurchase = false) =>
    request<{
      addedCount: number;
      skippedCount: number;
      syncedAccounts: number;
      message: string;
    }>('/api/plaid/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulateNewPurchase }),
    }),

  getSettings: () => request<AppSettings>('/api/settings'),

  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  resetDemo: () => request<{ seeded: boolean; count: number }>('/api/demo/reset', { method: 'POST' }),
};
