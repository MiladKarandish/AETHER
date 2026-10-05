import { describe, expect, it } from "vitest";
import { TRACKS, compose, composeCached, remixTrack, variationOf } from "@/lib/tracks";
import { trackFromParam } from "@/hooks/use-shareable-track";

describe("determinism", () => {
  it("composes the same score for the same seed", () => {
    for (const track of TRACKS) {
      expect(compose(track)).toEqual(compose(track));
    }
  });

  it("returns sorted, positive-duration, in-range events", () => {
    for (const track of TRACKS) {
      const events = compose(track);
      expect(events.length).toBeGreaterThan(0);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
      }
      for (const e of events) {
        expect(e.d).toBeGreaterThan(0);
        expect(e.v).toBeGreaterThanOrEqual(0);
        expect(e.v).toBeLessThanOrEqual(1);
        expect(e.f).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps every pitch inside the track's declared key", () => {
    for (const track of TRACKS) {
      // Voices are `C_root + track.root + deg(...)`, so the sounding pitch
      // class must be a mode tone transposed by the track's root.
      const sounding = new Set(track.scale.map((s) => (s + track.root) % 12));
      for (const e of compose(track)) {
        if (e.f === 0) continue; // percussion is unpitched
        // A4 = 440Hz is MIDI 69; derive the pitch class from the frequency.
        const midi = Math.round(69 + 12 * Math.log2(e.f / 440));
        expect(sounding.has(((midi % 12) + 12) % 12)).toBe(true);
      }
    }
  });
});

describe("remixTrack / variationOf", () => {
  const base = TRACKS[0];

  it("changes the seed but preserves identity", () => {
    const r = remixTrack(base, 3);
    expect(r.seed).not.toBe(base.seed);
    expect(r.title).toBe(base.title);
    expect(r.album).toBe(base.album);
    expect(r.palette).toEqual(base.palette);
  });

  it("round-trips the variation index", () => {
    expect(variationOf(remixTrack(base, 7).id)).toBe(7);
    expect(variationOf(base.id)).toBe(0);
  });

  it("produces different scores for different variations", () => {
    expect(compose(remixTrack(base, 1))).not.toEqual(compose(remixTrack(base, 2)));
  });
});

describe("composeCached", () => {
  it("returns the same array identity for a repeated request", () => {
    const track = TRACKS[1];
    expect(composeCached(track)).toBe(composeCached(track));
  });
});

describe("trackFromParam", () => {
  const base = TRACKS[0];

  it("resolves a bare track id", () => {
    expect(trackFromParam(base.id)?.id).toBe(base.id);
  });

  it("resolves a remixed id back to the same variation", () => {
    const remix = remixTrack(base, 5);
    const restored = trackFromParam(remix.id);
    expect(restored?.id).toBe(remix.id);
    expect(restored?.seed).toBe(remix.seed);
  });

  it("is the inverse of remixTrack for every track and variation", () => {
    for (const t of TRACKS) {
      for (const v of [1, 2, 17]) {
        const remix = remixTrack(t, v);
        expect(trackFromParam(remix.id)?.seed).toBe(remix.seed);
      }
    }
  });

  it("returns null for unknown ids and empty input", () => {
    expect(trackFromParam("not-a-track")).toBeNull();
    expect(trackFromParam(null)).toBeNull();
    expect(trackFromParam("")).toBeNull();
  });

  it("falls back to the base track for a malformed variation suffix", () => {
    expect(trackFromParam(`${base.id}#vNotANumber`)?.id).toBe(base.id);
    expect(trackFromParam(`${base.id}#v-4`)?.id).toBe(base.id);
  });
});