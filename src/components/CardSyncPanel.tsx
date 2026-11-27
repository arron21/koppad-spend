import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { soundEngine } from '../audio/soundEngine';
import { PIKMIN_CATEGORIES, formatMoney } from '../types';
import type {
  AccountRecord,
  AppSettings,
  CsvColumnMapping,
  CsvPreviewResponse,
  PlaidStatusResponse,
} from '../types';

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        receivedRedirectUri?: string;
        onSuccess: (publicToken: string, metadata: { institution?: { name?: string } }) => void;
        onExit?: (err: { error_message?: string; display_message?: string } | null) => void;
      }) => { open: () => void };
    };
  }
}

interface CardSyncPanelProps {
  accounts: AccountRecord[];
  plaidStatus: PlaidStatusResponse | null;
  settings: AppSettings | null;
  selectedDate: string;
  onRefreshAll: (jumpToDate?: string) => Promise<void>;
  onNotify: (msg: string, isError?: boolean) => void;
}

function buildSampleCsv(targetDate: string): string {
  const [y, m, d] = targetDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const prev = new Date(dt);
  prev.setDate(dt.getDate() - 1);
  const fmt = (dateObj: Date) =>
    `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;

  return [
    'Transaction Date,Description,Category,Amount',
    `${fmt(dt)},VERVE COFFEE ROASTERS,Food & Drink,-6.25`,
    `${fmt(dt)},DANDELION CHOCOLATE SHOP,Food & Drink,-14.50`,
    `${fmt(dt)},REI OUTDOOR GEAR COOP,Shopping,-42.80`,
    `${fmt(dt)},PAYMENT THANK YOU - AUTOPAY,Payment,350.00`,
    `${fmt(prev)},TRADER JOES #204,Groceries,-29.15`,
    `${fmt(prev)},CLIPPER TRANSIT RELOAD,Transportation,-10.00`,
  ].join('\n');
}

export function CardSyncPanel({
  accounts,
  plaidStatus,
  settings,
  selectedDate,
  onRefreshAll,
  onNotify,
}: CardSyncPanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [showSandboxPicker, setShowSandboxPicker] = useState(false);

  // CSV Upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [csvText, setCsvText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvAccountLabel, setCsvAccountLabel] = useState('Chase Freedom CSV');
  const [csvCardType, setCsvCardType] = useState<'credit' | 'debit'>('credit');
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResponse | null>(null);
  const [csvMapping, setCsvMapping] = useState<Partial<CsvColumnMapping>>({});
  const [dragging, setDragging] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);

  // Sunset Sync local form
  const [syncMode, setSyncMode] = useState<'sunset' | 'hourly' | 'manual'>(
    settings?.syncMode ?? 'sunset'
  );
  const [sunsetTime, setSunsetTime] = useState(settings?.sunsetSyncTime ?? '21:00');
  const [savingSchedule, setSavingSchedule] = useState(false);

  const launchPlaidHandler = (linkToken: string, receivedRedirectUri?: string) => {
    if (!window.Plaid) {
      onNotify('Plaid Link script is still loading — please try again in a moment.', true);
      return;
    }
    const handler = window.Plaid.create({
      token: linkToken,
      ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
      onSuccess: async (publicToken, metadata) => {
        window.sessionStorage.removeItem('koppad_plaid_link_token');
        try {
          const res = await api.exchangePlaidPublicToken(
            publicToken,
            metadata?.institution?.name
          );
          soundEngine.playSyncPulse();
          onNotify(
            `Linked ${res.accounts.length} Plaid card(s) and imported ${res.addedTransactions} transactions!`
          );
          await onRefreshAll();
        } catch (err) {
          onNotify(err instanceof Error ? err.message : 'Plaid exchange failed', true);
        }
      },
      onExit: (err) => {
        if (err && (err.display_message || err.error_message)) {
          onNotify(err.display_message || err.error_message || 'Plaid Link exited', true);
        }
      },
    });
    handler.open();
  };

  useEffect(() => {
    if (!window.location.search.includes('oauth_state_id=')) return;
    const savedToken = window.sessionStorage.getItem('koppad_plaid_link_token');
    if (!savedToken) return;
    const tryResume = () => {
      if (window.Plaid) {
        launchPlaidHandler(savedToken, window.location.href);
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        window.setTimeout(tryResume, 250);
      }
    };
    tryResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenPlaidLink = async () => {
    soundEngine.playTap();
    try {
      const { linkToken, mode } = await api.createPlaidLinkToken();
      if (mode === 'plaid_live') {
        window.sessionStorage.setItem('koppad_plaid_link_token', linkToken);
        launchPlaidHandler(linkToken);
      } else {
        setShowSandboxPicker(true);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to initialize card link', true);
    }
  };

  const handleLinkMockPreset = async (presetId: string) => {
    setLinkingId(presetId);
    try {
      const res = await api.linkMockCard(presetId);
      soundEngine.playSyncPulse();
      onNotify(
        `Connected ${res.account.institution} ${res.account.name} (+${res.addedTransactions} purchases synced).`
      );
      await onRefreshAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to link card', true);
    } finally {
      setLinkingId(null);
    }
  };

  const handleSyncNow = async (simulateNewPurchase = false) => {
    setSyncing(true);
    try {
      const res = await api.syncCards(simulateNewPurchase);
      soundEngine.playSyncPulse();
      onNotify(res.message);
      await onRefreshAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Card sync failed', true);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async (acct: AccountRecord) => {
    try {
      await api.disconnectAccount(acct.id, false);
      onNotify(`Disconnected ${acct.name}. Existing historical purchases were preserved.`);
      await onRefreshAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to disconnect account', true);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      await api.updateSettings({ syncMode, sunsetSyncTime: sunsetTime });
      soundEngine.playTap();
      onNotify('Auto-sync schedule updated on the KopPad server.');
      await onRefreshAll();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save schedule', true);
    } finally {
      setSavingSchedule(false);
    }
  };

  const runCsvPreview = async (
    text: string,
    label: string,
    mappingOverride?: Partial<CsvColumnMapping>
  ) => {
    try {
      const preview = await api.previewCsv({
        csvText: text,
        accountLabel: label,
        mapping: mappingOverride,
      });
      setCsvPreview(preview);
      setCsvMapping(preview.detectedMapping);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to parse CSV', true);
    }
  };

  const handleCsvFile = async (file: File) => {
    const text = await file.text();
    const baseName = file.name.replace(/\.csv$/i, '').slice(0, 32) || 'Uploaded Card CSV';
    setCsvText(text);
    setCsvFileName(file.name);
    setCsvAccountLabel(baseName);
    await runCsvPreview(text, baseName);
  };

  const handleLoadSampleCsv = async () => {
    const sample = buildSampleCsv(selectedDate);
    setCsvText(sample);
    setCsvFileName('sample-credit-statement.csv');
    setCsvAccountLabel('Sample Visa Statement');
    setCsvCardType('credit');
    await runCsvPreview(sample, 'Sample Visa Statement');
    soundEngine.playTap();
  };

  const handleImportCsv = async () => {
    if (!csvText.trim()) return;
    setImportingCsv(true);
    try {
      const res = await api.importCsv({
        csvText,
        accountLabel: csvAccountLabel,
        cardType: csvCardType,
        mapping: csvMapping,
      });
      soundEngine.playSyncPulse();
      onNotify(
        `Imported ${res.addedCount} rows (${res.skippedDuplicates} duplicates skipped, ${res.excludedCount} transfers/payments filtered).`
      );
      setCsvPreview(null);
      setCsvText('');
      setCsvFileName('');
      const latestDate = res.affectedDates[res.affectedDates.length - 1];
      await onRefreshAll(latestDate);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'CSV import failed', true);
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sync-layout">
        {/* LEFT COLUMN: Plaid Automatic Card Sync & Sunset Scheduler */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="k-panel">
            <div className="k-panel-header">
              <div>
                <h2 className="k-panel-title">Automatic Card Sync (Plaid)</h2>
                <div className="k-panel-meta">
                  {plaidStatus?.realConfigured
                    ? `Live Plaid API active (${plaidStatus.plaidEnv})`
                    : 'Local Sandbox / Mock Sync mode active — add PLAID_CLIENT_ID & PLAID_SECRET in .env for live banks'}
                </div>
              </div>
              <span className={`status-badge ${plaidStatus?.realConfigured ? 'abundant' : 'healthy'}`}>
                {plaidStatus?.realConfigured
                  ? `Plaid ${plaidStatus.plaidEnv}`
                  : 'Local Sandbox Ready'}
              </span>
            </div>

            {plaidStatus?.realConfigured &&
              plaidStatus.plaidEnv.toLowerCase() === 'sandbox' && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: 'rgba(247, 179, 77, 0.14)',
                    border: '1px solid rgba(247, 179, 77, 0.36)',
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    color: 'var(--text-primary)',
                  }}
                >
                  <strong style={{ color: 'var(--sunset-gold)' }}>
                    Plaid is currently in Sandbox mode:
                  </strong>{' '}
                  Plaid Sandbox never sends real SMS codes to your phone! In Sandbox, click{' '}
                  <strong>Continue as Guest</strong> (or enter test code <code>123456</code>, username{' '}
                  <code>user_good</code>, password <code>pass_good</code>). To connect your real bank
                  & receive real SMS codes, set <code>PLAID_ENV=production</code> and use your
                  Production secret in Vercel.
                </div>
              )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              <button
                type="button"
                id="btn-link-plaid-card"
                className="k-btn k-btn-primary"
                onClick={handleOpenPlaidLink}
              >
                + Link Credit / Debit Card
              </button>
              <button
                type="button"
                id="btn-sync-cards-panel"
                className="k-btn k-btn-cyan"
                disabled={syncing}
                onClick={() => handleSyncNow(false)}
              >
                {syncing ? 'Syncing...' : '↻ Sync Connected Cards'}
              </button>
              {!plaidStatus?.realConfigured && (
                <button
                  type="button"
                  id="btn-simulate-card-purchase"
                  className="k-btn"
                  disabled={syncing}
                  onClick={() => handleSyncNow(true)}
                  title="Simulates a new live credit or debit card purchase arriving today"
                >
                  ⚡ Simulate Live Card Charge
                </button>
              )}
            </div>

            {/* Connected Credit & Debit Accounts */}
            <div className="account-card-list">
              {accounts.length === 0 ? (
                <div className="specimen-pending-slot">
                  No cards connected yet. Click “Link Credit / Debit Card” or upload a CSV statement.
                </div>
              ) : (
                accounts.map((acct) => (
                  <div key={acct.id} className="account-card">
                    <div className="account-card-info">
                      <div className="account-card-name">
                        <span>
                          {acct.institution} {acct.name}
                        </span>
                        {acct.mask && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--sunset-gold)' }}>
                            ••{acct.mask}
                          </span>
                        )}
                        <span className={`card-chip ${acct.type}`}>
                          {acct.type === 'debit' ? 'Debit' : 'Credit'}
                        </span>
                      </div>
                      <div className="account-card-sub">
                        {acct.tx_count} purchases · Source: {acct.source.replace('_', ' ')}
                        {acct.last_synced_at
                          ? ` · Synced ${new Date(acct.last_synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="k-btn k-btn-danger"
                      style={{ padding: '6px 11px', fontSize: '0.76rem' }}
                      onClick={() => handleDisconnect(acct)}
                    >
                      Disconnect
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Interactive Local Sandbox Card Picker */}
            {(showSandboxPicker || (!plaidStatus?.realConfigured && accounts.length < 2)) &&
              plaidStatus && (
                <div style={{ marginTop: 18 }}>
                  <div className="k-panel-meta" style={{ color: 'var(--sunset-gold)' }}>
                    Plaid Local Sandbox — Pick any Credit or Debit card to link instantly:
                  </div>
                  <div className="preset-grid">
                    {plaidStatus.mockPresets.map((preset) => {
                      const alreadyLinked = accounts.some(
                        (a) => a.mask === preset.mask && a.institution === preset.institution
                      );
                      return (
                        <div key={preset.id} className="preset-card">
                          <div className="preset-card-title">
                            {preset.institution} {preset.name}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`card-chip ${preset.type}`}>
                              {preset.type === 'debit' ? 'Debit' : 'Credit'} ••{preset.mask}
                            </span>
                          </div>
                          <div className="preset-card-desc">{preset.description}</div>
                          <button
                            type="button"
                            className="k-btn k-btn-cyan"
                            disabled={alreadyLinked || linkingId === preset.id}
                            onClick={() => handleLinkMockPreset(preset.id)}
                          >
                            {alreadyLinked
                              ? 'Connected'
                              : linkingId === preset.id
                                ? 'Linking...'
                                : 'Connect Card'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
          </section>

          {/* Sunset Sync Scheduler */}
          <section className="k-panel">
            <div className="k-panel-header">
              <div>
                <h2 className="k-panel-title">Sunset Auto-Sync Schedule</h2>
                <div className="k-panel-meta">
                  Active: {plaidStatus?.scheduler.description || 'Daily Sunset Sync'}
                </div>
              </div>
            </div>

            <div className="csv-mapping-grid">
              <div className="form-field">
                <label htmlFor="sync-mode-select">Sync Cadence</label>
                <select
                  id="sync-mode-select"
                  className="k-select"
                  value={syncMode}
                  onChange={(e) => setSyncMode(e.target.value as 'sunset' | 'hourly' | 'manual')}
                >
                  <option value="sunset">Daily Sunset Sync (End of Day)</option>
                  <option value="hourly">Hourly Background Sync</option>
                  <option value="manual">Manual Sync Only</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="sunset-time-input">Sunset Sync Time</label>
                <input
                  id="sunset-time-input"
                  type="time"
                  className="k-input"
                  value={sunsetTime}
                  disabled={syncMode !== 'sunset'}
                  onChange={(e) => setSunsetTime(e.target.value)}
                />
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="k-btn k-btn-primary"
                disabled={savingSchedule}
                onClick={handleSaveSchedule}
              >
                {savingSchedule ? 'Updating...' : 'Save Sync Schedule'}
              </button>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Smart CSV Statement Importer + Sync Logs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="k-panel">
            <div className="k-panel-header">
              <div>
                <h2 className="k-panel-title">CSV Statement Upload</h2>
                <div className="k-panel-meta">
                  Auto-detects Chase, Amex, BofA, Capital One, Apple Card & generic bank CSVs
                </div>
              </div>
              <button
                type="button"
                id="btn-load-sample-csv"
                className="k-btn k-btn-ghost"
                style={{ fontSize: '0.76rem', padding: '6px 11px' }}
                onClick={handleLoadSampleCsv}
              >
                Load Sample CSV
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleCsvFile(file);
              }}
            />

            <div
              className={`csv-dropzone${dragging ? ' dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleCsvFile(file);
              }}
            >
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.02rem', color: 'var(--koppad-cyan)' }}>
                {csvFileName ? `Selected: ${csvFileName}` : 'Drop Bank / Credit Card CSV Here'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                Or click to browse `.csv` files · Automatic deduplication & transfer filtering built in
              </div>
            </div>

            {csvPreview && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="csv-mapping-grid">
                  <div className="form-field">
                    <label htmlFor="csv-account-name">Card / Account Label</label>
                    <input
                      id="csv-account-name"
                      className="k-input"
                      value={csvAccountLabel}
                      onChange={(e) => setCsvAccountLabel(e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="csv-card-type">Card Type</label>
                    <select
                      id="csv-card-type"
                      className="k-select"
                      value={csvCardType}
                      onChange={(e) => setCsvCardType(e.target.value as 'credit' | 'debit')}
                    >
                      <option value="credit">Credit Card</option>
                      <option value="debit">Debit Card / Checking</option>
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="csv-date-col">Date Column</label>
                    <select
                      id="csv-date-col"
                      className="k-select"
                      value={csvMapping.dateCol || ''}
                      onChange={(e) => {
                        const next = { ...csvMapping, dateCol: e.target.value };
                        setCsvMapping(next);
                        runCsvPreview(csvText, csvAccountLabel, next);
                      }}
                    >
                      {csvPreview.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="csv-desc-col">Merchant / Description</label>
                    <select
                      id="csv-desc-col"
                      className="k-select"
                      value={csvMapping.descriptionCol || ''}
                      onChange={(e) => {
                        const next = { ...csvMapping, descriptionCol: e.target.value };
                        setCsvMapping(next);
                        runCsvPreview(csvText, csvAccountLabel, next);
                      }}
                    >
                      {csvPreview.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="csv-amt-col">Amount Column</label>
                    <select
                      id="csv-amt-col"
                      className="k-select"
                      value={csvMapping.amountCol || ''}
                      onChange={(e) => {
                        const next = { ...csvMapping, amountCol: e.target.value || null };
                        setCsvMapping(next);
                        runCsvPreview(csvText, csvAccountLabel, next);
                      }}
                    >
                      <option value="">(Use Separate Debit/Credit)</option>
                      {csvPreview.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label htmlFor="csv-sign-mode">Amount Sign Convention</label>
                    <select
                      id="csv-sign-mode"
                      className="k-select"
                      value={csvMapping.signConvention || 'auto'}
                      onChange={(e) => {
                        const next = {
                          ...csvMapping,
                          signConvention: e.target.value as CsvColumnMapping['signConvention'],
                        };
                        setCsvMapping(next);
                        runCsvPreview(csvText, csvAccountLabel, next);
                      }}
                    >
                      <option value="negative_is_spend">Negative = Purchase (Chase / BofA)</option>
                      <option value="positive_is_spend">Positive = Purchase (Amex / Apple Card)</option>
                    </select>
                  </div>
                </div>

                {/* Preview Summary Pills */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span className="status-badge abundant">
                    {csvPreview.purchaseCount} New Purchases
                  </span>
                  <span className="status-badge caution">
                    {csvPreview.excludedCount} Transfers/Payments Auto-Filtered
                  </span>
                  <span className="status-badge healthy">
                    {csvPreview.duplicateCount} Duplicates Skipped
                  </span>
                </div>

                {/* Preview Rows Table */}
                <div className="k-table-wrap">
                  <table className="k-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Merchant</th>
                        <th>Pikmin Squad</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreview.sampleRows.slice(0, 8).map((row, idx) => (
                        <tr key={idx} style={{ opacity: row.isDuplicate || row.isExcluded ? 0.58 : 1 }}>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem' }}>{row.date}</td>
                          <td>{row.merchant}</td>
                          <td style={{ color: PIKMIN_CATEGORIES[row.category].color, fontWeight: 700 }}>
                            {PIKMIN_CATEGORIES[row.category].label}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{formatMoney(row.amount)}</td>
                          <td style={{ fontSize: '0.74rem' }}>
                            {row.isDuplicate
                              ? 'Duplicate'
                              : row.isExcluded
                                ? `Filtered (${row.excludeReason})`
                                : 'Ready'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    type="button"
                    className="k-btn k-btn-ghost"
                    onClick={() => {
                      setCsvPreview(null);
                      setCsvText('');
                      setCsvFileName('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id="btn-confirm-csv-import"
                    className="k-btn k-btn-primary"
                    disabled={importingCsv || csvPreview.validRows === 0}
                    onClick={handleImportCsv}
                  >
                    {importingCsv ? 'Importing...' : `Import ${csvPreview.purchaseCount + csvPreview.excludedCount} Rows`}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Telemetry / Sync Activity Log */}
          <section className="k-panel">
            <div className="k-panel-header">
              <h2 className="k-panel-title">KopPad Sync Log</h2>
              <span className="k-panel-meta">Recent CSV & card sync events</span>
            </div>

            <div className="sync-log-list">
              {plaidStatus?.recentLogs.length ? (
                plaidStatus.recentLogs.map((log) => (
                  <div key={log.id} className="sync-log-item">
                    <div>{log.message}</div>
                    <div className="sync-log-meta">
                      <span>{log.source.toUpperCase()}</span>
                      <span>{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="specimen-pending-slot">No sync activity logged yet.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
