'use client';

import { useEffect, useState } from 'react';

interface Range {
  min: number;
  max: number;
}
interface SessionRecap {
  date: string;
  weekday_full: string;
  title: string;
  feel_label: string | null;
  logged_at_time: string | null;
  distance_km: number | null;
  distance_label: string | null;
  duration_label: string | null;
  carb_target_g_per_hour: Range | null;
  kona_note: string;
  logged: {
    fuel_carried: string | null;
    pains: string | null;
    went_as_planned: boolean | null;
  };
  memory: { text: string; evidence: string[] } | null;
}

function rangeText(r: Range): string {
  return r.min === r.max ? r.min.toLocaleString() : `${r.min.toLocaleString()}–${r.max.toLocaleString()}`;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function SessionRecapView({
  date,
  onBack,
  onOpenChat,
  onOpenMemory,
}: {
  date: string;
  onBack: () => void;
  onOpenChat?: (prefill: string) => void;
  onOpenMemory?: () => void;
}) {
  const [data, setData] = useState<SessionRecap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  useEffect(() => {
    fetch(`/api/recap?date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((d: { recap: SessionRecap | null }) => setData(d.recap))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [date]);

  return (
    <div className="profile-overlay nested">
      <div className="knows">
        <header className="dash-head">
          <button className="back-btn" onClick={onBack} aria-label="Back to your week">
            ‹ Back
          </button>
          {!loaded && <p className="dash-msg">Loading…</p>}
          {loaded && !data && <p className="dash-msg">Nothing logged for this day.</p>}
          {data && (
            <>
              <div className="recap-title-row">
                <h1>{data.title}</h1>
                {data.feel_label && <span className="plan-chip accent">{data.feel_label}</span>}
              </div>
              <p className="dash-sub">
                {data.weekday_full} {longDate(data.date)}
                {data.logged_at_time ? ` · logged ${data.logged_at_time}` : ''}
              </p>
            </>
          )}
        </header>

        {data && (
          <>
            <div className="fuel-grid recap-stats">
              {(data.distance_label || data.distance_km) && (
                <div className="fuel-stat">
                  <span className="fuel-stat-label">Distance</span>
                  <span className="fuel-stat-value">{data.distance_label ?? `${data.distance_km} km`}</span>
                </div>
              )}
              {data.duration_label && (
                <div className="fuel-stat">
                  <span className="fuel-stat-label">Time</span>
                  <span className="fuel-stat-value">{data.duration_label}</span>
                </div>
              )}
              {data.carb_target_g_per_hour && (
                <div className="fuel-stat">
                  <span className="fuel-stat-label">Carbs/hr target</span>
                  <span className="fuel-stat-value">{rangeText(data.carb_target_g_per_hour)}g</span>
                </div>
              )}
            </div>

            <section className="home-card kona-card brief-card">
              <p className="kona-eyebrow">
                <span className="dot" aria-hidden />
                Kona · Just now
              </p>
              <p className="brief-line">{data.kona_note}</p>
              {(data.memory || onOpenChat) && (
                <div className="recap-actions">
                  {data.memory && (
                    <button className="choice" onClick={() => setShowWhy((v) => !v)}>
                      Why that matters
                    </button>
                  )}
                  {onOpenChat && (
                    <button
                      className="choice"
                      onClick={() => onOpenChat(`About ${data.weekday_full.toLowerCase()}'s ${data.title.toLowerCase()} — `)}
                    >
                      Talk to Kona about this
                    </button>
                  )}
                </div>
              )}
              {showWhy && data.memory && (
                <ul className="remembers-list recap-evidence">
                  {data.memory.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </section>

            <section className="knows-section">
              <h2 className="knows-h2">What you logged</h2>
              <div className="home-card">
                {data.logged.fuel_carried && (
                  <p className="told-line">
                    <span className="told-label">Fuel carried</span>
                    {data.logged.fuel_carried}
                  </p>
                )}
                {data.logged.pains && (
                  <p className="told-line">
                    <span className="told-label">Pains</span>
                    {data.logged.pains}
                  </p>
                )}
                {data.logged.went_as_planned !== null && (
                  <p className="told-line">
                    <span className="told-label">Went as planned</span>
                    {data.logged.went_as_planned ? 'Yes' : 'No'}
                  </p>
                )}
                {!data.logged.fuel_carried && !data.logged.pains && data.logged.went_as_planned === null && (
                  <p className="plan-empty">Nothing else logged for this session.</p>
                )}
              </div>
            </section>

            {data.memory && (
              <section className="knows-section">
                <h2 className="knows-h2">Added to memory</h2>
                <button className="home-card insight-card recap-memory-link" onClick={onOpenMemory} disabled={!onOpenMemory}>
                  <p className="insight-text">{data.memory.text}</p>
                </button>
              </section>
            )}

            <p className="home-foot">Kona logs what you tell it. Nothing here is a diagnosis.</p>
          </>
        )}
      </div>
    </div>
  );
}
