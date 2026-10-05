/**
 * Track accent colours.
 *
 * Imported files have no artwork of their own, so they get a deterministic
 * gradient picked from a fixed set. Keeping the set and the hash in one module
 * means the offline library and the Google Drive library pick the same colour
 * for the same seed, so a track never changes appearance as it moves between
 * the two backends.
 */
const PALETTES: [string, string, string][] = [
  ["#f59e0b", "#fbbf24", "#fef3c7"],
  ["#8b5cf6", "#d946ef", "#f0abfc"],
  ["#06b6d4", "#14b8a6", "#a5f3fc"],
  ["#ef4444", "#f97316", "#fecaca"],
  ["#10b981", "#84cc16", "#bbf7d0"],
  ["#ec4899", "#fb7185", "#fbcfe8"],
];

/** Stable FNV-1a hash, so a given seed always maps to the same palette. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The palette for a seed — stable across sessions, machines and backends. */
export function paletteFor(seed: string): [string, string, string] {
  return PALETTES[hashString(seed) % PALETTES.length];
}

/** Every palette, for callers that need the whole set (e.g. previews). */
export const PALETTE_SET = PALETTES;
