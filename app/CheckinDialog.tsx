'use client';

import { useState } from 'react';

const FEELS = ['Feeling great!', 'Breezed it', 'Solid grind', 'Survived', 'Dying...', "Didn't happen"];

export default function CheckinDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [feel, setFeel] = useState<string | null>(null);
  const [asPlanned, setAsPlanned] = useState<boolean | null>(null);
  const [pains, setPains] = useState<boolean | null>(null);
  const [elaborate, setElaborate] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const canSubmit = feel !== null && asPlanned !== null && pains !== null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workout_feel: feel,
          went_as_planned: asPlanned,
          pains,
          elaborate: elaborate.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? 'Could not save that — try again.');
        return;
      }
      setReply(typeof data.reflection === 'string' ? data.reflection : 'Logged.');
    } catch {
      setErr('Network error — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Evening check-in">
      <div className="dialog">
        {reply === null ? (
          <>
            <h2>How did today go?</h2>
            <p className="dialog-sub">A quick end-of-day check-in. Kona logs it — nothing gets diagnosed.</p>

            <div className="field">
              <label>How&apos;s your workout?</label>
              <div className="choice-row">
                {FEELS.map((f) => (
                  <button key={f} className={`choice${feel === f ? ' on' : ''}`} onClick={() => setFeel(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>Did the plan(s) go as planned?</label>
              <div className="choice-row">
                <button className={`choice${asPlanned === true ? ' on' : ''}`} onClick={() => setAsPlanned(true)}>
                  Yes
                </button>
                <button className={`choice${asPlanned === false ? ' on' : ''}`} onClick={() => setAsPlanned(false)}>
                  No
                </button>
              </div>
            </div>

            <div className="field">
              <label>Any injuries, cramps or pains?</label>
              <div className="choice-row">
                <button className={`choice${pains === true ? ' on' : ''}`} onClick={() => setPains(true)}>
                  Yes
                </button>
                <button className={`choice${pains === false ? ' on' : ''}`} onClick={() => setPains(false)}>
                  No
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="elab">
                Elaborate <span className="hint">optional</span>
              </label>
              <textarea
                id="elab"
                rows={2}
                maxLength={500}
                value={elaborate}
                onChange={(e) => setElaborate(e.target.value)}
                placeholder="e.g. calf tightened on the last km, or skipped the run — worked late"
              />
            </div>

            {err && <p className="form-error">{err}</p>}
            <div className="dialog-actions">
              <button className="ghost-btn" onClick={onClose}>
                Later
              </button>
              <button className="cta" disabled={!canSubmit} onClick={submit}>
                {busy ? 'Saving…' : 'Log it'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Thanks — logged.</h2>
            <p className="dialog-reply">{reply}</p>
            <div className="dialog-actions">
              <button className="cta" onClick={onDone}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
