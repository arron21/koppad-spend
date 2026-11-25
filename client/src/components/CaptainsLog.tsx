import { useEffect, useState } from 'react';
import type { CaptainDebrief } from '../types';
import { CaptainPortrait } from './PikminIcons';

interface CaptainsLogProps {
  date: string;
  debrief: CaptainDebrief;
  initialNote: string;
  onSaveNote: (date: string, note: string) => Promise<void>;
}

export function CaptainsLog({
  date,
  debrief,
  initialNote,
  onSaveNote,
}: CaptainsLogProps) {
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setNote(initialNote);
    setSavedNotice(false);
  }, [date, initialNote]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveNote(date, note);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2200);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="k-panel captain-card" aria-label="Captain's Daily Log">
      <div className="k-panel-header" style={{ marginBottom: 0 }}>
        <h2 className="k-panel-title">Captain’s Log</h2>
        <span className="k-panel-meta">KopPad Exploration Notes</span>
      </div>

      <div className="captain-header">
        <div className="captain-avatar-frame">
          <CaptainPortrait captain={debrief.captain} />
        </div>
        <div className="captain-name-row">
          <h3>{debrief.captainName}</h3>
          <span>{debrief.captainRole}</span>
        </div>
      </div>

      <div className="captain-speech">
        <div className="captain-speech-headline">{debrief.headline}</div>
        <div>{debrief.body}</div>
      </div>

      <div className="personal-note-box">
        <label htmlFor="daily-captain-note">
          <span>Your Expedition Note ({date})</span>
          {savedNotice && <span style={{ color: 'var(--leaf-lime)' }}>Saved to KopPad</span>}
        </label>
        <textarea
          id="daily-captain-note"
          className="k-textarea"
          placeholder="Jot down context about today’s purchases (e.g. team lunch, birthday gift, grocery stock-up)..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="k-btn k-btn-cyan"
            onClick={handleSave}
            disabled={saving || note === initialNote}
          >
            {saving ? 'Saving...' : 'Save Log Note'}
          </button>
        </div>
      </div>
    </section>
  );
}
