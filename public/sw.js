/**
 * AETHER service worker — offline shell for a generative music engine.
 *
 * Strategy (deliberately NOT "cache everything"):
 *
 *   1. Navigations / HTML   -> NETWORK FIRST, cache only as an offline fallback.
 *      A naive cache-first HTML handler serves a stale document forever after a
 *      deploy, pinning users to a dead build. Network-first means an online user
 *      always gets the current HTML; an offline user gets the last good shell.
 *
 *   2. /_next/static/*      -> CACHE FIRST. These filenames are content-hashed by
 *      the build, so the bytes at a given URL can never change. Safe to keep.
 *
 *   3. Same-origin /public  -> CACHE FIRST. Plain static files (icons, manifest,
 *      any future images/audio). Bumped out of the cache by bumping CACHE_VERSION.
 *
 *   4. Everything else      -> NOT INTERCEPTED. RSC payloads (?_rsc=), /_next/image
 *      and any third-party request go straight to the network, so we can never
 *      serve stale app data or a stale image transform.
 *
 * Note on OPFS + IndexedDB: the imported library lives in the browser's own storage,
 * reached through navigator.storage.getDirectory() and indexedDB. Those are not HTTP
 * requests, so they never reach this fetch handler. Playback of local tracks runs off
 * blob: URLs, which we also never intercept (see the scheme check below).
 *
 * BUMP CACHE_VERSION on every deploy that changes the shell. `activate` drops every
 * generation older than the previous one.
 */

const CACHE_VERSION = "v1";

/**
 * How many cache generations to keep. Two (current + previous) means a tab that
 * was open across a deploy can still fetch the old hashed chunks it already
 * references, instead of 404-ing into a white screen on its next lazy chunk.
 */
const KEEP_GENERATIONS = 2;

const PREFIX = "aether-";
const SHELL_CACHE = `${PREFIX}shell-${CACHE_VERSION}`;
const ASSET_CACHE = `${PREFIX}assets-${CACHE_VERSION}`;

/** The app shell, cached so a cold offline load still boots. */
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

/** Give up on the network after this long and fall back to cache. */
const NETWORK_TIMEOUT_MS = 5000;

const OFFLINE_FALLBACK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AETHER — offline</title>
<style>
  html,body{height:100%;margin:0;background:#050507;color:#e8e8f0;
    font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;
    display:flex;align-items:center;justify-content:center;text-align:center}
  p{max-width:22rem;line-height:1.6;opacity:.7;font-size:.9rem}
</style></head>
<body><p>AETHER is offline and has no cached shell yet. Reconnect once to install it.</p></body></html>`;

/* ------------------------------------------------------------------ helpers */

function generation(name) {
  const m = new RegExp(`^${PREFIX}[a-z]+-(.+)$`).exec(name);
  return m ? m[1] : null;
}

/** A response we are willing to store: same-origin, successful, cacheable. */
function isStorable(response) {
  return Boolean(
    response &&
      response.ok &&
      response.status === 200 &&
      response.type === "basic" &&
      response.headers.get("vary") !== "*"
  );
}

/** Store a copy, swallowing every failure. Never rejects. */
async function put(cacheName, request, response) {
  try {
    if (!isStorable(response)) return;
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {
    /* quota exceeded, opaque response, cache closed — never fatal */
  }
}

async function match(request) {
  try {
    return await caches.match(request);
  } catch {
    return undefined;
  }
}

/**
 * Fetch with a hard timeout. Returns undefined on any failure (offline, DNS,
 * abort, timeout). The underlying request is deliberately left running so a slow
 * network can still warm the cache after we have already answered from cache.
 */
async function fetchWithTimeout(request) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), NETWORK_TIMEOUT_MS);
  });
  const pending = fetch(request).then(
    (response) => response,
    () => undefined
  );
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------ navigation (HTML) */

async function handleNavigation(request) {
  const response = await fetchWithTimeout(request);

  if (isStorable(response)) {
    // Refresh the shell in the background; never block the response on it.
    void put(SHELL_CACHE, request, response);
    return response;
  }

  // Offline (or slow/errored): exact match, then the bare shell.
  const cached = (await match(request)) || (await match("/"));
  if (cached) return cached;

  return new Response(OFFLINE_FALLBACK_HTML, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/* ------------------------------------------------ cache-first static assets */

async function handleAsset(request) {
  const cached = await match(request);
  if (cached) return cached;

  const response = await fetchWithTimeout(request);
  if (response) {
    void put(ASSET_CACHE, request, response);
    return response;
  }
  return cached || Response.error();
}

/* --------------------------------------------------------- classification */

/** /_next/static/* — content-hashed by the build, therefore immutable. */
function isImmutableBuildAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

/**
 * Same-origin files served straight out of /public. Everything under /_next/ that
 * is NOT /_next/static/ is excluded, because that is where Next serves mutable
 * responses (RSC payloads, image optimisation).
 */
function isPublicAsset(url) {
  return !url.pathname.startsWith("/_next/") && !url.pathname.startsWith("/api/");
}

/**
 * Next.js App Router data traffic. These arrive as fetch() with ?_rsc= and/or an
 * RSC header rather than as navigations, and they must always hit the network.
 */
function isRouterTraffic(request, url) {
  return (
    url.searchParams.has("_rsc") ||
    url.pathname.endsWith(".rsc") ||
    url.pathname.endsWith("/index.txt") ||
    request.headers.has("RSC") ||
    request.headers.has("Next-Router-State-Tree") ||
    request.headers.has("Next-Action") ||
    request.headers.has("Next-Url")
  );
}

/* ---------------------------------------------------------------- lifecycle */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        // Individually, so one missing asset cannot fail the whole install.
        await Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            const request = new Request(url, { cache: "reload" });
            const response = await fetch(request);
            if (isStorable(response)) await cache.put(url, response);
          })
        );
      } catch {
        /* precache is best-effort */
      }
      // Take over promptly; the two-generation cache policy keeps open tabs safe.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        const generations = new Set(names.map(generation).filter((g) => g !== null));
        const keep = new Set(
          [...generations]
            .sort((a, b) => String(b).localeCompare(String(a), undefined, { numeric: true }))
            .slice(0, KEEP_GENERATIONS)
        );

        await Promise.all(
          names.map((name) => {
            const g = generation(name);
            // Delete anything outside the current and previous generation.
            return g !== null && keep.has(g) ? undefined : caches.delete(name);
          })
        );
      } catch {
        /* cache cleanup is best-effort */
      }
      await self.clients.claim();
    })()
  );
});

/* -------------------------------------------------------------------- fetch */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  try {
    // Only GET is cacheable; never interfere with mutations.
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // Only same-origin http(s). This also excludes blob:, data:, and the
    // IndexedDB/OPFS-backed blob URLs used for local library playback.
    if (url.origin !== self.location.origin) return;
    if (url.protocol !== "http:" && url.protocol !== "https:") return;

    // Range requests (media scrubbing) must not be answered from a full cache entry.
    if (request.headers.has("range")) return;

    // Never serve app data from cache.
    if (isRouterTraffic(request, url)) return;

    if (request.mode === "navigate") {
      event.respondWith(handleNavigation(request));
      return;
    }

    if (isImmutableBuildAsset(url) || isPublicAsset(url)) {
      event.respondWith(handleAsset(request));
    }
    // Anything else falls through to the browser default (pure network).
  } catch {
    /* never let a handler bug break playback */
  }
});

/** Let the page trigger an immediate update via controller.postMessage({type:'SKIP_WAITING'}). */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});