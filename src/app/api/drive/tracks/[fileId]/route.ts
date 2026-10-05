import { DriveHttpError, type DriveTrack } from "@/lib/drive";
import { deleteTrack, getTrack, updateMetadata } from "@/lib/server/drive";
import { assertSameOrigin, authorize, errorResponse } from "@/lib/server/drive-api";

/**
 * PATCH  /api/drive/tracks/[fileId] — edit metadata.
 * DELETE /api/drive/tracks/[fileId] — remove the file.
 * GET    /api/drive/tracks/[fileId] — one track's metadata.
 */

/** Never cached: per-user data that changes on every write. */
export const dynamic = "force-dynamic";

/** Rejects ids that are not plausible Drive file ids before we call Google. */
const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;

/** Resolve and validate the file id from the route params. */
async function fileIdFrom(params: Promise<{ fileId: string }>): Promise<string> {
  const { fileId } = await params;
  if (!FILE_ID.test(fileId)) {
    throw new DriveHttpError(400, "That isn’t a valid Drive file id.");
  }
  return fileId;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    const fileId = await fileIdFrom(params);
    const auth = await authorize();
    const track = await getTrack(auth.accessToken, fileId, auth.retry);
    if (!track) throw new DriveHttpError(404, "That file is no longer in Drive.");
    return Response.json(
      { track } satisfies { track: DriveTrack },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

interface PatchRequest {
  title?: unknown;
  artist?: unknown;
  duration?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    await assertSameOrigin(request);
    const fileId = await fileIdFrom(params);
    const auth = await authorize();

    const body = (await request.json().catch(() => ({}))) as PatchRequest;
    const duration = body.duration === undefined ? undefined : Number(body.duration);
    if (duration !== undefined && (!Number.isFinite(duration) || duration < 0)) {
      throw new DriveHttpError(400, "Invalid duration.");
    }

    await updateMetadata(
      auth.accessToken,
      fileId,
      {
        title: typeof body.title === "string" ? body.title : undefined,
        artist: typeof body.artist === "string" ? body.artist : undefined,
        duration,
      },
      auth.retry,
    );

    // Return the updated track so the caller can update its row in place
    // without a second round trip.
    const track = await getTrack(auth.accessToken, fileId, auth.retry);
    return Response.json(
      { track } satisfies { track: DriveTrack | null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  try {
    await assertSameOrigin(request);
    const fileId = await fileIdFrom(params);
    const auth = await authorize();
    await deleteTrack(auth.accessToken, fileId, auth.retry);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
