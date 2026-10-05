"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  importFileSafe,
  isLibrarySupported,
  listLibrary,
  removeFromLibrary,
  repairLibrary,
  storageUsage,
  type LibraryTrack,
} from "@/lib/library";
import { CloseIcon, PlayIcon, PlusIcon, TrashIcon } from "./icons";
import { formatBytes, formatDuration } from "@/lib/format";
import { useSwipeToDismiss } from "@/hooks/use-keyboard-shortcuts";

interface Props {
  onClose: () => void;
  onPlay: (t: LibraryTrack) => void;
  onRemoved: (sourceId: string) => void;
  currentId: string;
  /** Plays the closing animation before the parent unmounts us. */
  closing?: boolean;
}

export default function LibraryPanel({
  onClose,
  onPlay,
  onRemoved,
  currentId,
  closing,
}: Props) {
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } =
    useSwipeToDismiss(onClose);
  // Capability is a static, environment-level fact, so resolve it during the
  // first render rather than in an effect (which would cascade a render pass).
  // When storage is unavailable the list is permanently empty, so seed it here
  // too instead of setting it from an effect.
  const [supported] = useState(() => isLibrarySupported());
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(() =>
    isLibrarySupported() ? null : [],
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refreshUsage = useCallback(() => {
    void storageUsage().then(setUsage);
  }, []);

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    listLibrary()
      .then((t) => {
        if (alive) setTracks(t);
      })
      .catch(() => {
        if (alive) setTracks([]);
      });
    refreshUsage();
    return () => {
      alive = false;
    };
  }, [refreshUsage, supported]);

  // Reclaim quota held by files whose metadata row never landed.
  const repair = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await repairLibrary();
      setTracks(await listLibrary());
      refreshUsage();
    } catch {
      setError("Could not repair the library.");
    } finally {
      setBusy(false);
    }
  }, [refreshUsage]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const audio = Array.from(files).filter((f) => f.type.startsWith("audio/"));
      if (audio.length === 0) {
        setError("Those files don't look like audio.");
        return;
      }
      setBusy(true);
      setError(null);
      const added: LibraryTrack[] = [];
      for (const file of audio) {
        const t = await importFileSafe(file);
        if (t) added.push(t);
        else setError(`Couldn't import ${file.name}.`);
      }
      if (added.length > 0) {
        setTracks((prev) => {
          const have = new Set((prev ?? []).map((t) => t.id));
          return [...(prev ?? []), ...added.filter((t) => !have.has(t.id))];
        });
      }
      refreshUsage();
      setBusy(false);
    },
    [refreshUsage],
  );

  const remove = async (t: LibraryTrack) => {
    setTracks((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
    onRemoved(t.id);
    try {
      await removeFromLibrary(t.id.slice("library:".length));
    } finally {
      refreshUsage();
    }
  };

  const q = query.trim().toLowerCase();
  const visible = (tracks ?? []).filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
  );


  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Your library"
    >
      <div
        className={`anim-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm ${closing ? "closing" : ""}`}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        className={`anim-sheet safe-bottom relative flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl border border-white/10 bg-[#0b0b11] p-5 shadow-2xl sm:max-h-[80vh] sm:rounded-2xl ${closing ? "closing" : ""}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xs font-medium tracking-[0.25em] text-zinc-400 uppercase">Your library</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-500 transition-colors hover:text-white"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {/* import — the write path this library was missing */}
        {supported && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
            }}
            className={`mb-3 rounded-xl border border-dashed p-3 transition-colors ${
              dragging ? "border-white/30 bg-white/[0.06]" : "border-white/10"
            }`}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                <PlusIcon width={13} height={13} />
                {busy ? "Importing…" : "Add audio files"}
              </button>
              <span className="text-[11px] text-zinc-600">or drop them here</span>
              <button
                type="button"
                onClick={repair}
                disabled={busy}
                className="ml-auto text-[11px] text-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400 hover:underline disabled:opacity-50"
              >
                Repair storage
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="mb-2 text-xs text-amber-400/90">
            {error}
          </p>
        )}

        {!supported ? (
          <div className="px-2 py-10 text-center">
            <p className="text-sm text-zinc-400">Offline storage isn’t available.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-600">
              This browser blocks IndexedDB or the Origin Private File System —
              common in private windows and some embedded browsers. The
              generative engine still works; only the local library is off.
            </p>
          </div>
        ) : tracks === null ? (
          <ul className="space-y-2">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-white/5" />
                <span className="flex-1 space-y-1.5">
                  <span className="block h-3 w-2/5 animate-pulse rounded bg-white/5" />
                </span>
              </li>
            ))}
          </ul>
        ) : tracks.length === 0 ? (
          <div className="px-2 py-10 text-center">
            <p className="text-sm text-zinc-400">Your library is empty.</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-600">
              Add some audio above — it’s stored in this browser and plays
              offline, right alongside the generative engine.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search library"
                aria-label="Search library"
                className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
              />
              <span className="shrink-0 text-[11px] text-zinc-600">
                {visible.length}/{tracks.length}
              </span>
            </div>
            {visible.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-zinc-600">
                Nothing matches “{query}”.
              </p>
            ) : (
              <ul
                  data-no-swipe
                  className="-mr-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 overscroll-contain"
                >
                {visible.map((t) => (
                  <li key={t.id}>
                    <div className="group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-white/5 hover:bg-white/[0.03]">
                    <span
                      className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5"
                      style={{
                        background: t.artwork ? undefined : `linear-gradient(135deg, ${t.palette[0]}, ${t.palette[1]})`,
                      }}
                    >
                      {t.artwork && (
                        // eslint-disable-next-line @next/next/no-img-element -- stored artwork, unoptimized
                        <img src={t.artwork} alt="" width={40} height={40} loading="lazy" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${t.id === currentId ? "text-white" : "text-zinc-200"}`}>
                        {t.title}
                      </span>
                      <span className="block truncate text-xs text-zinc-600">{t.artist}</span>
                    </span>
                    <span className="text-xs tabular-nums text-zinc-700">
                      {t.duration > 0 ? formatDuration(t.duration) : "—"}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${t.title} from library`}
                      onClick={() => remove(t)}
                      className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:text-red-400"
                    >
                      <TrashIcon width={15} height={15} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Play ${t.title}`}
                      onClick={() => onPlay(t)}
                      className="rounded-full border border-white/15 p-2 text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
                    >
                      <PlayIcon width={14} height={14} />
                    </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <p className="mt-3 text-center text-[10px] text-zinc-700">
          {usage && usage.quota > 0 ? `${formatBytes(usage.used)} of ${formatBytes(usage.quota)} used · ` : null}
          Stored offline in this browser — plays without a network connection.
        </p>
      </div>
    </div>
  );
}
