import type { MusicProvider, StreamTrack } from "./types";
import { pickPalette } from "./types";

/**
 * Audius — decentralized streaming platform. Public content needs no API key:
 * every request just carries an `app_name` identifier. Discovery hosts are
 * resolved from https://api.audius.co and streams are served from CDN nodes
 * with CORS enabled, so tracks can feed the analyser/visualizer directly.
 */

const APP_NAME = "AETHER";
const FALLBACK_HOST = "https://discoveryprovider.audius.co";

const PALETTES: [string, string, string][] = [
  ["#8b5cf6", "#d946ef", "#f0abfc"],
  ["#6366f1", "#a855f7", "#e9d5ff"],
  ["#ec4899", "#f472b6", "#fbcfe8"],
  ["#7c3aed", "#c084fc", "#ede9fe"],
];

interface AudiusTrack {
  id: string;
  title: string;
  duration: number;
  permalink?: string;
  genre?: string;
  is_streamable?: boolean;
  /** present on gated tracks — these cannot be streamed freely */
  stream_conditions?: unknown;
  artwork?: Record<string, string>;
  user?: { name?: string; handle?: string };
}

let hostPromise: Promise<string> | null = null;

function getHost(): Promise<string> {
  if (!hostPromise) {
    hostPromise = fetch("https://api.audius.co", { headers: { accept: "application/json" } })
      .then((r) => r.json() as Promise<{ data: string[] }>)
      .then((j) => (Array.isArray(j.data) && j.data.length > 0 ? j.data[0] : FALLBACK_HOST))
      .catch(() => FALLBACK_HOST);
  }
  return hostPromise;
}

const playable = (t: AudiusTrack) =>
  t.is_streamable !== false && !t.stream_conditions && (t.duration ?? 0) > 0;

function mapTrack(t: AudiusTrack, host: string): StreamTrack {
  return {
    id: `audius:${t.id}`,
    kind: "stream",
    provider: "audius",
    title: t.title,
    artist: t.user?.name || t.user?.handle || "Unknown artist",
    album: t.genre ?? "Audius",
    duration: t.duration ?? 0,
    artwork: t.artwork?.["480x480"] ?? t.artwork?.["150x150"] ?? "",
    streamUrl: `${host}/v1/tracks/${t.id}/stream?app_name=${APP_NAME}`,
    license: "Uploaded by the artist — see Audius",
    pageUrl: t.permalink?.startsWith("http") ? t.permalink : `https://audius.co${t.permalink ?? ""}`,
    corsSafe: true,
    palette: pickPalette(PALETTES, t.id),
  };
}

async function query(path: string): Promise<AudiusTrack[]> {
  const host = await getHost();
  const res = await fetch(`${host}${path}${path.includes("?") ? "&" : "?"}app_name=${APP_NAME}`);
  if (!res.ok) throw new Error(`audius ${res.status}`);
  const j = (await res.json()) as { data: AudiusTrack[] };
  return Array.isArray(j.data) ? j.data : [];
}

export const audiusProvider: MusicProvider = {
  id: "audius",
  available: true,
  search: async (q) => {
    const host = await getHost();
    const tracks = await query(`/v1/tracks/search?query=${encodeURIComponent(q)}`);
    return tracks.filter(playable).map((t) => mapTrack(t, host));
  },
  trending: async () => {
    const host = await getHost();
    const tracks = await query("/v1/tracks/trending?limit=24");
    return tracks.filter(playable).map((t) => mapTrack(t, host));
  },
};
