'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '../../lib/supabase/client';

const CONFIGURED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  if (!CONFIGURED) {
    return (
      <div className="app">
        <div className="landing">
          <h1 className="wordmark">Kona</h1>
          <p className="blurb">
            Running in local dev mode — Supabase is not configured, so there is no sign-in. You are a single
            local user and data resets on restart. <a href="/">Open Kona →</a>
          </p>
        </div>
      </div>
    );
  }

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setStatus('sending');
    setError('');
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: addr,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setStatus('error');
      } else {
        setStatus('sent');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link.');
      setStatus('error');
    }
  };

  return (
    <div className="app">
      <div className="landing">
        <h1 className="wordmark">Kona</h1>
        <p className="blurb">Your AI endurance companion. Sign in with a link — no password.</p>

        {status === 'sent' ? (
          <p className="blurb">
            Check <strong>{email}</strong> for a sign-in link. You can close this tab.
          </p>
        ) : (
          <form className="form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button type="submit" className="cta" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send me a link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
