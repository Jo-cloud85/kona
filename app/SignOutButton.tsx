'use client';

import { useState } from 'react';

const CONFIGURED = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/** Sign out and return to the login screen. Rendered only when auth is real. */
export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  if (!CONFIGURED) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } finally {
      window.location.assign('/login');
    }
  };

  return (
    <button type="button" className="link-btn" onClick={signOut} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
