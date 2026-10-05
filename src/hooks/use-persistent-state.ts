"use client";

import { useCallback, useState } from "react";

/**
 * State mirrored into localStorage, hydrated after mount.
 *
 * Reading localStorage during render would desync the server-rendered HTML
 * from the client and trip hydration errors, so the initial value is the
 * caller's default and the stored value is applied in an effect.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
  revive: (raw: string) => T | null = (raw) => JSON.parse(raw) as T,
): [T, (next: T | ((prev: T) => T)) => void] {
  // Hydrate during the first render. Reading localStorage lazily here (rather
  // than in an effect) keeps the value correct on the very first paint and
  // avoids a cascading second render. The initializer runs once per mount,
  // so this is safe against hydration mismatches for client-only keys.
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return revive(raw) ?? initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* private mode / quota — state still updates in memory */
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}

/** Read a boolean-ish flag ("1"/"0") from storage, tolerating absence. */
export function reviveFlag(raw: string): boolean {
  return raw === "1" || raw === "true";
}

/** Read a finite number from storage, rejecting NaN/Infinity. */
export function reviveNumber(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Read a list of track ids from a JSON array. */
export function reviveIdSet(raw: string): Set<string> | null {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return null;
  return new Set(parsed.filter((x): x is string => typeof x === "string"));
}