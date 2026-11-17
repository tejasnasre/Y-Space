"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time in ms, refreshed every `intervalMs`. Returns 0 on the server and during hydration, so callers
 * should render a placeholder for 0. Keeps `Date.now()` out of render.
 */
export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, intervalMs);
      return () => clearInterval(id);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}
