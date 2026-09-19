'use client';

import { useEffect, useRef, useState } from 'react';
import { tzHeaders } from './client-tz';
import { readCache, writeCache } from './data-cache';

interface Milestone {
  id: string;
  title: string;
  sport: string | null;
  achieved: boolean;
  date: string | null;
}
interface RhythmDay {
  date: string;
  state: 'empty' | 'easy' | 'moderate' | 'hard';
  is_today: boolean;
  /** A same-day check-in reported a symptom — rendered as a ring around the
   *  dot, independent of `state` (M28.1: effort and pain are different axes). */
  pain: boolean;
}
interface Insight {
  kind: 'fact' | 'pattern' | 'hypothesis' | 'recommendation';
  text: string;
  certainty: 'high' | 'moderate' | 'low';
  evidence_count: number;
  topic: string;
  as_of?: string;
  evidence: string[];
  /** watching = not enough evidence yet to lean on; acting_on = confident
   *  enough to factor into today's advice. */
  tier: 'watching' | 'acting_on';
}
interface RhythmView {
  greeting_name: string | null;
  consistency: { days: RhythmDay[]; headline: string; detail: string };
  /** Up to 3 (M27.1). `countdown` is null when the athlete deliberately said
   *  there's no target date — rendered as "No target date", never omitted. */
  goals: { name: string; countdown: string | null }[];
  milestones: Milestone[];
  has_anything: boolean;
  insights: Insight[];
  told: { label: string; value: string }[];
  recent: { date: string; text: string; felt?: string; status?: string }[];
  timeline: { date: string; type: string; summary: string; by_kona: boolean }[];
}

const KIND_LABEL: Record<Insight['kind'], string> = {
  fact: 'Fact',
  pattern: 'Pattern',
  hypothesis: 'Hypothesis',
  recommendation: 'Suggestion',
};
const TIER_COPY: Record<Insight['tier'], string> = {
  watching: 'Still watching — not enough yet to lean on.',
  acting_on: "Confident enough to factor into today's advice.",
};

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RhythmTab({ profileVersion }: { profileVersion: number }) {
  const cacheKey = `rhythm:${profileVersion}`;
  const cached = readCache<RhythmView | null>(cacheKey);
  const [data, setData] = useState<RhythmView | null>(cached ? cached.value : null);
  const [loaded, setLoaded] = useState(cached !== null);
  const [showKnows, setShowKnows] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);

  // A plain vertical mouse wheel doesn't scroll a horizontal-only container
  // by default (only a trackpad's horizontal swipe or shift+wheel does) —
  // read as "scroll doesn't work" on desktop (founder report, 2026-09-18).
  // Registered natively (not React's onWheel) so preventDefault actually
  // takes effect — React 17+ attaches onWheel as a passive listener.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // The grid only exists once data has loaded and the Knows overlay isn't
    // covering it — re-run once it actually mounts, not just once on the
    // first render (which shows "Loading…" and has no grid yet).
  }, [data, showKnows]);

  // Click-and-drag scrolling — the scrollbar is hidden (scrollbar-width:
  // none, globals.css) and a plain mouse has no other way to move a
  // horizontal-only container (no trackpad swipe, no shift+wheel habit),
  // so without this a mouse user genuinely couldn't scroll it at all
  // (founder report, 2026-09-18). Mouse only: a real touchscreen already
  // gets smooth native scrolling from touch-action: pan-x (globals.css),
  // and capturing a touch pointer here would fight that native handling
  // instead of leaving it alone — on a phone that reads as "scrolling
  // doesn't work" (the actual bug the previous version of this had).
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      dragging = true;
      startX = e.clientX;
      startScroll = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      el.scrollLeft = startScroll - (e.clientX - startX);
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [data, showKnows]);

  useEffect(() => {
    fetch('/api/rhythm', { headers: tzHeaders() })
      .then((r) => r.json())
      .then((d: { rhythm: RhythmView | null }) => {
        setData(d.rhythm);
        writeCache(cacheKey, d.rhythm);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [cacheKey]);

  if (!loaded) {
    return (
      <div className="home">
        <p className="dash-msg">Loading…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="home">
        <p className="dash-msg">Finish onboarding first — this is built from your training history.</p>
      </div>
    );
  }

  const { milestones, goals, consistency } = data;
  const knowsPreview = data.insights[0]?.text ?? (data.told.length ? data.told[0]!.value : null);

  // Monday-first weeks (buildConsistencyDays already aligns the data),
  // ascending chronological order left to right — this week first, then
  // forward into future weeks (founder direction, 2026-09-18: this week is
  // column 1, next week is column 2, and so on). buildConsistencyDays
  // anchors the whole window at the current week for the same reason, so
  // column 0 here is always "this week" without any extra scroll handling.
  const consistencyWeeks: RhythmDay[][] = [];
  for (let i = 0; i < consistency.days.length; i += 7) {
    consistencyWeeks.push(consistency.days.slice(i, i + 7));
  }
  const thisWeek = consistencyWeeks[0]!;

  if (showKnows) {
    return (
      <div className="profile-overlay nested">
        <div className="knows">
          <header className="dash-head">
            <button className="back-btn" onClick={() => setShowKnows(false)} aria-label="Back to Rhythm">
              ‹ Back
            </button>
            <h1>What Kona knows</h1>
          </header>

          {!data.has_anything && (
            <div className="home-card">
              <p className="plan-empty">
                Kona&apos;s still getting to know you. Tell it your week, log what you actually do, and check in
                after sessions — this page fills in as it learns.
              </p>
            </div>
          )}

          {data.insights.length > 0 && (
            <section className="knows-section">
              <h2 className="knows-h2">What Kona has learned</h2>
              {data.insights.map((i, n) => (
                <div key={n} className="home-card insight-card">
                  <span className={`insight-kind k-${i.kind}`}>{KIND_LABEL[i.kind]}</span>
                  <p className="insight-text">{i.text}</p>
                  <p className="insight-tier">{TIER_COPY[i.tier]}</p>
                  {i.evidence.length > 0 && (
                    <details className="kf-evidence">
                      <summary>Why Kona thinks this ({i.evidence_count})</summary>
                      <ul>
                        {i.evidence.map((e, k) => (
                          <li key={k}>{e}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
            </section>
          )}

          {data.told.length > 0 && (
            <section className="knows-section">
              <h2 className="knows-h2">What you&apos;ve told Kona</h2>
              <div className="home-card">
                {data.told.map((t, n) => (
                  <p key={n} className="told-line">
                    <span className="told-label">{t.label}</span>
                    {t.value}
                  </p>
                ))}
              </div>
            </section>
          )}

          {data.recent.length > 0 && (
            <section className="knows-section">
              <h2 className="knows-h2">Recent training on record</h2>
              <div className="home-card">
                {data.recent.map((r, n) => (
                  <div key={n} className="recent-item">
                    <span className="recent-when">{r.date}</span>
                    <span className="recent-what">
                      {r.text}
                      {r.status && <span className="recent-status"> · {r.status}</span>}
                    </span>
                    {r.felt && <span className="recent-felt">“{r.felt}”</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.timeline.length > 0 && (
            <section className="knows-section">
              <h2 className="knows-h2">How Kona&apos;s been learning</h2>
              <div className="home-card">
                <ol className="tl-list">
                  {data.timeline.map((e, n) => (
                    <li key={n} className={`tl-item${e.by_kona ? ' tl-kona' : ''}`}>
                      <span className="tl-when">{e.date}</span>
                      <span className="tl-dot" aria-hidden />
                      <span className="tl-summary">{e.summary}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="home rhythm-tab">
      <div className="home-top">
        <div>
          <p className="home-greeting">Rhythm</p>
          <p className="home-date">Your training, and what Kona has learned from it</p>
        </div>
      </div>

      {/* CONSISTENCY GRID — a plain-language read, not a score. The one
          deliberate exception to "not a metrics dashboard" in this app,
          per founder direction (M27): a 24-week shape-of-training glance,
          always paired with a headline in words, never a number alone.
          No card chrome around the grid itself (M27.2 — founder review);
          the reading lives in its own card just below. */}
      <section className="rhythm-consistency">
        <p className="brief-label">Next 24 weeks</p>
        <p className="rhythm-range">
          This week: {shortDate(thisWeek[0]!.date)} – {shortDate(thisWeek[6]!.date)} · scroll right for weeks ahead →
        </p>
        <div
          className="rhythm-grid"
          role="img"
          aria-label={`Training days over the next 24 weeks — ${consistency.headline}`}
          ref={gridRef}
        >
          {consistencyWeeks.map((week, wi) => (
            <div key={wi} className="rhythm-week-col">
              {week.map((d) => (
                <span
                  key={d.date}
                  className={`rhythm-dot ${d.state}${d.pain ? ' pain' : ''}${d.is_today ? ' is-today' : ''}`}
                  title={d.pain ? `${d.date} — pain/injury reported` : d.date}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="rhythm-legend">
          <span className="rhythm-legend-item">
            <span className="rhythm-dot easy" aria-hidden /> Easy
          </span>
          <span className="rhythm-legend-item">
            <span className="rhythm-dot moderate" aria-hidden /> Moderate
          </span>
          <span className="rhythm-legend-item">
            <span className="rhythm-dot hard" aria-hidden /> Hard
          </span>
          <span className="rhythm-legend-item">
            <span className="rhythm-dot easy pain" aria-hidden /> Pain/injury reported
          </span>
        </div>
      </section>

      <section className="home-card kona-card brief-card">
        <p className="brief-label">Reading your rhythm</p>
        <p className="rhythm-headline">{consistency.headline}</p>
        <p className="brief-line">{consistency.detail}</p>
      </section>

      {goals.length > 0 ? (
        goals.map((g, i) => (
          <section key={i} className="home-card you-goal">
            <p className="brief-label">{i === 0 ? 'Current goal' : 'Also training for'}</p>
            <p className="you-goal-name">{g.name}</p>
            <p className="you-goal-countdown">{g.countdown ?? 'No target date'}</p>
          </section>
        ))
      ) : (
        <section className="home-card brief-card you-goal-empty">
          <p className="brief-label">No goal set</p>
          <p className="brief-line">Tell Kona what you&apos;re training for and it&apos;ll show your countdown here.</p>
        </section>
      )}

      {/* WHAT KONA KNOWS — a compact preview; tap through for the full feed
          (insights/told/recent/timeline), with a back button to return here
          (M27.2 — was always-expanded, per founder direction). */}
      <section className="home-card">
        <p className="brief-label">What Kona knows</p>
        {knowsPreview ? (
          <>
            <p className="brief-line">{knowsPreview}</p>
            <button className="home-link" onClick={() => setShowKnows(true)}>
              See everything Kona knows →
            </button>
          </>
        ) : (
          <p className="plan-empty">
            Kona&apos;s still getting to know you. Tell it your week, log what you actually do, and check in after
            sessions — this fills in as it learns.
          </p>
        )}
      </section>

      <section className="home-card brief-card">
        <p className="brief-label">Milestones</p>
        <div className="you-milestones">
          {milestones.map((m) => (
            <div key={m.id} className={`you-milestone${m.achieved ? ' achieved' : ''}`}>
              <span className="you-milestone-bar" />
              <span className="you-milestone-title">{m.title}</span>
              <span className="you-milestone-date">{m.achieved && m.date ? shortDate(m.date) : 'Not yet'}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="home-foot">
        Progression here reflects your actual training history — never invented, and never a reason to push through
        pain. Kona doesn&apos;t diagnose.
      </p>
    </div>
  );
}
