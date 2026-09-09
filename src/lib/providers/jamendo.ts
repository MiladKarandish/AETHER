import type { MusicProvider, StreamTrack } from "./types";
import { pickPalette } from "./types";

/**
 * Jamendo — 600k+ CC-licensed tracks. Requires a free Client ID supplied via
 * NEXT_PUBLIC_JAMENDO_CLIENT_ID; without it the provider simply reports
 * itself unavailable and is skipped by the registry.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_JAMENDO_CLIENT_ID ?? "";

const PALETTES: [string, string, string][] = [
  ["#10b981", "#84cc16", "#bbf7d0"],
  ["#06b6d4", "#14b8a6", "#a5f3fc"],
  ["#f59e0b", "#fbbf24", "#fef3c7"],
  ["#22c55e", "#a3e635", "#d9f99d"],
];

interface JamendoTrack {
  id: string;
  name: string;
  duration: number;
  artist_name?: string;
  album_name?: string;
  image?: string;
  audio?: string;
  license_ccurl?: string;
  shorturl?: string;
}

function mapTrack(t: JamendoTrack): StreamTrack {
  return {
    id: `jamendo:${t.id}`,
    kind: "stream",
    provider: "jamendo",
    title: t.name,
    artist: t.artist_name ?? "Unknown artist",
    album: t.album_name ?? "Jamendo",
    duration: t.duration ?? 0,
    artwork: t.image ?? "",
    streamUrl: t.audio ?? "",
    license: "Creative Commons — free to stream with attribution",
    pageUrl: t.shorturl ?? t.license_ccurl ?? "https://www.jamendo.com",
    corsSafe: true,
    // every Jamendo track ships a direct MP3 (audiodownload) — always savable
    downloadable: true,
    palette: pickPalette(PALETTES, t.id),
  };
}

async function query(params: string): Promise<StreamTrack[]> {
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${CLIENT_ID}&format=json&include=musicinfo&imagesize=600&${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`jamendo ${res.status}`);
  const j = (await res.json()) as { results: JamendoTrack[] };
  return (Array.isArray(j.results) ? j.results : [])
    .filter((t) => t.audio)
    .map(mapTrack);
}

export const jamendoProvider: MusicProvider = {
  id: "jamendo",
  available: CLIENT_ID.length > 0,
  search: (q) => query(`search=${encodeURIComponent(q)}&limit=20`),
  trending: () => query("order=popularity_week&limit=24"),
};
