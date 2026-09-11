'use client';

import { useEffect, useState } from 'react';

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

const TIER_COPY: Record<Insight['tier'], string> = {
  watching: 'Still watching — not enough yet to lean on.',
  acting_on: "Confident enough to factor into today's advice.",
};
interface KnowsView {
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

export default function KnowsView() {
  const [data, setData] = useState<KnowsView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/knows')
      .then((r) => r.json())
      .then((d: { knows: KnowsView | null }) => setData(d.knows))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded)
    return (
      <div className="knows">
        <p className="dash-msg">Loading…</p>
      </div>
    );
  if (!data)
    return (
      <div className="knows">
        <p className="dash-msg">Finish onboarding first.</p>
      </div>
    );

  return (
    <div className="knows">
      <header className="dash-head">
        <h1>What Kona knows about you</h1>
        <p className="dash-sub">
          What you&apos;ve told Kona, what it&apos;s worked out from your training, and what&apos;s on record.
        </p>
      </header>

      {!data.has_anything && (
        <div className="home-card">
          <p className="plan-empty">
            Kona&apos;s still getting to know you. Tell it your week, log what you actually do, and check in after
            sessions — this page fills in as it learns.
          </p>
        </div>
      )}

      {data.insights.length > 0 && (
        <section className="knows-section">
          <h2 className="knows-h2">What Kona&apos;s worked out</h2>
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

      <p className="home-foot">
        Kona doesn&apos;t diagnose. Observations are flags to talk through, not conclusions.
      </p>
    </div>
  );
}
