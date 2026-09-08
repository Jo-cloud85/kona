import type { Profile, Sport } from '../domain/types';

/**
 * The opening message Kona shows once, right after onboarding. Warm and short —
 * an assistant introducing itself, NOT an app reciting a calculation. It orients
 * the athlete around their goal and offers a few first things to say.
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
  gym: 'strength',
  climbing: 'climbing',
  skating: 'skating',
  combat_sports: 'combat sports',
  hyrox: 'HYROX',
  triathlon: 'triathlon',
  other: 'training',
};

export function buildStarter(profile: Profile): ChatStarter {
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
