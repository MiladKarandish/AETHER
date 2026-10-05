"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type Stem } from "@/lib/engine";
import { isLocal, type PlayerTrack } from "@/lib/local-track";
import { saveDuration } from "@/lib/library";

/**
 * Wraps the AudioEngine lifecycle and exposes reactive transport state.
 *
 * The key invariant this owns: switching tracks must NOT stop playback. Every
 * music player keeps playing across a track change, so the load effect records
 * whether it was playing and auto-resumes the new track.
 */
export function useAudioEngine(track: PlayerTrack | undefined) {
  const [engine] = useState(() => new AudioEngine());
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  /** Real duration reported by a local file once its metadata loads. */
  const [liveDuration, setLiveDuration] = useState<{ id: string; d: number } | null>(null);
  /** Id of the track currently loaded into the engine; drives the reset below. */
  const [loadedId, setLoadedId] = useState<string | null>(null);

  /** Set when a caller wants playback to auto-start after the next load. */
  const pendingPlayRef = useRef(false);
  /** Reflects whether audio is currently running, for the resume-on-load check. */
  const wasPlaying = useRef(false);

  /**
   * Ask for playback to begin automatically once the next track finishes
   * loading. Exposed as a function rather than a bare ref so callers never
   * mutate a value owned by the hook.
   */
  const requestPlay = useCallback(() => {
    pendingPlayRef.current = true;
  }, []);

  const trackId = track?.id ?? null;

  // Reset transport state during render when the selection changes. This is
  // React's documented "adjust state when props change" pattern; doing it in an
  // effect would trigger a second cascading render pass.
  if (loadedId !== trackId) {
    setLoadedId(trackId);
    setPosition(0);
    setLiveDuration(null);
    setPlaying(false);
  }

  // Load the selected track into the engine (a real side effect, so it lives
  // in an effect rather than in the render phase).
  useEffect(() => {
    const t = track;
    if (!t) return;

    // Preserve continuity: if we were playing, keep playing across the switch.
    const shouldResume = wasPlaying.current || pendingPlayRef.current;
    pendingPlayRef.current = false;
    wasPlaying.current = false;

    if (isLocal(t)) engine.loadLocal(t);
    else engine.load(t);

    if (shouldResume) {
      void engine.play().then(() => {
        wasPlaying.current = true;
        setPlaying(true);
        setAnalyserNode(engine.getAnalyser());
      });
    }
  }, [engine, track]);

  const play = useCallback(async () => {
    await engine.play();
    wasPlaying.current = true;
    setPlaying(true);
    setAnalyserNode(engine.getAnalyser());
  }, [engine]);

  const pause = useCallback(() => {
    engine.pause();
    wasPlaying.current = false;
    setPlaying(false);
  }, [engine]);

  const toggle = useCallback(() => {
    if (engine.playing) pause();
    else void play();
  }, [engine, pause, play]);

  const seek = useCallback(
    (t: number) => {
      engine.seek(t);
      setPosition(t);
    },
    [engine],
  );

  // rAF position loop — only runs while playing to avoid burning frames.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      setPosition(engine.position);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, playing]);

  // Learn the real duration of local files and persist it for next time.
  useEffect(() => {
    engine.setOnDurationChanged((id, d) => {
      setLiveDuration({ id, d });
      if (id.startsWith("library:")) {
        void saveDuration(id.slice("library:".length), d);
      }
    });
    return () => {
      engine.setOnDurationChanged(null);
    };
  }, [engine]);

  // Release the audio context when the player unmounts.
  useEffect(() => {
    return () => {
      engine.destroy();
    };
  }, [engine]);

  return {
    engine,
    playing,
    position,
    analyserNode,
    liveDuration,
    requestPlay,
    setPlaying,
    setPosition,
    play,
    pause,
    toggle,
    seek,
  };
}

/** Track with a live duration override applied, for display in the transport. */
export function withLiveDuration<T extends PlayerTrack>(
  track: T,
  liveDuration: { id: string; d: number } | null,
): T {
  if (liveDuration && liveDuration.id === track.id && liveDuration.d > 0) {
    return { ...track, duration: liveDuration.d };
  }
  return track;
}

/** Per-instrument gain state, persisted so the mixer survives a reload. */
export function useStems(engine: AudioEngine) {
  // Read persisted levels once during the initial render instead of in an
  // effect, which would cause a cascading render.
  const [gains, setGains] = useState<Record<Stem, number>>(() => {
    try {
      const raw = localStorage.getItem("aether:stems");
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const [stem, value] of Object.entries(parsed)) {
            if (typeof value === "number") engine.setStemGain(stem as Stem, value);
          }
        }
      }
    } catch {
      /* corrupt mixer state — keep defaults */
    }
    return engine.getStemGains();
  });

  const setStem = useCallback(
    (stem: Stem, value: number) => {
      engine.setStemGain(stem, value);
      setGains((prev) => {
        const next = { ...prev, [stem]: value };
        try {
          localStorage.setItem("aether:stems", JSON.stringify(next));
        } catch {
          /* storage unavailable — mixer still works for this session */
        }
        return next;
      });
    },
    [engine],
  );

  /** Restore every stem to unity gain. */
  const resetStems = useCallback(() => {
    for (const stem of Object.keys(gains) as Stem[]) {
      engine.setStemGain(stem, 1);
    }
    setGains(engine.getStemGains());
    try {
      localStorage.removeItem("aether:stems");
    } catch {
      /* storage unavailable */
    }
  }, [engine, gains]);

  return { gains, setStem, resetStems };
}