"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TRACKS } from "@/lib/tracks";
import { AudioEngine } from "@/lib/engine";
import {
  PROVIDER_LABEL,
  type PlayerTrack,
  type StreamTrack,
} from "@/lib/providers";
import { isStream } from "@/lib/providers/types";
import { listLibrary, removeFromLibrary, type LibraryTrack } from "@/lib/library";
import Visualizer from "./visualizer";
import QueueList from "./queue-list";
import Transport, { type RepeatMode } from "./transport";
import Discover from "./discover";
import LibraryPanel from "./library-panel";
import { CloseIcon, KeyboardIcon, LibraryIcon, SearchIcon, WaveIcon } from "./icons";

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 seconds"],
  ["↑ / ↓", "Volume"],
  ["N / P", "Next / previous track"],
  ["M", "Mute"],
  ["S", "Shuffle"],
  ["R", "Repeat mode"],
  ["L", "Like current track"],
  ["I", "Immersive mode"],
  ["D", "Discover online music"],
  ["Esc", "Exit immersive / close panels"],
  ["?", "Toggle this panel"],
];

export default function MusicPlayer() {
  const [engine] = useState(() => new AudioEngine());
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set());
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const [queue, setQueue] = useState<PlayerTrack[]>(TRACKS);
  /** real duration reported by a stream once metadata loads */
  const [liveDuration, setLiveDuration] = useState<{ id: string; d: number } | null>(null);

  const track = queue[index] ?? TRACKS[0];
  const displayTrack =
    liveDuration && liveDuration.id === track.id && liveDuration.d > 0
      ? { ...track, duration: liveDuration.d }
      : track;
  const palette = track.palette;
  const stateRef = useRef({ shuffle, repeat, index, queueLen: queue.length });
  const queueRef = useRef(queue);
  const pendingPlay = useRef(false);
  const retryId = useRef<string | null>(null);

  // keep an imperative snapshot for callbacks that must not re-bind
  useEffect(() => {
    stateRef.current = { shuffle, repeat, index, queueLen: queue.length };
  }, [shuffle, repeat, index, queue.length]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // load the offline library into the tail of the queue on mount
  useEffect(() => {
    let alive = true;
    listLibrary().then((lib) => {
      if (!alive || lib.length === 0) return;
      setSavedIds(new Set(lib.map((t) => t.id.slice("library:".length))));
      setQueue((q) => [...q, ...lib.filter((l) => !q.some((x) => x.id === l.id))]);
    });
    return () => {
      alive = false;
    };
  }, []);

  // restore persisted settings
  useEffect(() => {
    try {
      const v = localStorage.getItem("aether:volume");
      if (v !== null) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
          setVolume(n);
          engine.setVolume(n);
        }
      }
      const m = localStorage.getItem("aether:muted");
      if (m === "1") {
         
        setMuted(true);
        engine.setMuted(true);
      }
      const l = localStorage.getItem("aether:liked");
      if (l) {
         
        setLiked(new Set(JSON.parse(l) as string[]));
      }
      const i = localStorage.getItem("aether:index");
      const n = i !== null ? Number(i) : 0;
      if (Number.isInteger(n) && n >= 0 && n < TRACKS.length) setIndex(n);
    } catch {
      /* ignore corrupt storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load track whenever selection changes
  useEffect(() => {
    const t = queue[index] ?? TRACKS[0];
    if (isStream(t)) engine.loadStream(t);
    else engine.load(t);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transport state for the new track
    setPosition(0);
    setLiveDuration(null);
    setPlaying(false);
    localStorage.setItem("aether:index", String(index));
    if (pendingPlay.current) {
      pendingPlay.current = false;
      void engine.play().then(() => setAnalyserNode(engine.getAnalyser()));
      setPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on selection change, not on queue identity updates
  }, [engine, index]);

  const play = useCallback(async () => {
    await engine.play();
    setPlaying(true);
    setAnalyserNode(engine.getAnalyser());
  }, [engine]);

  const pause = useCallback(() => {
    engine.pause();
    setPlaying(false);
  }, [engine]);

  const toggle = useCallback(() => {
    if (engine.playing) pause();
    else void play();
  }, [engine, pause, play]);

  const pickNextIndex = useCallback((dir: 1 | -1) => {
    const { shuffle: sh, index: cur, queueLen } = stateRef.current;
    if (sh && queueLen > 1) {
      let n = cur;
      while (n === cur) n = Math.floor(Math.random() * queueLen);
      return n;
    }
    return (cur + dir + queueLen) % queueLen;
  }, []);

  const next = useCallback(() => setIndex(pickNextIndex(1)), [pickNextIndex]);

  const prev = useCallback(() => {
    if (engine.position > 3) {
      engine.seek(0);
      setPosition(0);
    } else {
      setIndex(pickNextIndex(-1));
    }
  }, [engine, pickNextIndex]);
  // what happens when a track finishes
  useEffect(() => {
    engine.setOnEnded(() => {
      const { repeat: rep, shuffle: sh, index: cur, queueLen } = stateRef.current;
      if (rep === "one") {
        engine.seek(0);
        void engine.play();
        setPosition(0);
        setPlaying(true);
      } else if (rep === "all" || sh || cur < queueLen - 1) {
        setPlaying(false);
        if (sh) setIndex(pickNextIndex(1));
        else if (cur < queueLen - 1) setIndex(cur + 1);
        else setIndex(0);
      } else {
        setPlaying(false);
        const t = queueRef.current[cur];
        setPosition(t?.duration ?? 0);
      }
    });
    return () => {
      engine.setOnEnded(null);
    };
  }, [engine, pickNextIndex]);

  // stream lifecycle: real duration + failure fallback (CORS retry → skip)
  useEffect(() => {
    engine.setOnDurationChanged((id, d) => setLiveDuration({ id, d }));
    engine.setOnStreamError(() => {
      const cur = stateRef.current.index;
      const t = queueRef.current[cur];
      if (!t) return;
      if (isStream(t) && t.corsSafe && retryId.current !== t.id) {
        // first failure: retry the same track without the analyser path
        retryId.current = t.id;
        engine.loadStream({ ...t, corsSafe: false });
        void engine.play().catch(() => undefined);
      } else {
        // give up on this track and move on
        retryId.current = null;
        setPlaying(false);
        setIndex(pickNextIndex(1));
      }
    });
    return () => {
      engine.setOnDurationChanged(null);
      engine.setOnStreamError(null);
    };
  }, [engine, pickNextIndex]);

  // rAF position loop
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

  const seek = useCallback(
    (t: number) => {
      engine.seek(t);
      setPosition(t);
    },
    [engine],
  );

  const changeVolume = useCallback(
    (v: number) => {
      setVolume(v);
      engine.setVolume(v);
      if (v > 0 && muted) {
        setMuted(false);
        engine.setMuted(false);
      }
      localStorage.setItem("aether:volume", String(v));
    },
    [engine, muted],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      engine.setMuted(!m);
      localStorage.setItem("aether:muted", m ? "0" : "1");
      return !m;
    });
  }, [engine]);

  const toggleLike = useCallback((id: string) => {
    if (!id) return;
    setLiked((prevSet) => {
      const s = new Set(prevSet);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      localStorage.setItem("aether:liked", JSON.stringify([...s]));
      return s;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  const toggleImmersive = useCallback(() => setImmersive((v) => !v), []);

  // discover: play a stream now (append to queue if needed) or just queue it
  const playStreamNow = useCallback((t: StreamTrack) => {
    const q = queueRef.current;
    const i = q.findIndex((x) => x.id === t.id);
    pendingPlay.current = true;
    retryId.current = null;
    if (i >= 0) {
      setIndex(i);
    } else {
      setQueue([...q, t]);
      setIndex(q.length);
    }
    setDiscoverOpen(false);
  }, []);

  const addStreamToQueue = useCallback((t: StreamTrack) => {
    setQueue((q) => (q.some((x) => x.id === t.id) ? q : [...q, t]));
  }, []);

  // library panel: play (and dismiss the panel) / remove a saved track
  const playNow = useCallback(
    (t: StreamTrack) => {
      playStreamNow(t);
      setLibraryOpen(false);
    },
    [playStreamNow],
  );

  const removeLibraryTrack = useCallback(
    (libId: string) => {
      const q = queueRef.current;
      const i = q.findIndex((x) => x.id === libId);
      if (i < 0) return;
      const cur = stateRef.current.index;
      if (i === cur) {
        engine.pause();
        setPlaying(false);
        setIndex(0);
      } else if (i < cur) {
        setIndex(cur - 1);
      }
      setQueue(q.filter((x) => x.id !== libId));
      setSavedIds((s) => {
        const n = new Set(s);
        n.delete(libId.slice("library:".length));
        return n;
      });
    },
    [engine],
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(Math.min(track.duration, engine.position + 5));
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(Math.max(0, engine.position - 5));
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.05));
          break;
        case "n":
        case "N":
          next();
          break;
        case "p":
        case "P":
          prev();
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "s":
        case "S":
          setShuffle((s) => !s);
          break;
        case "r":
        case "R":
          cycleRepeat();
          break;
        case "l":
        case "L":
          toggleLike(track.id);
          break;
        case "i":
        case "I":
          toggleImmersive();
          break;
        case "d":
        case "D":
          setDiscoverOpen((s) => !s);
          break;
        case "?":
          setShowShortcuts((s) => !s);
          break;
        case "Escape":
          setShowShortcuts(false);
          setQueueOpen(false);
          setDiscoverOpen(false);
          setImmersive(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeVolume, cycleRepeat, engine, next, prev, seek, toggle, toggleImmersive, toggleLike, toggleMute, track.duration, track.id, volume]);

  // OS media session integration
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: isStream(track) ? track.artist : "AETHER Engine",
      album: track.album,
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
  }, [next, pause, play, playing, prev, track, track.album, track.title]);
  const queuePanel = (
    <QueueList
      tracks={queue}
      currentId={track.id}
      playing={playing}
      liked={liked}
      onSelect={(i) => {
        setIndex(i);
        setQueueOpen(false);
      }}
      onToggleLike={toggleLike}
    />
  );

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#050507] text-zinc-200">
      {/* track-colored ambient background */}
      <div
        key={track.id}
        className="fade-bg pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(55% 45% at 18% 8%, ${palette[0]}24, transparent 65%), radial-gradient(45% 40% at 85% 25%, ${palette[1]}1e, transparent 60%), radial-gradient(50% 45% at 50% 100%, ${palette[2]}17, transparent 65%)`,
        }}
      />
      <div className="noise pointer-events-none absolute inset-0 opacity-[0.05]" />

      {/* header */}
      <header
        className={`relative z-10 flex items-center justify-between px-4 py-5 transition-all duration-500 sm:px-8 ${
          immersive ? "pointer-events-none -translate-y-4 opacity-0" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
              boxShadow: `0 0 20px ${palette[1]}44`,
            }}
          >
            <WaveIcon width={18} height={18} className="text-black" />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-[0.35em] text-white">AETHER</h1>
            <p className="text-[11px] tracking-wide text-zinc-500">generative music engine</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDiscoverOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            <SearchIcon width={13} height={13} />
            Discover
          </button>
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            <LibraryIcon width={13} height={13} />
            Library{savedIds.size > 0 ? ` · ${savedIds.size}` : ""}
          </button>
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="rounded-full px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:text-white lg:hidden"
          >
            Queue
          </button>
          <button
            type="button"
            onClick={() => setShowShortcuts(true)}
            aria-label="Keyboard shortcuts"
            className="rounded-full p-2 text-zinc-500 transition-colors hover:text-white"
          >
            <KeyboardIcon width={17} height={17} />
          </button>
          <button
            type="button"
            onClick={toggleImmersive}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/25 hover:text-white"
          >
            Immersive
          </button>
        </div>
      </header>

      {/* main */}
      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-8 px-4 pb-44 sm:px-8 lg:grid-cols-[1fr_340px]">
        {/* now playing */}
        <section className="flex min-w-0 flex-col items-center text-center">
          <div className="relative aspect-square w-full max-w-[420px]">
            {/* track-change shockwave */}
            <div
              key={track.id}
              aria-hidden="true"
              className="pulse-ring pointer-events-none absolute inset-0 rounded-full"
              style={{ background: `radial-gradient(circle, ${palette[1]}40 0%, transparent 60%)` }}
            />
            <Visualizer analyser={analyserNode} playing={playing} colors={palette} />
          </div>
          <div
            key={`info-${track.id}`}
            className={`track-enter mt-6 transition-all duration-500 ${immersive ? "pointer-events-none opacity-0" : ""}`}
          >
            {isStream(track) ? (
              <>
                <p className="mb-2 text-[11px] tracking-[0.3em] text-zinc-500 uppercase">
                  {track.artist} · {track.album}
                </p>
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{track.title}</h2>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-500">
                    <span className="relative flex h-1.5 w-1.5">
                      <span
                        className={`absolute inline-flex h-full w-full rounded-full ${playing ? "animate-ping" : ""}`}
                        style={{ backgroundColor: palette[1] }}
                      />
                      <span
                        className="relative inline-flex h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: palette[1] }}
                      />
                    </span>
                    streaming from {PROVIDER_LABEL[track.provider]}
                  </span>
                  <a
                    href={track.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-500 transition-colors hover:border-white/25 hover:text-zinc-300"
                  >
                    {track.license}
                  </a>
                </div>
              </>
            ) : (
              <>
                <p className="mb-2 text-[11px] tracking-[0.3em] text-zinc-500 uppercase">
                  {track.album} · {track.mood} · {track.bpm} bpm
                </p>
                <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{track.title}</h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-500">{track.blurb}</p>
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
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setQueueOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0a0a0f] p-4 pb-8">
            {queuePanel}
          </div>
        </div>
      )}

      {/* immersive exit — always reachable, since the header/transport are hidden on touch devices */}
      {immersive && (
        <button
          type="button"
          onClick={toggleImmersive}
          className="fixed top-5 right-5 z-30 rounded-full border border-white/10 bg-black/40 px-3.5 py-1.5 text-xs text-zinc-400 backdrop-blur-md transition-colors hover:border-white/25 hover:text-white"
        >
          Exit immersive
        </button>
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
          liked={liked.has(track.id)}
          shuffle={shuffle}
          repeat={repeat}
          volume={volume}
          muted={muted}
          onToggle={toggle}
          onNext={next}
          onPrev={prev}
          onSeek={seek}
          onLike={() => toggleLike(track.id)}
          onShuffle={() => setShuffle((s) => !s)}
          onRepeat={cycleRepeat}
          onVolume={changeVolume}
          onMute={toggleMute}
        />
      </div>

      {/* discover modal */}
      {discoverOpen && (
        <Discover
          onClose={() => setDiscoverOpen(false)}
          onPlay={playStreamNow}
          onAdd={addStreamToQueue}
          queuedIds={new Set(queue.map((t) => t.id))}
          savedIds={savedIds}
        />
      )}

      {/* offline library modal */}
      {libraryOpen && (
        <LibraryPanel
          onClose={() => setLibraryOpen(false)}
          onPlay={playNow}
          onRemoved={removeLibraryTrack}
          currentId={track.id}
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
