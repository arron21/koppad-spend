import { useCallback, useEffect, useState } from 'react';
import { UnauthorizedError, api } from './api';
import { soundEngine } from './audio/soundEngine';
import { CardSyncPanel } from './components/CardSyncPanel';
import { DayEndSequence } from './components/DayEndSequence';
import { DayNavigator } from './components/DayNavigator';
import { LedgerManager } from './components/LedgerManager';
import { LockScreen } from './components/LockScreen';
import { BudgetSettingsModal, TransactionModal } from './components/Modals';
import { DrakeEmblemIcon } from './components/PikminIcons';
import type {
  AccountRecord,
  AppSettings,
  DayReportResponse,
  MonthDaysResponse,
  PikminCategory,
  PlaidStatusResponse,
  Transaction,
} from './types';

type ActiveTab = 'day-end' | 'sync' | 'ledger';

function getLocalToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('day-end');
  const [selectedDate, setSelectedDate] = useState<string>(getLocalToday);
  const [activeMonth, setActiveMonth] = useState<string>(() => getLocalToday().slice(0, 7));

  const [authEnabled, setAuthEnabled] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [dbBackend, setDbBackend] = useState<'postgres' | 'sqlite' | 'ephemeral_json'>('sqlite');

  const [monthData, setMonthData] = useState<MonthDaysResponse | null>(null);
  const [dayReport, setDayReport] = useState<DayReportResponse | null>(null);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [plaidStatus, setPlaidStatus] = useState<PlaidStatusResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [syncingTopbar, setSyncingTopbar] = useState(false);
  const [muted, setMuted] = useState<boolean>(() => soundEngine.isMuted());
  const [replayToken, setReplayToken] = useState(0);

  // Modals
  const [txModalMode, setTxModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);

  const notify = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const loadMonthAndMeta = useCallback(async (monthToLoad: string) => {
    const [mData, accts, pStatus, appSettings] = await Promise.all([
      api.getMonthDays(monthToLoad),
      api.getAccounts(),
      api.getPlaidStatus(),
      api.getSettings(),
    ]);
    setMonthData(mData);
    setAccounts(accts);
    setPlaidStatus(pStatus);
    setSettings(appSettings);
    if (pStatus.dbBackend) setDbBackend(pStatus.dbBackend);
  }, []);

  const loadDay = useCallback(async (dateToLoad: string) => {
    const rep = await api.getDayReport(dateToLoad);
    setDayReport(rep);
  }, []);

  const refreshAll = useCallback(
    async (jumpToDate?: string) => {
      try {
        const targetDate = jumpToDate || selectedDate;
        const targetMonth = targetDate.slice(0, 7);
        if (jumpToDate) {
          setSelectedDate(jumpToDate);
          setActiveMonth(targetMonth);
        }
        await Promise.all([loadMonthAndMeta(targetMonth), loadDay(targetDate)]);
        setIsLocked(false);
        if (jumpToDate) {
          setActiveTab('day-end');
          setReplayToken((n) => n + 1);
        }
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          setIsLocked(true);
          return;
        }
        throw err;
      }
    },
    [selectedDate, loadMonthAndMeta, loadDay]
  );

  // Initial bootstrap with auth check
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [health, auth] = await Promise.all([api.getHealth(), api.getAuthStatus()]);
        if (!mounted) return;
        const today = health.today || getLocalToday();
        setSelectedDate(today);
        setActiveMonth(today.slice(0, 7));
        setAuthEnabled(auth.authEnabled);
        setDbBackend(auth.dbBackend);

        if (auth.authEnabled && !auth.authenticated) {
          setIsLocked(true);
          setLoading(false);
          return;
        }

        await Promise.all([loadMonthAndMeta(today.slice(0, 7)), loadDay(today)]);
      } catch (err) {
        if (!mounted) return;
        if (err instanceof UnauthorizedError) {
          setIsLocked(true);
        } else {
          notify(err instanceof Error ? err.message : 'Unable to reach KopPad API server', true);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadMonthAndMeta, loadDay, notify]);

  const handleUnlocked = async () => {
    setLoading(true);
    setIsLocked(false);
    try {
      await Promise.all([loadMonthAndMeta(activeMonth), loadDay(selectedDate)]);
    } finally {
      setLoading(false);
    }
  };

  const handleLockNow = async () => {
    soundEngine.playTap();
    await api.logout();
    setIsLocked(true);
  };

  const handleSelectDate = async (date: string) => {
    soundEngine.playTap();
    setSelectedDate(date);
    const nextMonth = date.slice(0, 7);
    if (nextMonth !== activeMonth) {
      setActiveMonth(nextMonth);
      await loadMonthAndMeta(nextMonth);
    }
    await loadDay(date);
  };

  const handleChangeMonth = async (nextMonth: string) => {
    soundEngine.playTap();
    setActiveMonth(nextMonth);
    await loadMonthAndMeta(nextMonth);
  };

  const handleTopSync = async () => {
    setSyncingTopbar(true);
    try {
      const res = await api.syncCards(false);
      soundEngine.playSyncPulse();
      notify(res.message);
      await refreshAll();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setIsLocked(true);
      } else {
        notify(err instanceof Error ? err.message : 'Card sync failed', true);
      }
    } finally {
      setSyncingTopbar(false);
    }
  };

  const handleToggleMute = () => {
    const next = !muted;
    soundEngine.setMuted(next);
    setMuted(next);
    if (!next) soundEngine.playTap();
  };

  const handleSaveNote = async (date: string, note: string) => {
    await api.saveDayNote(date, note);
    soundEngine.playTap();
    await loadDay(date);
  };

  const handleCreateTransaction = async (payload: {
    date: string;
    merchant: string;
    amount: number;
    category: PikminCategory;
    cardType: 'credit' | 'debit' | 'cash';
    accountLabel?: string;
    notes?: string;
  }) => {
    await api.createTransaction(payload);
    soundEngine.playPurchasePop(dayReport?.purchases.length ?? 0);
    notify(`Logged ${payload.merchant} ($${payload.amount.toFixed(2)})`);
    await refreshAll(payload.date !== selectedDate ? payload.date : undefined);
  };

  const handleEditTransaction = async (
    id: string,
    patch: {
      merchant: string;
      amount: number;
      category: PikminCategory;
      date: string;
      notes: string;
    }
  ) => {
    await api.updateTransaction(id, patch);
    soundEngine.playTap();
    notify('Purchase specimen updated.');
    await refreshAll();
  };

  const handleToggleExclude = async (tx: Transaction) => {
    const nextExcluded = tx.is_excluded === 0;
    await api.updateTransaction(tx.id, { is_excluded: nextExcluded });
    soundEngine.playTap();
    notify(
      nextExcluded
        ? `Hidden "${tx.merchant}" from daily spending total.`
        : `Restored "${tx.merchant}" to daily spending total.`
    );
    await refreshAll();
  };

  const handleDeleteTransaction = async (tx: Transaction) => {
    await api.deleteTransaction(tx.id);
    soundEngine.playTap();
    notify(`Deleted "${tx.merchant}".`);
    await refreshAll();
  };

  const handleSaveSettings = async (patch: Partial<AppSettings>) => {
    await api.updateSettings(patch);
    soundEngine.playTap();
    notify('KopPad budget & sync settings saved.');
    await refreshAll();
  };

  const handleResetDemo = async (clearOnly = false) => {
    await api.resetDemo(clearOnly);
    soundEngine.playSyncPulse();
    const today = getLocalToday();
    notify(
      clearOnly
        ? 'All demo & historical transactions cleared — ready for your cards!'
        : '10-day demo expedition restored.'
    );
    await refreshAll(today);
  };

  const storageBadge =
    dbBackend === 'postgres'
      ? 'Cloud Postgres'
      : dbBackend === 'sqlite'
        ? 'Local SQLite'
        : 'Temp Storage (Add DATABASE_URL)';

  return (
    <>
      {/* PNF-404 Orbital Sunset Backdrop */}
      <div className="orbital-backdrop" aria-hidden="true">
        <div className="orbital-stars" />
        <div className="orbital-planet-limb" />
      </div>

      {isLocked ? (
        <LockScreen onUnlocked={handleUnlocked} />
      ) : (
        <div className="koppad-shell">
          {/* KopPad Top Header */}
          <header className="koppad-topbar">
            <div className="koppad-brand">
              <div className="koppad-brand-badge">
                <DrakeEmblemIcon size={28} />
              </div>
              <div className="koppad-title-group">
                <h1>KopPad Ledger</h1>
                <div className="koppad-subtitle">
                  <span>{accounts.length} card{accounts.length === 1 ? '' : 's'} linked</span>
                  <span>·</span>
                  <span
                    style={{
                      color:
                        dbBackend === 'postgres' || dbBackend === 'sqlite'
                          ? 'var(--leaf-lime)'
                          : 'var(--sunset-gold)',
                    }}
                  >
                    {storageBadge}
                  </span>
                </div>
              </div>
            </div>

            <nav className="koppad-nav" aria-label="KopPad Views">
              <button
                type="button"
                id="nav-day-end"
                className={`koppad-nav-btn${activeTab === 'day-end' ? ' active' : ''}`}
                onClick={() => {
                  soundEngine.playTap();
                  setActiveTab('day-end');
                }}
              >
                Day-End Report
              </button>
              <button
                type="button"
                id="nav-sync"
                className={`koppad-nav-btn${activeTab === 'sync' ? ' active' : ''}`}
                onClick={() => {
                  soundEngine.playTap();
                  setActiveTab('sync');
                }}
              >
                Cards & CSV
              </button>
              <button
                type="button"
                id="nav-ledger"
                className={`koppad-nav-btn${activeTab === 'ledger' ? ' active' : ''}`}
                onClick={() => {
                  soundEngine.playTap();
                  setActiveTab('ledger');
                }}
              >
                Ledger
              </button>
            </nav>

            <div className="koppad-actions">
              <button
                type="button"
                id="btn-topbar-sync"
                className="k-btn k-btn-cyan"
                disabled={syncingTopbar}
                onClick={handleTopSync}
              >
                <span className={syncingTopbar ? 'spin' : ''}>↻</span>
                {syncingTopbar ? 'Syncing' : 'Sync Cards'}
              </button>
              <button
                type="button"
                id="btn-toggle-sound"
                className="k-btn k-btn-icon"
                onClick={handleToggleMute}
                title={muted ? 'Unmute KopPad SFX' : 'Mute KopPad SFX'}
                aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
              >
                {muted ? '🔇' : '🔊'}
              </button>
              <button
                type="button"
                id="btn-open-settings"
                className="k-btn k-btn-icon"
                onClick={() => {
                  soundEngine.playTap();
                  setShowSettingsModal(true);
                }}
                title="Budget & Sunset Sync Settings"
                aria-label="Open settings"
              >
                ⚙
              </button>
              {authEnabled && (
                <button
                  type="button"
                  id="btn-lock-koppad"
                  className="k-btn k-btn-icon"
                  onClick={handleLockNow}
                  title="Lock KopPad"
                  aria-label="Lock KopPad"
                >
                  🔒
                </button>
              )}
            </div>
          </header>

          {/* Horizontal Expedition Day Strip */}
          <DayNavigator
            monthData={monthData}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            onChangeMonth={handleChangeMonth}
          />

          {/* Active View Content */}
          <main>
            {loading || !dayReport ? (
              <section className="k-panel" style={{ textAlign: 'center', padding: 48 }}>
                <DrakeEmblemIcon size={40} />
                <p style={{ color: 'var(--text-secondary)', marginTop: 12 }}>
                  Establishing KopPad telemetry with S.S. Drake...
                </p>
              </section>
            ) : activeTab === 'day-end' ? (
              <DayEndSequence
                report={dayReport}
                replayToken={replayToken}
                onSelectDate={handleSelectDate}
                onSaveNote={handleSaveNote}
                onEditTx={(tx) => {
                  setEditingTx(tx);
                  setTxModalMode('edit');
                }}
                onToggleExclude={handleToggleExclude}
                onOpenQuickAdd={() => {
                  setEditingTx(null);
                  setTxModalMode('create');
                }}
              />
            ) : activeTab === 'sync' ? (
              <CardSyncPanel
                accounts={accounts}
                plaidStatus={plaidStatus}
                settings={settings}
                selectedDate={selectedDate}
                onRefreshAll={refreshAll}
                onNotify={notify}
              />
            ) : (
              <LedgerManager
                report={dayReport}
                onQuickAdd={handleCreateTransaction}
                onEditTx={(tx) => {
                  setEditingTx(tx);
                  setTxModalMode('edit');
                }}
                onToggleExclude={handleToggleExclude}
                onDeleteTx={handleDeleteTransaction}
              />
            )}
          </main>
        </div>
      )}

      {/* Add / Edit Purchase Modal */}
      {txModalMode && !isLocked && (
        <TransactionModal
          mode={txModalMode}
          initialDate={selectedDate}
          transaction={editingTx}
          onClose={() => {
            setTxModalMode(null);
            setEditingTx(null);
          }}
          onSaveCreate={handleCreateTransaction}
          onSaveEdit={handleEditTransaction}
          onDelete={handleDeleteTransaction}
        />
      )}

      {/* Budget & Sunset Sync Settings Modal */}
      {showSettingsModal && settings && !isLocked && (
        <BudgetSettingsModal
          settings={settings}
          onClose={() => setShowSettingsModal(false)}
          onSave={handleSaveSettings}
          onResetDemo={handleResetDemo}
        />
      )}

      {/* KopPad Status Toast */}
      {toast && (
        <div className={`koppad-toast${toast.isError ? ' error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
