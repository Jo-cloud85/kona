import type { PlannedSession, Profile, Sport } from '../domain/types';

/**
 * The opening message Kona shows on an empty conversation. Warm and short — an
 * assistant introducing itself, NOT an app reciting a calculation. When there's
 * a plan, it also *initiates*: it leads with the nearest session worth preparing
 * for, rather than waiting to be asked.
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
}

const SPORT_LABEL: Record<Sport, string> = {
  running: 'running',
  cycling: 'cycling',
  swimming: 'swimming',
  gym: 'strength',
  climbing: 'climbing',
  skating: 'skating',
  combat_sports: 'combat sports',
  hyrox: 'HYROX',
  triathlon: 'triathlon',
  other: 'training',
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Whole days from `now` (local midnight) to the date string, or null if past. */
function daysUntil(dateStr: string, now: Date): number {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const then = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((then - today) / 86_400_000);
}

function whenLabel(days: number, dateStr: string): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  return `on ${WEEKDAY[new Date(y, m - 1, d).getDay()]}`;
}

function describeSession(s: PlannedSession): string {
  const dist = s.distance_km ? `${s.distance_km} km ` : '';
  const effort = s.is_long ? 'long ' : s.intensity && s.intensity !== 'easy' ? `${s.intensity} ` : '';
  const sport = SPORT_LABEL[s.sport] ?? s.sport;
  return `${dist}${effort}${sport}`.trim();
}

/** The next session worth preparing for, within the next few days. Key sessions
 *  (long / hard / part of a double day) win; otherwise just the soonest one. */
function nextNotable(sessions: PlannedSession[], now: Date): { session: PlannedSession; days: number; key: boolean } | null {
  const today = ymd(now);
  const byDate = new Map<string, number>();
  for (const s of sessions) {
    const day = s.start_at.slice(0, 10);
    byDate.set(day, (byDate.get(day) ?? 0) + 1);
  }
  const upcoming = sessions
    .map((s) => ({ s, days: daysUntil(s.start_at.slice(0, 10), now) }))
    .filter(({ s, days }) => s.start_at.slice(0, 10) >= today && days >= 0 && days <= 3)
    .sort((a, b) => a.days - b.days || a.s.start_at.localeCompare(b.s.start_at));
  if (upcoming.length === 0) return null;

  const isKey = (s: PlannedSession) =>
    Boolean(s.is_long) || s.intensity === 'hard' || (byDate.get(s.start_at.slice(0, 10)) ?? 0) > 1;

  const key = upcoming.find(({ s }) => isKey(s));
  const pick = key ?? upcoming[0]!;
  return { session: pick.s, days: pick.days, key: Boolean(key) };
}

export function buildStarter(profile: Profile, ctx?: StarterContext): ChatStarter {
  const name = profile.username?.trim() || 'there';
  const sports =
    profile.usual_sports.length > 0
      ? profile.usual_sports.map((s) => SPORT_LABEL[s]).join(', ')
      : 'training';

  const lines = [
    `Hi ${name}, I'm Kona — your endurance companion.`,
    '',
    `I'll help you prepare for sessions, remember what actually happens, and use that history the next time. ` +
      `I've got ${sports} from your setup.`,
  ];

  if (profile.goal?.text) {
    lines.push('', `You're working towards: ${profile.goal.text}. I'll keep that in view.`);
  } else {
    lines.push(
      '',
      `What are you working towards right now — a race, an event, or just staying consistent? ` +
        `Then tell me about your week or your next session.`,
    );
  }

  const notable = ctx ? nextNotable(ctx.sessions, ctx.now) : null;
  if (notable) {
    const when = whenLabel(notable.days, notable.session.start_at.slice(0, 10));
    const desc = describeSession(notable.session);
    const needsDetail = (notable.session.needs_detail ?? []).length > 0;
    if (notable.key) {
      lines.push(
        '',
        needsDetail
          ? `Coming up ${when}: your ${desc}. That's a session worth getting right — tell me the details and we'll sort the fuelling.`
          : `Coming up ${when}: your ${desc}. That's a real fuelling day — want to plan it before then?`,
      );
    } else {
      lines.push(
        '',
        `You've got a ${desc} ${when}. ` +
          (needsDetail ? `Fill me in on it and I'll help you prepare.` : `Say the word and I'll help you fuel it.`),
      );
    }
  }

  if (profile.recent_injuries_note) {
    lines.push('', `You mentioned: ${profile.recent_injuries_note} — I'll keep that in mind.`);
  }

  return {
    greeting: lines.join('\n'),
    prompts: [
      { label: 'My training week', prefill: 'My typical training week is: ' },
      { label: "What I'm doing today or tomorrow", prefill: "Tomorrow I'm doing " },
      { label: 'My next race', prefill: 'My next race is ' },
    ],
  };
}
