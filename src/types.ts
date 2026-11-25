export type PikminCategory = 'dining' | 'shopping' | 'groceries' | 'bills' | 'leisure';

export interface Transaction {
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
  is_excluded: number;
  exclude_reason: string | null;
  notes: string;
  created_at: string;
}

export interface DaySummaryItem {
  date: string;
  dayNumber: number;
  purchaseCount: number;
  hiddenCount: number;
  totalSpent: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface MonthDaysResponse {
  month: string;
  today: string;
  daysInMonth: number;
  monthlyBudget: number;
  dailyTarget: number;
  monthTotal: number;
  days: DaySummaryItem[];
}

export interface TrendPoint {
  date: string;
  dayLabel: string;
  total: number;
  dining: number;
  shopping: number;
  groceries: number;
  bills: number;
  leisure: number;
}

export interface CaptainDebrief {
  captain: 'alph' | 'brittany' | 'charlie';
  captainName: string;
  captainRole: string;
  headline: string;
  body: string;
}

export interface DayReportResponse {
  date: string;
  dayOfMonth: number;
  daysInMonth: number;
  daysLeftInMonth: number;
  purchases: Transaction[];
  excluded: Transaction[];
  summary: {
    dayTotal: number;
    purchaseCount: number;
    excludedCount: number;
    creditTotal: number;
    debitTotal: number;
    cashTotal: number;
    dailyTarget: number;
    monthlyBudget: number;
    monthSpentToDate: number;
    monthRemainingDollars: number;
    rationsDaysRemaining: number;
    rationsBeforeToday: number;
    rationStatus: 'abundant' | 'healthy' | 'caution' | 'critical';
  };
  categories: Record<PikminCategory, { total: number; count: number }>;
  trend: TrendPoint[];
  debrief: CaptainDebrief;
  note: string;
}

export interface AccountRecord {
  id: string;
  name: string;
  institution: string;
  mask: string;
  type: 'credit' | 'debit';
  source: 'plaid' | 'mock_plaid' | 'csv' | 'manual';
  last_synced_at: string | null;
  created_at: string;
  tx_count: number;
}

export interface MockBankPreset {
  id: string;
  institution: string;
  name: string;
  mask: string;
  type: 'credit' | 'debit';
  accent: string;
  description: string;
}

export interface SyncLog {
  id: number;
  source: string;
  status: string;
  added_count: number;
  skipped_count: number;
  message: string;
  created_at: string;
}

export interface SchedulerStatus {
  mode: 'sunset' | 'hourly' | 'manual';
  description: string;
  sunsetSyncTime: string;
  lastRunAt: string | null;
}

export interface PlaidStatusResponse {
  mode: 'plaid_live' | 'local_sandbox';
  plaidEnv: string;
  realConfigured: boolean;
  mockPresets: MockBankPreset[];
  recentLogs: SyncLog[];
  scheduler: SchedulerStatus;
}

export interface AppSettings {
  monthlyBudget: number;
  dailyTargetOverride: number | null;
  syncMode: 'sunset' | 'hourly' | 'manual';
  sunsetSyncTime: string;
  captainPersona: 'auto' | 'alph' | 'brittany' | 'charlie';
  scheduler?: SchedulerStatus;
}

export interface CsvColumnMapping {
  dateCol: string;
  descriptionCol: string;
  amountCol: string | null;
  debitCol: string | null;
  creditCol: string | null;
  categoryCol: string | null;
  signConvention: 'auto' | 'positive_is_spend' | 'negative_is_spend';
}

export interface CsvPreviewResponse {
  headers: string[];
  detectedMapping: CsvColumnMapping;
  totalRows: number;
  validRows: number;
  purchaseCount: number;
  excludedCount: number;
  duplicateCount: number;
  sampleRows: Array<{
    date: string;
    rawDescription: string;
    merchant: string;
    amount: number;
    category: PikminCategory;
    fruitAlias: string;
    isExcluded: boolean;
    excludeReason: string | null;
    isDuplicate: boolean;
  }>;
}

export interface PikminCategoryMeta {
  id: PikminCategory;
  label: string;
  pikminName: string;
  color: string;
  softBg: string;
  specimenLabel: string;
}

export const PIKMIN_CATEGORIES: Record<PikminCategory, PikminCategoryMeta> = {
  dining: {
    id: 'dining',
    label: 'Dining & Coffee',
    pikminName: 'Red Pikmin',
    color: '#ef5350',
    softBg: 'rgba(239, 83, 80, 0.16)',
    specimenLabel: 'Sunseed Berry',
  },
  shopping: {
    id: 'shopping',
    label: 'Shopping & Tech',
    pikminName: 'Yellow Pikmin',
    color: '#facc15',
    softBg: 'rgba(250, 204, 21, 0.16)',
    specimenLabel: 'Citrus Relic',
  },
  groceries: {
    id: 'groceries',
    label: 'Groceries & Home',
    pikminName: 'Blue Pikmin',
    color: '#38bdf8',
    softBg: 'rgba(56, 189, 248, 0.16)',
    specimenLabel: 'Dewdrop Melon',
  },
  bills: {
    id: 'bills',
    label: 'Bills & Transit',
    pikminName: 'Rock Pikmin',
    color: '#94a3b8',
    softBg: 'rgba(148, 163, 184, 0.18)',
    specimenLabel: 'Fuel Mineral',
  },
  leisure: {
    id: 'leisure',
    label: 'Fun & Travel',
    pikminName: 'Winged Pikmin',
    color: '#f472b6',
    softBg: 'rgba(244, 114, 182, 0.16)',
    specimenLabel: 'Blossom Nectar',
  },
};

export const CATEGORY_LIST: PikminCategoryMeta[] = [
  PIKMIN_CATEGORIES.dining,
  PIKMIN_CATEGORIES.shopping,
  PIKMIN_CATEGORIES.groceries,
  PIKMIN_CATEGORIES.bills,
  PIKMIN_CATEGORIES.leisure,
];

export function formatMoney(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}
