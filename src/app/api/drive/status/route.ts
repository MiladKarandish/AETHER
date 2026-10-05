import { DriveHttpError, type DriveStatus } from "@/lib/drive";
import { isConfigured, listTracks } from "@/lib/server/drive";
import { hasSessionSecret, readSession } from "@/lib/server/drive-session";
import { authorize, errorResponse, folderName } from "@/lib/server/drive-api";

/**
 * GET /api/drive/status — is Drive usable, and is this browser connected?
 *
 * The UI calls this on mount. It must answer even when nothing is configured:
 * "not set up" is a normal, reportable state, not an error. So unlike the other
 * routes it never throws for a missing configuration, and only reports failures
 * for a genuinely broken connected session.
 */

/** Never cache: the answer depends on a cookie and changes on connect. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const configured = isConfigured() && hasSessionSecret();

  if (!configured) {
    return Response.json(
      { configured: false, connected: false } satisfies DriveStatus,
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Read the cookie directly rather than via authorize(), so an unconnected
  // browser gets `connected: false` instead of a 401.
  const session = await readSession();
  if (!session) {
    return Response.json(
      { configured: true, connected: false } satisfies DriveStatus,
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const auth = await authorize();
    const status: DriveStatus = {
      configured: true,
      connected: true,
      account: { email: session.email ?? "", name: session.name },
      usage: { bytes: 0, files: 0 },
    };

    // The byte count is a nice-to-have, so a failure here must not sink the
    // whole status call — but it must be classified. `authorize()` only
    // refreshes a token it *believes* is stale, so the first genuine Google
    // response often arrives here: a revoked grant surfaces as a 401 from this
    // call, and swallowing it would report a dead session as connected.
    try {
      const tracks = await listTracks(auth.accessToken, folderName(), auth.retry);
      status.usage = {
        bytes: tracks.reduce((sum, t) => sum + t.bytes, 0),
        files: tracks.length,
      };
    } catch (err) {
      if (err instanceof DriveHttpError && err.status === 401) {
        // The refresh token is dead. Say so, rather than claiming a
        // connection that cannot serve a single byte.
        return Response.json(
          { configured: true, connected: false } satisfies DriveStatus,
          { headers: { "cache-control": "no-store" } },
        );
      }
      console.warn("[drive] usage lookup failed:", err);
    }

    return Response.json(status, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // A dead session is a legitimate answer, not a server fault.
    const response = errorResponse(err);
    if (response.status === 401) {
      return Response.json(
        { configured: true, connected: false } satisfies DriveStatus,
        { headers: { "cache-control": "no-store" } },
      );
    }
    return response;
  }
}
