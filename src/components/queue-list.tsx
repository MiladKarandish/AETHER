"use client";

import { isLocal, type PlayerTrack } from "@/lib/local-track";
import { HeartIcon } from "./icons";

interface Props {
  tracks: PlayerTrack[];
  currentId: string;
  playing: boolean;
  liked: ReadonlySet<string>;
  onSelect: (index: number) => void;
  onToggleLike: (id: string) => void;
}

export function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function QueueList({ tracks, currentId, playing, liked, onSelect, onToggleLike }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between px-1 pb-3">
        <h2 className="text-xs font-medium tracking-[0.25em] text-zinc-500 uppercase">Queue</h2>
        <span className="text-xs text-zinc-600">{tracks.length} transmissions</span>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 pb-4">
        {tracks.map((track, i) => {
          const isCurrent = track.id === currentId;
          return (
            <li key={track.id}>
              <div
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
                }`}
              >
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
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
