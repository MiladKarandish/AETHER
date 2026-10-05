"use client";

import { useEffect, useRef } from "react";

interface Props {
  analyser: AnalyserNode | null;
  playing: boolean;
  colors: [string, string, string];
}

const BARS = 108;

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export default function Visualizer({ analyser, playing, colors }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ analyser, playing, colors });

  // keep the render loop reading fresh props without re-subscribing
  useEffect(() => {
    propsRef.current = { analyser, playing, colors };
  }, [analyser, playing, colors]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    // Users who ask for reduced motion get a single static frame instead of a
    // continuously animating canvas — this is the heaviest animation in the app.
    const motionQuery =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const prefersReduced = () => motionQuery?.matches ?? false;
    // Also stop drawing while the tab is hidden, to save battery.
    let visible = typeof document === "undefined" || !document.hidden;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, w * dpr);
      canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const freq = new Uint8Array(1024);
    const wave = new Uint8Array(1024);
    const smooth = new Float32Array(BARS);
    const particles = Array.from({ length: 64 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.6 + 0.4,
      s: Math.random() * 0.0007 + 0.0002,
    }));
    let rot = 0;
    let level = 0.1;

    // Under `prefers-reduced-motion` we draw a single static frame and never
    // schedule another; otherwise this is the normal animation loop.
    const startLoop = () => {
      if (raf) return;
      raf = requestAnimationFrame(draw);
    };

    const draw = () => {
      raf = 0;
      if (!visible) return;
      // frame the animation below
      const { analyser: an, playing: isPlaying, colors: cols } = propsRef.current;
      const [c1, c2, c3] = cols.map(hexToRgb);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) / 2;
      const now = performance.now();

      let bass = 0;
      if (an) {
        an.getByteFrequencyData(freq);
        an.getByteTimeDomainData(wave);
        for (let i = 2; i < 24; i++) bass += freq[i];
        bass /= 22 * 255;
      } else {
        bass = 0.12 + 0.05 * Math.sin(now / 900);
      }

      for (let i = 0; i < BARS; i++) {
        const src =
          an && isPlaying
            ? freq[Math.min(1023, Math.floor(Math.pow(i / BARS, 1.6) * 420) + 2)] / 255
            : 0.07 + 0.05 * Math.sin(now / 700 + i * 0.42);
        smooth[i] += (src - smooth[i]) * (src > smooth[i] ? 0.5 : 0.12);
      }

      level += (bass - level) * 0.15;
      rot += 0.0016 + bass * 0.004;

      // drifting particles
      for (const p of particles) {
        p.y -= p.s * (1 + bass * 3.5);
        if (p.y < -0.02) {
          p.y = 1.02;
          p.x = Math.random();
        }
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(c2, 0.2 + level * 0.5);
        ctx.fill();
      }

      // core glow
      const r1 = base * 0.42;
      const pulse = r1 * (1 + level * 0.4);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse * 2.3);
      grad.addColorStop(0, rgba(c3, 0.28 + level * 0.4));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, pulse * 2.3, 0, Math.PI * 2);
      ctx.fill();

      // radial spectrum bars
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2;
        const v = smooth[i];
        const len = base * 0.05 + v * base * 0.4;
        const m = i / BARS;
        const col = [c1[0] + (c2[0] - c1[0]) * m, c1[1] + (c2[1] - c1[1]) * m, c1[2] + (c2[2] - c1[2]) * m];
        ctx.strokeStyle = rgba(col, 0.3 + v * 0.7);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * (r1 + len), Math.sin(a) * (r1 + len));
        ctx.stroke();
      }
      ctx.restore();
      // live waveform ring
      if (an && isPlaying) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-rot * 0.6);
        ctx.beginPath();
        const N = 180;
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2;
          const s = (wave[Math.floor((i / N) * (wave.length - 1))] - 128) / 128;
          const r = r1 * 0.92 + s * base * 0.06;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = rgba(c3, 0.75);
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }

      // inner disc
      ctx.beginPath();
      ctx.arc(cx, cy, r1 * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = rgba(c1, 0.1 + level * 0.12);
      ctx.fill();
      ctx.strokeStyle = rgba(c2, 0.45);
      ctx.lineWidth = 1;
      ctx.stroke();

      // outer faint ring
      ctx.beginPath();
      ctx.arc(cx, cy, base * 0.94, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(c2, 0.1);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Schedule the next frame unless the user prefers reduced motion, in
      // which case this single frame is all they get.
      if (!prefersReduced()) raf = requestAnimationFrame(draw);
    };

    // Restart on tab visibility changes, and when the motion preference flips.
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) startLoop();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const onMotionChange = () => {
      if (prefersReduced()) {
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        draw(); // one representative still frame
      } else {
        startLoop();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    motionQuery?.addEventListener("change", onMotionChange);
    startLoop();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery?.removeEventListener("change", onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}
