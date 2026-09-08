import type { Track } from "@/lib/tracks";

export type ProviderId = "audius" | "jamendo" | "archive" | "fma";

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
  trending?(): Promise<StreamTrack[]>;
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
