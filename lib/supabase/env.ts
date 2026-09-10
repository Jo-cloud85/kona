/**
 * Supabase configuration, read from the environment.
 *
 * Only the anon (public) key is used anywhere in this app — RLS is the security
 * boundary, so a user-scoped anon client is sufficient and correct. The
 * service-role key is deliberately NOT read here and must never reach the
 * browser.
 *
 * When these are unset the app runs in a dev-only, single-user, in-memory
 * fallback (see `lib/server-context.ts`). That fallback is refused in
 * production.
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (url && anonKey) return { url, anonKey };
  return null;
}

export function isPersistenceConfigured(): boolean {
  return supabaseConfig() !== null;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
