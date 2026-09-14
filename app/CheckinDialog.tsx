'use client';

import { useState } from 'react';

const FEELS = ['Feeling great!', 'Breezed it', 'Solid grind', 'Survived', 'Dying...', "Didn't happen"];

export default function CheckinDialog({
  onClose,
  onDone,
  contextLabel,
  konaBriefing,
}: {
  onClose: () => void;
  onDone: () => void;
  /** e.g. "Tuesday" when this is catching up on a missed day's check-in — the
   *  log itself still saves against today (see /api/checkin), but the copy
   *  should be honest about which day it's asking about. */
  contextLabel?: string;
  /** M24.5 — closes the loop. Only passed for today's own check-in, and only
   *  produces the follow-up question when a real, evidence-backed action was
   *  actually given (not the honest "nothing special" default). */
  konaBriefing?: { action: string; why: string | null };
}) {
  const [feel, setFeel] = useState<string | null>(null);
  const [asPlanned, setAsPlanned] = useState<boolean | null>(null);
  const [pains, setPains] = useState<boolean | null>(null);
  const [elaborate, setElaborate] = useState('');
  const [followed, setFollowed] = useState<boolean | null>(null);
  const [outcome, setOutcome] = useState<'better' | 'worse' | 'same' | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const showLoop = Boolean(konaBriefing?.why);
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
          followed_recommendation: showLoop && followed !== null ? followed : undefined,
          recommendation_outcome: showLoop && followed === true && outcome !== null ? outcome : undefined,
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
        <div className="dialog-handle" aria-hidden />
        {reply === null ? (
          <>
            <h2>How did {contextLabel ?? 'today'} go?</h2>
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

            <div className="choice-pair-row">
              <div className="field">
                <label>As planned?</label>
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
                <label>Pains?</label>
                <div className="choice-row">
                  <button className={`choice${pains === true ? ' on' : ''}`} onClick={() => setPains(true)}>
                    Yes
                  </button>
                  <button className={`choice${pains === false ? ' on' : ''}`} onClick={() => setPains(false)}>
                    No
                  </button>
                </div>
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

            {showLoop && (
              <div className="field">
                <label>
                  Kona suggested: {konaBriefing!.action} <span className="hint">optional</span>
                </label>
                <div className="choice-row">
                  <button className={`choice${followed === true ? ' on' : ''}`} onClick={() => setFollowed(true)}>
                    Followed it
                  </button>
                  <button
                    className={`choice${followed === false ? ' on' : ''}`}
                    onClick={() => {
                      setFollowed(false);
                      setOutcome(null);
                    }}
                  >
                    Didn&apos;t
                  </button>
                </div>
                {followed === true && (
                  <div className="choice-row">
                    <button className={`choice${outcome === 'better' ? ' on' : ''}`} onClick={() => setOutcome('better')}>
                      Better
                    </button>
                    <button className={`choice${outcome === 'same' ? ' on' : ''}`} onClick={() => setOutcome('same')}>
                      About the same
                    </button>
                    <button className={`choice${outcome === 'worse' ? ' on' : ''}`} onClick={() => setOutcome('worse')}>
                      Worse
                    </button>
                  </div>
                )}
              </div>
            )}

            {err && <p className="form-error">{err}</p>}
            <div className="dialog-actions">
              <button className="ghost-btn" onClick={onClose}>
                Later
              </button>
              <button className="cta" disabled={!canSubmit} onClick={submit}>
                {busy ? 'Saving…' : 'Log it →'}
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
