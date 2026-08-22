'use client';

import * as React from 'react';

const noopSubscribe = () => () => undefined;

/**
 * True only after hydration, false during SSR and the first client render.
 *
 * Uses `useSyncExternalStore` rather than `useState` + `useEffect`, which is the
 * pattern React 19 wants: no cascading render, and the server snapshot is
 * explicit instead of implied by an effect that has not run yet.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * A boolean persisted in `localStorage`, read without tripping hydration.
 *
 * Returns the server default until hydrated, then the stored value. Storage
 * access is wrapped because it throws in some privacy modes.
 */
export function usePersistedFlag(
  key: string,
  serverDefault = false,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const subscribe = React.useCallback((onChange: () => void) => {
    const handler = (e: StorageEvent) => {
      if (e.key === null || e.key === key) onChange();
    };
    window.addEventListener('storage', handler);
    window.addEventListener('cp360:storage', onChange);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('cp360:storage', onChange);
    };
  }, [key]);

  const getSnapshot = React.useCallback(() => {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return serverDefault;
    }
  }, [key, serverDefault]);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, () => serverDefault);

  const setValue = React.useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(getSnapshot()) : next;
      try {
        window.localStorage.setItem(key, resolved ? '1' : '0');
      } catch {
        // Non-fatal: the preference simply will not persist.
      }
      // Same-tab listeners do not receive `storage`, so nudge them directly.
      window.dispatchEvent(new Event('cp360:storage'));
    },
    [key, getSnapshot],
  );

  return [value, setValue];
}
