'use client';

import { useEffect, useState } from 'react';

interface Range {
  min: number;
  max: number;
}
interface DDay {
  date: string;
  weekday: string;
  is_rest: boolean;
  sessions: { sport: string; duration_class: string | null; is_long: boolean; needs_detail: boolean }[];
  carb_g_per_hour: Range | null;
  fluid_ml_per_hour: Range | null;
  sodium_mg_per_litre: Range | null;
}
interface Dashboard {
  has_plan: boolean;
  week_start: string | null;
  week_end: string | null;
  baseline: { protein_daily_g: Range; protein_daily_g_per_kg: Range; post_session_protein_g: Range };
  days: DDay[];
  methodology_version: string;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

function sessionText(day: DDay): string {
  if (day.is_rest) return 'rest';
  return day.sessions
    .map((s) => `${s.is_long ? 'long ' : ''}${s.sport}${s.duration_class ? ` · ${s.duration_class.toLowerCase().replace('_', ' ')}` : ''}`)
    .join(' + ');
}

/** Short label for a chart row (the gutter is narrow). */
function compactSessions(day: DDay): string {
  if (day.is_rest) return 'rest';
  if (day.sessions.length === 1) {
    const s = day.sessions[0]!;
    return `${s.is_long ? 'long ' : ''}${s.sport}`;
  }
  return day.sessions.map((s) => s.sport).join(' + ');
}

/** A horizontal range-bar chart: one floating bar per day, shared scale. */
function RangeChart({
  title,
  unit,
  max,
  rows,
}: {
  title: string;
  unit: string;
  max: number;
  rows: { label: string; sub: string; range: Range | null }[];
}) {
  const W = 640;
  const LEFT = 116;
  const RIGHT = 84;
  const rowH = 34;
  const plotW = W - LEFT - RIGHT;
  const H = rows.length * rowH + 30;
  const x = (v: number) => LEFT + (Math.min(v, max) / max) * plotW;
  const ticks = [0, max / 2, max];

  return (
    <figure className="viz">
      <figcaption>
        {title} <span className="viz-unit">({unit})</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="viz-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={6} y2={H - 22} className="viz-grid" />
            <text x={x(t)} y={H - 8} className="viz-tick" textAnchor="middle">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = 8 + i * rowH;
          return (
            <g key={r.label} className="viz-row">
              <title>
                {r.label}: {r.range ? `${r.range.min}–${r.range.max} ${unit}` : 'no during-session target'}
                {r.sub ? ` — ${r.sub}` : ''}
              </title>
              <text x={LEFT - 10} y={y + rowH / 2 - 3} className="viz-rowlabel" textAnchor="end">
                {r.label}
              </text>
              <text x={LEFT - 10} y={y + rowH / 2 + 9} className="viz-rowsub" textAnchor="end">
                {r.sub}
              </text>
              <rect x={LEFT} y={y + 6} width={plotW} height={rowH - 16} rx={5} className="viz-track" />
              {r.range ? (
                <>
                  <rect
                    x={x(r.range.min)}
                    y={y + 6}
                    width={Math.max(x(r.range.max) - x(r.range.min), 3)}
                    height={rowH - 16}
                    rx={4}
                    className="viz-fill"
                  />
                  <text x={x(r.range.max) + 8} y={y + rowH / 2 + 1} className="viz-value">
                    {r.range.min}–{r.range.max}
                  </text>
                </>
              ) : (
                <text x={LEFT + 8} y={y + rowH / 2 + 1} className="viz-none">
                  not needed for this session
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d: { dashboard: Dashboard | null }) => setData(d.dashboard))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const trainingDays = (data?.days ?? []).filter((d) => !d.is_rest);
  const carbRows = trainingDays.map((d) => ({
    label: d.weekday,
    sub: compactSessions(d),
    range: d.carb_g_per_hour,
  }));
  const fluidRows = trainingDays.map((d) => ({
    label: d.weekday,
    sub: compactSessions(d),
    range: d.fluid_ml_per_hour,
  }));
  const sodiumDays = trainingDays.filter((d) => d.sodium_mg_per_litre);

  return (
    <div className="dash">
      <header className="dash-head">
        <a className="back" href="/">
          ← Back to chat
        </a>
        <h1>Weekly fueling</h1>
        {data?.has_plan && data.week_start && (
          <p className="dash-sub">
            {fmtDate(data.week_start)} – {fmtDate(data.week_end!)} · methodology v{data.methodology_version}
          </p>
        )}
      </header>

      {!loaded && <p className="dash-msg">Loading…</p>}

      {loaded && !data && (
        <p className="dash-msg">Finish onboarding first, then come back here.</p>
      )}

      {loaded && data && !data.has_plan && (
        <div className="dash-msg">
          <p>No weekly plan yet.</p>
          <p className="muted">
            Head back to chat and tell Kona your week (e.g. &ldquo;Mon rest, Tue 6km run, Wed gym…&rdquo;) — this page
            fills in from it.
          </p>
        </div>
      )}

      {loaded && data && data.has_plan && (
        <>
          <div className="kpi-row">
            <div className="kpi">
              <span className="kpi-label">Daily protein</span>
              <span className="kpi-value">
                {data.baseline.protein_daily_g.min}–{data.baseline.protein_daily_g.max}
                <span className="kpi-unit"> g</span>
              </span>
              <span className="kpi-note">
                {data.baseline.protein_daily_g_per_kg.min}–{data.baseline.protein_daily_g_per_kg.max} g/kg · from body
                weight, general guidance
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">After a session</span>
              <span className="kpi-value">
                {data.baseline.post_session_protein_g.min}–{data.baseline.post_session_protein_g.max}
                <span className="kpi-unit"> g protein</span>
              </span>
              <span className="kpi-note">in the meal within a few hours</span>
            </div>
          </div>

          {trainingDays.length > 0 ? (
            <>
              <RangeChart title="Carbohydrate during exercise" unit="g/hour" max={90} rows={carbRows} />
              <RangeChart title="Fluid during exercise" unit="ml/hour" max={1000} rows={fluidRows} />

              <div className="callout">
                <strong>Sodium</strong> — a per-litre reference, not a daily total. For long or hot sessions
                {sodiumDays.length ? ` (${sodiumDays.map((d) => d.weekday).join(', ')})` : ''}, aim for a drink with
                about{' '}
                {sodiumDays[0]?.sodium_mg_per_litre
                  ? `${sodiumDays[0].sodium_mg_per_litre.min}–${sodiumDays[0].sodium_mg_per_litre.max}`
                  : '500–700'}{' '}
                mg sodium per litre. Cramps have several causes — treat it as something to test.
              </div>

              <details className="table-view">
                <summary>Table view</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Session</th>
                      <th>Carb (g/hr)</th>
                      <th>Fluid (ml/hr)</th>
                      <th>Sodium (mg/L)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.date}>
                        <td>{d.weekday}</td>
                        <td>{sessionText(d)}</td>
                        <td>{d.carb_g_per_hour ? `${d.carb_g_per_hour.min}–${d.carb_g_per_hour.max}` : '—'}</td>
                        <td>{d.fluid_ml_per_hour ? `${d.fluid_ml_per_hour.min}–${d.fluid_ml_per_hour.max}` : '—'}</td>
                        <td>
                          {d.sodium_mg_per_litre ? `${d.sodium_mg_per_litre.min}–${d.sodium_mg_per_litre.max}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="dash-msg muted">
              The week has no training sessions with a set duration yet — fill in effort and length in chat and the
              charts will populate.
            </p>
          )}

          <p className="dash-foot">
            Starting ranges from general sports-nutrition guidance (methodology v{data.methodology_version}), not exact
            targets. A day with no bar means that session is short/easy enough that normal meals and fluids cover it.
          </p>
        </>
      )}
    </div>
  );
}
