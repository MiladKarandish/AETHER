import dns from "node:dns";

// Some provider hosts advertise broken IPv6 on certain networks — Node's
// fetch does not fall back to IPv4, so prefer A records process-wide.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  /* older runtimes */
}

/**
 * Same-origin audio streaming proxy.
 *
 * Free-music providers redirect their streams to CDN nodes that don't send
 * CORS headers (Audius content nodes, some Internet Archive items). A media
 * element with `crossOrigin="anonymous"` then fails with a CORS error — and
 * without the analyser path the visualizer dies.
 *
 * The browser treats this endpoint as same-origin, so audio can always be
 * routed through the Web Audio graph. Range requests are forwarded so
 * seeking works, and the upstream redirect chain is followed server-side.
 *
 * Note: this proxies any https URL, which is acceptable for a personal app
 * but should be tightened to a provider allowlist before public deployment.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target) return new Response("missing url", { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  // block non-public schemes (file:, http: internal hosts, etc.)
  if (parsed.protocol !== "https:") {
    return new Response("only https sources are proxied", { status: 400 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(parsed, {
    headers: {
      // some CDNs reject requests without a user agent
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AETHER/1.0",
      ...(range ? { range } : {}),
    },
    redirect: "follow",
    cache: "no-store",
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("upstream failed", { status: 502 });
  }

  const headers = new Headers();
  const copy = ["content-type", "content-length", "content-range", "accept-ranges"];
  for (const h of copy) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) headers.set("content-type", "audio/mpeg");
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, { status: upstream.status, headers });
}
