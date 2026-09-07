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
  is_key_day: boolean;
  protein_daily_g: Range;
  sessions: { sport: string; duration_class: string | null; is_long: boolean; needs_detail: boolean }[];
  carb_g_per_hour: Range | null;
  fluid_ml_per_hour: Range | null;
  sodium_mg_per_litre: Range | null;
  prep_for: string | null;
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
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]} ${d} ${
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  }`;
}

function sessionText(day: DDay): string {
  if (day.is_rest) return 'rest';
  return day.sessions
    .map((s) => `${s.is_long ? 'long ' : ''}${s.sport}${s.duration_class ? ` · ${s.duration_class.toLowerCase().replace('_', ' ')}` : ''}`)
    .join(' + ');
}
function compact(day: DDay): string {
  if (day.is_rest) return 'rest';
  if (day.sessions.length === 1) {
    const s = day.sessions[0]!;
    return `${s.is_long ? 'long ' : ''}${s.sport}`;
  }
  return day.sessions.map((s) => s.sport).join(' + ');
}

interface Row {
  label: string;
  sub: string;
  range: Range | null;
  note?: string;
  prep?: string | null;
}

function RangeChart({ title, unit, max, rows }: { title: string; unit: string; max: number; rows: Row[] }) {
  const W = 660;
  const LEFT = 128;
  const RIGHT = 92;
  const rowH = 36;
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
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = 8 + i * rowH;
          return (
            <g key={r.label} className="viz-row">
              <title>
                {r.label}: {r.range ? `${r.range.min}–${r.range.max} ${unit}` : r.note ?? '—'}
                {r.sub ? ` — ${r.sub}` : ''}
                {r.prep ? ` · prep for ${r.prep}` : ''}
              </title>
              <text x={LEFT - 10} y={y + rowH / 2 - 3} className="viz-rowlabel" textAnchor="end">
                {r.label}
                {r.prep ? ' ⚑' : ''}
              </text>
              <text x={LEFT - 10} y={y + rowH / 2 + 9} className="viz-rowsub" textAnchor="end">
                {r.prep ? `prep for ${r.prep}` : r.sub}
              </text>
              <rect x={LEFT} y={y + 7} width={plotW} height={rowH - 18} rx={5} className="viz-track" />
              {r.range ? (
                <>
                  <rect
                    x={x(r.range.min)}
                    y={y + 7}
                    width={Math.max(x(r.range.max) - x(r.range.min), 3)}
                    height={rowH - 18}
                    rx={4}
                    className="viz-fill"
                  />
                  <text x={x(r.range.max) + 8} y={y + rowH / 2 + 1} className="viz-value">
                    {r.range.min.toLocaleString()}–{r.range.max.toLocaleString()}
                  </text>
                </>
              ) : (
                <text x={LEFT + 8} y={y + rowH / 2 + 1} className="viz-none">
                  {r.note ?? '—'}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export default function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d: { dashboard: Dashboard | null }) => setData(d.dashboard))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const days = data?.days ?? [];
  const training = days.filter((d) => !d.is_rest);
  const proteinMax = data ? Math.round(data.baseline.protein_daily_g.max * 1.25) : 200;

  const proteinRows: Row[] = days.map((d) => ({
    label: d.weekday,
    sub: d.is_rest
      ? 'rest day'
      : `+${data!.baseline.post_session_protein_g.min}–${data!.baseline.post_session_protein_g.max} g after`,
    range: d.protein_daily_g,
    prep: d.prep_for,
  }));
  const carbRows: Row[] = training.map((d) => ({
    label: d.weekday,
    sub: compact(d),
    range: d.carb_g_per_hour,
    note: 'short session — top up from meals, not during',
    prep: d.prep_for,
  }));
  const fluidRows: Row[] = training.map((d) => ({
    label: d.weekday,
    sub: compact(d),
    range: d.fluid_ml_per_hour,
    note: 'short session — drink to thirst',
    prep: d.prep_for,
  }));
  const sodiumRows: Row[] = training.map((d) => ({
    label: d.weekday,
    sub: compact(d),
    range: d.sodium_mg_per_litre,
    note: 'not needed for this session',
    prep: d.prep_for,
  }));

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>Weekly fueling</h1>
        {data?.has_plan && data.week_start && (
          <p className="dash-sub">
            {fmtDate(data.week_start)} – {fmtDate(data.week_end!)} · methodology v{data.methodology_version}
          </p>
        )}
      </header>

      {!loaded && <p className="dash-msg">Loading…</p>}
      {loaded && !data && <p className="dash-msg">Finish onboarding first, then come back here.</p>}
      {loaded && data && !data.has_plan && (
        <div className="dash-msg">
          <p>No weekly plan yet.</p>
          <p className="muted">
            Head to Chat and tell Kona your week (e.g. &ldquo;Mon rest, Tue 6km run, Wed gym…&rdquo;) — this page fills
            in from it.
          </p>
        </div>
      )}

      {loaded && data && data.has_plan && (
        <>
          <p className="dash-lead">
            Four things per day. Protein is a daily target (same every day). Carbohydrate, fluid and sodium are
            <em> during-session</em> starting references — they repeat because the engine has no measured personal data
            yet; a <strong>⚑</strong> marks the day before a long or key session, when eating and hydrating normally
            matters most.
          </p>

          <RangeChart title="Protein — daily target" unit="g/day" max={proteinMax} rows={proteinRows} />
          {training.length > 0 && (
            <>
              <RangeChart title="Carbohydrate — during exercise" unit="g/hour" max={90} rows={carbRows} />
              <RangeChart title="Fluid — during exercise" unit="ml/hour" max={1000} rows={fluidRows} />
              <RangeChart title="Sodium — electrolyte drink" unit="mg per litre" max={800} rows={sodiumRows} />
              <p className="dash-foot">
                Sodium is a per-litre concentration for the drink, not a daily amount. Cramps have several causes — treat
                it as something to test.
              </p>
            </>
          )}

          <details className="table-view">
            <summary>Table view</summary>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Session</th>
                  <th>Protein/day (g)</th>
                  <th>Carb (g/hr)</th>
                  <th>Fluid (ml/hr)</th>
                  <th>Sodium (mg/L)</th>
                  <th>Prep</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.weekday}</td>
                    <td>{sessionText(d)}</td>
                    <td>
                      {d.protein_daily_g.min}–{d.protein_daily_g.max}
                    </td>
                    <td>{d.carb_g_per_hour ? `${d.carb_g_per_hour.min}–${d.carb_g_per_hour.max}` : '—'}</td>
                    <td>{d.fluid_ml_per_hour ? `${d.fluid_ml_per_hour.min}–${d.fluid_ml_per_hour.max}` : '—'}</td>
                    <td>{d.sodium_mg_per_litre ? `${d.sodium_mg_per_litre.min}–${d.sodium_mg_per_litre.max}` : '—'}</td>
                    <td>{d.prep_for ? `for ${d.prep_for}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <p className="dash-foot">
            Starting ranges from general sports-nutrition guidance (methodology v{data.methodology_version}), not exact
            targets. A short/easy session has no <em>during</em>-session carb or sodium target — normal meals and fluids
            cover it.
          </p>
        </>
      )}
    </div>
  );
}
