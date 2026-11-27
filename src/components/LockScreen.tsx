import { useState } from 'react';
import { api } from '../api';
import { soundEngine } from '../audio/soundEngine';
import { DrakeEmblemIcon } from './PikminIcons';

interface LockScreenProps {
  onUnlocked: () => Promise<void>;
}

export function LockScreen({ onUnlocked }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.login(password);
      soundEngine.playSunsetChime();
      await onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <section
        className="k-panel"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: '28px 26px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          textAlign: 'center',
        }}
        aria-label="KopPad Security Lock"
      >
        <div style={{ display: 'grid', placeItems: 'center', gap: 10 }}>
          <div
            className="koppad-brand-badge"
            style={{ width: 62, height: 62, borderRadius: 20 }}
          >
            <DrakeEmblemIcon size={38} />
          </div>
          <div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.76rem',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--sunset-gold)',
              }}
            >
              S.S. DRAKE ENCRYPTED TELEMETRY
            </div>
            <h1
              style={{
                margin: '4px 0 0',
                fontFamily: 'var(--font-display)',
                fontSize: '1.5rem',
              }}
            >
              KopPad Locked
            </h1>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: '0.86rem',
                color: 'var(--text-secondary)',
              }}
            >
              Enter your Captain passcode to unlock your cards & daily spending log.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-field" style={{ textAlign: 'left' }}>
            <label htmlFor="koppad-passcode">Passcode</label>
            <input
              id="koppad-passcode"
              type="password"
              className="k-input"
              placeholder="Enter APP_PASSWORD..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: '9px 12px',
                borderRadius: 11,
                background: 'rgba(248, 113, 113, 0.16)',
                border: '1px solid rgba(248, 113, 113, 0.35)',
                color: '#fecaca',
                fontSize: '0.82rem',
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            id="btn-unlock-koppad"
            className="k-btn k-btn-primary"
            disabled={submitting || !password}
            style={{ width: '100%', padding: '11px 16px', fontSize: '0.94rem' }}
          >
            {submitting ? 'Verifying Passcode...' : 'Unlock KopPad'}
          </button>
        </form>
      </section>
    </main>
  );
}
