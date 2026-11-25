import { useState } from 'react';
import { CATEGORY_LIST, PIKMIN_CATEGORIES, formatMoney } from '../types';
import type { DayReportResponse, PikminCategory, Transaction } from '../types';
import { PikminSproutIcon } from './PikminIcons';

interface LedgerManagerProps {
  report: DayReportResponse;
  onQuickAdd: (payload: {
    date: string;
    merchant: string;
    amount: number;
    category: PikminCategory;
    cardType: 'credit' | 'debit' | 'cash';
  }) => Promise<void>;
  onEditTx: (tx: Transaction) => void;
  onToggleExclude: (tx: Transaction) => Promise<void>;
  onDeleteTx: (tx: Transaction) => Promise<void>;
}

export function LedgerManager({
  report,
  onQuickAdd,
  onEditTx,
  onToggleExclude,
  onDeleteTx,
}: LedgerManagerProps) {
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<PikminCategory>('dining');
  const [cardType, setCardType] = useState<'credit' | 'debit' | 'cash'>('credit');
  const [submitting, setSubmitting] = useState(false);

  const [cardFilter, setCardFilter] = useState<'all' | 'credit' | 'debit' | 'cash'>('all');
  const [showHidden, setShowHidden] = useState(true);

  const allItems = showHidden
    ? [...report.purchases, ...report.excluded]
    : report.purchases;
  const filtered = allItems.filter((tx) =>
    cardFilter === 'all' ? true : tx.card_type === cardFilter
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(amount);
    if (!merchant.trim() || !Number.isFinite(num) || num === 0) return;
    setSubmitting(true);
    try {
      await onQuickAdd({
        date: report.date,
        merchant: merchant.trim(),
        amount: num,
        category,
        cardType,
      });
      setMerchant('');
      setAmount('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Manual Quick-Add Bar */}
      <section className="k-panel">
        <div className="k-panel-header">
          <div>
            <h2 className="k-panel-title">Quick-Add Purchase for Day {report.dayOfMonth}</h2>
            <div className="k-panel-meta">Log cash or manual card purchases directly to {report.date}</div>
          </div>
        </div>

        <form className="quick-add-grid" onSubmit={handleAdd}>
          <div className="form-field">
            <label htmlFor="qa-merchant">Merchant / Item</label>
            <input
              id="qa-merchant"
              className="k-input"
              placeholder="e.g. Matcha Cafe Maiko"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="qa-amount">Amount ($)</label>
            <input
              id="qa-amount"
              type="number"
              step="0.01"
              min="0.01"
              className="k-input"
              placeholder="12.50"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="qa-category">Pikmin Category</label>
            <select
              id="qa-category"
              className="k-select"
              value={category}
              onChange={(e) => setCategory(e.target.value as PikminCategory)}
            >
              {CATEGORY_LIST.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.pikminName} — {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="qa-card-type">Payment Method</label>
            <select
              id="qa-card-type"
              className="k-select"
              value={cardType}
              onChange={(e) => setCardType(e.target.value as 'credit' | 'debit' | 'cash')}
            >
              <option value="credit">Credit Card</option>
              <option value="debit">Debit Card</option>
              <option value="cash">Cash</option>
            </select>
          </div>

          <button
            type="submit"
            id="btn-submit-quick-add"
            className="k-btn k-btn-primary"
            disabled={submitting}
            style={{ height: 41 }}
          >
            {submitting ? 'Adding...' : '+ Add'}
          </button>
        </form>
      </section>

      {/* Full Day Ledger Table */}
      <section className="k-panel">
        <div className="k-panel-header">
          <div>
            <h2 className="k-panel-title">Day {report.dayOfMonth} Complete Transaction Ledger</h2>
            <div className="k-panel-meta">
              {report.purchases.length} counted purchases ({formatMoney(report.summary.dayTotal)}) ·{' '}
              {report.excluded.length} hidden/filtered items
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="chart-mode-toggle">
              {(['all', 'credit', 'debit', 'cash'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chart-mode-btn${cardFilter === f ? ' active' : ''}`}
                  onClick={() => setCardFilter(f)}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
              />
              Show filtered transfers/payments
            </label>
          </div>
        </div>

        <div className="k-table-wrap">
          <table className="k-table">
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Pikmin Squad</th>
                <th>Card / Source</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                    No matching transactions for {report.date}.
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => {
                  const cat = PIKMIN_CATEGORIES[tx.category];
                  return (
                    <tr key={tx.id} style={{ opacity: tx.is_excluded ? 0.58 : 1 }}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{tx.merchant}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {tx.fruit_alias}
                          {tx.notes ? ` · ${tx.notes}` : ''}
                        </div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: cat.color, fontWeight: 700 }}>
                          <PikminSproutIcon category={tx.category} size={20} />
                          {cat.label}
                        </span>
                      </td>
                      <td>
                        <span className={`card-chip ${tx.card_type}`}>
                          {tx.card_type} · {tx.account_label}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                        {formatMoney(tx.amount)}
                      </td>
                      <td style={{ fontSize: '0.76rem' }}>
                        {tx.is_excluded
                          ? `Filtered (${tx.exclude_reason || 'manual'})`
                          : 'Counted'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="mini-action-btn" onClick={() => onEditTx(tx)}>
                            Edit
                          </button>
                          <button type="button" className="mini-action-btn" onClick={() => onToggleExclude(tx)}>
                            {tx.is_excluded ? 'Include' : 'Hide'}
                          </button>
                          <button
                            type="button"
                            className="mini-action-btn"
                            style={{ color: '#fca5a5' }}
                            onClick={() => onDeleteTx(tx)}
                          >
                            Del
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
