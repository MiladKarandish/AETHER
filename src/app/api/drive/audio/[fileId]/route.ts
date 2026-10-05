import { DriveHttpError } from "@/lib/drive";
import { getTrack, streamMedia } from "@/lib/server/drive";
import { assertSameOrigin, authorize, errorResponse } from "@/lib/server/drive-api";

/**
 * GET /api/drive/audio/[fileId] — stream a Drive file's bytes.
 *
 * This is what makes a Drive track behave like a local one. The engine points
 * an `HTMLAudioElement` at this URL and routes it through the Web Audio graph,
 * so the route must:
 *
 *   - be same-origin (it is), otherwise the analyser goes silent under CORS;
 *   - honour Range requests, otherwise seeking does not work;
 *   - never be cached, since it is private and revocation must take effect
 *     immediately.
 *
 * `fileId` is Drive's own opaque id, so it is validated only for shape before
 * being interpolated into the upstream URL.
 */

/** Streaming and auth both mean this can never be prerendered or cached. */
export const dynamic = "force-dynamic";

/** Rejects ids that are not plausible Drive file ids. */
const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await params;
    if (!FILE_ID.test(fileId)) {
      throw new DriveHttpError(400, "That isn’t a valid Drive file id.");
    }

    const auth = await authorize();

    // Confirm the file is audio before spending bandwidth on it. This also
    // gives a clean 404 for a file the user deleted in Drive.
    const meta = await getTrack(auth.accessToken, fileId, auth.retry);
    if (!meta) throw new DriveHttpError(404, "That file is no longer in Drive.");

    return await streamMedia(
      auth.accessToken,
      fileId,
      request.headers.get("range"),
      auth.retry,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * HEAD is used by some media stacks to probe a resource.
 *
 * Answering it from GET would download the whole file, so it is handled
 * explicitly: fetch the metadata, advertise the size and range support, and
 * send no body.
 */
export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const { fileId } = await params;
    if (!FILE_ID.test(fileId)) throw new DriveHttpError(400, "Invalid file id.");

    const auth = await authorize();
    const meta = await getTrack(auth.accessToken, fileId, auth.retry);
    if (!meta) throw new DriveHttpError(404, "That file is no longer in Drive.");

    return new Response(null, {
      status: 200,
      headers: {
        "content-type": meta.mimeType,
        "content-length": String(meta.bytes),
        "accept-ranges": "bytes",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Media is only ever fetched, never mutated, from this path. */
export async function POST(request: Request): Promise<Response> {
  try {
    await assertSameOrigin(request);
    throw new DriveHttpError(405, "Use GET to stream audio.");
  } catch (err) {
    return errorResponse(err);
  }
}
