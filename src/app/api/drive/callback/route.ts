import { cookies } from "next/headers";
import { DriveHttpError } from "@/lib/drive";
import { exchangeCode, readConfig, toSessionTokens } from "@/lib/server/drive";
import { STATE_COOKIE, writeSession } from "@/lib/server/drive-session";
import { errorResponse } from "@/lib/server/drive-api";

/**
 * GET /api/drive/callback — Google's redirect target.
 *
 * Exchanges the authorization code for tokens, seals them into the session
 * cookie, and redirects back to the app. Any failure also redirects back (with
 * `?drive=error`) rather than rendering a raw error page, because the user
 * arrived here from a full-page navigation and a bare JSON screen would look
 * broken.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const config = readConfig();
    if (!config) {
      throw new DriveHttpError(501, "Google Drive isn’t configured.", "notConfigured");
    }

    const url = new URL(request.url);
    const error = url.searchParams.get("error");
    if (error) {
      return redirectToApp(url, "denied");
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) throw new DriveHttpError(400, "Malformed OAuth callback.");

    // CSRF: the nonce we issued must come back unchanged. A mismatch means this
    // response is not the reply to *our* authorisation request.
    const store = await cookies();
    const expected = store.get(STATE_COOKIE)?.value;
    if (!expected || expected !== state) {
      throw new DriveHttpError(400, "The sign-in request could not be verified.");
    }

    const tokens = toSessionTokens(await exchangeCode(config, code));
    if (!tokens.refreshToken) {
      // Google only issues one on fresh consent. If it is missing, the account
      // had already granted access, which still works — but warn loudly, since
      // the connection will not survive a server-side secret change.
      console.warn("[drive] no refresh token returned; session may not persist");
    }

    await writeSession({
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenIssuedAt: Date.now(),
    });
    return redirectToApp(url, "connected");
  } catch (err) {
    const response = errorResponse(err);
    // Preserve the message so the app can explain what went wrong.
    const body = (await response.clone().json()) as { error?: string };
    const url = new URL(request.url);
    return Response.redirect(failureUrl(url, body.error ?? "Something went wrong."), 302);
  }
}

/** Send the user back to the app with a short status the UI understands. */
function redirectToApp(callbackUrl: URL, outcome: "connected" | "denied"): Response {
  const target = new URL("/", callbackUrl.origin);
  target.searchParams.set("drive", outcome);
  return Response.redirect(target, 302);
}

/** Redirect home with an error message, never showing raw Google text. */
function failureUrl(callbackUrl: URL, message: string): URL {
  const target = new URL("/", callbackUrl.origin);
  target.searchParams.set("drive", "error");
  target.searchParams.set("reason", message.slice(0, 200));
  return target;
}
