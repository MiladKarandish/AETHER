"use client";

import { useCallback, useRef, useState } from "react";
import type { Track } from "@/lib/tracks";
import { formatTime } from "./queue-list";
import {
  HeartIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  VolumeIcon,
} from "./icons";

export type RepeatMode = "off" | "all" | "one";

interface Props {
  track: Track;
  playing: boolean;
  position: number;
  liked: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (t: number) => void;
  onLike: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onVolume: (v: number) => void;
  onMute: () => void;
}

export default function Transport(props: Props) {
  const { track, playing, position, volume, muted } = props;
  const barRef = useRef<HTMLDivElement | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? position;
  const pct = track.duration > 0 ? Math.min(1, shown / track.duration) : 0;

  const posFromEvent = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * track.duration;
    },
    [track.duration],
  );

  return (
    <div className="border-t border-white/5 bg-black/50 backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
        {/* seek bar */}
        <div className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-500">{formatTime(shown)}</span>
          <div
            ref={barRef}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(track.duration)}
            aria-valuenow={Math.round(shown)}
            tabIndex={0}
            className="group relative h-6 flex-1 cursor-pointer touch-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const t = posFromEvent(e.clientX);
              setScrub(t);
              props.onSeek(t);
            }}
            onPointerMove={(e) => {
              if (scrub === null) return;
              setScrub(posFromEvent(e.clientX));
            }}
            onPointerUp={(e) => {
              const t = posFromEvent(e.clientX);
              setScrub(null);
              props.onSeek(t);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") props.onSeek(Math.max(0, position - 5));
              if (e.key === "ArrowRight") props.onSeek(Math.min(track.duration, position + 5));
            }}
          >
            <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{
                  width: `${pct * 100}%`,
                  background: `linear-gradient(90deg, ${track.palette[0]}, ${track.palette[1]}, ${track.palette[2]})`,
                  boxShadow: `0 0 10px ${track.palette[1]}66`,
                }}
              />
            </div>
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
              style={{ left: `${pct * 100}%`, boxShadow: `0 0 12px ${track.palette[2]}` }}
            />
          </div>
          <span className="w-10 shrink-0 text-xs tabular-nums text-zinc-500">{formatTime(track.duration)}</span>
        </div>
        {/* controls */}
        <div className="flex items-center justify-center gap-2 sm:justify-between sm:gap-4">
          {/* left: track info */}
          <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex">
            <span
              className="h-9 w-9 shrink-0 rounded-lg"
              style={{
                background: `linear-gradient(135deg, ${track.palette[0]}, ${track.palette[1]})`,
                boxShadow: `0 0 16px ${track.palette[1]}44`,
              }}
            />
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">{track.title}</p>
              <p className="truncate text-xs text-zinc-600">{track.album}</p>
            </div>
            <button
              type="button"
              onClick={props.onLike}
              aria-label="Like this track"
              className={`ml-1 shrink-0 rounded-md p-1.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none ${
                props.liked ? "text-rose-400" : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              <HeartIcon filled={props.liked} width={16} height={16} />
            </button>
          </div>

          {/* center: transport buttons */}
          <div className="flex flex-none items-center justify-center gap-1 sm:gap-3">
            <button
              type="button"
              onClick={props.onShuffle}
              aria-label="Shuffle"
              aria-pressed={props.shuffle}
              className={`rounded-full p-2.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none ${
                props.shuffle ? "text-white" : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              <ShuffleIcon width={17} height={17} />
            </button>
            <button
              type="button"
              onClick={props.onPrev}
              aria-label="Previous track"
              className="rounded-full p-2.5 text-zinc-400 transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
            >
              <PrevIcon />
            </button>
            <button
              type="button"
              onClick={props.onToggle}
              aria-label={playing ? "Pause" : "Play"}
              className="flex h-12 w-12 items-center justify-center rounded-full text-black shadow-lg transition-transform hover:scale-105 active:scale-95 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
              style={{
                background: `linear-gradient(135deg, ${track.palette[2]}, ${track.palette[1]})`,
                boxShadow: `0 0 28px ${track.palette[1]}55`,
              }}
            >
              {playing ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
            </button>
            <button
              type="button"
              onClick={props.onNext}
              aria-label="Next track"
              className="rounded-full p-2.5 text-zinc-400 transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
            >
              <NextIcon />
            </button>
            <button
              type="button"
              onClick={props.onRepeat}
              aria-label={`Repeat: ${props.repeat}`}
              className={`rounded-full p-2.5 transition-colors focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none ${
                props.repeat !== "off" ? "text-white" : "text-zinc-600 hover:text-zinc-300"
              }`}
            >
              {props.repeat === "one" ? <RepeatOneIcon width={17} height={17} /> : <RepeatIcon width={17} height={17} />}
            </button>
          </div>

          {/* right: volume */}
          <div className="flex flex-none items-center justify-end gap-2 sm:flex-1">
            <button
              type="button"
              onClick={props.onMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className="rounded-full p-2 text-zinc-500 transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
            >
              {muted || volume === 0 ? <MuteIcon width={17} height={17} /> : <VolumeIcon width={17} height={17} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => props.onVolume(Number(e.target.value))}
              aria-label="Volume"
              className="volume-slider hidden h-1 w-14 cursor-pointer appearance-none rounded-full min-[400px]:block sm:w-20 md:w-28"
              style={{
                background: `linear-gradient(90deg, ${track.palette[1]} ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.12) ${(muted ? 0 : volume) * 100}%)`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
