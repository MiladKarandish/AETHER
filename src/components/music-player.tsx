"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TRACKS, remixTrack, variationOf } from "@/lib/tracks";
import { isLocal, type PlayerTrack } from "@/lib/local-track";
import { listLibrary, revokeLibraryUrls } from "@/lib/library";
import { usePlayerQueue } from "@/hooks/use-player-queue";
import { useAudioEngine, useStems, withLiveDuration } from "@/hooks/use-audio-engine";
import {
  reviveFlag,
  reviveIdSet,
  reviveNumber,
  usePersistentState,
} from "@/hooks/use-persistent-state";
import { useKeyboardShortcuts, useScrollLock, useSwipeToDismiss } from "@/hooks/use-keyboard-shortcuts";
import { useShareableTrack } from "@/hooks/use-shareable-track";
import Visualizer from "./visualizer";
import QueueList from "./queue-list";
import Transport, { type RepeatMode } from "./transport";
import LibraryPanel from "./library-panel";
import MixerPanel from "./mixer-panel";
import ScoreView from "./score-view";
import { CloseIcon, DiceIcon, DownloadIcon, KeyboardIcon, LibraryIcon, SlidersIcon, WaveIcon } from "./icons";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 seconds"],
  ["↑ / ↓", "Volume"],
  ["N / P", "Next / previous track"],
  ["M", "Mute"],
  ["S", "Shuffle"],
  ["R", "Repeat mode"],
  ["L", "Like current track"],
  ["E", "Remix current track"],
  ["X", "Toggle the mixer"],
  ["I", "Immersive mode"],
  ["Esc", "Exit immersive / close panels"],
  ["?", "Toggle this panel"],
];

export default function MusicPlayer() {
  const [immersive, setImmersive] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const {
    queue,
    index,
    current: track,
    shuffle,
    repeat,
    setShuffle,
    setRepeat,
    setIndex,
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
  } = usePlayerQueue(TRACKS);

  const safeTrack = track ?? TRACKS[0];
  const {
    engine,
    playing,
    position,
    analyserNode,
    liveDuration,
    requestPlay,
    setPlaying,
    play,
    pause,
    toggle,
    seek,
  } = useAudioEngine(safeTrack);

  const { gains: stemGains, setStem, resetStems } = useStems(engine);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [scoreView, setScoreView] = useState(false);

  // A `?t=` param selects the initial track; `share()` writes it back.
  const hydrateFromUrl = useCallback(
    (t: PlayerTrack) => {
      select(0);
      playNow(t);
    },
    [playNow, select],
  );
  const { share } = useShareableTrack(
    isLocal(safeTrack) ? undefined : safeTrack,
    hydrateFromUrl,
  );

  const doShare = useCallback(async () => {
    const ok = await share();
    setNotice(
      ok
        ? "Link copied — this track's score is reproducible from the URL."
        : "Couldn't copy the link.",
    );
  }, [share]);

  const [volume, setVolume] = usePersistentState("aether:volume", 0.8, reviveNumber);
  const [muted, setMuted] = usePersistentState("aether:muted", false, reviveFlag);
  const [liked, setLiked] = usePersistentState<ReadonlySet<string>>(
    "aether:liked",
    new Set<string>(),
    reviveIdSet,
  );

  const displayTrack = withLiveDuration(safeTrack, liveDuration);
  const palette = safeTrack.palette;
  const localCount = queue.filter(isLocal).length;

  // Restore shuffle / repeat / last index once, before any persistence runs.
  const hydrated = useRef(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("aether:shuffle") === "1") setShuffle(true);
      const r = localStorage.getItem("aether:repeat");
      if (r === "off" || r === "all" || r === "one") setRepeat(r as RepeatMode);
      const i = localStorage.getItem("aether:index");
      const n = i !== null ? Number(i) : NaN;
      if (Number.isInteger(n) && n >= 0 && n < TRACKS.length) setIndex(n);
    } catch {
      /* ignore corrupt storage */
    } finally {
      // Only allow writes after the saved values have been read, otherwise this
      // effect would clobber them with the defaults on first mount.
      hydrated.current = true;
    }
    // hydrate once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the settings the queue hook owns, so shuffle/repeat survive reload.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem("aether:shuffle", shuffle ? "1" : "0");
      localStorage.setItem("aether:repeat", repeat);
      localStorage.setItem("aether:index", String(index));
    } catch {
      /* storage unavailable — preferences just won't persist */
    }
  }, [index, repeat, shuffle]);

  // load the offline library into the tail of the queue on mount
  useEffect(() => {
    let alive = true;
    listLibrary()
      .then((lib) => {
        if (alive && lib.length > 0) mergeLibrary(lib);
      })
      .catch(() => {
        /* listLibrary already degrades to [] — belt and braces */
      });
    return () => {
      alive = false;
    };
  }, [mergeLibrary]);

  // Release every blob: URL this session minted when the player unmounts.
  useEffect(() => {
    const onPageHide = () => revokeLibraryUrls();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      revokeLibraryUrls();
    };
  }, []);

  // Push restored volume / mute into the audio context.
  useEffect(() => {
    engine.setVolume(volume);
  }, [engine, volume]);
  useEffect(() => {
    engine.setMuted(muted);
  }, [engine, muted]);

  // what happens when a track finishes
  useEffect(() => {
    engine.setOnEnded(() => {
      const len = queueRef.current.length;
      const cur = indexRef.current;
      if (repeat === "one") {
        engine.seek(0);
        void engine.play();
        setPlaying(true);
        return;
      }
      const atEnd = cur >= len - 1;
      if (repeat === "all" || shuffle || !atEnd) {
        // auto-advance must keep playing: flag the next track to resume
        requestPlay();
        setPlaying(false);
        advance(1);
      } else {
        setPlaying(false);
      }
    });
    return () => {
      engine.setOnEnded(null);
    };
  }, [advance, engine, indexRef, requestPlay, queueRef, repeat, setPlaying, shuffle]);

  // a local file failed to load or play — skip it, but stop after N failures
  useEffect(() => {
    engine.setOnAudioError(() => {
      requestPlay();
      const willContinue = reportError();
      if (!willContinue) {
        pause();
        setNotice("Several tracks in your library could not be played.");
      }
    });
    return () => {
      engine.setOnAudioError(null);
    };
  }, [engine, pause, requestPlay, reportError]);

  const next = useCallback(() => {
    requestPlay();
    setPlaying(false);
    advance(1);
  }, [advance, requestPlay, setPlaying]);

  const prev = useCallback(() => {
    if (engine.position > 3) {
      seek(0);
      return;
    }
    requestPlay();
    setPlaying(false);
    advance(-1);
  }, [advance, engine.position, requestPlay, seek, setPlaying]);

  const changeVolume = useCallback(
    (v: number) => {
      const clamped = Math.min(1, Math.max(0, v));
      setVolume(clamped);
      engine.setVolume(clamped);
      if (clamped > 0 && muted) {
        setMuted(false);
        engine.setMuted(false);
      }
    },
    [engine, muted, setMuted, setVolume],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      engine.setMuted(!m);
      return !m;
    });
  }, [engine, setMuted]);

  const toggleLike = useCallback(
    (id: string) => {
      if (!id) return;
      setLiked((prevSet) => {
        const s = new Set(prevSet);
        if (s.has(id)) s.delete(id);
        else s.add(id);
        return s;
      });
    },
    [setLiked],
  );

  const toggleImmersive = useCallback(() => setImmersive((v) => !v), []);

  /** Playing a library track should start audio, not just select it. */
  const playLibraryTrack = useCallback(
    (t: PlayerTrack) => {
      requestPlay();
      setPlaying(false);
      playNow(t);
    },
    [playNow, requestPlay, setPlaying],
  );

  /** Library track removed: keep the index pointing at the same logical track. */
  const removeLibraryTrack = useCallback(
    (libId: string) => {
      const result = removeAt(libId);
      if (result === -2) {
        // the playing track was removed — stop and fall back to the first track
        engine.pause();
        setPlaying(false);
        setIndex(0);
      }
    },
    [engine, removeAt, setIndex, setPlaying],
  );

  /** Remove any queue entry. For library tracks this also deletes the file. */
  const removeFromQueue = useCallback(
    (i: number) => {
      const t = queueRef.current[i];
      if (!t) return;
      if (isLocal(t)) {
        // Removing a library track means removing it from the library too.
        removeLibraryTrack(t.id);
        return;
      }
      const result = removeAt(t.id);
      if (result === -2) {
        engine.pause();
        setPlaying(false);
        setIndex(0);
      }
    },
    [engine, queueRef, removeAt, removeLibraryTrack, setIndex, setPlaying],
  );

  // auto-dismiss the transient notice
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  /** Remix the current generated track: same title/palette, new seed. */
  const remixCurrent = useCallback(() => {
    if (safeTrack.kind === "local") return;
    const nextVariation = variationOf(safeTrack.id) + 1;
    requestPlay();
    setPlaying(false);
    playNow(remixTrack(safeTrack, nextVariation));
  }, [playNow, requestPlay, safeTrack, setPlaying]);

  // Mobile drawer gestures, and stop the page scrolling behind open overlays.
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const { sheetRef: queueSheetRef, onTouchStart: qTouchStart, onTouchMove: qTouchMove, onTouchEnd: qTouchEnd, onTouchCancel: qTouchCancel } =
    useSwipeToDismiss(closeQueue);
  useScrollLock(queueOpen || libraryOpen || showShortcuts || mixerOpen);

  // Reflect the playing track in the tab title so it stays visible when the
  // window is backgrounded or minimised. Generated tracks have no `artist`,
  // so fall back to the album.
  useEffect(() => {
    const subtitle = isLocal(safeTrack) ? safeTrack.artist : safeTrack.album;
    document.title = `${safeTrack.title} · ${subtitle} — AETHER`;
  }, [safeTrack]);

  // keyboard shortcuts — a declarative map, rebuilt only when handlers change
  const shortcuts = useMemo(
    () => ({
      " ": toggle,
      ArrowRight: () => seek(Math.min(displayTrack.duration, engine.position + 5)),
      ArrowLeft: () => seek(Math.max(0, engine.position - 5)),
      ArrowUp: () => changeVolume(volume + 0.05),
      ArrowDown: () => changeVolume(volume - 0.05),
      n: next,
      N: next,
      p: prev,
      P: prev,
      m: toggleMute,
      M: toggleMute,
      s: () => setShuffle((s) => !s),
      S: () => setShuffle((s) => !s),
      r: cycleRepeat,
      R: cycleRepeat,
      l: () => toggleLike(safeTrack.id),
      L: () => toggleLike(safeTrack.id),
      i: toggleImmersive,
      I: toggleImmersive,
      x: () => setMixerOpen((v) => !v),
      X: () => setMixerOpen((v) => !v),
      e: remixCurrent,
      E: remixCurrent,
      "?": () => setShowShortcuts((s) => !s),
      Escape: () => {
        setShowShortcuts(false);
        setQueueOpen(false);
        setLibraryOpen(false);
        setMixerOpen(false);
        setImmersive(false);
      },
    }),
    [
      changeVolume,
      cycleRepeat,
      displayTrack.duration,
      engine.position,
      next,
      prev,
      remixCurrent,
      safeTrack.id,
      seek,
      setShuffle,
      toggle,
      toggleImmersive,
      toggleLike,
      toggleMute,
      volume,
    ],
  );

  useKeyboardShortcuts(shortcuts);

  // OS media session integration
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: safeTrack.title,
      artist: isLocal(safeTrack) ? safeTrack.artist : "AETHER Engine",
      album: safeTrack.album,
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    try {
      navigator.mediaSession.setActionHandler("play", () => void play());
      navigator.mediaSession.setActionHandler("pause", () => pause());
      navigator.mediaSession.setActionHandler("previoustrack", () => prev());
      navigator.mediaSession.setActionHandler("nexttrack", () => next());
    } catch {
      /* unsupported action */
    }
  }, [next, pause, play, playing, prev, safeTrack]);
  const queuePanel = (
    <QueueList
      tracks={queue}
      currentId={safeTrack.id}
      playing={playing}
      liked={liked}
      onSelect={(i) => {
        // an explicit user pick is not a failed skip — use `select` so it
        // clears any consecutive-error streak
        select(i);
        setQueueOpen(false);
      }}
      onToggleLike={toggleLike}
      onMove={move}
      onRemove={removeFromQueue}
    />
  );

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#050507] text-zinc-200">
      {/* track-colored ambient background */}
      <div
        key={safeTrack.id}
        className="fade-bg pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(55% 45% at 18% 8%, ${palette[0]}24, transparent 65%), radial-gradient(45% 40% at 85% 25%, ${palette[1]}1e, transparent 60%), radial-gradient(50% 45% at 50% 100%, ${palette[2]}17, transparent 65%)`,
        }}
      />
      <div className="noise pointer-events-none absolute inset-0 opacity-[0.05]" />

      {/* header */}
      <header
        className={`safe-top safe-x relative z-10 flex items-center justify-between py-4 transition-all duration-500 sm:px-8 sm:py-5 ${
          immersive ? "pointer-events-none -translate-y-4 opacity-0" : ""
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
              boxShadow: `0 0 20px ${palette[1]}44`,
            }}
          >
            <WaveIcon width={18} height={18} className="text-black" />
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-[0.35em] text-white">AETHER</h1>
            {/* the tagline crowds narrow phones — the logo carries the identity */}
            <p className="hidden text-[11px] tracking-wide text-zinc-500 sm:block">
              generative music engine
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="tap-target flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            <LibraryIcon width={13} height={13} />
            <span className="hidden min-[380px]:inline">Library</span>
            {localCount > 0 ? ` · ${localCount}` : ""}
          </button>
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="tap-target rounded-full px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-white lg:hidden"
          >
            Queue
          </button>
          {/* Per-instrument mixer — only meaningful for generated tracks, since imported
              files arrive as a single already-mixed stream. */}
          {!isLocal(safeTrack) && (
            <button
              type="button"
              onClick={() => setMixerOpen(true)}
              aria-label="Open mixer"
              className="tap-target rounded-full p-2 text-zinc-500 transition-colors hover:text-white"
            >
              <SlidersIcon width={17} height={17} />
            </button>
          )}
          {/* No physical keyboard on phones, so the shortcut reference is
              desktop-only chrome. */}
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard shortcuts"
            className="tap-target hidden rounded-full p-2 text-zinc-500 transition-colors hover:text-white sm:block"
          >
            <KeyboardIcon width={17} height={17} />
          </button>
          <button
            type="button"
            onClick={toggleImmersive}
            aria-label="Toggle immersive mode"
            aria-pressed={immersive}
            className="tap-target rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            Immersive
          </button>
        </div>
      </header>

      {/* main */}
      {/* Bottom padding clears the fixed transport. Mobile gained a
          now-playing strip, so it needs more clearance than desktop. */}
      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-8 px-4 pb-56 sm:px-8 sm:pb-44 lg:grid-cols-[1fr_340px]">
        {/* now playing */}
        <section className="flex min-w-0 flex-col items-center text-center">
          <div className="relative aspect-square w-full max-w-[min(420px,72vw)]">
            {/* track-change shockwave */}
            <div
              key={safeTrack.id}
              aria-hidden="true"
              className="pulse-ring pointer-events-none absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, ${palette[1]}40 0%, transparent 60%)` }}
            />
            <Visualizer analyser={analyserNode} playing={playing} colors={palette} />
          </div>
          <div
            key={`info-${safeTrack.id}`}
            className={`track-enter mt-6 transition-all duration-500 ${immersive ? "pointer-events-none opacity-0" : ""}`}
          >
            {isLocal(safeTrack) ? (
              <>
                <p className="mb-2 text-[11px] tracking-[0.3em] text-zinc-500 uppercase">
                  {safeTrack.artist} · {safeTrack.album}
                </p>
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{safeTrack.title}</h2>
                <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-500">
                  <span className="relative flex h-1.5 w-1.5">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full ${playing ? "animate-ping" : ""}`}
                      style={{ backgroundColor: palette[1] }}
                    />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette[1] }} />
                  </span>
                  playing from your local library
                </p>
              </>
            ) : (
              <>
                <p className="mb-2 text-[11px] tracking-[0.3em] text-zinc-500 uppercase">
                  {safeTrack.album} · {safeTrack.mood} · {safeTrack.bpm} bpm
                </p>
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{safeTrack.title}</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-500">{safeTrack.blurb}</p>
                <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-500">
                  <span className="relative flex h-1.5 w-1.5">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full ${playing ? "animate-ping" : ""}`}
                      style={{ backgroundColor: palette[1] }}
                    />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette[1] }} />
                  </span>
                  synthesized live in your browser — no audio files
                </p>
                {/* Remix is only possible for generated tracks, and share is
                    most useful for them too (the URL reproduces the score). */}
                {!isLocal(safeTrack) && (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={remixCurrent}
                      className="tap-target inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-white/25 hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
                    >
                      <DiceIcon width={13} height={13} />
                      Remix
                    </button>
                    <button
                      type="button"
                      onClick={doShare}
                      className="tap-target inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-white/25 hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
                    >
                      <DownloadIcon width={13} height={13} />
                      Share
                    </button>
                    <button
                      type="button"
                      onClick={() => setScoreView((v) => !v)}
                      aria-pressed={scoreView}
                      className={`tap-target rounded-full border px-3 py-1.5 text-[11px] transition-colors focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none ${
                        scoreView
                          ? "border-white/25 text-white"
                          : "border-white/10 text-zinc-400 hover:border-white/25 hover:text-white"
                      }`}
                    >
                      Score
                    </button>
                  </div>
                )}
                {/* The composed score, drawn as instrument lanes. Generated
                    tracks only — an imported file has no ScoreEvent data. */}
                {!isLocal(safeTrack) && (
                  <div className="mt-4 w-full max-w-md">
                    <ScoreView
                      track={safeTrack}
                      position={position}
                      duration={displayTrack.duration}
                      playing={playing}
                      visible={scoreView}
                      onSeek={seek}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* queue — desktop */}
        <aside
          className={`hidden h-[520px] max-h-full rounded-2xl border border-white/5 bg-white/[0.02] p-4 lg:flex lg:flex-col ${
            immersive ? "pointer-events-none opacity-0" : ""
          }`}
        >
          {queuePanel}
        </aside>
      </main>

      {/* queue — mobile drawer */}
      {queueOpen && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="Queue">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setQueueOpen(false)}
          />
          <div
            ref={queueSheetRef}
            onTouchStart={qTouchStart}
            onTouchMove={qTouchMove}
            onTouchEnd={qTouchEnd}
            onTouchCancel={qTouchCancel}
            className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0a0a0f] p-4 safe-x safe-bottom"
          >
            {/* grab handle + explicit close: the backdrop alone is a poor
                affordance on touch, and pb-8 ignored the home indicator. */}
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <span aria-hidden="true" className="h-1 w-10 rounded-full bg-white/20" />
              <button
                type="button"
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue"
                className="tap-target -mt-1 rounded-md p-1 text-zinc-500 transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
              >
                <CloseIcon width={16} height={16} />
              </button>
            </div>
            {queuePanel}
          </div>
        </div>
      )}

      {/* immersive exit — always reachable, since the header/transport are hidden on touch devices */}
      {immersive && (
        <button
          type="button"
          onClick={toggleImmersive}
          className="tap-target fixed top-5 right-5 z-30 rounded-full border border-white/10 bg-black/40 px-3.5 py-1.5 text-xs text-zinc-400 backdrop-blur-md transition-colors hover:border-white/25 hover:text-white"
        >
          Exit immersive
        </button>
      )}

      {/* transient notices (e.g. consecutive playback failures) */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="toast fixed bottom-28 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-black/80 px-4 py-2 text-xs text-zinc-300 backdrop-blur-md"
        >
          {notice}
        </div>
      )}

      {/* transport */}
      <div
        className={`fixed inset-x-0 bottom-0 z-20 transition-all duration-500 ${
          immersive ? "opacity-0 hover:opacity-100 focus-within:opacity-100" : ""
        }`}
      >
        <Transport
          track={displayTrack}
          playing={playing}
          position={position}
          liked={liked.has(safeTrack.id)}
          shuffle={shuffle}
          repeat={repeat}
          volume={volume}
          muted={muted}
          onToggle={toggle}
          onNext={next}
          onPrev={prev}
          onSeek={seek}
          onLike={() => toggleLike(safeTrack.id)}
          onShuffle={() => setShuffle((s) => !s)}
          onRepeat={cycleRepeat}
          onVolume={changeVolume}
          onMute={toggleMute}
        />
      </div>

      {/* offline library modal */}
      {libraryOpen && (
        <LibraryPanel
          onClose={() => setLibraryOpen(false)}
          onPlay={playLibraryTrack}
          onRemoved={removeLibraryTrack}
          currentId={safeTrack.id}
        />
      )}

      {/* mixer */}
      {mixerOpen && (
        <MixerPanel
          gains={stemGains}
          onChange={setStem}
          onReset={resetStems}
          onClose={() => setMixerOpen(false)}
        />
      )}

      {/* shortcuts modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowShortcuts(false)} />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b0b11] p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setShowShortcuts(false)}
              aria-label="Close"
              className="absolute top-4 right-4 rounded-md p-1 text-zinc-500 hover:text-white"
            >
              <CloseIcon width={16} height={16} />
            </button>
            <h3 className="mb-4 text-xs font-medium tracking-[0.25em] text-zinc-400 uppercase">Keyboard shortcuts</h3>
            <ul className="space-y-2.5">
              {SHORTCUTS.map(([key, label]) => (
                <li key={key} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">{label}</span>
                  <kbd className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-zinc-300">
                    {key}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
