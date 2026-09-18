'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '../../lib/supabase/client';
import Landing from '../Landing';

const CONFIGURED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SEEN_LANDING_KEY = 'kona_seen_landing';

export default function LoginPage() {
  // Shown once per browser to anyone who isn't signed in — including right
  // after Sign Out, which is the only place a real user reaches this page.
  // `null` until the localStorage check resolves on mount (avoids an SSR/
  // client hydration mismatch); resolving to `false` reveals the carousel,
  // `true` skips straight to the sign-in form below.
  const [seenLanding, setSeenLanding] = useState<boolean | null>(null);
  useEffect(() => {
    if (!CONFIGURED) return;
    try {
      setSeenLanding(localStorage.getItem(SEEN_LANDING_KEY) === '1');
    } catch {
      setSeenLanding(true);
    }
  }, []);

  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState('');

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

  if (seenLanding === false) {
    return (
      <Landing
        onContinue={() => {
          try {
            localStorage.setItem(SEEN_LANDING_KEY, '1');
          } catch {
            /* ignore */
          }
          setSeenLanding(true);
        }}
      />
    );
  }
  if (seenLanding === null) return null;

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

  const verifyCode = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const token = code.trim();
    if (!token) return;
    setVerifying(true);
    setCodeError('');
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (error) {
        setCodeError(error.message);
        setVerifying(false);
        return;
      }
      // Full reload so the server (middleware, server components) picks up the new session cookie.
      window.location.assign('/');
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'Could not verify that code.');
      setVerifying(false);
    }
  };

  return (
    <div className="app">
      <div className="landing">
        <div className="onboard-avatar">K</div>
        <h1>Kona</h1>
        <p className="blurb">Your AI endurance companion. Sign in with a link — no password.</p>

        {status === 'sent' ? (
          <>
            <p className="blurb">
              Check <strong>{email}</strong> for a sign-in link — tap it and you&apos;re in.
            </p>
            <p className="blurb">
              Link not working? Some mail providers (Outlook/Live especially) scan links before you open the
              email, which can use it up before you click it. Enter the 6-digit code from the same email instead:
            </p>
            <form className="form" onSubmit={verifyCode}>
              <div className="field">
                <label htmlFor="code">Code</label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                />
              </div>
              {codeError && <p className="form-error">{codeError}</p>}
              <div className="form-actions">
                <button type="submit" className="cta" disabled={verifying || !code.trim()}>
                  {verifying ? 'Verifying…' : 'Verify code'}
                </button>
              </div>
            </form>
          </>
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
