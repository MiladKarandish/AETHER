"use client";

import { useCallback, useEffect } from "react";
import { TRACKS, remixTrack, variationOf, type Track } from "@/lib/tracks";

/**
 * Shareable URL state.
 *
 * Because composition is deterministic, a track id plus its variation fully
 * describes a piece of music — so the URL is enough to reproduce it exactly.
 * That makes generated tracks linkable: `?t=solar-drift#v3` always plays the
 * same audio, on any machine.
 */

const paramFor = (track: Track) => {
  const v = variationOf(track.id);
  return v > 0 ? `${track.id}#v${v}` : track.id;
};

/** Resolve a `?t=` value back to a track, or null if it isn't one we know. */
export function trackFromParam(raw: string | null): Track | null {
  if (!raw) return null;
  const hash = raw.indexOf("#v");
  const base = hash >= 0 ? raw.slice(0, hash) : raw;
  const baseTrack = TRACKS.find((t) => t.id === base);
  if (!baseTrack) return null;
  if (hash < 0) return baseTrack;
  const v = Number(raw.slice(hash + 2));
  if (!Number.isInteger(v) || v < 0) return baseTrack;
  return remixTrack(baseTrack, v);
}

/** Keeps `?t=` in sync with the playing track. */
export function useShareableTrack(track: Track | undefined, onHydrate: (t: Track) => void) {
  // Read the URL once on mount and hand the initial track to the player.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("t");
    const resolved = trackFromParam(raw);
    if (resolved) onHydrate(resolved);
    // hydrate once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = useCallback(async () => {
    if (!track) return;
    const url = new URL(window.location.href);
    url.searchParams.set("t", paramFor(track));
    // replaceState so sharing doesn't spam the back button
    window.history.replaceState(null, "", url.toString());
    const shareData = { title: `${track.title} — AETHER`, url: url.toString() };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return true;
      }
      await navigator.clipboard.writeText(url.toString());
      return true;
    } catch {
      // user dismissed the share sheet, or clipboard was blocked
      return false;
    }
  }, [track]);

  return { share };
}