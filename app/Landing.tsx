'use client';

import { useRef, useState } from 'react';
import { TriangleMark } from './brand-icon';

const SLIDE_COUNT = 4;

const LOOP_STEPS = [
  'Plan your week',
  'Talk it through with Kona',
  'Train',
  'Check in, in your own words',
  'Adapt the next session',
  'Remember, for next time',
];

const FEATURES = [
  { label: 'During training', body: 'Fluid, sodium, carbohydrate — sized to the session.' },
  { label: 'Daily recovery', body: 'Protein, meals, sleep — the basics, not calorie-counting.' },
  { label: 'Planned vs. actual', body: 'An 18km run that becomes 10km stays two facts, never one story.' },
];

export default function Landing({ onContinue }: { onContinue: () => void }) {
  const [slide, setSlide] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const next = () => (slide === SLIDE_COUNT - 1 ? onContinue() : setSlide((s) => s + 1));

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    const endX = e.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (startX === null || endX === undefined) return;
    const dx = endX - startX;
    if (dx < -40) next();
    if (dx > 40 && slide > 0) setSlide((s) => s - 1);
  };

  return (
    <div className="lc-screen" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {slide < SLIDE_COUNT - 1 && (
        <button className="lc-skip" onClick={onContinue}>
          Skip
        </button>
      )}

      <div className="lc-body">
        {slide === 0 && (
          <div className="lc-hero">
            <div className="lc-mark">
              <TriangleMark />
            </div>
            <h1>Kona</h1>
            <p className="lc-tagline">Your AI endurance companion.</p>
            <p className="lc-blurb">
              Kona learns what you&apos;re training for, what you did, how you fuelled, and how you felt — then
              helps you prepare for the next one.
            </p>
          </div>
        )}

        {slide === 1 && (
          <div className="lc-content">
            <p className="lc-eyebrow">How it works</p>
            <h1 className="lc-h1">One loop, always running.</h1>
            <div className="lc-rows">
              {LOOP_STEPS.map((step, i) => (
                <div
                  key={step}
                  className={`lc-row lc-si${i === LOOP_STEPS.length - 1 ? ' lc-row-accent' : ''}`}
                  style={{ animationDelay: `${0.05 + i * 0.1}s` }}
                >
                  <span className="lc-row-num">{i + 1}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}

        {slide === 2 && (
          <div className="lc-content">
            <p className="lc-eyebrow">What it tracks</p>
            <h1 className="lc-h1">Fuel, without the spreadsheet.</h1>
            <div className="lc-cards">
              {FEATURES.map((f, i) => (
                <div
                  key={f.label}
                  className={`lc-card lc-si${i === FEATURES.length - 1 ? ' lc-card-accent' : ''}`}
                  style={{ animationDelay: `${0.05 + i * 0.15}s` }}
                >
                  <p className="lc-card-label">{f.label}</p>
                  <p className="lc-card-body">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {slide === 3 && (
          <div className="lc-content">
            <p className="lc-eyebrow">Worth knowing</p>
            <h1 className="lc-h1">Honest, not clinical.</h1>
            <p className="lc-trust-body">
              Kona isn&apos;t a doctor or a dietitian. It labels estimates as estimates, never invents false
              precision, and tells you plainly when something needs real medical attention.
            </p>
          </div>
        )}
      </div>

      <div className="lc-foot">
        <div className="lc-dots">
          {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
            <span key={i} className={i === slide ? 'lc-dot on' : 'lc-dot'} />
          ))}
        </div>
        {slide === SLIDE_COUNT - 1 ? (
          <button className="cta lc-cta" onClick={onContinue}>
            Get started
          </button>
        ) : (
          <button className="lc-next" onClick={next} aria-label="Next">
            →
          </button>
        )}
      </div>
    </div>
  );
}
