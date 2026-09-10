import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './env';

/**
 * A request-scoped Supabase client bound to the caller's auth cookies. Every
 * query it issues runs as the signed-in user, so RLS enforces isolation.
 *
 * Returns null when Supabase is not configured (dev fallback path).
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;

  const cookieStore = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — cookie writes are not allowed
          // there. The middleware refreshes the session cookie instead.
        }
      },
    },
  });
}
