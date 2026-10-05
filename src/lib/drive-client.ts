"use client";

import {
  DriveHttpError,
  DRIVE_ERRORS,
  driveErrorCode,
  driveErrorMessage,
  parseFilename,
  type DriveStatus,
  type DriveTrack,
} from "@/lib/drive";

/**
 * Browser-side client for the Drive API routes.
 *
 * The browser never sees an OAuth token — it only ever calls same-origin
 * endpoints that authenticate with the server's encrypted cookie. Uploads are
 * delegated straight to Google, so a 100 MB file never passes through Next.
 */

/** A failed Drive call, carrying the message the UI should show. */
export class DriveClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DriveClientError";
    this.code = code;
  }
}

/** Parse a failed response into a {@link DriveClientError}. */
async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
  } | null;
  const code = body?.code ?? driveErrorCode({ status: res.status });
  throw new DriveClientError(
    code,
    body?.error || driveErrorMessage(code as keyof typeof DRIVE_ERRORS) || `Drive request failed (${res.status}).`,
  );
}

/** GET JSON, or throw a DriveClientError. */
async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new DriveClientError("network", DRIVE_ERRORS.network);
  }
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

/** POST JSON, or throw a DriveClientError. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new DriveClientError("network", DRIVE_ERRORS.network);
  }
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

/** PATCH JSON, or throw a DriveClientError. */
async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  }).catch(() => {
    throw new DriveClientError("network", DRIVE_ERRORS.network);
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}

/** DELETE, or throw a DriveClientError. */
async function del(url: string): Promise<void> {
  const res = await fetch(url, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
  }).catch(() => {
    throw new DriveClientError("network", DRIVE_ERRORS.network);
  });
  if (!res.ok) return fail(res);
}

/** Read the current connection state. Never throws. */
export async function getStatus(): Promise<DriveStatus> {
  try {
    return await getJson<DriveStatus>("/api/drive/status");
  } catch {
    // An unreachable status endpoint means Drive cannot be used; report that
    // rather than leaving the panel spinning forever.
    return { configured: false, connected: false };
  }
}

/** Begin the OAuth flow. Returns the Google URL to navigate to. */
export async function startConnect(): Promise<string> {
  const { url } = await getJson<{ url: string }>("/api/drive/auth");
  return url;
}

/** Forget this browser's Drive connection (and revoke it at Google). */
export async function disconnect(): Promise<void> {
  await postJson<{ ok: boolean }>("/api/drive/disconnect", {});
}

/** Every track in the Drive folder, newest first. */
export async function listTracks(): Promise<DriveTrack[]> {
  const { tracks } = await getJson<{ tracks: DriveTrack[] }>("/api/drive/tracks");
  return tracks;
}

/**
 * Upload one file to Drive.
 *
 * Two steps: ask our server for a resumable session, then PUT the bytes to
 * Google directly. The title/artist are inferred from an "Artist - Title"
 * filename, which is what makes a Drive upload show sensible metadata without
 * any extra UI.
 */
export async function uploadTrack(file: File): Promise<DriveTrack> {
  const guessed = parseFilename(file.name);
  const { uploadUrl, fileId } = await postJson<{ uploadUrl: string; fileId: string }>(
    "/api/drive/tracks",
    {
      name: file.name,
      bytes: file.size,
      mimeType: file.type,
      title: guessed.title,
      artist: guessed.artist ?? "",
    },
  );

  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new DriveClientError("network", DRIVE_ERRORS.network);
  }
  if (!res.ok) {
    // Google reports per-chunk resumable progress as 308, which means "keep
    // going"; only a hard failure is an error here.
    throw new DriveClientError("network", `Upload failed for ${file.name}.`);
  }

  // The session response carries the created file; fall back to a refetch if
  // the session was closed before we could read it.
  const created = (await res.json().catch(() => null)) as Partial<DriveTrack> | null;
  if (created && typeof created.fileId === "string" && created.fileId) {
    return { ...(created as DriveTrack), fileId: created.fileId || fileId };
  }
  const tracks = await listTracks();
  const match = tracks.find((t) => t.fileId === fileId);
  if (match) return match;
  throw new DriveClientError("unknown", `Uploaded ${file.name}, but Drive did not list it.`);
}

/** Persist a duration learned during playback, so the queue stops showing 0:00. */
export async function saveDuration(fileId: string, duration: number): Promise<void> {
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    await patchJson(`/api/drive/tracks/${encodeURIComponent(fileId)}`, { duration });
  } catch {
    /* duration persistence is best-effort; never break playback for it */
  }
}

/** Edit a track's title and/or artist. */
export async function editTrack(
  fileId: string,
  patch: { title?: string; artist?: string },
): Promise<void> {
  await patchJson(`/api/drive/tracks/${encodeURIComponent(fileId)}`, patch);
}

/** Delete a track from Drive. Permanent. */
export async function deleteTrack(fileId: string): Promise<void> {
  await del(`/api/drive/tracks/${encodeURIComponent(fileId)}`);
}

/** A stable id for an in-flight upload, used as a React key and to dedupe. */
export function uploadKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Re-exported so the panel can show a Drive-shaped error message. */
export { DriveHttpError };
