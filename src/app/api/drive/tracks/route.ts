import { DriveHttpError, isAudioName, mimeTypeFor, type DriveTrack } from "@/lib/drive";
import { createUploadSession, listTracks } from "@/lib/server/drive";
import { assertSameOrigin, authorize, errorResponse, folderName } from "@/lib/server/drive-api";

/**
 * GET  /api/drive/tracks — the library listing.
 * POST /api/drive/tracks — begin an upload.
 *
 * The upload is deliberately split in two. This route only mints a Google
 * resumable session and hands the URL back; the browser then PUTs the bytes
 * straight to Google. That keeps large albums off this server entirely, sidesteps
 * request body size limits, and means a slow connection to Drive does not tie up
 * a Next worker.
 */

/** Never cached — the listing is per-user and changes constantly. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const auth = await authorize();
    const tracks = await listTracks(auth.accessToken, folderName(), auth.retry);
    return Response.json(
      { tracks } satisfies { tracks: DriveTrack[] },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/** The body the client posts to start an upload. */
interface UploadRequest {
  name?: unknown;
  bytes?: unknown;
  mimeType?: unknown;
  title?: unknown;
  artist?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  try {
    await assertSameOrigin(request);
    const auth = await authorize();

    const body = (await request.json().catch(() => ({}))) as UploadRequest;

    const name = str(body.name, "Untitled");
    // Reject anything we could not play back rather than storing dead weight.
    if (!isAudioName(name)) {
      throw new DriveHttpError(415, "That doesn’t look like an audio file.");
    }

    const bytes = num(body.bytes);
    if (bytes <= 0) {
      throw new DriveHttpError(400, "The file is empty.");
    }

    const session = await createUploadSession(
      auth.accessToken,
      {
        name,
        bytes,
        mimeType: str(body.mimeType) || mimeTypeFor(name) || "audio/mpeg",
        title: str(body.title),
        artist: str(body.artist),
      },
      folderName(),
      auth.retry,
    );

    // The session URL embeds an access token, so this response must never be
    // cached or logged.
    return Response.json(
      { uploadUrl: session.uploadUrl, fileId: session.fileId },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/** Accept a string, trimmed, or fall back. */
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

/** Accept a finite number, or 0. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
