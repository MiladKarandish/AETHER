import { compose, type ScoreEvent, type Track } from "./tracks";
import type { LocalTrack } from "./local-track";

const LOOKAHEAD = 0.35;
const TICK_MS = 60;

interface Voice {
  srcs: AudioScheduledSourceNode[];
  gain: GainNode;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Real-time synthesizer built on the Web Audio API.
 * Plays the deterministic score produced by `compose()` with a look-ahead
 * scheduler, supports play/pause/seek, volume, and exposes an analyser node
 * for visualizations.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private noise: AudioBuffer | null = null;
  private events: ScoreEvent[] = [];
  private duration = 0;
  private idx = 0;
  private voices: Voice[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private offset = 0;
  private startedAt = 0;
  private _playing = false;
  private _volume = 0.8;
  private _muted = false;
  private finished = false;

  // ——— local file playback (offline library) ———
  private mode: "synth" | "local" = "synth";
  private localTrack: LocalTrack | null = null;
  private el: HTMLAudioElement | null = null;
  private srcEl: MediaElementAudioSourceNode | null = null;

  /** Fired when playback reaches the end of the track. */
  onEnded: (() => void) | null = null;
  /** Fired when the real duration becomes known after loading a local file. */
  onDurationChanged: ((trackId: string, duration: number) => void) | null = null;
  /** Fired when a local file fails to load/play (used to skip). */
  onAudioError: ((error: unknown) => void) | null = null;

  setOnEnded(fn: (() => void) | null) {
    this.onEnded = fn;
  }

  setOnDurationChanged(fn: ((trackId: string, duration: number) => void) | null) {
    this.onDurationChanged = fn;
  }

  setOnAudioError(fn: ((error: unknown) => void) | null) {
    this.onAudioError = fn;
  }

  get playing() {
    return this._playing;
  }

  get ready() {
    return this.ctx !== null;
  }

  get durationSec() {
    return this.duration;
  }

  get position() {
    if (this.mode === "local") {
      if (this.el) return clamp(this.el.currentTime, 0, this.duration || this.el.duration || 0);
      return 0;
    }
    if (!this.ctx) return this.offset;
    if (!this._playing) return this.offset;
    return clamp(this.offset + (this.ctx.currentTime - this.startedAt), 0, this.duration);
  }

  getAnalyser() {
    return this.analyser;
  }

  /** Swap in a new track. Stops any ongoing playback. */
  load(track: Track) {
    this.stopAllVoices(0.05);
    this.stopTimer();
    this.pauseLocalEl();
    this.mode = "synth";
    this.localTrack = null;
    this.events = compose(track);
    this.duration = track.duration;
    this.offset = 0;
    this.idx = 0;
    this._playing = false;
    this.finished = false;
  }

  /**
   * Load a local audio file (offline library). The blob: URL is same-origin,
   * so the element is routed through master gain + analyser — the visualizer
   * works for local tracks unconditionally.
   */
  loadLocal(t: LocalTrack) {
    this.stopAllVoices(0.05);
    this.stopTimer();
    this.pauseLocalEl();
    this.mode = "local";
    this.localTrack = t;
    this.events = [];
    this.duration = t.duration || 0;
    this.offset = 0;
    this.idx = 0;
    this._playing = false;
    this.finished = false;
    const el = this.getEl();
    el.src = t.url;
    el.load();
    this.ensureCtx();
    this.connectLocal();
    this.applyGain();
  }

  /** Route the local media element through master gain + analyser. */
  private connectLocal() {
    if (!this.el || !this.ctx || this.srcEl || !this.master) return;
    this.srcEl = this.ctx.createMediaElementSource(this.el);
    this.srcEl.connect(this.master);
  }

  private getEl(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = new Audio();
    el.preload = "auto";
    el.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        this.duration = el.duration;
        this.onDurationChanged?.(this.localTrack?.id ?? "", el.duration);
      }
    });
    el.addEventListener("ended", () => {
      this._playing = false;
      this.onEnded?.();
    });
    el.addEventListener("error", () => {
      if (el.src) this.onAudioError?.(new Error(`audio error: ${el.src}`));
    });
    this.el = el;
    return el;
  }

  private pauseLocalEl() {
    this.el?.pause();
  }

  async play() {
    if (this.mode === "local") {
      const el = this.el;
      if (!el || !el.src) return;
      this.ensureCtx();
      if (this.ctx!.state === "suspended") {
        try {
          await this.ctx!.resume();
        } catch {
          /* ignore */
        }
      }
      this._playing = true;
      try {
        await el.play();
      } catch (err) {
        this._playing = false;
        this.onAudioError?.(err);
      }
      return;
    }
    if (this.duration === 0) return;
    this.ensureCtx();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }
    if (this.finished || this.offset >= this.duration) {
      this.offset = 0;
      this.finished = false;
    }
    this._playing = true;
    // small delay so the scheduler has a stable, near-future reference point
    this.startedAt = ctx.currentTime + 0.08;
    this.idx = this.lowerBound(this.offset);
    this.tick();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  pause() {
    if (!this._playing) return;
    if (this.mode === "local") {
      this.el?.pause();
      this._playing = false;
      return;
    }
    this.offset = this.position;
    this._playing = false;
    this.stopTimer();
    this.stopAllVoices(0.08);
  }

  seek(t: number) {
    if (this.mode === "local") {
      const el = this.el;
      const max = this.duration || el?.duration || 0;
      if (el) el.currentTime = clamp(t, 0, max);
      this.duration = max;
      return;
    }
    const target = clamp(t, 0, this.duration);
    const wasPlaying = this._playing;
    this.stopAllVoices(0.05);
    this.offset = target;
    this.finished = target < this.duration ? false : this.finished;
    if (wasPlaying && this.ctx) {
      this.startedAt = this.ctx.currentTime + 0.05;
      this.idx = this.lowerBound(target);
    } else {
      this.idx = this.lowerBound(target);
    }
  }

  setVolume(v: number) {
    this._volume = clamp(v, 0, 1);
    this.applyGain();
  }

  setMuted(m: boolean) {
    this._muted = m;
    this.applyGain();
  }

  destroy() {
    this.stopTimer();
    this.stopAllVoices(0.03);
    this.pauseLocalEl();
    if (this.el) {
      this.el.removeAttribute("src");
      this.el.load();
    }
    this.el = null;
    this.srcEl = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
  private ensureCtx() {
    if (this.ctx) return;
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    // note bus -> master (dry) and -> convolution reverb -> master (wet)
    this.bus = ctx.createGain();
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    const conv = ctx.createConvolver();
    conv.buffer = this.makeIR(ctx, 2.8, 2.4);

    this.bus.connect(this.master);
    this.bus.connect(wet);
    wet.connect(conv);
    conv.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // shared noise buffer for percussion
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  private makeIR(ctx: AudioContext, seconds: number, decay: number) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  private applyGain() {
    const target = this._muted ? 0 : this._volume;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
    }
  }

  private lowerBound(t: number) {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private stopAllVoices(fade: number) {
    if (!this.ctx) {
      this.voices = [];
      return;
    }
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0, now + fade);
        for (const s of v.srcs) s.stop(now + fade + 0.03);
      } catch {
        /* source already stopped */
      }
    }
    this.voices = [];
  }

  private tick() {
    if (!this._playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const pos = this.position;
    while (this.idx < this.events.length && this.events[this.idx].t < pos + LOOKAHEAD) {
      const ev = this.events[this.idx++];
      const when = Math.max(now + 0.02, this.startedAt + (ev.t - this.offset));
      this.playEvent(ev, when);
    }
    if (pos >= this.duration) {
      this._playing = false;
      this.offset = this.duration;
      this.finished = true;
      this.stopTimer();
      this.stopAllVoices(0.6); // let the reverb tail breathe
      this.onEnded?.();
    }
  }

  private playEvent(ev: ScoreEvent, t: number) {
    switch (ev.i) {
      case "pad":
        this.playPad(t, ev.d, ev.f, ev.v);
        break;
      case "pluck":
        this.playPluck(t, ev.d, ev.f, ev.v);
        break;
      case "bass":
        this.playBass(t, ev.d, ev.f, ev.v);
        break;
      case "kick":
        this.playKick(t, ev.v);
        break;
      case "snare":
        this.playSnare(t, ev.v);
        break;
      case "hat":
        this.playHat(t, ev.v);
        break;
    }
  }
  /** Registers a voice so pause/seek can stop it click-free; auto-prunes on end. */
  private track(srcs: AudioScheduledSourceNode[], gain: GainNode) {
    const voice: Voice = { srcs, gain };
    this.voices.push(voice);
    srcs[0].onended = () => {
      const i = this.voices.indexOf(voice);
      if (i !== -1) this.voices.splice(i, 1);
    };
  }

  private playPad(t: number, d: number, f: number, v: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus!);
    const env = ctx.createGain();
    const peak = v * 0.09;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + d * 0.4);
    env.gain.setValueAtTime(peak, t + d * 0.75);
    env.gain.linearRampToValueAtTime(0, t + d * 1.05);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = Math.min(f * 5, 2200);
    filt.Q.value = 0.6;
    env.connect(filt);
    filt.connect(out);
    const srcs: AudioScheduledSourceNode[] = [];
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(env);
      o.start(t);
      o.stop(t + d * 1.1);
      srcs.push(o);
    }
    this.track(srcs, out);
  }

  private playPluck(t: number, d: number, f: number, v: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus!);
    const env = ctx.createGain();
    const dur = Math.max(d, 0.4);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.2, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = Math.min(f * 6, 6500);
    env.connect(filt);
    filt.connect(out);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = f;
    o.connect(env);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track([o], out);
  }

  private playBass(t: number, d: number, f: number, v: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus!);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.34, t + 0.02);
    env.gain.setValueAtTime(v * 0.34, t + d * 0.6);
    env.gain.linearRampToValueAtTime(0, t + d);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 420;
    env.connect(filt);
    filt.connect(out);
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = f;
    o1.connect(env);
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = f;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o2.connect(g2);
    g2.connect(env);
    o1.start(t);
    o1.stop(t + d + 0.05);
    o2.start(t);
    o2.stop(t + d + 0.05);
    this.track([o1, o2], out);
  }
  private playKick(t: number, v: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus!);
    const env = ctx.createGain();
    env.gain.setValueAtTime(v * 0.9, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    env.connect(out);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(43, t + 0.13);
    o.connect(env);
    o.start(t);
    o.stop(t + 0.32);
    this.track([o], out);
  }

  private playSnare(t: number, v: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus!);
    // noise burst
    const env = ctx.createGain();
    env.gain.setValueAtTime(v * 0.3, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    env.connect(bp);
    bp.connect(out);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.connect(env);
    n.start(t, Math.random());
    n.stop(t + 0.22);
    // tonal body
    const body = ctx.createGain();
    body.gain.setValueAtTime(v * 0.15, t);
    body.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    body.connect(out);
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 200;
    o.connect(body);
    o.start(t);
    o.stop(t + 0.1);
    this.track([n, o], out);
  }

  private playHat(t: number, v: number) {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.bus!);
    const env = ctx.createGain();
    env.gain.setValueAtTime(v * 0.14, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 8200;
    env.connect(hp);
    hp.connect(out);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.connect(env);
    n.start(t, Math.random());
    n.stop(t + 0.07);
    this.track([n], out);
  }
}

