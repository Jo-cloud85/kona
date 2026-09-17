'use client';

import { useState } from 'react';

const LEGS: { value: 'fresh' | 'normal' | 'heavy'; label: string }[] = [
  { value: 'fresh', label: 'Fresh' },
  { value: 'normal', label: 'Normal' },
  { value: 'heavy', label: 'Heavy' },
];
const SLEEP: { value: 'poor' | 'ok' | 'good'; label: string }[] = [
  { value: 'poor', label: 'Poor' },
  { value: 'ok', label: 'OK' },
  { value: 'good', label: 'Good' },
];
const MOOD: { value: 'low' | 'ok' | 'good'; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'ok', label: 'OK' },
  { value: 'good', label: 'Good' },
];

export default function CheckinDialog({
  onClose,
  onDone,
  contextLabel,
  konaBriefing,
}: {
  onClose: () => void;
  /** `learned` is set only when this exact check-in first crossed the
   *  evidence threshold for a category — see submitCheckin (kona-server.ts). */
  onDone: (learned: string | null) => void;
  /** e.g. "Tuesday" when this is catching up on a missed day's check-in — the
   *  log itself still saves against today (see /api/checkin), but the copy
   *  should be honest about which day it's asking about. */
  contextLabel?: string;
  /** M24.5 — closes the loop. Only passed for today's own check-in, and only
   *  produces the follow-up question when a real, evidence-backed action was
   *  actually given (not the honest "nothing special" default, and not a
   *  plan-change proposal — that closes its own loop via Accept/Decline). */
  konaBriefing?: { action: string; why: string | null; category: string | null };
}) {
  const [legs, setLegs] = useState<'fresh' | 'normal' | 'heavy' | null>(null);
  const [asPlanned, setAsPlanned] = useState<boolean | null>(null);
  const [pains, setPains] = useState<boolean | null>(null);
  const [sleep, setSleep] = useState<'poor' | 'ok' | 'good' | null>(null);
  const [mood, setMood] = useState<'low' | 'ok' | 'good' | null>(null);
  const [elaborate, setElaborate] = useState('');
  const [followed, setFollowed] = useState<boolean | null>(null);
  const [outcome, setOutcome] = useState<'better' | 'worse' | 'same' | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [learned, setLearned] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const showLoop = Boolean(konaBriefing?.why);
  const canSubmit = legs !== null && asPlanned !== null && pains !== null && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          legs,
          went_as_planned: asPlanned,
          pains,
          sleep_quality: sleep ?? undefined,
          mood: mood ?? undefined,
          elaborate: elaborate.trim() || undefined,
          followed_recommendation: showLoop && followed !== null ? followed : undefined,
          recommendation_outcome: showLoop && followed === true && outcome !== null ? outcome : undefined,
          category: showLoop ? (konaBriefing!.category ?? undefined) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? 'Could not save that — try again.');
        return;
      }
      setReply(typeof data.reflection === 'string' ? data.reflection : 'Logged.');
      setLearned(typeof data.learned === 'string' ? data.learned : null);
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
              <label>Legs?</label>
              <div className="choice-row">
                {LEGS.map((f) => (
                  <button key={f.value} className={`choice${legs === f.value ? ' on' : ''}`} onClick={() => setLegs(f.value)}>
                    {f.label}
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

            <div className="choice-pair-row">
              <div className="field">
                <label>
                  Sleep <span className="hint">optional</span>
                </label>
                <div className="choice-row">
                  {SLEEP.map((s) => (
                    <button key={s.value} className={`choice${sleep === s.value ? ' on' : ''}`} onClick={() => setSleep(s.value)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>
                  Mood <span className="hint">optional</span>
                </label>
                <div className="choice-row">
                  {MOOD.map((m) => (
                    <button key={m.value} className={`choice${mood === m.value ? ' on' : ''}`} onClick={() => setMood(m.value)}>
                      {m.label}
                    </button>
                  ))}
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
              <button className="cta" onClick={() => onDone(learned)}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
