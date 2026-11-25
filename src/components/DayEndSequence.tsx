import { useEffect, useMemo, useRef, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import { formatMoney } from '../types';
import type { DayReportResponse, Transaction } from '../types';
import { CaptainsLog } from './CaptainsLog';
import { JuiceReserveGauge } from './JuiceReserveGauge';
import { DrakeEmblemIcon } from './PikminIcons';
import { PikminSpendChart } from './PikminSpendChart';
import { PurchaseFruitCard } from './PurchaseFruitCard';

interface DayEndSequenceProps {
  report: DayReportResponse;
  replayToken: number;
  onSelectDate: (date: string) => void;
  onSaveNote: (date: string, note: string) => Promise<void>;
  onEditTx: (tx: Transaction) => void;
  onToggleExclude: (tx: Transaction) => Promise<void>;
  onOpenQuickAdd: () => void;
}

type SequencePhase = 'intro' | 'tallying' | 'complete';

function formatReadableDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function DayEndSequence({
  report,
  replayToken,
  onSelectDate,
  onSaveNote,
  onEditTx,
  onToggleExclude,
  onOpenQuickAdd,
}: DayEndSequenceProps) {
  const [phase, setPhase] = useState<SequencePhase>('intro');
  const [revealedCount, setRevealedCount] = useState(0);
  const [showExcluded, setShowExcluded] = useState(false);
  const [localReplay, setLocalReplay] = useState(0);
  const timerRef = useRef<number | null>(null);

  const totalPurchases = report.purchases.length;

  // Trigger fresh Pikmin 3 Day-End animation whenever selected date or replay button changes
  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);

    if (totalPurchases === 0) {
      setPhase('complete');
      setRevealedCount(0);
      return;
    }

    setPhase('intro');
    setRevealedCount(0);
    soundEngine.playSunsetChime();

    timerRef.current = window.setTimeout(() => {
      setPhase('tallying');
    }, 850);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [report.date, replayToken, localReplay, totalPurchases]);

  // Step purchases one-by-one during tallying phase
  useEffect(() => {
    if (phase !== 'tallying') return;

    if (revealedCount >= totalPurchases) {
      setPhase('complete');
      soundEngine.playDayComplete(report.summary.rationStatus);
      return;
    }

    timerRef.current = window.setTimeout(() => {
      soundEngine.playPurchasePop(revealedCount);
      setRevealedCount((c) => c + 1);
    }, 460);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [phase, revealedCount, totalPurchases, report.summary.rationStatus]);

  const visiblePurchases = useMemo(
    () => report.purchases.slice(0, revealedCount),
    [report.purchases, revealedCount]
  );

  const displayedDayTotal = useMemo(
    () => Math.round(visiblePurchases.reduce((sum, tx) => sum + tx.amount, 0) * 100) / 100,
    [visiblePurchases]
  );

  const monthSpentBeforeToday = Math.max(
    0,
    report.summary.monthSpentToDate - report.summary.dayTotal
  );

  const handleSkip = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    soundEngine.playTap();
    setRevealedCount(totalPurchases);
    setPhase('complete');
  };

  const handleStep = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (phase === 'intro') {
      setPhase('tallying');
    }
    if (revealedCount < totalPurchases) {
      soundEngine.playPurchasePop(revealedCount);
      const next = revealedCount + 1;
      setRevealedCount(next);
      if (next >= totalPurchases) {
        setPhase('complete');
        soundEngine.playDayComplete(report.summary.rationStatus);
      }
    }
  };

  const handleReplay = () => {
    soundEngine.playTap();
    setLocalReplay((n) => n + 1);
  };

  const isOverDaily = displayedDayTotal > report.summary.dailyTarget;
  const isUnderWell = displayedDayTotal <= report.summary.dailyTarget * 0.75;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Pikmin 3 "DAY X RESULTS" Hero Header */}
      <section className="day-end-hero" aria-label="Day End Results Summary">
        <div className="day-end-stamp">
          <div className="day-end-kicker">
            <span>S.S. DRAKE · END OF DAY REPORT</span>
            <span>·</span>
            <span>
              {report.summary.purchaseCount} PURCHASE{report.summary.purchaseCount === 1 ? '' : 'S'}
            </span>
          </div>
          <h2 className="day-end-heading">DAY {report.dayOfMonth} RESULTS</h2>
          <div className="day-end-date-sub">
            {formatReadableDate(report.date)}
            {' · '}
            Credit {formatMoney(report.summary.creditTotal)} / Debit {formatMoney(report.summary.debitTotal)}
            {report.summary.cashTotal > 0 ? ` / Cash ${formatMoney(report.summary.cashTotal)}` : ''}
          </div>
        </div>

        <div className="day-end-total-cluster">
          <div className="odometer-box">
            <div className="odometer-label">Total Spent Today</div>
            <div
              className={`odometer-value${isOverDaily ? ' over' : isUnderWell ? ' under' : ''}`}
            >
              {formatMoney(displayedDayTotal)}
            </div>
            <div className="odometer-sub">
              {isOverDaily
                ? `${formatMoney(displayedDayTotal - report.summary.dailyTarget)} over daily ration`
                : `${formatMoney(Math.max(0, report.summary.dailyTarget - displayedDayTotal))} under daily ration`}
            </div>
          </div>

          <div className="playback-controls">
            <button
              type="button"
              id="btn-replay-day-end"
              className="k-btn k-btn-primary"
              onClick={handleReplay}
            >
              ▶ Replay Day-End
            </button>
            {phase !== 'complete' && (
              <>
                <button
                  type="button"
                  id="btn-step-purchase"
                  className="k-btn"
                  onClick={handleStep}
                >
                  Step +1
                </button>
                <button
                  type="button"
                  id="btn-skip-summary"
                  className="k-btn k-btn-ghost"
                  onClick={handleSkip}
                >
                  Skip to Summary
                </button>
              </>
            )}
            <button
              type="button"
              id="btn-quick-add-purchase"
              className="k-btn k-btn-cyan"
              onClick={onOpenQuickAdd}
            >
              + Add Purchase
            </button>
          </div>
        </div>
      </section>

      {/* Brief Sundown Liftoff Banner */}
      {phase === 'intro' && (
        <div className="sunset-intro-banner" role="status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <DrakeEmblemIcon size={32} />
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--sunset-gold)' }}>
                Sundown Reached — Lifting Off to Orbit!
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Tallying {totalPurchases} card specimen{totalPurchases === 1 ? '' : 's'} collected on Day {report.dayOfMonth}...
              </div>
            </div>
          </div>
          <button type="button" className="k-btn k-btn-ghost" onClick={handleSkip}>
            Skip Intro
          </button>
        </div>
      )}

      {/* Primary Stage: One-by-One Purchase Fruit Tray + Animated Budget Juice Bottles */}
      <div className="day-end-grid">
        <section className="k-panel" aria-label="Purchases Collected Today">
          <div className="k-panel-header">
            <div>
              <h2 className="k-panel-title">Today’s Purchases Tally</h2>
              <div className="k-panel-meta">
                {phase === 'complete'
                  ? `Showing all ${totalPurchases} purchase${totalPurchases === 1 ? '' : 's'} logged on ${report.date}`
                  : `Tallied ${revealedCount} of ${totalPurchases} purchases...`}
              </div>
            </div>
            <span className="k-panel-meta" style={{ fontFamily: 'var(--font-mono)' }}>
              {revealedCount}/{totalPurchases}
            </span>
          </div>

          {totalPurchases === 0 ? (
            <div className="empty-day-state">
              <DrakeEmblemIcon size={38} />
              <h3>Zero Purchases Today!</h3>
              <p>
                No credit or debit card charges were logged on {report.date}. Your budget juice bottles stay completely untouched!
              </p>
              <button type="button" className="k-btn k-btn-cyan" onClick={onOpenQuickAdd}>
                + Log a Purchase for Day {report.dayOfMonth}
              </button>
            </div>
          ) : (
            <div className="specimen-list">
              {visiblePurchases.map((tx, idx) => (
                <PurchaseFruitCard
                  key={tx.id}
                  tx={tx}
                  index={idx}
                  isLatest={phase === 'tallying' && idx === visiblePurchases.length - 1}
                  onEdit={onEditTx}
                  onToggleExclude={onToggleExclude}
                />
              ))}

              {phase !== 'complete' && revealedCount < totalPurchases && (
                <div className="specimen-pending-slot">
                  Scanning specimen #{revealedCount + 1} from KopPad hold...
                </div>
              )}
            </div>
          )}

          {/* Auto-Filtered Transfers / Payments / Income Drawer */}
          {report.excluded.length > 0 && (
            <div>
              <div className="excluded-toggle-bar">
                <span>
                  {report.excluded.length} non-purchase item{report.excluded.length === 1 ? '' : 's'} auto-filtered
                  (card payments, transfers, income, or hidden)
                </span>
                <button
                  type="button"
                  className="mini-action-btn"
                  onClick={() => setShowExcluded((v) => !v)}
                >
                  {showExcluded ? 'Hide' : 'Review'}
                </button>
              </div>
              {showExcluded && (
                <div className="excluded-list">
                  {report.excluded.map((tx) => (
                    <div key={tx.id} className="excluded-row">
                      <div>
                        <strong style={{ color: 'var(--text-primary)' }}>{tx.merchant}</strong>{' '}
                        <span style={{ opacity: 0.7 }}>
                          ({tx.exclude_reason?.replace('_', ' ') || 'excluded'} · {tx.account_label})
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(tx.amount)}</span>
                        <button
                          type="button"
                          className="mini-action-btn"
                          onClick={() => onToggleExclude(tx)}
                        >
                          Include
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <JuiceReserveGauge
          displayedDaySpent={displayedDayTotal}
          dailyTarget={report.summary.dailyTarget}
          monthlyBudget={report.summary.monthlyBudget}
          monthSpentBeforeToday={monthSpentBeforeToday}
          daysLeftInMonth={report.daysLeftInMonth}
          rationStatus={report.summary.rationStatus}
          isTallying={phase !== 'complete'}
        />
      </div>

      {/* Secondary Stage: Pikmin Squad Category Graph + Captain's Log */}
      <div className="day-end-secondary-grid">
        <PikminSpendChart
          categories={report.categories}
          dayTotal={report.summary.dayTotal}
          dailyTarget={report.summary.dailyTarget}
          trend={report.trend}
          selectedDate={report.date}
          onSelectDate={onSelectDate}
        />

        <CaptainsLog
          date={report.date}
          debrief={report.debrief}
          initialNote={report.note}
          onSaveNote={onSaveNote}
        />
      </div>
    </div>
  );
}
