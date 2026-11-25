import { useEffect, useRef } from 'react';
import type { MonthDaysResponse } from '../types';

interface DayNavigatorProps {
  monthData: MonthDaysResponse | null;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onChangeMonth: (month: string) => void;
}

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthTitle(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function DayNavigator({
  monthData,
  selectedDate,
  onSelectDate,
  onChangeMonth,
}: DayNavigatorProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeMonth = monthData?.month || selectedDate.slice(0, 7);

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLButtonElement>('.day-pill.selected');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [selectedDate, monthData?.month]);

  return (
    <nav className="day-navigator" aria-label="Expedition Day Selector">
      <div className="month-switcher">
        <button
          type="button"
          className="k-btn k-btn-icon k-btn-ghost"
          onClick={() => onChangeMonth(shiftMonth(activeMonth, -1))}
          aria-label="Previous month"
        >
          ◀
        </button>
        <span className="month-label">{formatMonthTitle(activeMonth)}</span>
        <button
          type="button"
          className="k-btn k-btn-icon k-btn-ghost"
          onClick={() => onChangeMonth(shiftMonth(activeMonth, 1))}
          aria-label="Next month"
        >
          ▶
        </button>
      </div>

      <div className="day-strip-scroll" ref={stripRef}>
        {monthData?.days.map((d) => {
          const isSelected = d.date === selectedDate;
          const dotClass =
            d.purchaseCount === 0
              ? 'none'
              : d.totalSpent > monthData.dailyTarget * 1.05
                ? 'over'
                : d.totalSpent > monthData.dailyTarget * 0.78
                  ? 'near'
                  : 'under';

          return (
            <button
              key={d.date}
              type="button"
              className={`day-pill${isSelected ? ' selected' : ''}${d.isFuture ? ' future' : ''}`}
              onClick={() => onSelectDate(d.date)}
              title={`${d.date}: ${d.purchaseCount} purchases ($${d.totalSpent.toFixed(2)})`}
            >
              <span className="day-pill-num">
                {d.isToday ? `★${d.dayNumber}` : `D${d.dayNumber}`}
              </span>
              <span className="day-pill-amt">
                {d.totalSpent > 0 ? `$${Math.round(d.totalSpent)}` : '—'}
              </span>
              <span className={`day-pill-dot ${dotClass}`} />
            </button>
          );
        })}
      </div>

      {monthData && selectedDate !== monthData.today && (
        <button
          type="button"
          className="k-btn k-btn-ghost"
          style={{ flexShrink: 0, padding: '6px 12px', fontSize: '0.78rem' }}
          onClick={() => {
            if (monthData.today.slice(0, 7) !== activeMonth) {
              onChangeMonth(monthData.today.slice(0, 7));
            }
            onSelectDate(monthData.today);
          }}
        >
          Today
        </button>
      )}
    </nav>
  );
}
