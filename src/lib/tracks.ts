export type Instrument = "pad" | "pluck" | "bass" | "kick" | "snare" | "hat";

export interface ScoreEvent {
  /** start time in seconds */
  t: number;
  /** duration in seconds */
  d: number;
  /** frequency in Hz (0 for unpitched percussion) */
  f: number;
  i: Instrument;
  /** velocity 0..1 */
  v: number;
}

export interface Track {
  /** discriminator for the queue union */
  kind: "synth";
  id: string;
  title: string;
  album: string;
  mood: string;
  bpm: number;
  /** total length in seconds (including reverb tail) */
  duration: number;
  seed: number;
  /** semitone offset from C */
  root: number;
  /** semitone steps of the mode within one octave */
  scale: number[];
  /** three signature hex colors used across the UI */
  palette: [string, string, string];
  blurb: string;
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
} as const;

export const TRACKS: Track[] = [
  {
    kind: "synth",
    id: "solar-drift",
    title: "Solar Drift",
    album: "Heliographs",
    mood: "Weightless",
    bpm: 84,
    duration: 196,
    seed: 1337,
    root: 0,
    scale: [...SCALES.lydian],
    palette: ["#f59e0b", "#fbbf24", "#fef3c7"],
    blurb: "Slow golden currents of light, suspended somewhere above the sun.",
  },
  {
    kind: "synth",
    id: "ultraviolet-rain",
    title: "Ultraviolet Rain",
    album: "Heliographs",
    mood: "Nocturnal",
    bpm: 96,
    duration: 188,
    seed: 4242,
    root: 9,
    scale: [...SCALES.minor],
    palette: ["#8b5cf6", "#d946ef", "#f0abfc"],
    blurb: "A midnight storm heard through a prism — every drop a different violet.",
  },
  {
    kind: "synth",
    id: "tidal-memory",
    title: "Tidal Memory",
    album: "Cartography",
    mood: "Submerged",
    bpm: 72,
    duration: 204,
    seed: 9021,
    root: 2,
    scale: [...SCALES.dorian],
    palette: ["#06b6d4", "#14b8a6", "#a5f3fc"],
    blurb: "The ocean remembers everything it has ever carried.",
  },
  {
    kind: "synth",
    id: "night-cartography",
    title: "Night Cartography",
    album: "Cartography",
    mood: "Restless",
    bpm: 104,
    duration: 180,
    seed: 777,
    root: 4,
    scale: [...SCALES.phrygian],
    palette: ["#ef4444", "#f97316", "#fecaca"],
    blurb: "Mapping a city that only exists between 2 and 4 a.m.",
  },
  {
    kind: "synth",
    id: "glass-meridian",
    title: "Glass Meridian",
    album: "Cartography",
    mood: "Crystalline",
    bpm: 88,
    duration: 192,
    seed: 5150,
    root: 5,
    scale: [...SCALES.lydian],
    palette: ["#10b981", "#84cc16", "#bbf7d0"],
    blurb: "Lines of longitude drawn on frozen water.",
  },
  {
    kind: "synth",
    id: "half-light-chorus",
    title: "Half-Light Chorus",
    album: "Signal Bloom",
    mood: "Tender",
    bpm: 80,
    duration: 200,
    seed: 6161,
    root: 7,
    scale: [...SCALES.mixolydian],
    palette: ["#ec4899", "#fb7185", "#fbcfe8"],
    blurb: "For the minutes when dusk and dawn are indistinguishable.",
  },
  {
    kind: "synth",
    id: "analog-sunrise",
    title: "Analog Sunrise",
    album: "Signal Bloom",
    mood: "Radiant",
    bpm: 110,
    duration: 176,
    seed: 8080,
    root: 0,
    scale: [...SCALES.major],
    palette: ["#f97316", "#facc15", "#fde68a"],
    blurb: "A sunrise rebuilt from oscillators and optimism.",
  },
  {
    kind: "synth",
    id: "signal-bloom",
    title: "Signal Bloom",
    album: "Signal Bloom",
    mood: "Hypnotic",
    bpm: 92,
    duration: 196,
    seed: 3141,
    root: 11,
    scale: [...SCALES.minor],
    palette: ["#6366f1", "#3b82f6", "#c7d2fe"],
    blurb: "A transmission from deep space, patiently unfolding into a flower.",
  },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 4, 4],
  [0, 4, 5, 3],
  [0, 2, 5, 4],
  [0, 6, 3, 4],
  [0, 3, 1, 4],
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Deterministically "composes" a track into a flat list of note events.
 * Same seed => same performance every play, so seeking works like a recording.
 */
export function compose(track: Track): ScoreEvent[] {
  const rnd = mulberry32(track.seed);
  const spb = 60 / track.bpm; // seconds per beat
  const barLen = spb * 4;
  const bars = Math.max(8, Math.round((track.duration - 2) / barLen));
  const events: ScoreEvent[] = [];
  const scale = track.scale;
  const deg = (d: number) => 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7];
  const prog = PROGRESSIONS[Math.floor(rnd() * PROGRESSIONS.length)];

  const intro = 2;
  const outro = 3;
  const breakStart = Math.floor(bars * 0.5);
  const breakLen = 4;

  const energyAt = (b: number) => {
    if (b < intro) return 0.25;
    if (b >= bars - outro) return 0.3;
    if (b >= breakStart && b < breakStart + breakLen) return 0.45;
    return 1;
  };

  for (let b = 0; b < bars; b++) {
    const t0 = b * barLen;
    const energy = energyAt(b);
    const d = prog[b % prog.length];
    const chordDegrees = [d, d + 2, d + 4, d + 6];

    // PADS — one soft sustained chord per bar
    const padVoices =
      energy >= 1 ? chordDegrees : energy >= 0.4 ? chordDegrees.slice(0, 3) : chordDegrees.slice(0, 2);
    for (const cd of padVoices) {
      events.push({
        t: t0 + rnd() * 0.08,
        d: barLen * 1.08,
        f: midi(50 + track.root + deg(cd)),
        i: "pad",
        v: 0.5 + 0.1 * rnd(),
      });
    }
    // BASS
    if (energy >= 0.45) {
      const rootMidi = 33 + track.root + deg(d);
      events.push({ t: t0, d: spb * 1.7, f: midi(rootMidi), i: "bass", v: 0.8 });
      if (energy >= 1 && rnd() < 0.7) {
        events.push({
          t: t0 + spb * 2.5,
          d: spb * 0.9,
          f: midi(rootMidi + (rnd() < 0.3 ? 7 : 0)),
          i: "bass",
          v: 0.6,
        });
      }
      if (energy >= 1 && rnd() < 0.35) {
        events.push({ t: t0 + spb * 3.5, d: spb * 0.4, f: midi(rootMidi + 12), i: "bass", v: 0.45 });
      }
    }

    // PLUCK — probabilistic arpeggio on 8th notes
    for (let step = 0; step < 8; step++) {
      const t = t0 + step * (spb / 2);
      const p = energy >= 1 ? 0.62 : energy >= 0.4 ? 0.3 : 0.16;
      if (rnd() < p) {
        const nd = chordDegrees[Math.floor(rnd() * chordDegrees.length)];
        const oct = rnd() < 0.25 ? 12 : 0;
        events.push({
          t,
          d: spb * 0.55,
          f: midi(57 + track.root + deg(nd) + oct),
          i: "pluck",
          v: 0.35 + rnd() * 0.4,
        });
      }
    }

    // DRUMS
    if (energy >= 1) {
      events.push({ t: t0, d: 0.3, f: 0, i: "kick", v: 0.9 });
      events.push({ t: t0 + spb * 2, d: 0.3, f: 0, i: "kick", v: 0.85 });
      if (rnd() < 0.25) events.push({ t: t0 + spb * 3.5, d: 0.25, f: 0, i: "kick", v: 0.5 });
      events.push({ t: t0 + spb, d: 0.25, f: 0, i: "snare", v: 0.55 });
      events.push({ t: t0 + spb * 3, d: 0.25, f: 0, i: "snare", v: 0.55 });
      for (let step = 0; step < 8; step++) {
        if (rnd() < 0.85) {
          events.push({
            t: t0 + step * (spb / 2),
            d: 0.06,
            f: 0,
            i: "hat",
            v: step % 2 === 1 ? 0.4 : 0.18 + rnd() * 0.12,
          });
        }
      }
    } else if (energy >= 0.4) {
      // break — sparse heartbeat
      events.push({ t: t0, d: 0.3, f: 0, i: "kick", v: 0.5 });
      events.push({ t: t0 + spb * 2, d: 0.3, f: 0, i: "kick", v: 0.42 });
      for (let step = 0; step < 8; step += 2) {
        if (rnd() < 0.5) events.push({ t: t0 + step * (spb / 2), d: 0.06, f: 0, i: "hat", v: 0.15 });
      }
    }
  }

  events.sort((a, b) => a.t - b.t);
  return events;
}

