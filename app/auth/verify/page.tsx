'use client';

import { useEffect, useState } from 'react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from '../../../lib/supabase/client';

/**
 * Lands a hand-generated sign-in link (scripts/generate-invite-link.ts) —
 * not the normal "Send me a link" flow. That admin-minted action_link points
 * at Supabase's hosted /verify, which redirects to /auth/callback with a
 * PKCE `code`; exchanging it needs a code_verifier this browser never set
 * (only signInWithOtp, called from this same browser, sets one), so it
 * fails for anyone who didn't request their own link. verifyOtp with a
 * token_hash sidesteps that — same mechanism the login page's own 6-digit
 * code fallback already uses, just carried in the URL instead of typed in.
 */
export default function VerifyPage() {
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token_hash = params.get('token_hash');
    const type = params.get('type') as EmailOtpType | null;
    const next = params.get('next') ?? '/';

    if (!token_hash || !type) {
      setError('This link is missing required parameters — ask for a fresh one.');
      return;
    }

    const supabase = createSupabaseBrowserClient();
    supabase.auth.verifyOtp({ token_hash, type }).then(({ error }) => {
      if (error) {
        setError(error.message);
      } else {
        // Full reload, same as the login page's code-verify path, so the
        // server (middleware, server components) picks up the new session
        // cookie rather than just the client-side SDK state.
        window.location.assign(next);
      }
    });
  }, []);

  return (
    <div className="app">
      <div className="landing">
        <div className="onboard-avatar">K</div>
        <h1>Kona</h1>
        <p className="blurb">{error ? `Couldn't sign you in: ${error}. Ask for a fresh link.` : 'Signing you in…'}</p>
      </div>
    </div>
  );
}
