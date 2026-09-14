'use client';

/**
 * In-memory, per-browser-tab cache for the read-only tab views (Home, Week,
 * Memory, You). AppShell remounts the active tab's component on every nav
 * switch (`key={tab}` in AppShell.tsx resets its transient UI state), which
 * would otherwise mean a full "Loading…" spinner and a refetch of unchanged
 * data every time someone taps back to a tab they were just on.
 *
 * A module-level Map survives that remount (it isn't React state), so a tab
 * can paint its last-known data immediately instead of blanking to a
 * spinner, while still kicking off a fresh fetch in the background to catch
 * anything that changed. Cleared on full page reload — including sign-out,
 * which navigates via `window.location.assign` — so nothing carries across
 * accounts.
 */
const store = new Map<string, unknown>();

export function readCache<T>(key: string): { value: T } | null {
  return store.has(key) ? { value: store.get(key) as T } : null;
}

export function writeCache<T>(key: string, value: T): void {
  store.set(key, value);
}
