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

type StepId = 'legs' | 'asPlanned' | 'pains' | 'sleep' | 'mood' | 'elaborate' | 'followed';
const BASE_STEPS: StepId[] = ['legs', 'asPlanned', 'pains', 'sleep', 'mood', 'elaborate'];

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

  // M28: one question per screen (Whoop/Oura-style) instead of all six
  // fields dumped into a single scrolling form — the payoff moment (M27's
  // own framing) deserves more ceremony than a settings form. Chip answers
  // still cost exactly one tap each; only the free-text and final steps need
  // an explicit continue button.
  const [step, setStep] = useState(0);

  const showLoop = Boolean(konaBriefing?.why);
  const steps: StepId[] = showLoop ? [...BASE_STEPS, 'followed'] : BASE_STEPS;
  const current = steps[step];
  const isLast = step === steps.length - 1;
  const canSubmit = legs !== null && asPlanned !== null && pains !== null && !busy;

  const goNext = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  /** Sets a required-step's answer and auto-advances — none of legs/
   *  asPlanned/pains/sleep/mood is ever the last step, so there's always a
   *  next screen to land on. */
  const pickAndAdvance = <T,>(setter: (v: T) => void, value: T) => {
    setter(value);
    goNext();
  };

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
            <div className="checkin-head">
              <button
                type="button"
                className="icon-btn checkin-back"
                onClick={goBack}
                aria-label="Back"
                hidden={step === 0}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
              <div className="checkin-progress" aria-hidden>
                {steps.map((s, i) => (
                  <span key={s} className={`checkin-seg${i <= step ? ' done' : ''}`} />
                ))}
              </div>
              <button type="button" className="icon-btn checkin-close" onClick={onClose} aria-label="Finish later">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <h2>How did {contextLabel ?? 'today'} go?</h2>
            {step === 0 && <p className="dialog-sub">A quick end-of-day check-in. Kona logs it — nothing gets diagnosed.</p>}

            {current === 'legs' && (
              <div className="field">
                <label>Legs?</label>
                <div className="choice-row">
                  {LEGS.map((f) => (
                    <button
                      key={f.value}
                      className={`choice${legs === f.value ? ' on' : ''}`}
                      onClick={() => pickAndAdvance(setLegs, f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {current === 'asPlanned' && (
              <div className="field">
                <label>Did it go as planned?</label>
                <div className="choice-row">
                  <button className={`choice${asPlanned === true ? ' on' : ''}`} onClick={() => pickAndAdvance(setAsPlanned, true)}>
                    Yes
                  </button>
                  <button className={`choice${asPlanned === false ? ' on' : ''}`} onClick={() => pickAndAdvance(setAsPlanned, false)}>
                    No
                  </button>
                </div>
              </div>
            )}

            {current === 'pains' && (
              <div className="field">
                <label>Any pains?</label>
                <div className="choice-row">
                  <button className={`choice${pains === true ? ' on' : ''}`} onClick={() => pickAndAdvance(setPains, true)}>
                    Yes
                  </button>
                  <button className={`choice${pains === false ? ' on' : ''}`} onClick={() => pickAndAdvance(setPains, false)}>
                    No
                  </button>
                </div>
              </div>
            )}

            {current === 'sleep' && (
              <div className="field">
                <label>
                  Sleep <span className="hint">optional</span>
                </label>
                <div className="choice-row">
                  {SLEEP.map((s) => (
                    <button key={s.value} className={`choice${sleep === s.value ? ' on' : ''}`} onClick={() => pickAndAdvance(setSleep, s.value)}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="checkin-skip" onClick={goNext}>
                  Skip →
                </button>
              </div>
            )}

            {current === 'mood' && (
              <div className="field">
                <label>
                  Mood <span className="hint">optional</span>
                </label>
                <div className="choice-row">
                  {MOOD.map((m) => (
                    <button key={m.value} className={`choice${mood === m.value ? ' on' : ''}`} onClick={() => pickAndAdvance(setMood, m.value)}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="checkin-skip" onClick={goNext}>
                  Skip →
                </button>
              </div>
            )}

            {current === 'elaborate' && (
              <div className="field">
                <label htmlFor="elab">
                  Anything to add? <span className="hint">optional</span>
                </label>
                <textarea
                  id="elab"
                  rows={3}
                  maxLength={500}
                  autoFocus
                  value={elaborate}
                  onChange={(e) => setElaborate(e.target.value)}
                  placeholder="e.g. calf tightened on the last km, or skipped the run — worked late"
                />
              </div>
            )}

            {current === 'followed' && konaBriefing && (
              <div className="field">
                <label>Kona suggested: {konaBriefing.action}</label>
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

            {(current === 'elaborate' || current === 'followed') && (
              <div className="dialog-actions">
                <button className="ghost-btn" onClick={onClose}>
                  Later
                </button>
                <button className="cta" disabled={!canSubmit} onClick={isLast ? submit : goNext}>
                  {busy ? 'Saving…' : isLast ? 'Log it →' : 'Next →'}
                </button>
              </div>
            )}
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
