"use client";

import { useEffect, useState } from "react";
import {
  listLibrary,
  removeFromLibrary,
  type LibraryTrack,
} from "@/lib/library";
import { CloseIcon, PlayIcon, TrashIcon } from "./icons";
interface Props {
  onClose: () => void;
  onPlay: (t: LibraryTrack) => void;
  onRemoved: (sourceId: string) => void;
  currentId: string;
}

export default function LibraryPanel({ onClose, onPlay, onRemoved, currentId }: Props) {
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(null);

  useEffect(() => {
    let alive = true;
    listLibrary().then((t) => alive && setTracks(t));
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (t: LibraryTrack) => {
    await removeFromLibrary(t.id.slice("library:".length));
    setTracks((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
    onRemoved(t.id);
  };


  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl border border-white/10 bg-[#0b0b11] p-5 shadow-2xl sm:max-h-[80vh] sm:rounded-2xl">
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

        {tracks === null ? (
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
              Tracks saved here live in this browser and play offline, right
              alongside the generative engine.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-[11px] text-zinc-600">
              {tracks.length} track{tracks.length === 1 ? "" : "s"} · stored offline in this browser
            </p>
            <ul className="-mr-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 overscroll-contain">
              {tracks.map((t) => (
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
          </>
        )}

        <p className="mt-3 text-center text-[10px] text-zinc-700">
          Stored offline in this browser — plays without a network connection.
        </p>
      </div>
    </div>
  );
}
