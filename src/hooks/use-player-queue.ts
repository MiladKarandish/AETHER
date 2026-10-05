"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerTrack } from "@/lib/local-track";

export type RepeatMode = "off" | "all" | "one";

/** How many consecutive auto-skips are tolerated before we stop the carousel. */
const MAX_CONSECUTIVE_ERRORS = 3;
/** How recently-played tracks shuffle avoids, to stop A -> B -> A ping-pong. */
const RECENT_MEMORY = 4;

/**
 * Owns the play queue and all navigation state: current index, shuffle order,
 * repeat mode, and consecutive-error protection for unplayable local files.
 *
 * Extracted from the player shell so navigation logic is testable in isolation
 * from rendering.
 */
export function usePlayerQueue(initial: PlayerTrack[]) {
  const [queue, setQueue] = useState<PlayerTrack[]>(initial);
  const [index, setIndex] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  /** Raised when N consecutive local files fail to play, so the UI can warn. */
  const [errorStreak, setErrorStreak] = useState(0);
  const [onStalled, setOnStalled] = useState<(() => void) | null>(null);

  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  /** Mirror of `shuffle` so navigation callbacks never capture a stale value. */
  const shuffleRef = useRef(shuffle);
  /** Fisher-Yates order used when shuffle is on; regenerated per queue change. */
  const shuffleOrder = useRef<number[]>([]);
  const recent = useRef<number[]>([]);
  const consecutiveErrors = useRef(0);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  const current = queue[index] ?? queue[0];

  // Rebuild the shuffle order whenever the queue contents change, so shuffle
  // is a stable permutation instead of a fresh dice roll on every skip.
  const queueSignature = queue.map((t) => t.id).join("|");
  useEffect(() => {
    const order = queue.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    shuffleOrder.current = order;
    recent.current = recent.current.filter((i) => i < order.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the id signature
  }, [queueSignature]);

  const pickNextIndex = useCallback((dir: 1 | -1): number => {
    const len = queueRef.current.length;
    if (len === 0) return 0;
    if (len === 1) return 0;
    const cur = indexRef.current;

    if (shuffleRef.current) {
      const order = shuffleOrder.current.length === len
        ? shuffleOrder.current
        : queueRef.current.map((_, i) => i);
      // take the next entry after the current one in the shuffled order
      const pos = order.indexOf(cur);
      for (let step = 1; step <= len; step++) {
        const candidate = order[(pos + step) % len];
        if (!recent.current.includes(candidate)) {
          recent.current = [...recent.current, candidate].slice(-RECENT_MEMORY);
          return candidate;
        }
      }
      // everything is "recent" (tiny queue) — fall back to plain order
      const candidate = order[(pos + 1) % len];
      return candidate === cur ? order[(pos + 2) % len] : candidate;
    }

    const next = cur + dir;
    if (next < 0) return len - 1;
    if (next >= len) return 0;
    return next;
  }, []);

  const advance = useCallback(
    (dir: 1 | -1) => {
      const target = pickNextIndex(dir);
      consecutiveErrors.current = 0;
      setErrorStreak(0);
      setIndex(target);
    },
    [pickNextIndex],
  );

  /** Select an index explicitly (queue click) — this is a user action, so it
   *  also clears any error streak rather than counting as a failed skip. */
  const select = useCallback((i: number) => {
    consecutiveErrors.current = 0;
    setErrorStreak(0);
    setIndex(i);
  }, []);

  /** Called when the current track fails to play. Skips on, but gives up after
   *  MAX_CONSECUTIVE_ERRORS so a folder of broken files can't loop forever. */
  const reportError = useCallback(() => {
    consecutiveErrors.current += 1;
    setErrorStreak(consecutiveErrors.current);
    if (consecutiveErrors.current >= MAX_CONSECUTIVE_ERRORS) {
      consecutiveErrors.current = 0;
      setErrorStreak(0);
      onStalled?.();
      return false;
    }
    setIndex(pickNextIndex(1));
    return true;
  }, [onStalled, pickNextIndex]);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  /** Move a queue entry, keeping the index pointing at the same playing track. */
  const move = useCallback((from: number, to: number) => {
    const q = queueRef.current;
    if (from === to || from < 0 || to < 0 || from >= q.length || to >= q.length) return;
    setQueue((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    // Keep "now playing" on the same track after the shuffle of positions.
    setIndex((prevIdx) => {
      if (prevIdx === from) return to;
      if (from < prevIdx && to >= prevIdx) return prevIdx - 1;
      if (from > prevIdx && to <= prevIdx) return prevIdx + 1;
      return prevIdx;
    });
  }, []);

  /** Append a track if missing and select it (used by the library panel). */
  const playNow = useCallback((t: PlayerTrack) => {
    const q = queueRef.current;
    const existing = q.findIndex((x) => x.id === t.id);
    consecutiveErrors.current = 0;
    setErrorStreak(0);
    if (existing >= 0) {
      setIndex(existing);
      return;
    }
    setQueue([...q, t]);
    setIndex(q.length);
  }, []);

  /** Remove a track, keeping the index pointing at the same logical track. */
  const removeAt = useCallback((id: string) => {
    const q = queueRef.current;
    const i = q.findIndex((x) => x.id === id);
    if (i < 0) return -1;
    const cur = indexRef.current;
    setQueue(q.filter((x) => x.id !== id));
    if (i === cur) return -2; // caller must stop playback
    if (i < cur) setIndex(cur - 1);
    return -3;
  }, []);

  /** Merge library tracks into the queue tail without disturbing playback. */
  const mergeLibrary = useCallback((tracks: PlayerTrack[]) => {
    setQueue((q) => {
      const have = new Set(q.map((t) => t.id));
      const extra = tracks.filter((t) => !have.has(t.id));
      return extra.length ? [...q, ...extra] : q;
    });
  }, []);

  return {
    queue,
    index,
    current,
    shuffle,
    repeat,
    errorStreak,
    setShuffle,
    setRepeat,
    setIndex,
    setOnStalled,
    pickNextIndex,
    advance,
    select,
    reportError,
    cycleRepeat,
    playNow,
    removeAt,
    move,
    mergeLibrary,
    queueRef,
    indexRef,
  };
}