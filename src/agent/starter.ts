import type { Profile, Sport } from '../domain/types';
import { profileDailyBaseline } from '../engine/index';

/**
 * The opening message Kona shows once, right after onboarding: a greeting, a
 * plain-language summary of the form inputs and the daily baseline (numbers from
 * the deterministic engine only), and a few conversation starters.
 */

export interface ChatStarter {
  greeting: string;
  /** Suggested first messages — the client pre-fills the composer with these. */
  prompts: { label: string; prefill: string }[];
}

const SPORT_LABEL: Record<Sport, string> = {
  running: 'running',
  cycling: 'cycling',
  swimming: 'swimming',
  gym: 'gym',
  climbing: 'climbing',
  hyrox: 'HYROX',
  triathlon: 'triathlon',
  other: 'other training',
};

function rating(n: number | undefined): string {
  return typeof n === 'number' ? `${n}/5` : '—';
}

export function buildStarter(profile: Profile): ChatStarter {
  const name = profile.username?.trim() || 'there';
  const base = profileDailyBaseline({ body_weight_kg: profile.body_weight_kg });

  const sports =
    profile.usual_sports.length > 0
      ? profile.usual_sports.map((s) => SPORT_LABEL[s]).join(', ')
      : 'training';
  const sessions = profile.typical_weekly_sessions;
  const p = profile.self_perception;

  const lines: string[] = [
    `Hi ${name}, I'm Kona — your AI fueling companion for training.`,
    '',
    `Here's what I've got from your form: ${profile.body_weight_kg} kg` +
      (profile.age ? `, ${profile.age}` : '') +
      `, ${sports}` +
      (typeof sessions === 'number' ? `, about ${sessions} session${sessions === 1 ? '' : 's'} a week` : '') +
      (p ? `. You rate your sleep ${rating(p.sleep_quality)}, hydration ${rating(p.hydration)}, sweat ${rating(p.sweat_level)}.` : '.'),
  ];

  if (profile.recent_injuries_note) {
    lines.push('', `You mentioned: ${profile.recent_injuries_note} — I'll keep that in mind.`);
  }

  lines.push(
    '',
    `A rough daily protein target for you is about ${base.protein_daily_g.min}–${base.protein_daily_g.max} g ` +
      `(${base.protein_daily_g_per_kg.min}–${base.protein_daily_g_per_kg.max} g/kg), with roughly ` +
      `${base.post_session_protein_g.min}–${base.post_session_protein_g.max} g in the meal after a session.`,
    `Fluid and sodium aren't a fixed daily number — they depend on each workout. As a starting point, plan around ` +
      `${base.training_fluid_ml_per_hour.min}–${base.training_fluid_ml_per_hour.max} ml of fluid per hour of exercise, ` +
      `and for long or hot sessions a drink with about ${base.training_sodium_mg_per_litre.min}–${base.training_sodium_mg_per_litre.max} mg sodium per litre. ` +
      `I'll give you specific numbers per session as we go.`,
    '',
    `These are starting ranges from general guidance, not exact targets. Tell me more and I can make them fit you:`,
  );

  return {
    greeting: lines.join('\n'),
    prompts: [
      { label: 'My typical training week', prefill: 'My typical training week is: ' },
      { label: "What I'm doing today or tomorrow", prefill: 'Tomorrow I\'m doing ' },
      { label: 'My next race', prefill: 'My next race is ' },
    ],
  };
}
