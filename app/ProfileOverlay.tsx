'use client';

import { useEffect, useState } from 'react';
import ProfileForm, { type ProfileValues } from './ProfileForm';
import SignOutButton from './SignOutButton';

const SPORT_LABEL: Record<string, string> = {
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  gym: 'Strength',
  climbing: 'Climbing',
  skating: 'Skating',
  combat_sports: 'Combat sports',
  hyrox: 'HYROX',
  triathlon: 'Triathlon',
  other: 'Training',
};

/**
 * Account settings. Per the mockup's own stated intent, this is deliberately
 * NOT a bottom-nav tab — it stays "Home's own small avatar button," a
 * full-screen overlay, not a settings sub-screen given equal billing with
 * Home/Chat/Week/Memory/You.
 */
export default function ProfileOverlay({
  open,
  name,
  onClose,
  onSaved,
  checkinNudgeLabel,
  onOpenCheckin,
}: {
  open: boolean;
  /** Fallback display name / avatar initial before the profile loads. */
  name: string;
  onClose: () => void;
  onSaved: (p: ProfileValues) => void;
  /** When set, a check-in nudge banner is shown that calls `onOpenCheckin`. */
  checkinNudgeLabel?: string;
  onOpenCheckin?: () => void;
}) {
  const [profileInitial, setProfileInitial] = useState<ProfileValues | null>(null);

  useEffect(() => {
    if (!open || profileInitial) return;
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d: { profile: ProfileValues | null }) => setProfileInitial(d.profile ?? {}))
      .catch(() => setProfileInitial({}));
  }, [open, profileInitial]);

  if (!open) return null;

  const initial = (name.trim()[0] ?? 'K').toUpperCase();

  return (
    <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Profile">
      <div className="profile-overlay-bar">
        <h1>Profile</h1>
        <button className="profile-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {checkinNudgeLabel && onOpenCheckin && (
        <button className="checkin-nudge profile-checkin-nudge" onClick={onOpenCheckin}>
          {checkinNudgeLabel}
        </button>
      )}
      {profileInitial && (profileInitial.username || profileInitial.usual_sports?.length) && (
        <div className="profile-head">
          <div className="profile-head-avatar">{(profileInitial.username?.trim()[0] ?? initial).toUpperCase()}</div>
          <div>
            <h2>{profileInitial.username || name}</h2>
            <p>
              {(profileInitial.usual_sports ?? []).map((s) => SPORT_LABEL[s] ?? s).join(', ')}
              {profileInitial.typical_weekly_sessions ? ` · ${profileInitial.typical_weekly_sessions} sessions / week` : ''}
            </p>
          </div>
        </div>
      )}
      <div className="app">
        <div className="landing profile-blurb">
          <p className="blurb">Update your weight, usual bottle, sports or goal — anything. It sharpens Kona&apos;s advice.</p>
        </div>
        {profileInitial ? (
          <ProfileForm
            initial={profileInitial}
            submitLabel="Save changes"
            onSaved={(p) => {
              setProfileInitial(p);
              onSaved(p);
              onClose();
            }}
          />
        ) : (
          <p className="dash-msg" style={{ textAlign: 'center' }}>
            Loading…
          </p>
        )}

        <div className="profile-signout">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
