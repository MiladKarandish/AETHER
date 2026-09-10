import type { Track } from "./tracks";

/**
 * A local, file-backed audio track (the offline library, stored in OPFS).
 * Played through an HTMLAudioElement via a blob: URL — always same-origin,
 * so the analyser (visualizer) works unconditionally.
 */
export interface LocalTrack {
  id: string;
  /** discriminator for the queue union */
  kind: "local";
  title: string;
  artist: string;
  album: string;
  /** duration in seconds — 0 until the browser reads the file's metadata */
  duration: number;
  artwork: string;
  palette: [string, string, string];
  /** blob: URL minted per session from the stored file */
  url: string;
}

/** Everything the player queue can contain. */
export type PlayerTrack = Track | LocalTrack;

export function isLocal(t: PlayerTrack): t is LocalTrack {
  return t.kind === "local";
}
