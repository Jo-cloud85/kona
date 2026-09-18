// Kona — generate a sign-in link without sending an email.
// ===========================================================================
// Workaround for Supabase's default (unconfigured-SMTP) email sender, which
// is rate-limited and unreliable beyond the project owner — a second real
// user hit "Error sending confirmation email" trying the normal flow
// (founder report, 2026-09-18). This calls the same admin API Supabase's own
// invite email would use, but returns the link instead of emailing it — you
// copy it and send it to the person yourself (text, WhatsApp, whatever).
//
// Needs the PRODUCTION project's service-role key (Supabase dashboard →
// Settings → API → service_role) — NOT the anon key, and NOT
// KONA_TEST_SUPABASE_SERVICE_ROLE (that's the disposable test project's).
// Keep it out of .env.example and never commit a filled-in .env.local.
//
// Usage:
//   node --env-file=.env.local --import tsx scripts/generate-invite-link.ts someone@example.com
//   node --env-file=.env.local --import tsx scripts/generate-invite-link.ts someone@example.com https://your-custom-domain.com

import { createClient } from '@supabase/supabase-js';
// Node 20 has no native WebSocket; supabase-js unconditionally spins up a
// Realtime client in createClient() even though this script never uses it,
// so without a transport it throws before we get anywhere near the admin
// API call (same gap hit earlier this session trying raw Supabase queries
// from a plain script). Node 22+ wouldn't need this.
import WebSocket from 'ws';

const email = process.argv[2];
const siteUrl = process.argv[3] ?? 'https://kona-livid.vercel.app';

if (!email) {
  console.error('Usage: generate-invite-link.ts <email> [siteUrl]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Add SUPABASE_SERVICE_ROLE_KEY to .env.local (Supabase dashboard → Settings → API → service_role) — ' +
      'NEXT_PUBLIC_SUPABASE_URL should already be there.',
  );
  process.exit(1);
}

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
});

const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });

if (error) {
  console.error('generateLink failed:', error.message);
  process.exit(1);
}

// Not data.properties.action_link — that goes through Supabase's hosted
// /verify, which redirects to /auth/callback with a PKCE `code` needing a
// code_verifier this script never set in the recipient's browser, so it
// fails for anyone but whoever ran signInWithOtp themselves. app/auth/verify
// instead calls verifyOtp with the token_hash directly, which doesn't need
// PKCE state at all (see that page's comment for the full story — this bit
// the first version of this script, 2026-09-18).
const link = `${siteUrl}/auth/verify?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`;

console.log(`\nLink for ${email} (send this to them directly — do not open it yourself):\n`);
console.log(link);
console.log('\nOne-time use, expires per your Supabase project\'s OTP validity setting (default 1 hour).');
