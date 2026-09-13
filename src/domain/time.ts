/**
 * Athlete-local time. Nothing in this app stores or reliably knows the
 * athlete's timezone — every "what day is it" computation used to fall back
 * to the server's own clock. That's harmless in local dev (the dev server
 * runs on the founder's own machine, same timezone as the browser) but wrong
 * in production: Vercel's server timezone is UTC, so for however many hours
 * a day the athlete's offset spans (~8/day for Singapore), a message sent
 * near local midnight gets attributed to the wrong calendar day — resolving
 * "today"/"tomorrow" wrong when Kona saves a session, and mis-bucketing
 * already-stored records when reading them back by day.
 *
 * The fix doesn't touch what gets stored — `created_at`/`logged_at` stay
 * real, unambiguous UTC instants, which is correct. It only changes how
 * "now"/"today" get computed from those instants, given the athlete's IANA
 * timezone (sent by the client, which is the only place that reliably knows
 * it — see app/client-tz.ts).
 */

export const DEFAULT_TZ = 'UTC';

/** Falls back to UTC for a missing/invalid zone rather than throwing. */
export function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/**
 * A Date whose LOCAL getters (getFullYear/getMonth/getDate/getHours/...)
 * read back the athlete's wall-clock time in `tz`, for the real instant
 * `real`. Every existing "now" consumer in this codebase (buildHome,
 * buildWeek, buildStarter, orchestrator's now_iso) already reads local
 * getters off a `Date`, so passing this in place of `new Date()` fixes them
 * with no further changes — the round trip (construct via local getters,
 * read via local getters) is exact regardless of what timezone the server
 * process itself runs in.
 */
export function athleteNow(tz: string, real: Date = new Date()): Date {
  const zone = safeTz(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(real);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Some engines render midnight as hour "24" with hour12:false.
  const hour = get('hour') % 24;
  return new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
}

/**
 * Formats a Date using its own LOCAL getters — e.g. "2026-09-14T00:20:00" —
 * never converting to UTC. This is the naive-local-datetime convention this
 * codebase already uses for `start_at` fields throughout the domain model.
 *
 * Deliberately NOT `.toISOString()`: that always renders the Date's true UTC
 * instant regardless of how it was constructed, which silently undoes
 * athleteNow()'s whole point — a Date built from the athlete's local
 * y/m/d/h/mi/s round-trips correctly through LOCAL getters (ymdLocal,
 * isoDate, buildHome, buildWeek all already use those), but `.toISOString()`
 * would convert it back to a real UTC string, discarding exactly the
 * athlete-local reading it was built to preserve.
 */
export function localIsoString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** YYYY-MM-DD of a stored UTC-ish instant, in the athlete's local calendar
 *  day — for bucketing already-saved records (recovery/fuel logs) by day. */
export function localDateOf(iso: string, tz: string): string {
  const zone = safeTz(tz);
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** HH:MM of a stored UTC-ish instant, in the athlete's local time — e.g. for
 *  "logged 21:04" on the session recap screen. */
export function localTimeOf(iso: string, tz: string): string {
  const zone = safeTz(tz);
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = String(Number(get('hour')) % 24).padStart(2, '0');
  return `${hour}:${get('minute')}`;
}
