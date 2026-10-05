"use client";

import { useCallback } from "react";
import type { Stem } from "@/lib/engine";
import { CloseIcon, SlidersIcon } from "./icons";

interface Props {
  gains: Record<Stem, number>;
  onChange: (stem: Stem, value: number) => void;
  onClose: () => void;
  onReset: () => void;
}

/** Display names and colours for the six synth voices. */
const LANES: { id: Stem; label: string; hint: string; color: string }[] = [
  { id: "pad", label: "Pads", hint: "sustained chords", color: "#38bdf8" },
  { id: "pluck", label: "Plucks", hint: "arpeggio", color: "#a78bfa" },
  { id: "bass", label: "Bass", hint: "low end", color: "#f472b6" },
  { id: "kick", label: "Kick", hint: "low drum", color: "#fbbf24" },
  { id: "snare", label: "Snare", hint: "backbeat", color: "#fb923c" },
  { id: "hat", label: "Hats", hint: "high texture", color: "#34d399" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function MixerPanel({ gains, onChange, onClose, onReset }: Props) {
  // A voice is effectively muted at or below this level.
  const isMuted = (v: number) => v <= 0.001;
  const toggleMute = useCallback(
    (stem: Stem) => onChange(stem, isMuted(gains[stem]) ? 1 : 0),
    [gains, onChange],
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Mixer"
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="safe-bottom safe-x relative flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl border border-white/10 bg-[#0b0b11] p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-xs font-medium tracking-[0.25em] text-zinc-400 uppercase">
            <SlidersIcon width={14} height={14} />
            Mixer
          </h3>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onReset}
              className="rounded-full px-2.5 py-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close mixer"
              className="tap-target rounded-md p-1 text-zinc-500 transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
            >
              <CloseIcon width={16} height={16} />
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
          {LANES.map((lane) => {
            const value = gains[lane.id];
            const muted = isMuted(value);
            return (
              <li key={lane.id} className="flex items-center gap-3">
                <div className="w-20 shrink-0">
                  <label
                    htmlFor={`stem-${lane.id}`}
                    className="block truncate text-xs text-zinc-300"
                  >
                    {lane.label}
                  </label>
                  <span className="block truncate text-[10px] text-zinc-600">{lane.hint}</span>
                </div>
                <input
                  id={`stem-${lane.id}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={value}
                  onChange={(e) => onChange(lane.id, Number(e.target.value))}
                  aria-label={`${lane.label} volume`}
                  aria-valuetext={pct(value)}
                  className="stem-slider h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
                  style={{
                    background: muted
                      ? "rgba(255,255,255,0.12)"
                      : `linear-gradient(90deg, ${lane.color} ${value * 100}%, rgba(255,255,255,0.12) ${value * 100}%)`,
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleMute(lane.id)}
                  aria-label={muted ? `Unmute ${lane.label}` : `Mute ${lane.label}`}
                  aria-pressed={muted}
                  className={`tap-target w-9 shrink-0 rounded-md px-1 py-1 text-[10px] tabular-nums transition-colors focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none ${
                    muted
                      ? "bg-rose-500/20 text-rose-300"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {muted ? "MUTE" : pct(value)}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-center text-[10px] text-zinc-700">
          Levels apply to generated tracks and are saved for next time.
        </p>
      </div>
    </div>
  );
}