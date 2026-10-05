import { DriveHttpError } from "@/lib/drive";
import { revoke } from "@/lib/server/drive";
import { clearSession, readSession } from "@/lib/server/drive-session";
import { assertSameOrigin, errorResponse } from "@/lib/server/drive-api";

/**
 * POST /api/drive/disconnect — forget this browser's Drive connection.
 *
 * Revokes the grant at Google as well as clearing the cookie, so "disconnect"
 * means what a user expects: the app loses access immediately, not in an hour
 * when the access token lapses. Revocation is best-effort — the local cookie is
 * cleared either way, which is the part the user actually asked for.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await assertSameOrigin(request);

    const session = await readSession();
    if (!session) {
      // Already disconnected. Succeed anyway: the caller's intent is satisfied.
      return Response.json({ ok: true });
    }

    const token = session.accessToken ?? session.refreshToken;
    if (token) await revoke(token);
    await clearSession();

    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A GET would be a CSRF hazard (a link could disconnect the user), so 405. */
export async function GET(): Promise<Response> {
  return Response.json(
    { error: "Use POST.", code: "unknown" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

/** Keep the error type referenced so the import stays honest if routes grow. */
export type { DriveHttpError };
