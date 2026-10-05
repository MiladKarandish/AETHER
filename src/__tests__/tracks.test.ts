import { describe, expect, it } from "vitest";
import { compose, mulberry32, TRACKS, type Instrument, type ScoreEvent, type Track } from "@/lib/tracks";

const DRUMS: ReadonlySet<Instrument> = new Set<Instrument>(["kick", "snare", "hat"]);

const barLenOf = (t: Track) => (60 / t.bpm) * 4;
const barsOf = (t: Track) => Math.max(8, Math.round((t.duration - 2) / barLenOf(t)));

/** Events whose start falls inside bars [from, to). */
const eventsInBars = (events: ScoreEvent[], barLen: number, from: number, to: number) => {
  const lo = from * barLen;
  const hi = to * barLen;
  return events.filter((e) => e.t >= lo && e.t < hi);
};

describe("mulberry32", () => {
  it("produces an identical sequence for the same seed", () => {
    const a = Array.from({ length: 500 }, mulberry32(1337));
    const b = Array.from({ length: 500 }, mulberry32(1337));
    expect(a).toEqual(b);
    expect(a).toHaveLength(500);
  });

  it("matches the known mulberry32 output for seed 1337", () => {
    // Pins the exact PRNG arithmetic — every composed track's audio depends on these values.
    const seq = Array.from({ length: 8 }, mulberry32(1337));
    expect(seq).toEqual([
      0.1844118325971067, 0.18998925131745636, 0.8104719922412187, 0.6437488221563399, 0.430774615611881,
      0.381045897025615, 0.5265626488253474, 0.5485863720532507,
    ]);
  });

  it("stays within [0, 1) and is not degenerate for seed 0", () => {
    const rnd = mulberry32(0);
    const values = Array.from({ length: 2000 }, () => rnd());
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(values).size).toBeGreaterThan(1900);
  });

  it("spreads roughly uniformly and is seed-sensitive", () => {
    const rnd = mulberry32(42);
    const values = Array.from({ length: 20000 }, () => rnd());
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);

    const deciles = new Array<number>(10).fill(0);
    for (const v of values) deciles[Math.floor(v * 10)]++;
    for (const count of deciles) {
      expect(count).toBeGreaterThan(20000 / 10 - 600);
      expect(count).toBeLessThan(20000 / 10 + 600);
    }

    const first = Array.from({ length: 50 }, mulberry32(1));
    const second = Array.from({ length: 50 }, mulberry32(2));
    expect(first).not.toEqual(second);
  });

  it("gives independent streams for equal seeds", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });

  it("normalises the seed to a uint32 before mixing", () => {
    // `seed >>> 0` means out-of-range and negative seeds wrap instead of poisoning the state.
    const take = (s: number) => Array.from({ length: 6 }, mulberry32(s));
    expect(take(-1)).toEqual(take(4294967295));
    expect(take(4294967296)).toEqual(take(0));
    expect(take(12345678901234)).toEqual(take(12345678901234 >>> 0));
  });
});

const CASES = TRACKS.map((t) => [t.id, t] as const);

describe("compose", () => {
  it.each(CASES)("%s — is deterministic", (_id, track) => {
    expect(compose(track)).toEqual(compose(track));
    // A structurally-equal but distinct object must also render identically.
    expect(compose({ ...track })).toEqual(compose(track));
  });

  it.each(CASES)("%s — emits sorted, well-formed events", (_id, track) => {
    const events = compose(track);
    expect(events.length).toBeGreaterThan(100);

    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }

    for (const e of events) {
      expect(Number.isFinite(e.t)).toBe(true);
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(e.d).toBeGreaterThan(0);
      expect(e.f).toBeGreaterThanOrEqual(0);
      expect(e.v).toBeGreaterThan(0); // within range, and never silent
      expect(e.v).toBeLessThanOrEqual(1);
    }
  });
it.each(CASES)("%s — pitches are valid frequencies", (_id, track) => {
    const events = compose(track);
    for (const e of events) {
      if (DRUMS.has(e.i)) {
        expect(e.f).toBe(0); // percussion is unpitched
      } else {
        expect(e.f).toBeGreaterThan(20);
        expect(e.f).toBeLessThan(20000);
      }
    }
    expect(events.some((e) => DRUMS.has(e.i))).toBe(true);
    expect(events.some((e) => !DRUMS.has(e.i))).toBe(true);
  });

  it.each(CASES)("%s — intro/outro are quieter than the high-energy middle", (_id, track) => {
    const barLen = barLenOf(track);
    const bars = barsOf(track);
    const drumsIn = (from: number, to: number) =>
      eventsInBars(compose(track), barLen, from, to).filter((e) => DRUMS.has(e.i)).length;

    // intro = first 2 bars, outro = last 3 bars (see energyAt in tracks.ts)
    expect(drumsIn(0, 2)).toBe(0);
    expect(drumsIn(bars - 3, bars)).toBe(0);

    const peakPerBar = drumsIn(4, 10) / 6;
    expect(peakPerBar).toBeGreaterThanOrEqual(4);

    // the "break" (energy 0.45) sits at bars 50%..50%+4
    const breakPerBar = drumsIn(Math.floor(bars * 0.5), Math.floor(bars * 0.5) + 4) / 4;
    expect(breakPerBar).toBeGreaterThan(0);
    expect(peakPerBar).toBeGreaterThanOrEqual(breakPerBar * 2);
  });
it.each(CASES)("%s — every bar carries at least two pad voices", (_id, track) => {
    const barLen = barLenOf(track);
    const events = compose(track);
    for (let b = 0; b < barsOf(track); b++) {
      const pads = eventsInBars(events, barLen, b, b + 1).filter((e) => e.i === "pad");
      expect(pads.length).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(CASES)("%s — thins the pad voicing in the intro/outro", (_id, track) => {
    const barLen = barLenOf(track);
    const bars = barsOf(track);
    const padsIn = (from: number, to: number) =>
      eventsInBars(compose(track), barLen, from, to).filter((e) => e.i === "pad").length;

    // intro/outro run a 2-note voicing; full-energy bars get the whole 4-note chord.
    expect(padsIn(0, 2)).toBe(2 * 2);
    expect(padsIn(bars - 3, bars)).toBe(3 * 2);
    expect(padsIn(4, 10)).toBe(6 * 4);
  });

  it.each(CASES)("%s — arpeggiates more densely in the middle than the intro", (_id, track) => {
    const barLen = barLenOf(track);
    const plucks = (from: number, to: number) =>
      eventsInBars(compose(track), barLen, from, to).filter((e) => e.i === "pluck").length;

    // intro uses p=0.16 per 8th note, the peak uses p=0.62 — the difference must show up.
    const peakPerBar = plucks(4, 10) / 6;
    const introPerBar = plucks(0, 2) / 2;
    expect(peakPerBar).toBeGreaterThan(introPerBar * 2);
    expect(peakPerBar).toBeGreaterThanOrEqual(4);
  });

  it.each(CASES)("%s — the performance fits inside track.duration", (_id, track) => {
    const events = compose(track);
    expect(Math.max(...events.map((e) => e.t + e.d))).toBeLessThanOrEqual(track.duration);
  });

  it("responds to the seed and does not mutate the track", () => {
    const track = TRACKS[0];
    const before = JSON.stringify(track);
    const base = compose(track);
    const reseeded = compose({ ...track, seed: track.seed + 1 });

    expect(JSON.stringify(track)).toBe(before);
    expect(reseeded).not.toEqual(base);
    expect(reseeded.length).toBeGreaterThan(0);
  });

  it("honours a minimum of 8 bars for very short tracks", () => {
    const tiny: Track = { ...TRACKS[0], bpm: 120, duration: 1 };
    expect(barsOf(tiny)).toBe(8);
    const events = compose(tiny);
    expect(events.length).toBeGreaterThan(0);
    expect(Math.max(...events.map((e) => e.t))).toBeLessThan(8 * barLenOf(tiny));
  });
});
