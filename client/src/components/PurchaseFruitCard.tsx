import { PIKMIN_CATEGORIES, formatMoney } from '../types';
import type { Transaction } from '../types';
import { FruitSpecimenIcon } from './PikminIcons';

interface PurchaseFruitCardProps {
  tx: Transaction;
  index: number;
  isLatest: boolean;
  onEdit: (tx: Transaction) => void;
  onToggleExclude: (tx: Transaction) => void;
}

export function PurchaseFruitCard({
  tx,
  index,
  isLatest,
  onEdit,
  onToggleExclude,
}: PurchaseFruitCardProps) {
  const catMeta = PIKMIN_CATEGORIES[tx.category];

  return (
    <article
      className={`specimen-card${isLatest ? ' latest-pop' : ''}`}
      data-tx-id={tx.id}
    >
      <div
        className="specimen-icon-well"
        style={{ background: catMeta.softBg, borderColor: `${catMeta.color}44` }}
        title={`${catMeta.pikminName} — ${catMeta.label}`}
      >
        <FruitSpecimenIcon category={tx.category} size={30} />
      </div>

      <div className="specimen-info">
        <div className="specimen-merchant-row">
          <span className="specimen-merchant" title={tx.raw_description}>
            {tx.merchant}
          </span>
          <span className="specimen-alias" style={{ color: catMeta.color }}>
            #{index + 1} · {tx.fruit_alias}
          </span>
        </div>

        <div className="specimen-meta">
          <span className={`card-chip ${tx.card_type}`}>
            {tx.card_type === 'debit' ? 'Debit' : tx.card_type === 'cash' ? 'Cash' : 'Credit'} · {tx.account_label}
          </span>
          <span>{catMeta.label}</span>
          {tx.notes && <span title={tx.notes}>“{tx.notes}”</span>}
        </div>
      </div>

      <div className="specimen-right">
        <span className="specimen-price">{formatMoney(tx.amount)}</span>
        <div className="specimen-mini-actions">
          <button
            type="button"
            className="mini-action-btn"
            onClick={() => onEdit(tx)}
          >
            Edit
          </button>
          <button
            type="button"
            className="mini-action-btn"
            onClick={() => onToggleExclude(tx)}
            title="Exclude from day spending total"
          >
            Hide
          </button>
        </div>
      </div>
    </article>
  );
}
