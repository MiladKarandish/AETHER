"use client";

import { useRef, useState } from "react";
import { isLocal, type PlayerTrack } from "@/lib/local-track";
import { CloseIcon, HeartIcon } from "./icons";

interface Props {
  tracks: PlayerTrack[];
  currentId: string;
  playing: boolean;
  liked: ReadonlySet<string>;
  onSelect: (index: number) => void;
  onToggleLike: (id: string) => void;
  /** Drag-to-reorder; omit to disable reordering. */
  onMove?: (from: number, to: number) => void;
  /** Remove a track from the queue; omit to hide the remove button. */
  onRemove?: (index: number) => void;
}

export function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function QueueList({
  tracks,
  currentId,
  playing,
  liked,
  onSelect,
  onToggleLike,
  onMove,
  onRemove,
}: Props) {
  // Reordering uses pointer events (not HTML5 drag-and-drop) so it works on
  // touch devices too, which is where the queue is actually used.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const pointerY = useRef(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  /** Row index under a viewport Y coordinate, using live row geometry. */
  const indexAt = (clientY: number): number | null => {
    const list = listRef.current;
    if (!list) return null;
    const rows = list.querySelectorAll<HTMLElement>("[data-queue-row]");
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      // grab zone extends slightly past the row so gaps still register
      if (clientY >= r.top - r.height / 2 && clientY <= r.bottom + r.height / 2) {
        return i;
      }
    }
    // past the ends — clamp
    if (clientY < (rows[0]?.getBoundingClientRect().top ?? 0)) return 0;
    return Math.max(0, rows.length - 1);
  };

  const onHandlePointerDown = (e: React.PointerEvent, index: number) => {
    if (!onMove) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragIndex(index);
    setOverIndex(index);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (dragIndex === null || !onMove) return;
    pointerY.current = e.clientY;
    const target = indexAt(e.clientY);
    if (target !== null) setOverIndex(target);
  };

  const onHandlePointerUp = () => {
    if (dragIndex !== null && onMove && overIndex !== null && overIndex !== dragIndex) {
      onMove(dragIndex, overIndex);
    }
    setDragIndex(null);
    setOverIndex(null);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between px-1 pb-3">
        <h2 className="text-xs font-medium tracking-[0.25em] text-zinc-500 uppercase">Queue</h2>
        <span className="text-xs text-zinc-600">{tracks.length} transmissions</span>
      </div>
      {/* data-no-swipe keeps touch-dragging here scrolling the queue instead of
          dragging the whole sheet down. */}
      <ul
        ref={listRef}
        data-no-swipe
        className="flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 pb-4"
      >
        {tracks.map((track, i) => {
          const isCurrent = track.id === currentId;
          return (
            <li key={track.id}>
              <div
                data-queue-row
                role="button"
                tabIndex={0}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(i);
                  }
                }}
                className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                  isCurrent
                    ? "border-white/10 bg-white/[0.06]"
                    : "border-transparent hover:border-white/5 hover:bg-white/[0.03]"
                } ${dragIndex === i ? "opacity-40" : ""} ${
                  overIndex === i && dragIndex !== null && dragIndex !== i
                    ? "ring-1 ring-white/25"
                    : ""
                }`}
              >
                {onMove ? (
                  <button
                    type="button"
                    aria-label={`Reorder ${track.title}`}
                    onPointerDown={(e) => onHandlePointerDown(e, i)}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerUp}
                    onClick={(e) => e.stopPropagation()}
                    className="tap-target -ml-1 shrink-0 cursor-grab touch-none rounded p-1 text-zinc-700 transition-colors hover:text-zinc-400 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor">
                      <circle cx="2" cy="2" r="1.4" />
                      <circle cx="8" cy="2" r="1.4" />
                      <circle cx="2" cy="7" r="1.4" />
                      <circle cx="8" cy="7" r="1.4" />
                      <circle cx="2" cy="12" r="1.4" />
                      <circle cx="8" cy="12" r="1.4" />
                    </svg>
                  </button>
                ) : null}
                <span className="w-5 shrink-0 text-center text-xs tabular-nums text-zinc-600">
                  {isCurrent && playing ? (
                    <span className="eq inline-flex h-3.5 items-end gap-[2px]" style={{ color: track.palette[1] }}>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <span
                  className="h-8 w-8 shrink-0 rounded-lg opacity-80 transition-opacity group-hover:opacity-100"
                  style={{
                    background: `linear-gradient(135deg, ${track.palette[0]}, ${track.palette[1]})`,
                    boxShadow: isCurrent ? `0 0 14px ${track.palette[1]}55` : undefined,
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${isCurrent ? "font-medium text-white" : "text-zinc-300"}`}
                  >
                    {track.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-600">
                    {isLocal(track) ? `${track.artist} · ${track.album}` : track.album}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-zinc-600">{formatTime(track.duration)}</span>
                <button
                  type="button"
                  aria-label={liked.has(track.id) ? "Unlike" : "Like"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLike(track.id);
                  }}
                  className={`rounded-md p-1 transition-colors focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none sm:opacity-0 sm:group-hover:opacity-100 ${
                    liked.has(track.id)
                      ? "text-rose-400 sm:hover:text-zinc-300"
                      : "text-zinc-600 sm:hover:text-zinc-300"
                  }`}
                >
                  <HeartIcon filled={liked.has(track.id)} width={15} height={15} />
                </button>
                {onRemove && tracks.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove ${track.title} from queue`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(i);
                    }}
                    className="tap-target rounded-md p-1 text-zinc-700 transition-colors hover:text-red-400 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
                  >
                    <CloseIcon width={13} height={13} />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
