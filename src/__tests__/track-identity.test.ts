import { describe, expect, it } from "vitest";
import { compose, remixTrack, TRACKS, variationOf } from "@/lib/tracks";

describe("remixTrack", () => {
  it.each(TRACKS.map((t) => [t.id, t] as const))("%s — keeps identity, swaps the seed", (_id, track) => {
    const remix = remixTrack(track, 3);

    // same id family: the variation counter is appended, never replacing the base id
    expect(remix.id).toBe(`${track.id}#v3`);
    expect(remix.id.startsWith(track.id)).toBe(true);

    // different seed => a genuinely different performance
    expect(remix.seed).not.toBe(track.seed);
    expect(compose(remix)).not.toEqual(compose(track));

    // metadata is preserved verbatim
    expect(remix.kind).toBe(track.kind);
    expect(remix.title).toBe(track.title);
    expect(remix.album).toBe(track.album);
    expect(remix.mood).toBe(track.mood);
    expect(remix.bpm).toBe(track.bpm);
    expect(remix.duration).toBe(track.duration);
    expect(remix.root).toBe(track.root);
    expect(remix.blurb).toBe(track.blurb);
    expect(remix.palette).toEqual(track.palette);
    expect([...remix.scale]).toEqual([...track.scale]);
  });

  it("does not mutate the source track", () => {
    const track = TRACKS[0];
    const before = JSON.stringify(track);
    remixTrack(track, 5);
    expect(JSON.stringify(track)).toBe(before);
  });

  it("yields a distinct id and seed per variation, and is stable", () => {
    const track = TRACKS[1];
    const seeds = new Set<number>();
    const ids = new Set<string>();
    for (let v = 1; v <= 12; v++) {
      const remix = remixTrack(track, v);
      seeds.add(remix.seed);
      ids.add(remix.id);
      expect(remix.seed).not.toBe(track.seed);
      expect(remixTrack(track, v)).toEqual(remix); // pure
    }
    expect(seeds.size).toBe(12);
    expect(ids.size).toBe(12);
  });

  it("keeps the seed an unsigned 32-bit integer, including for large variations", () => {
    const track = TRACKS[0];
    for (const v of [1, 2, 3, 7, 100, 1000, 65535, 1_000_000]) {
      const { seed } = remixTrack(track, v);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("round-trips the variation index through the id", () => {
    const track = TRACKS[2];
    for (const v of [1, 2, 3, 4, 9, 17, 100]) {
      expect(variationOf(remixTrack(track, v).id)).toBe(v);
    }
  });

  it("variation 0 keeps the original seed but still namespaces the id", () => {
    // `seed ^ 0` is the identity, so v0 is a re-render of the same performance.
    const track = TRACKS[0];
    const remix = remixTrack(track, 0);
    expect(remix.id).toBe(`${track.id}#v0`);
    expect(remix.seed).toBe(track.seed);
    expect(variationOf(remix.id)).toBe(0);
  });
});

describe("variationOf", () => {
  it("parses an explicit variation suffix", () => {
    expect(variationOf("solar-drift#v3")).toBe(3);
    expect(variationOf("solar-drift#v0")).toBe(0);
    expect(variationOf("solar-drift#v17")).toBe(17);
    expect(variationOf("a#v007")).toBe(7); // parsed as a number, not compared as a string
  });

  it("returns 0 for a plain id", () => {
    expect(variationOf("solar-drift")).toBe(0);
    expect(variationOf("")).toBe(0);
  });

  it("is anchored to the end of the id", () => {
    // Only a trailing "#vN" counts; a trailing marker matches, junk does not.
    expect(variationOf("solar-drift#v3#v4")).toBe(4);
    expect(variationOf("solar-drift#v3x")).toBe(0);
    expect(variationOf("solar-drift#v")).toBe(0);
    expect(variationOf("solar-drift#v-3")).toBe(0);
    expect(variationOf("solar-drift#V3")).toBe(0);
  });
});