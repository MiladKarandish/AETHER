"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { composeCached, type Instrument, type ScoreEvent, type Track } from "@/lib/tracks";
import { formatTime } from "./queue-list";

/* Lane order mirrors the engine's STEMS order so the strip reads top-to-bottom
   like the mixer: sustained voices first, percussion last. */
const LANES: readonly Instrument[] = ["pad", "pluck", "bass", "kick", "snare", "hat"];

const LANE_INDEX: Record<Instrument, number> = {
  pad: 0,
  pluck: 1,
  bass: 2,
  kick: 3,
  snare: 4,
  hat: 5,
};

/** Three-letter abbreviations — the gutter is only wide enough for these. */
const LANE_LABEL: Record<Instrument, string> = {
  pad: "PAD",
  pluck: "PLK",
  bass: "BAS",
  kick: "KIK",
  snare: "SNR",
  hat: "HAT",
};

/** Events are bucketed at this many CSS pixels; each frame then costs O(width/2). */
const BUCKET_PX = 2;
/** Hard ceiling so a 4K display can't allocate an unbounded bucket array. */
const MAX_BUCKETS = 2048;

const GUTTER = 32;
const LANE_GAP = 1.5;
const PAD_Y = 4;
const ZINC_300 = [226, 232, 240] as const;

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const mix = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Lane colors stay inside the track's three-color palette: pitched voices take
 * the palette straight, drums are blends/tints of it, so the whole strip reads
 * as "this track's theme" rather than a fixed instrument rainbow.
 */
const laneColor = (lane: number, pal: readonly [number, number, number][]): readonly number[] => {
  switch (lane) {
    case 0:
      return pal[0]; // pad
    case 1:
      return pal[1]; // pluck
    case 2:
      return pal[2]; // bass
    case 3:
      return mix(pal[0], pal[1], 0.5); // kick — blended
    case 4:
      return mix(pal[1], ZINC_300, 0.45); // snare — lifted
    default:
      return ZINC_300; // hat — near-white tick
  }
};

interface Buckets {
  count: number;
  secPerBucket: number;
  /** max velocity 0..1 per (bucket, lane) */
  vel: Float32Array;
  /** latest (t + d) in seconds per (bucket, lane) — drives the bar's width */
  endT: Float32Array;
  /** how many events landed in the cell (saturating) */
  hits: Uint16Array;
  /** 1 when any event overlaps the cell's time span — powers "sounding now" */
  active: Uint8Array;
}

/**
 * Collapse the score into a fixed grid, once per track/size change. Events are
 * already sorted by `t`; we touch each event once per bucket it spans (a 3s pad
 * is ~30 cells at a typical width), keeping the pass in the tens of thousands
 * of ops. After this, no frame ever looks at `ScoreEvent[]` again.
 */
function buildBuckets(events: readonly ScoreEvent[], duration: number, count: number): Buckets {
  const cells = count * LANES.length;
  const secPerBucket = duration / count;
  const vel = new Float32Array(cells);
  const endT = new Float32Array(cells);
  const hits = new Uint16Array(cells);
  const active = new Uint8Array(cells);

  for (const e of events) {
    const lane = LANE_INDEX[e.i];
    const t0 = Math.max(0, e.t);
    const t1 = Math.max(t0 + 1e-3, e.t + e.d);
    let b0 = Math.floor(t0 / secPerBucket);
    let b1 = Math.ceil(t1 / secPerBucket) - 1;
    if (!Number.isFinite(b0) || !Number.isFinite(b1) || b1 < 0 || b0 >= count) continue;
    if (b0 < 0) b0 = 0;
    if (b1 >= count) b1 = count - 1;
    const v = Math.min(1, Math.max(0, e.v));
    for (let b = b0; b <= b1; b++) {
      const c = b * LANES.length + lane;
      if (v > vel[c]) vel[c] = v;
      if (t1 > endT[c]) endT[c] = t1;
      if (hits[c] < 65535) hits[c]++;
      // Sample the bucket's midpoint rather than "touches anywhere": a 0.06s hat
      // would otherwise light its whole 0.3s lane and read as constantly-on.
      const mid = (b + 0.5) * secPerBucket;
      if (t0 <= mid && mid < t1) active[c] = 1;
    }
  }
  return { count, secPerBucket, vel, endT, hits, active };
}

export interface ScoreViewProps {
  /** a `Track` from `@/lib/tracks` — a score only exists for generated music */
  track: Track;
  /** playhead position in seconds */
  position: number;
  /** timeline length in seconds; falls back to `track.duration` when 0 */
  duration: number;
  /** false unmounts the strip entirely — zero CPU while hidden */
  visible?: boolean;
  /** drive the rAF loop; pass the player's `playing`. Defaults to true. */
  playing?: boolean;
  /** when provided the strip becomes a seek surface, mirroring the transport */
  onSeek?: (t: number) => void;
}

export default function ScoreView({
  track,
  position,
  duration,
  visible = true,
  playing = true,
  onSeek,
}: ScoreViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  /** Set by the canvas effect so prop changes can request a repaint. */
  const requestRef = useRef<(() => void) | null>(null);

  const dur = duration > 0 ? duration : track.duration;
  const mounted = visible !== false;

  // Same shape as visualizer.tsx: the render loop reads fresh props from a ref
  // instead of re-subscribing on every position tick.
  const stateRef = useRef({ track, position, dur, mounted, playing });
  useEffect(() => {
    stateRef.current = { track, position, dur, mounted, playing };
    requestRef.current?.();
  }, [track, position, dur, mounted, playing]);

  /* ——— seeking, copied from transport.tsx's seek bar ——— */
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? position;

  const posFromEvent = useCallback(
    (clientX: number) => {
      const el = surfaceRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * dur;
    },
    [dur],
  );

  const seekable = typeof onSeek === "function";

  /* ——— canvas ——— */
  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let laneH = 0;

    /** Static bitmap: lane beds, bar grid, every note bar, labels. */
    const layer = document.createElement("canvas");
    const lctx = layer.getContext("2d");

    let layerKey = "";
    let buckets: Buckets | null = null;
    let laneColors: readonly (readonly number[])[] = [];
    let lastRatio = -1;
    let dirty = true;

    const laneTop = (lane: number) => PAD_Y + lane * (laneH + LANE_GAP);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const nw = Math.round(rect.width);
      const nh = Math.round(rect.height);
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (lctx) {
        layer.width = Math.max(1, w * dpr);
        layer.height = Math.max(1, h * dpr);
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      dirty = true;
      lastRatio = -1;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    /** Bucket the score and paint the static bitmap. Track/size changes only. */
    const rebuild = (tk: Track, length: number) => {
      const pal = tk.palette.map(hexToRgb);
      laneColors = LANES.map((_, i) => laneColor(i, pal));
      const count = Math.max(1, Math.min(MAX_BUCKETS, Math.ceil(w / BUCKET_PX)));
      buckets = buildBuckets(composeCached(tk), length, count);

      if (!lctx || w < 4 || h < 4) return;
      laneH = Math.max(2, (h - PAD_Y * 2 - LANE_GAP * (LANES.length - 1)) / LANES.length);
      lctx.clearRect(0, 0, w, h);

      for (let i = 0; i < LANES.length; i++) {
        lctx.fillStyle = "rgba(255,255,255,0.03)";
        lctx.fillRect(0, laneTop(i), w, laneH);
      }

      // bar grid — one hairline per bar, brighter every fourth
      const barLen = 240 / tk.bpm;
      if (Number.isFinite(barLen) && barLen > 0) {
        for (let t = 0, b = 0; t <= length; t += barLen, b++) {
          const x = Math.round((t / length) * w);
          lctx.fillStyle = b % 4 === 0 ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.035)";
          lctx.fillRect(x, 0, 1, h);
        }
      }

      // note bars — one fillRect per non-empty cell, O(width / 2)
      const n = buckets.count;
      for (let b = 0; b < n; b++) {
        const x = (b * buckets.secPerBucket / length) * w;
        for (let i = 0; i < LANES.length; i++) {
          const c = b * LANES.length + i;
          if (buckets.hits[c] === 0) continue;
          const v = buckets.vel[c];
          const bh = Math.max(1, laneH * (0.3 + 0.7 * v));
          const xEnd = (Math.min(length, buckets.endT[c]) / length) * w;
          lctx.fillStyle = rgba(laneColors[i], 0.34 + 0.56 * v);
          lctx.fillRect(x, laneTop(i) + (laneH - bh) / 2, Math.max(BUCKET_PX, xEnd - x), bh);
        }
      }

      // left scrim + instrument labels, so the gutter stays readable over events
      const scrim = lctx.createLinearGradient(0, 0, GUTTER + 8, 0);
      scrim.addColorStop(0, "rgba(3,7,18,0.92)");
      scrim.addColorStop(1, "rgba(3,7,18,0)");
      lctx.fillStyle = scrim;
      lctx.fillRect(0, 0, GUTTER + 8, h);
      lctx.font = "600 8px ui-monospace, SFMono-Regular, Menlo, monospace";
      lctx.textAlign = "right";
      lctx.textBaseline = "middle";
      lctx.fillStyle = "rgba(113,113,122,0.95)";
      for (let i = 0; i < LANES.length; i++) {
        lctx.fillText(LANE_LABEL[LANES[i]], GUTTER - 6, laneTop(i) + laneH / 2);
      }
      lctx.fillStyle = "rgba(255,255,255,0.08)";
      lctx.fillRect(GUTTER, 0, 1, h);
    };

    /** Composite the cached bitmap + playhead. Cheap: no per-event work. */
    const paint = () => {
      if (w < 4 || h < 4) return;
      const { track: tk, position: pos, dur: length } = stateRef.current;
      const key = `${tk.seed}|${tk.root}|${tk.bpm}|${tk.duration}|${tk.scale.join(",")}|${length}|${w}x${h}`;
      if (key !== layerKey) {
        layerKey = key;
        rebuild(tk, length);
        dirty = true;
      }
      if (!buckets) return;

      const ratio = length > 0 ? Math.min(1, Math.max(0, pos / length)) : 0;
      // skip redundant frames: nothing to animate unless the playhead moved
      if (!dirty && ratio === lastRatio) return;
      lastRatio = ratio;
      dirty = false;

      const px = ratio * w;
      ctx.clearRect(0, 0, w, h);
      if (layer.width > 0) ctx.drawImage(layer, 0, 0, w, h);

      // dim the not-yet-played tail so the strip reads as progress
      ctx.fillStyle = "rgba(0,0,0,0.42)";
      ctx.fillRect(px, 0, w - px, h);
      if (px > 0) {
        ctx.fillStyle = rgba(laneColors[2], 0.07);
        ctx.fillRect(0, 0, px, h);
      }

      // lanes sounding at `position` light up — O(6)
      const b = Math.min(buckets.count - 1, Math.max(0, Math.floor(ratio * buckets.count)));
      for (let i = 0; i < LANES.length; i++) {
        if (!buckets.active[b * LANES.length + i]) continue;
        const y = laneTop(i);
        ctx.fillStyle = rgba(laneColors[i], 0.5);
        ctx.fillRect(GUTTER, y + laneH - 1, w - GUTTER, 1);
        ctx.fillStyle = rgba(laneColors[i], 0.16);
        ctx.fillRect(px, y, GUTTER, laneH);
        ctx.font = "600 8px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = rgba(laneColors[i], 0.95);
        ctx.fillText(LANE_LABEL[LANES[i]], GUTTER - 6, y + laneH / 2);
      }

      // playhead line + cap
      ctx.save();
      ctx.shadowColor = rgba(laneColors[2], 0.9);
      ctx.shadowBlur = 8;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(px, 0, 1.5, h);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(px - 4, 0);
      ctx.lineTo(px + 4, 0);
      ctx.lineTo(px, 6);
      ctx.closePath();
      ctx.fillStyle = rgba(laneColors[2], 0.95);
      ctx.fill();
    };

    /* rAF runs only while it has something to animate (playing + visible);
       paused it parks after a single static frame. */
    const loop = () => {
      raf = requestAnimationFrame(frame);
    };
    const frame = () => {
      raf = 0;
      paint();
      const { mounted: on, playing: anim } = stateRef.current;
      if (on && anim) loop();
    };
    const request = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    requestRef.current = request;

    request();
    return () => {
      cancelAnimationFrame(raf);
      requestRef.current = null;
      ro.disconnect();
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      ref={surfaceRef}
      className={`relative h-14 w-full overflow-hidden rounded-lg border border-white/5 bg-white/[0.02] ${
        seekable ? "cursor-pointer touch-none" : ""
      }`}
      role={seekable ? "slider" : undefined}
      aria-label={seekable ? "Seek from score timeline" : undefined}
      aria-orientation={seekable ? "horizontal" : undefined}
      aria-valuemin={seekable ? 0 : undefined}
      aria-valuemax={seekable ? Math.round(dur) : undefined}
      aria-valuenow={seekable ? Math.round(shown) : undefined}
      aria-valuetext={seekable ? `${formatTime(shown)} of ${formatTime(dur)}` : undefined}
      tabIndex={seekable ? 0 : -1}
      onPointerDown={
        seekable
          ? (e: ReactPointerEvent<HTMLDivElement>) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const t = posFromEvent(e.clientX);
              setScrub(t);
              onSeek?.(t);
            }
          : undefined
      }
      onPointerMove={
        seekable
          ? (e: ReactPointerEvent<HTMLDivElement>) => {
              if (scrub === null) return;
              setScrub(posFromEvent(e.clientX));
            }
          : undefined
      }
      onPointerUp={
        seekable
          ? (e: ReactPointerEvent<HTMLDivElement>) => {
              const t = posFromEvent(e.clientX);
              setScrub(null);
              onSeek?.(t);
            }
          : undefined
      }
      onKeyDown={
        seekable
          ? (e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === "ArrowLeft") onSeek?.(Math.max(0, position - 5));
              if (e.key === "ArrowRight") onSeek?.(Math.min(dur, position + 5));
              if (e.key === "Home") onSeek?.(0);
              if (e.key === "End") onSeek?.(dur);
            }
          : undefined
      }
    >
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden="true" />
    </div>
  );
}
