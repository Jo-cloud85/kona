'use client';

import { useEffect, useState } from 'react';

interface Range {
  min: number;
  max: number;
}
interface WeekDay {
  date: string;
  weekday: string;
  day_of_month: number;
  is_today: boolean;
  is_rest: boolean;
  is_key_day: boolean;
  is_double: boolean;
  title: string | null;
  duration_label: string | null;
  fuelling: { carb_g_per_hour: Range; fluid_ml_per_hour: Range } | null;
}
interface WeekViewData {
  has_plan: boolean;
  range_label: string | null;
  session_count: number;
  rest_count: number;
  protein_daily_g: Range | null;
  key_days_label: string | null;
  days: WeekDay[];
  footnote: string;
}

function rangeText(r: Range): string {
  return r.min === r.max ? r.min.toLocaleString() : `${r.min.toLocaleString()}–${r.max.toLocaleString()}`;
}

export default function WeekView({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<WeekViewData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/week')
      .then((r) => r.json())
      .then((d: { week: WeekViewData | null }) => setData(d.week))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Your week">
      <div className="profile-overlay-bar">
        <h1>Your week</h1>
        <button className="profile-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="week">
        {!loaded && <p className="dash-msg">Loading…</p>}

        {loaded && (!data || !data.has_plan) && (
          <p className="plan-empty">
            No week on record yet. Tell Kona your week in chat — sessions, rest days, whatever you&apos;ve got — and
            it&apos;ll show up here.
          </p>
        )}

        {loaded && data && data.has_plan && (
          <>
            <header className="week-head">
              <div>
                <h1>{data.range_label}</h1>
                <p className="week-head-sub">
                  {data.session_count} session{data.session_count === 1 ? '' : 's'}, {data.rest_count} rest day
                  {data.rest_count === 1 ? '' : 's'}
                </p>
              </div>
              {data.protein_daily_g && (
                <span className="week-protein-pill">Protein {rangeText(data.protein_daily_g)}g daily</span>
              )}
            </header>

            {data.key_days_label && (
              <div className="week-keydays">
                <p className="week-keydays-label">Key days</p>
                <p className="week-keydays-value">{data.key_days_label}</p>
              </div>
            )}

            <div className="week-days">
              {data.days.map((d) => (
                <div
                  key={d.date}
                  className={`week-day${d.is_today ? ' is-today' : ''}${d.is_double ? ' is-double' : ''}${d.is_rest ? ' is-rest' : ''}${!d.title ? ' is-open' : ''}`}
                >
                  <span className="week-day-dow">{d.weekday}</span>
                  <div className="week-day-main">
                    <span className="week-day-title">
                      {d.title ?? <span className="week-day-open">Nothing planned</span>}
                    </span>
                    {d.fuelling && (
                      <div className="week-day-chips">
                        <span className="week-day-chip">{rangeText(d.fuelling.carb_g_per_hour)} g carbs/hr</span>
                        <span className="week-day-chip">{rangeText(d.fuelling.fluid_ml_per_hour)} ml/hr</span>
                      </div>
                    )}
                  </div>
                  {d.is_today && <span className="week-day-badge">Today</span>}
                  {!d.is_today && d.is_double && <span className="week-day-badge">Double</span>}
                  {!d.is_today && !d.is_double && d.duration_label && d.duration_label !== 'length not set' && (
                    <span className="week-day-meta">{d.duration_label}</span>
                  )}
                </div>
              ))}
            </div>

            <p className="week-foot">{data.footnote}</p>
          </>
        )}
      </div>
    </div>
  );
}
