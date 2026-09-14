'use client';

import { useEffect, useState } from 'react';
import { tzHeaders } from './client-tz';
import { readCache, writeCache } from './data-cache';

interface ArcStage {
  name: string;
  complete: boolean;
  current: boolean;
  progress: number;
}
interface ArcProgress {
  stage: string;
  stage_index: number;
  stages: ArcStage[];
  metrics: { consistent_weeks: number; checkins_logged: number; adaptations_applied: number };
}
interface Milestone {
  id: string;
  title: string;
  sport: string | null;
  achieved: boolean;
  date: string | null;
}
interface YouView {
  greeting_name: string | null;
  goal_name: string | null;
  goal_countdown: string | null;
  arc: ArcProgress;
  milestones: Milestone[];
  learned: string | null;
}

const ARC_BLURB: Record<string, string> = {
  Foundation: "Kona is watching for steady weeks before anything else — not distance.",
  Rhythm: 'A routine is forming. Kona is starting to notice what a normal week looks like for you.',
  Judgment: "You're reading your own effort well enough that Kona is factoring it into advice.",
  Composure: "You've adapted a plan sensibly more than once — that's the hard part.",
  Command: 'Months of steady, honest training. Kona trusts your judgment here as much as its own.',
};

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function YouTab({ profileVersion }: { profileVersion: number }) {
  const cacheKey = `you:${profileVersion}`;
  const cached = readCache<YouView | null>(cacheKey);
  const [data, setData] = useState<YouView | null>(cached ? cached.value : null);
  const [loaded, setLoaded] = useState(cached !== null);

  useEffect(() => {
    fetch('/api/you', { headers: tzHeaders() })
      .then((r) => r.json())
      .then((d: { you: YouView | null }) => {
        setData(d.you);
        writeCache(cacheKey, d.you);
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

  const { arc, milestones, learned, goal_name, goal_countdown } = data;
  const current = arc.stages[arc.stage_index];
  const ringDeg = Math.round((current?.progress ?? 0) * 360);

  return (
    <div className="home you-tab">
      <div className="home-top">
        <div>
          <p className="home-greeting">You</p>
          <p className="home-date">Your progression with Kona</p>
        </div>
      </div>

      <section className="you-avatar-wrap">
        <div className="you-ring" style={{ ['--ring-deg' as string]: `${ringDeg}deg` }}>
          <div className="you-ring-inner">
            <span className="you-ring-chevron" aria-hidden />
          </div>
        </div>
        <p className="you-badge">{arc.stage}</p>
      </section>

      <section className="home-card kona-card">
        <p className="brief-label">
          Arc {['I', 'II', 'III', 'IV', 'V'][arc.stage_index]} · {arc.stage}
        </p>
        <div className="you-arc-bar">
          {arc.stages.map((s) => (
            <span
              key={s.name}
              className={`you-arc-seg${s.complete ? ' done' : ''}${s.current ? ' current' : ''}`}
              style={s.current ? { ['--seg-fill' as string]: `${Math.round(s.progress * 100)}%` } : undefined}
            />
          ))}
        </div>
        <p className="brief-line">{ARC_BLURB[arc.stage] ?? ''}</p>
      </section>

      {goal_name ? (
        <section className="home-card you-goal">
          <p className="brief-label">Current goal</p>
          <p className="you-goal-name">{goal_name}</p>
          {goal_countdown && <p className="you-goal-countdown">{goal_countdown}</p>}
        </section>
      ) : (
        <section className="home-card brief-card you-goal-empty">
          <p className="brief-label">No goal set</p>
          <p className="brief-line">Tell Kona what you&apos;re training for and it&apos;ll show your countdown here.</p>
        </section>
      )}

      <section className="home-card you-learned">
        <p className="kona-eyebrow">
          <span className="dot" aria-hidden />
          Kona learned
        </p>
        <p className="brief-line">
          {learned ?? 'Still learning. Give Kona a few more weeks of sessions and check-ins before it has something worth telling you.'}
        </p>
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
        Progression here reflects your actual training history — never invented, and never a reason to push through pain.
      </p>
    </div>
  );
}
