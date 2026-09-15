import type { PlannedSession, Profile, Sport } from '../domain/types';
import type { KonaBriefing } from './briefing';

/**
 * The opening message Kona shows on an empty conversation. Warm and short — an
 * assistant introducing itself, NOT an app reciting a calculation. When there's
 * a plan, it also *initiates*: it leads with the Kona Briefing (M24) — the
 * SAME judgment Home shows, not a separate read of the schedule — so the
 * athlete is never made to ask "what should I do today?" before Kona uses
 * what it already knows.
 */

export interface ChatStarter {
  greeting: string;
  /** Suggested first messages — the client pre-fills the composer with these. */
  prompts: { label: string; prefill: string }[];
}

/** Optional context so the opener can point at what's actually coming up. */
export interface StarterContext {
  now: Date;
  /** Planned sessions from the current weekly plan (any dates). */
  sessions: PlannedSession[];
  /** The same briefing `lib/kona-server.ts` computes for Home (M24.4). */
  briefing?: KonaBriefing;
}

const SPORT_LABEL: Record<Sport, string> = {
  running: 'running',
  cycling: 'cycling',
  swimming: 'swimming',
  gym: 'strength',
  cardio: 'cardio',
  crossfit: 'CrossFit',
  climbing: 'climbing',
  skating: 'skating',
  combat_sports: 'combat sports',
  hyrox: 'HYROX',
  triathlon: 'triathlon',
  other: 'training',
};

export function buildStarter(profile: Profile, ctx?: StarterContext): ChatStarter {
  const name = profile.username?.trim() || 'there';
  const sports =
    profile.usual_sports.length > 0
      ? profile.usual_sports.map((s) => SPORT_LABEL[s]).join(', ')
      : 'training';

  const lines = [
    `Hi ${name}, I'm Kona — your endurance companion.`,
    '',
    `Bring your training plan and I'll help you execute it sustainably — I don't sync Strava, Garmin or a watch, ` +
      `so tell me in your own words. I've got ${sports} from your setup.`,
  ];

  if (profile.goal?.text) {
    lines.push('', `You're working towards: ${profile.goal.text}. I'll keep that in view.`);
  } else {
    lines.push(
      '',
      `What are you working towards right now — a race, an event, or just staying consistent? ` +
        `Then tell me your plan or your next session.`,
    );
  }

  const briefing = ctx?.briefing;
  if (briefing) {
    const lead = briefing.session_label ? `${briefing.when ?? 'Coming up'} · ${briefing.session_label}` : briefing.when;
    lines.push('', lead ? `${lead} — ${briefing.headline}.` : `${briefing.headline}.`);
    if (briefing.why) lines.push(briefing.why);
    lines.push(briefing.action);
    const targetSessions = briefing.date ? (ctx?.sessions ?? []).filter((s) => s.start_at.slice(0, 10) === briefing.date) : [];
    if (targetSessions.some((s) => (s.needs_detail ?? []).length > 0)) {
      lines.push('Fill in the rest of the details when you get a chance and I can sort the fuelling too.');
    }
  }

  if (profile.recent_injuries_note) {
    lines.push('', `You mentioned: ${profile.recent_injuries_note} — I'll keep that in mind.`);
  }

  return {
    greeting: lines.join('\n'),
    prompts: [
      { label: 'My training plan', prefill: 'My training plan is: ' },
      { label: "What I'm doing today or tomorrow", prefill: "Tomorrow I'm doing " },
      { label: 'My next race', prefill: 'My next race is ' },
    ],
  };
}
