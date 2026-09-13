/**
 * The browser is the only place that reliably knows the athlete's timezone
 * (the server's own clock is not it — see src/domain/time.ts for why that
 * matters). Sent as a header on every request that resolves "today"/"now".
 */
export function tzHeaders(): Record<string, string> {
  try {
    return { 'x-kona-tz': Intl.DateTimeFormat().resolvedOptions().timeZone };
  } catch {
    return {};
  }
}
