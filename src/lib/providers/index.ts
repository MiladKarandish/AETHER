import type {
  MusicProvider,
  PlayerTrack,
  ProviderId,
  StreamTrack,
  TrendingOpts,
} from "./types";
import { isRemixTitle } from "./types";
import { audiusProvider } from "./audius";
import { jamendoProvider } from "./jamendo";
import { archiveProvider } from "./archive";
import { fmaProvider } from "./fma";

export * from "./types";

/**
 * Order matters: results are interleaved fairly per provider, so the first
 * entry gets the top slots. Audius first — the largest, best-quality open
 * catalog; the others follow.
 */
export const PROVIDERS: MusicProvider[] = [
  audiusProvider,
  jamendoProvider,
  archiveProvider,
  fmaProvider,
];

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  audius: "Audius",
  jamendo: "Jamendo",
  archive: "Archive",
  fma: "FMA",
};

/** Generative tracks always come first in Discover. */
export const PROVIDER_FILTERS: (ProviderId | "all")[] = [
  "all",
  "audius",
  "jamendo",
  "archive",
  "fma",
];

const cache = new Map<string, StreamTrack[]>();
let seq = 0;

export interface SearchResult {
  tracks: StreamTrack[];
  /** provider ids that were queried for this request */
  providers: ProviderId[];
  /** true if this result is stale (a newer search has started) */
  stale: boolean;
}

/**
 * Search every available provider in parallel (cached per query). Failures
 * degrade silently — a dead provider just contributes no results.
 * Originals are ranked ahead of remixes/covers/edits.
 */
export async function searchAll(query: string): Promise<StreamTrack[]> {
  const key = `q:${query.toLowerCase().trim()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mine = ++seq;
  const active = PROVIDERS.filter((p) => p.available);
  const results = await Promise.all(
    active.map((p) =>
      p.search(query).catch(() => [] as StreamTrack[]),
    ),
  );
  if (mine !== seq) return []; // superseded by a newer query
  const merged = dedupe(results.flat());
  const ranked = rankOriginalsFirst(merged);
  cache.set(key, ranked);
  return ranked;
}

/** Trending / curated picks from every provider that supports it. */
export async function trendingAll(opts?: TrendingOpts): Promise<StreamTrack[]> {
  const genre = opts?.genre ?? "";
  const key = `trending:${genre}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mine = ++seq;
  const active = PROVIDERS.filter((p) => p.available && p.trending);
  const results = await Promise.all(
    active.map((p) =>
      p.trending!({ genre: genre || undefined }).catch(() => [] as StreamTrack[]),
    ),
  );
  if (mine !== seq) return [];
  const merged = dedupe(results.flat());
  const ranked = rankOriginalsFirst(merged);
  cache.set(key, ranked);
  return ranked;
}

/** Stable-sort originals ahead of remixes/covers/edits. */
export function rankOriginalsFirst(tracks: StreamTrack[]): StreamTrack[] {
  return [...tracks].sort(
    (a, b) => Number(isRemixTitle(a.title)) - Number(isRemixTitle(b.title)),
  );
}

/** Interleave providers so each gets fair representation at the top. */
function dedupe(tracks: StreamTrack[]): StreamTrack[] {
  const seen = new Set<string>();
  const byProvider = new Map<ProviderId, StreamTrack[]>();
  for (const t of tracks) {
    if (seen.has(t.id) || !t.streamUrl) continue;
    seen.add(t.id);
    const list = byProvider.get(t.provider) ?? [];
    list.push(t);
    byProvider.set(t.provider, list);
  }
  const out: StreamTrack[] = [];
  const queues = [...byProvider.values()];
  for (let i = 0; queues.some((q) => q.length > 0); i++) {
    for (const q of queues) {
      const t = q.shift();
      if (t && i < 24) out.push(t);
    }
  }
  return out;
}

export function filterByProvider(
  tracks: StreamTrack[],
  provider: ProviderId | "all",
): StreamTrack[] {
  return provider === "all" ? tracks : tracks.filter((t) => t.provider === provider);
}

/** Placeholder entry used while a queued stream's URL is being resolved. */
export function asPlayerTrack(t: StreamTrack): PlayerTrack {
  return t;
}
