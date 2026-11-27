import { useState } from 'react';
import { CATEGORY_LIST } from '../types';
import type { AppSettings, PikminCategory, Transaction } from '../types';

interface TransactionModalProps {
  mode: 'create' | 'edit';
  initialDate: string;
  transaction?: Transaction | null;
  onClose: () => void;
  onSaveCreate: (payload: {
    date: string;
    merchant: string;
    amount: number;
    category: PikminCategory;
    cardType: 'credit' | 'debit' | 'cash';
    accountLabel?: string;
    notes?: string;
  }) => Promise<void>;
  onSaveEdit: (
    id: string,
    patch: {
      merchant: string;
      amount: number;
      category: PikminCategory;
      date: string;
      notes: string;
    }
  ) => Promise<void>;
  onDelete?: (tx: Transaction) => Promise<void>;
}

export function TransactionModal({
  mode,
  initialDate,
  transaction,
  onClose,
  onSaveCreate,
  onSaveEdit,
  onDelete,
}: TransactionModalProps) {
  const [merchant, setMerchant] = useState(transaction?.merchant ?? '');
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [date, setDate] = useState(transaction?.date ?? initialDate);
  const [category, setCategory] = useState<PikminCategory>(transaction?.category ?? 'dining');
  const [cardType, setCardType] = useState<'credit' | 'debit' | 'cash'>(
    transaction?.card_type ?? 'credit'
  );
  const [accountLabel, setAccountLabel] = useState(transaction?.account_label ?? '');
  const [notes, setNotes] = useState(transaction?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(amount);
    if (!merchant.trim() || !Number.isFinite(num) || num === 0) return;
    setSaving(true);
    try {
      if (mode === 'edit' && transaction) {
        await onSaveEdit(transaction.id, {
          merchant: merchant.trim(),
          amount: num,
          category,
          date,
          notes,
        });
      } else {
        await onSaveCreate({
          date,
          merchant: merchant.trim(),
          amount: num,
          category,
          cardType,
          accountLabel: accountLabel.trim() || undefined,
          notes,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="k-panel-header" style={{ marginBottom: 0 }}>
          <h2 className="k-panel-title">
            {mode === 'edit' ? 'Edit Purchase Specimen' : 'Log New Purchase'}
          </h2>
          <button type="button" className="k-btn k-btn-icon k-btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-field">
            <label htmlFor="modal-merchant">Merchant / Purchase Name</label>
            <input
              id="modal-merchant"
              className="k-input"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. Blue Bottle Coffee"
              required
              autoFocus
            />
          </div>

          <div className="csv-mapping-grid">
            <div className="form-field">
              <label htmlFor="modal-amount">Amount ($)</label>
              <input
                id="modal-amount"
                type="number"
                step="0.01"
                className="k-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="modal-date">Purchase Date</label>
              <input
                id="modal-date"
                type="date"
                className="k-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="csv-mapping-grid">
            <div className="form-field">
              <label htmlFor="modal-category">Pikmin Category</label>
              <select
                id="modal-category"
                className="k-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as PikminCategory)}
              >
                {CATEGORY_LIST.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.pikminName} — {c.label}
                  </option>
                ))}
              </select>
            </div>

            {mode === 'create' && (
              <div className="form-field">
                <label htmlFor="modal-card-type">Card Type</label>
                <select
                  id="modal-card-type"
                  className="k-select"
                  value={cardType}
                  onChange={(e) => setCardType(e.target.value as 'credit' | 'debit' | 'cash')}
                >
                  <option value="credit">Credit Card</option>
                  <option value="debit">Debit Card</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
            )}
          </div>

          {mode === 'create' && (
            <div className="form-field">
              <label htmlFor="modal-card-label">Card Label (Optional)</label>
              <input
                id="modal-card-label"
                className="k-input"
                placeholder="e.g. Sapphire Reserve ••4821"
                value={accountLabel}
                onChange={(e) => setAccountLabel(e.target.value)}
              />
            </div>
          )}

          <div className="form-field">
            <label htmlFor="modal-notes">Notes (Optional)</label>
            <input
              id="modal-notes"
              className="k-input"
              placeholder="Any short note for your KopPad log..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <div>
              {mode === 'edit' && transaction && onDelete && (
                <button
                  type="button"
                  className="k-btn k-btn-danger"
                  onClick={async () => {
                    await onDelete(transaction);
                    onClose();
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="k-btn k-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Add Purchase'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

interface BudgetSettingsModalProps {
  settings: AppSettings;
  onClose: () => void;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onResetDemo: (clearOnly?: boolean) => Promise<void>;
}

export function BudgetSettingsModal({
  settings,
  onClose,
  onSave,
  onResetDemo,
}: BudgetSettingsModalProps) {
  const [monthlyBudget, setMonthlyBudget] = useState(String(settings.monthlyBudget));
  const [dailyOverride, setDailyOverride] = useState(
    settings.dailyTargetOverride ? String(settings.dailyTargetOverride) : ''
  );
  const [syncMode, setSyncMode] = useState(settings.syncMode);
  const [sunsetSyncTime, setSunsetSyncTime] = useState(settings.sunsetSyncTime);
  const [captainPersona, setCaptainPersona] = useState(settings.captainPersona);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        monthlyBudget: Number(monthlyBudget) || 2100,
        dailyTargetOverride: dailyOverride.trim() ? Number(dailyOverride) : null,
        syncMode,
        sunsetSyncTime,
        captainPersona,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="k-panel-header" style={{ marginBottom: 0 }}>
          <h2 className="k-panel-title">KopPad Budget & Rations Settings</h2>
          <button type="button" className="k-btn k-btn-icon k-btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="csv-mapping-grid">
            <div className="form-field">
              <label htmlFor="set-monthly-budget">Monthly Juice Budget ($)</label>
              <input
                id="set-monthly-budget"
                type="number"
                step="10"
                min="50"
                className="k-input"
                value={monthlyBudget}
                onChange={(e) => setMonthlyBudget(e.target.value)}
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor="set-daily-override">Daily Ration Override (Optional)</label>
              <input
                id="set-daily-override"
                type="number"
                step="1"
                min="1"
                className="k-input"
                placeholder="Auto = Monthly / Days"
                value={dailyOverride}
                onChange={(e) => setDailyOverride(e.target.value)}
              />
            </div>
          </div>

          <div className="csv-mapping-grid">
            <div className="form-field">
              <label htmlFor="set-sync-mode">Card Auto-Sync Mode</label>
              <select
                id="set-sync-mode"
                className="k-select"
                value={syncMode}
                onChange={(e) => setSyncMode(e.target.value as AppSettings['syncMode'])}
              >
                <option value="sunset">Daily Sunset Sync</option>
                <option value="hourly">Hourly Auto-Sync</option>
                <option value="manual">Manual Only</option>
              </select>
            </div>

            <div className="form-field">
              <label htmlFor="set-sunset-time">Sunset Sync Time</label>
              <input
                id="set-sunset-time"
                type="time"
                className="k-input"
                value={sunsetSyncTime}
                disabled={syncMode !== 'sunset'}
                onChange={(e) => setSunsetSyncTime(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="set-captain">Captain’s Log Narrator</label>
            <select
              id="set-captain"
              className="k-select"
              value={captainPersona}
              onChange={(e) => setCaptainPersona(e.target.value as AppSettings['captainPersona'])}
            >
              <option value="auto">Auto (Reacts to your daily spend!)</option>
              <option value="alph">Always Alph (Lead Engineer)</option>
              <option value="brittany">Always Brittany (Rations Chief)</option>
              <option value="charlie">Always Captain Charlie (Commander)</option>
            </select>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 8,
              paddingTop: 12,
              borderTop: '1px solid var(--border-glass)',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="k-btn k-btn-ghost"
                onClick={async () => {
                  await onResetDemo(false);
                  onClose();
                }}
              >
                Load Demo Data
              </button>
              <button
                type="button"
                className="k-btn k-btn-danger"
                onClick={async () => {
                  await onResetDemo(true);
                  onClose();
                }}
              >
                Wipe All Data
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="k-btn k-btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" id="btn-save-settings" className="k-btn k-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
