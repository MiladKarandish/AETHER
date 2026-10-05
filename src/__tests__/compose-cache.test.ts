import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/lib/tracks";

/** A fresh module instance => an empty module-level compose cache. */
const loadFresh = async () => {
  vi.resetModules();
  return await import("@/lib/tracks");
};

/** Tracks that differ only in seed, so each maps to a distinct cache key. */
const withSeed = (seed: number, base: Track): Track => ({ ...base, id: `cache-${seed}`, seed });

describe("composeCached", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the same array reference for the same input", async () => {
    const { compose, composeCached, TRACKS } = await loadFresh();
    const track = TRACKS[0];

    const first = composeCached(track);
    const second = composeCached(track);
    expect(second).toBe(first);
    // also for a structurally-equal but distinct object (same cache key)
    expect(composeCached({ ...track })).toBe(first);

    expect(first).toEqual(compose(track));
    first.push({ t: -1, d: 1, f: 1, i: "pad", v: 1 });
    expect(composeCached(track)).toBe(first); // hit returns the very same (mutated) array
  });

  it("keys on seed/root/bpm/duration/scale, not on id or title", async () => {
    const { composeCached, TRACKS } = await loadFresh();
    const track = TRACKS[3];

    const base = composeCached(track);
    expect(composeCached({ ...track, id: "other", title: "Other" })).toBe(base);
    expect(composeCached({ ...track, root: track.root + 1 })).not.toBe(base);
    expect(composeCached({ ...track, bpm: track.bpm + 1 })).not.toBe(base);
    expect(composeCached({ ...track, duration: track.duration + 1 })).not.toBe(base);
    expect(composeCached({ ...track, scale: [...track.scale].reverse() })).not.toBe(base);
  });

  it("caches remixes under their own new seed", async () => {
    const { compose, composeCached, remixTrack, TRACKS } = await loadFresh();
    const track = TRACKS[4];

    const r1 = remixTrack(track, 1);
    const r2 = remixTrack(track, 2);
    const c1 = composeCached(r1);
    expect(composeCached(r1)).toBe(c1);
    expect(c1).toEqual(compose(r1));

    expect(composeCached(r2)).not.toBe(c1);
    expect(c1).not.toEqual(composeCached(r2));
  });

  it("bounds the cache at 16 entries, evicting the oldest first", async () => {
    const { composeCached, TRACKS } = await loadFresh();
    const base = TRACKS[5];

    const keys = Array.from({ length: 16 }, (_, i) => withSeed(1000 + i, base));
    const refs = keys.map((k) => composeCached(k));
    expect(new Set(refs).size).toBe(16); // all distinct so far

    // A 17th distinct key evicts the oldest (insertion order), then is cached itself.
    const overflow = withSeed(9999, base);
    const overflowRef = composeCached(overflow);
    expect(overflowRef).not.toBe(refs[0]);
    expect(composeCached(overflow)).toBe(overflowRef);

    // keys[0] was dropped, so recomposing yields equal-but-distinct content...
    const recomputed0 = composeCached(keys[0]);
    expect(recomputed0).not.toBe(refs[0]);
    expect(recomputed0).toEqual(refs[0]);

    // ...and inserting it again drops the next-oldest entry, proving FIFO order.
    expect(composeCached(keys[1])).not.toBe(refs[1]);

    // The 13 entries that are still resident are served from memory by reference,
    // which is what keeps re-selecting a track cheap.
    for (const i of [3, 4, 5, 8, 15]) {
      expect(composeCached(keys[i])).toBe(refs[i]);
    }
    expect(composeCached(overflow)).toBe(overflowRef);
  });

  it("never grows past 16 entries under sustained distinct input", async () => {
    const { composeCached, TRACKS } = await loadFresh();
    const base = TRACKS[6];

    // Fill well past the bound, then confirm the oldest entries were released while
    // the cache still returns correct (not stale) scores for them.
    const seen = Array.from({ length: 40 }, (_, i) => composeCached(withSeed(5000 + i, base)));
    expect(new Set(seen).size).toBe(40); // every recomposition produced a fresh array

    const early = composeCached(withSeed(5000, base));
    expect(early).not.toBe(seen[0]);
    expect(early).toEqual(seen[0]); // correct content, just not the cached instance

    const recent = composeCached(withSeed(5039, base));
    expect(recent).toBe(seen[39]); // most recent entry survived
  });
});