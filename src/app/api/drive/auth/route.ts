import { cookies } from "next/headers";
import { DriveHttpError } from "@/lib/drive";
import { authorizationUrl, readConfig } from "@/lib/server/drive";
import { STATE_COOKIE } from "@/lib/server/drive-session";
import { errorResponse } from "@/lib/server/drive-api";

/**
 * GET /api/drive/auth — start the OAuth consent flow.
 *
 * The browser is redirected to Google, so this handler's only job is to mint a
 * CSRF `state` nonce, stash it in a short-lived cookie, and hand back Google's
 * authorisation URL as JSON (the client navigates there itself, which keeps the
 * full-page redirect under the UI's control).
 */
export async function GET(): Promise<Response> {
  try {
    const config = readConfig();
    if (!config) {
      throw new DriveHttpError(
        501,
        "Google Drive isn’t configured on this server.",
        "notConfigured",
      );
    }

    // 256 bits of nonce; the callback compares it byte-for-byte.
    const state = crypto.randomUUID() + crypto.randomUUID();
    const store = await cookies();
    store.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax", // must survive the top-level redirect back from Google
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600, // the round trip takes seconds; 10 minutes is generous
    });

    return Response.json({ url: authorizationUrl(config, state) });
  } catch (err) {
    return errorResponse(err);
  }
}
