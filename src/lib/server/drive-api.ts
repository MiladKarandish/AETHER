import "server-only";

import { cookies } from "next/headers";
import {
  DRIVE_ERRORS,
  DRIVE_FOLDER_NAME,
  DriveHttpError,
  driveErrorCode,
  driveErrorMessage,
} from "@/lib/drive";
import {
  clearSession,
  hasSessionSecret,
  readSession,
  writeSession,
  type DriveSession,
} from "@/lib/server/drive-session";
import { readConfig, refreshTokens } from "@/lib/server/drive";

/**
 * Shared plumbing for the Drive route handlers: resolve a valid access token
 * from the session cookie, and turn any failure into a consistent JSON body.
 */

/** The folder name, overridable so a deploy can share one library. */
export function folderName(): string {
  const override = process.env.GOOGLE_DRIVE_FOLDER?.trim();
  return override || DRIVE_FOLDER_NAME;
}

/**
 * An access token plus the session it came from.
 *
 * The session is returned because a refresh may rotate the stored tokens, and
 * the caller needs to be able to persist them.
 */
export interface Authorized {
  accessToken: string;
  session: DriveSession;
  /**
   * Obtain a new access token when Drive rejects this one.
   *
   * Passed into the Drive helpers as their `onRetry` callback, so a token that
   * expires mid-request costs one extra round trip rather than a user-visible
   * error.
   */
  retry: () => Promise<string>;
}

/** True when a cached access token still has comfortable life left in it. */
function isFresh(issuedAt: number | undefined): boolean {
  return (
    typeof issuedAt === "number" &&
    Number.isFinite(issuedAt) &&
    // Google access tokens last 3600s. Refreshing a minute early means an
    // in-flight playback request can never race the expiry.
    Date.now() - issuedAt < (3600 - 60) * 1000
  );
}

/**
 * Resolve an access token for this request, or throw a {@link DriveHttpError}
 * the caller converts into a response.
 */
export async function authorize(): Promise<Authorized> {
  const config = readConfig();
  if (!config) {
    throw new DriveHttpError(501, DRIVE_ERRORS.notConfigured, "notConfigured");
  }
  if (!hasSessionSecret()) {
    // Without this the cookie cannot be encrypted, so no session can exist.
    throw new DriveHttpError(
      501,
      "AETHER_SESSION_SECRET is not set on the server.",
      "notConfigured",
    );
  }

  const session = await readSession();
  if (!session) {
    throw new DriveHttpError(401, DRIVE_ERRORS.notConnected, "notConnected");
  }

  if (!isFresh(session.accessTokenIssuedAt) || !session.accessToken) {
    await refresh(config, session);
  }

  return {
    accessToken: session.accessToken ?? "",
    session,
    retry: async () => {
      // Force a refresh, then hand back the token to retry the request with.
      await refresh(config, session);
      return session.accessToken ?? "";
    },
  };
}

/** Swap the refresh token for a fresh access token and persist it. */
async function refresh(
  config: NonNullable<ReturnType<typeof readConfig>>,
  session: DriveSession,
): Promise<void> {
  try {
    const tokens = await refreshTokens(config, session.refreshToken);
    session.accessToken = tokens.accessToken;
    session.accessTokenIssuedAt = Date.now();
    // Google only returns a new refresh token on re-consent; keep the old one
    // otherwise so the session never loses its long-lived credential.
    if (tokens.refreshToken) session.refreshToken = tokens.refreshToken;
    await writeSession(session);
  } catch (err) {
    // A rejected refresh token cannot be recovered from — the grant is gone
    // (revoked, or the user changed their password). Drop the session so the UI
    // offers "Reconnect" instead of retrying forever.
    if (err instanceof DriveHttpError && (err.status === 400 || err.status === 401)) {
      await clearSession();
      throw new DriveHttpError(401, DRIVE_ERRORS.unauthorized, "unauthorized");
    }
    throw err;
  }
}

/**
 * Map any thrown value to a JSON response.
 *
 * Every Drive route funnels errors through here, so the client sees the same
 * `{ error, code }` shape no matter where the failure happened.
 *
 * The `code` matters to the UI, not just the message: it decides whether the
 * panel offers "Reconnect" or a plain retry. Deriving it from the HTTP status
 * alone would lose that, because "not configured" and "not connected" are both
 * 501/401 responses that look like generic auth failures — so an explicit code
 * carried by the error always wins.
 */
export function errorResponse(err: unknown): Response {
  if (err instanceof DriveHttpError) {
    const code = err.code ?? driveErrorCode(err);
    // 501 means this build has no Drive credentials, so a session cannot exist.
    // Clearing the cookie would be pointless and would hide the real problem.
    return Response.json(
      { error: err.message || driveErrorMessage(code), code },
      { status: err.status },
    );
  }
  // Never leak a raw internal message (it can contain a token URL).
  const code = driveErrorCode(err);
  return Response.json({ error: driveErrorMessage(code), code }, { status: 500 });
}

/**
 * Reject cross-site mutations (CSRF).
 *
 * A cookie is sent automatically on cross-site requests, so `SameSite=Lax`
 * alone is not enough for a state-changing endpoint; comparing Origin to Host
 * closes the gap.
 */
export async function assertSameOrigin(request: Request): Promise<void> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  // Absence means a non-browser client or same-origin navigation; nothing to
  // check, and this endpoint is not reachable cross-origin without Origin.
  if (!origin || !host) return;
  try {
    if (new URL(origin).host !== host) {
      throw new DriveHttpError(403, DRIVE_ERRORS.forbidden, "forbidden");
    }
  } catch {
    throw new DriveHttpError(403, DRIVE_ERRORS.forbidden, "forbidden");
  }
}

/** Read the cookies once, for routes that need them directly. */
export async function cookieStore() {
  return cookies();
}
