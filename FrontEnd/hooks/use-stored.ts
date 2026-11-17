"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

/**
 * localStorage-backed string, safe for SSR (server snapshot is null, so no hydration mismatch).
 * `ready` is false until the browser has actually read storage: on the server and during the first client
 * render a stored value looks like "nothing stored", so gate "signed out" UI on `ready` to avoid a flash.
 */
export function useStored(key: string) {
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => read(key),
    () => null,
  );
  const set = useCallback(
    (next: string | null) => {
      try {
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, next);
      } catch {}
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set, ready] as const;
}

export const ADMIN_TOKEN_KEY = "yspace.admin.token";
export const guestKey = (spaceId: string) => `yspace.guest.${spaceId}`;
