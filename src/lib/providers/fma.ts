import type { MusicProvider, StreamTrack } from "./types";

/**
 * FMA (Free Music Archive) — the live API is no longer reliably available, so
 * this provider serves a curated catalog committed to the repo at
 * /fma-catalog.json. Fill that file with entries and the provider lights up;
 * with the starter file it reports itself unavailable.
 */

interface CatalogEntry {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  artwork?: string;
  streamUrl: string;
  license?: string;
  pageUrl?: string;
  genre?: string;
}

let catalog: CatalogEntry[] | null = null;

async function loadCatalog(): Promise<CatalogEntry[]> {
  if (catalog) return catalog;
  try {
    const res = await fetch("/fma-catalog.json");
    const j = (await res.json()) as CatalogEntry[];
    catalog = Array.isArray(j) ? j.filter((e) => e.streamUrl) : [];
  } catch {
    catalog = [];
  }
  return catalog;
}

function mapEntry(e: CatalogEntry): StreamTrack {
  return {
    id: `fma:${e.id}`,
    kind: "stream",
    provider: "fma",
    title: e.title,
    artist: e.artist,
    album: e.album ?? "Free Music Archive",
    duration: e.duration ?? 0,
    artwork: e.artwork ?? "",
    streamUrl: e.streamUrl,
    license: e.license ?? "Creative Commons — see Free Music Archive",
    pageUrl: e.pageUrl ?? "https://freemusicarchive.org",
    corsSafe: true, // FMA CDN serves CORS headers
    palette: ["#f472b6", "#c084fc", "#fbcfe8"],
  };
}

export const fmaProvider: MusicProvider = {
  id: "fma",
  available: false, // set below once the catalog is known to be populated
  search: async (q) => {
    const items = await loadCatalog();
    const needle = q.toLowerCase();
    return items
      .filter(
        (e) =>
          e.title.toLowerCase().includes(needle) ||
          e.artist.toLowerCase().includes(needle),
      )
      .slice(0, 20)
      .map(mapEntry);
  },
  trending: async () => (await loadCatalog()).slice(0, 24).map(mapEntry),
};

// Seed the availability flag asynchronously at module load.
void loadCatalog().then((items) => {
  fmaProvider.available = items.length > 0;
});
