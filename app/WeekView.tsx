'use client';

import { useEffect, useState } from 'react';
import { tzHeaders } from './client-tz';
import { readCache, writeCache } from './data-cache';
import SessionRecapView from './SessionRecapView';

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
  title_lines: string[];
  duration_label: string | null;
  fuelling: { carb_g_per_hour: Range; fluid_ml_per_hour: Range } | null;
  has_recap: boolean;
  updated_lines: string[];
}
interface WeekViewData {
  has_plan: boolean;
  range_label: string | null;
  session_count: number;
  rest_count: number;
  protein_daily_g: Range | null;
  days: WeekDay[];
  footnote: string;
}

function rangeText(r: Range): string {
  return r.min === r.max ? r.min.toLocaleString() : `${r.min.toLocaleString()}–${r.max.toLocaleString()}`;
}

export default function WeekView({
  onOpenChat,
  onOpenMemory,
}: {
  onOpenChat?: (prefill: string) => void;
  onOpenMemory?: () => void;
}) {
  const cached = readCache<WeekViewData | null>('week');
  const [data, setData] = useState<WeekViewData | null>(cached ? cached.value : null);
  const [loaded, setLoaded] = useState(cached !== null);
  const [recapDate, setRecapDate] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/week', { headers: tzHeaders() })
      .then((r) => r.json())
      .then((d: { week: WeekViewData | null }) => {
        setData(d.week);
        writeCache('week', d.week);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="home week-tab">
      <div className="home-top">
        <div>
          <p className="home-greeting">Week</p>
        </div>
      </div>

      <div className="week">
        {!loaded && <p className="dash-msg">Loading…</p>}

        {loaded && (!data || !data.has_plan) && (
          <p className="plan-empty">
            No week on record yet. Bring your training plan in chat — sessions, rest days, whatever you&apos;ve got.
            Kona doesn&apos;t sync Strava or Garmin, so tell it in your own words and it&apos;ll show up here.
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

            <div className="week-days">
              {data.days.map((d) => (
                <div
                  key={d.date}
                  role={d.has_recap ? 'button' : undefined}
                  tabIndex={d.has_recap ? 0 : undefined}
                  onClick={d.has_recap ? () => setRecapDate(d.date) : undefined}
                  onKeyDown={
                    d.has_recap
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') setRecapDate(d.date);
                        }
                      : undefined
                  }
                  className={`week-day${d.is_today ? ' is-today' : ''}${!d.is_today && (d.is_key_day || d.is_double) ? ' is-key' : ''}${d.is_rest ? ' is-rest' : ''}${!d.title_lines.length ? ' is-open' : ''}${d.has_recap ? ' is-tappable' : ''}`}
                >
                  <span className="week-day-dow">{d.weekday}</span>
                  <div className="week-day-main">
                    {d.title_lines.length ? (
                      d.title_lines.map((line, i) => (
                        <span key={i} className="week-day-title">
                          {line}
                        </span>
                      ))
                    ) : (
                      <span className="week-day-title week-day-open">Nothing planned</span>
                    )}
                    {d.updated_lines.map((line, i) => (
                      <span key={i} className="week-day-updated">
                        Updated: {line}
                      </span>
                    ))}
                    {d.fuelling && (
                      <div className="week-day-chips">
                        <span className="week-day-chip">{rangeText(d.fuelling.carb_g_per_hour)} g carbs/hr</span>
                        <span className="week-day-chip">{rangeText(d.fuelling.fluid_ml_per_hour)} ml/hr</span>
                      </div>
                    )}
                  </div>
                  {d.is_today && <span className="week-day-badge">Today</span>}
                  {!d.is_today && (d.is_key_day || d.is_double) && (
                    <span className="week-day-badge key">{d.is_key_day ? 'Key' : 'Double'}</span>
                  )}
                  {!d.is_today && !d.is_key_day && !d.is_double && d.duration_label && d.duration_label !== 'length not set' && (
                    <span className="week-day-meta">{d.duration_label}</span>
                  )}
                </div>
              ))}
            </div>

            <p className="week-foot">{data.footnote}</p>
          </>
        )}
      </div>

      {recapDate && (
        <SessionRecapView
          date={recapDate}
          onBack={() => setRecapDate(null)}
          onOpenChat={onOpenChat}
          onOpenMemory={onOpenMemory}
        />
      )}
    </div>
  );
}
