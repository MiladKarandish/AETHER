import type { Track } from "@/lib/tracks";

export type ProviderId = "audius" | "jamendo" | "archive" | "fma" | "library";

/** A streamable track from an external free-music provider. */
export interface StreamTrack {
  /** globally unique: `${provider}:${nativeId}` */
  id: string;
  kind: "stream";
  provider: ProviderId;
  title: string;
  artist: string;
  album: string;
  /** seconds — from the API; corrected from stream metadata once loaded */
  duration: number;
  artwork: string;
  streamUrl: string;
  /** human-readable license hint (CC tracks require attribution) */
  license: string;
  /** link back to the source page */
  pageUrl: string;
  /** true → can be routed through the Web Audio graph (visualizer works) */
  corsSafe: boolean;
  /** true → the source offers a direct file download (save-to-library) */
  downloadable?: boolean;
  palette: [string, string, string];
}

/** Anything the player can put in its queue (generative Track stays untouched). */
export type PlayerTrack = Track | StreamTrack;

export const isStream = (t: PlayerTrack): t is StreamTrack =>
  (t as StreamTrack).kind === "stream";

export interface MusicProvider {
  id: ProviderId;
  /** false → provider is skipped (e.g. Jamendo without a client id) */
  available: boolean;
  search(query: string): Promise<StreamTrack[]>;
  trending?(opts?: TrendingOpts): Promise<StreamTrack[]>;
}

/** Deterministically pick a palette variant so tracks don't all look the same. */
export function pickPalette(
  palettes: [string, string, string][],
  seed: string,
): [string, string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

const REMIX_TITLE_RE =
  /\b(remix(es|ed)?|bootleg|reworks?|remakes?|flips?|mash ?ups?|vips?|covers?|edit|slowed|sped ?up|nightcore)\b/i;

/**
 * Heuristic: does the title suggest a remix/cover/bootleg rather than the
 * artist's original work? Titles marked "original mix/version" are the
 * artist's own release, so they count as originals.
 */
export function isRemixTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (/\boriginal\b/.test(t)) return false;
  return REMIX_TITLE_RE.test(t);
}

/** Options accepted by a provider's trending endpoint. */
export interface TrendingOpts {
  /** e.g. "Electronic", "Ambient" — providers may ignore unsupported genres */
  genre?: string;
}
