import { paletteFor } from "./palette";
import type { LocalTrack } from "./local-track";

/**
 * Google Drive as a second home for the library.
 *
 * Drive files become ordinary `LocalTrack`s in the queue (`kind: "local"`,
 * id `drive:<fileId>`), so the audio engine, the queue, the mixer gating and
 * the error-recovery logic all work on them unchanged. The bytes come back
 * through a same-origin route (`/api/drive/audio/<id>`) that forwards Range
 * requests, which is what makes seeking -- and the Web Audio analyser --
 * behave exactly as they do for OPFS files.
 *
 * Everything in this module is pure and environment-agnostic, so it can be unit
 * tested in plain Node. Networking and cookies live in `server/drive.ts` and
 * the route handlers under `app/api/drive/`.
 */

/** Prefix that marks a queue entry as a Drive-hosted track. */
export const DRIVE_ID_PREFIX = "drive:";

/** The Drive folder that AETHER keeps its music in. */
export const DRIVE_FOLDER_NAME = "AETHER Music";

/**
 * The narrowest Drive scope that can still save and serve music.
 *
 * `drive.file` grants access ONLY to files this app creates or that the user
 * opens with it -- not the rest of the user's Drive. Anything broader (plain
 * `drive`) would let a compromised deploy read every document the user owns.
 */
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"] as const;

/** The scope string sent to Google, in one place. */
export const DRIVE_SCOPE_STRING = DRIVE_SCOPES.join(" ");

/** A track as stored in Drive, as returned by our own API routes. */
export interface DriveTrack {
  /** Drive's opaque file id. */
  fileId: string;
  title: string;
  artist: string;
  album: string;
  /** seconds; 0 until the browser plays it once and reports the real value */
  duration: number;
  /** file size in bytes, from Drive's metadata */
  bytes: number;
  mimeType: string;
  createdAt: string;
  modifiedAt: string;
  /** thumbnail URL from Drive, when one exists (rare for audio) */
  thumbnail?: string;
}

/** Connection state, so the UI can explain *why* Drive is unavailable. */
export interface DriveStatus {
  /** Credentials are present in the environment -- the feature can be used. */
  configured: boolean;
  /** A user has completed the OAuth flow in this browser. */
  connected: boolean;
  /** The connected account, when connected. */
  account?: { email: string; name?: string };
  /** Bytes used by AETHER's folder, when connected. */
  usage?: { bytes: number; files: number };
}

/** Why a Drive call failed, in terms the UI can show verbatim. */
export const DRIVE_ERRORS = {
  notConfigured: "Google Drive isn't configured on this server.",
  notConnected: "Connect Google Drive first.",
  unauthorized: "Google Drive needs reconnecting -- your session expired.",
  notFound: "That file is no longer in Drive.",
  forbidden: "That request was blocked for security reasons.",
  network: "Google Drive didn't respond. Try again.",
  unknown: "Something went wrong talking to Google Drive.",
} as const;

export type DriveErrorCode = keyof typeof DRIVE_ERRORS;

/** The id of a Drive track as it appears in the player queue. */
export function trackId(fileId: string): string {
  return `${DRIVE_ID_PREFIX}${fileId}`;
}

/** The Drive file id for a queue entry, or null if it isn't a Drive track. */
export function fileIdOf(id: string): string | null {
  return id.startsWith(DRIVE_ID_PREFIX) ? id.slice(DRIVE_ID_PREFIX.length) : null;
}

/** True when a queue id refers to a Drive-hosted track. */
export function isDriveTrack(id: string): boolean {
  return id.startsWith(DRIVE_ID_PREFIX);
}

/**
 * Same-origin audio URL for a Drive file.
 *
 * The route forwards Range requests and re-authorises on every request, so the
 * browser treats it as an ordinary media resource it can seek within.
 */
export function audioUrl(fileId: string): string {
  return `/api/drive/audio/${encodeURIComponent(fileId)}`;
}

/**
 * Turn a Drive track into a queue entry.
 *
 * `kind: "local"` is what routes it through the HTMLAudioElement path in the
 * engine; the id prefix is what tells the rest of the app (removal, duration
 * persistence, the Drive panel) where it actually lives.
 */
export function toQueueTrack(t: DriveTrack): LocalTrack {
  return {
    id: trackId(t.fileId),
    kind: "local",
    title: t.title || "Untitled",
    artist: t.artist || "Unknown artist",
    album: t.album || DRIVE_FOLDER_NAME,
    duration: t.duration > 0 ? t.duration : 0,
    artwork: t.thumbnail ?? "",
    url: audioUrl(t.fileId),
    palette: paletteFor(t.fileId),
  };
}

/* -- metadata --
 * Drive has no title/artist/duration fields for arbitrary files, so AETHER
 * stores them in the file's `description` as a short human-readable string.
 * That keeps the library self-describing: files stay meaningful in any other
 * Drive client, and a rename in Drive can never desync a metadata index. */

/** Serialise a track's editable metadata into a Drive file description. */
export function encodeDescription(meta: {
  title?: string;
  artist?: string;
  duration?: number;
}): string {
  const parts: string[] = [];
  const title = meta.title?.trim();
  const artist = meta.artist?.trim();
  if (title) parts.push(title);
  if (artist) parts.push(`-- ${artist}`);
  if (meta.duration && meta.duration > 0) {
    parts.push(`(${Math.round(meta.duration)}s)`);
  }
  return parts.join(" ");
}

/**
 * Parse a description written by {@link encodeDescription}.
 *
 * Tolerant by design: a hand-edited, truncated or empty description must never
 * throw, because a bad string here would otherwise take down the whole listing.
 */
export function decodeDescription(description: string | undefined | null): {
  title?: string;
  artist?: string;
  duration?: number;
} {
  if (!description) return {};
  const out: { title?: string; artist?: string; duration?: number } = {};
  let rest = description.trim();

  const dur = /\((\d+)s\)\s*$/.exec(rest);
  if (dur) {
    const seconds = Number(dur[1]);
    if (Number.isFinite(seconds) && seconds > 0) out.duration = seconds;
    rest = rest.slice(0, dur.index).trim();
  }

  // An em dash separator, so a hyphenated title ("Jay-Z") is never mistaken
  // for an artist delimiter. Anchored at a boundary so a description that is
  // *only* a separator parses to nothing rather than becoming the title "--".
  const dash = /(?:^|\s)--(?:\s|$)/.exec(rest);
  if (dash) {
    const artist = rest.slice(dash.index + dash[0].length).trim();
    if (artist) out.artist = artist;
    rest = rest.slice(0, dash.index).trim();
  }
  if (rest) out.title = rest;
  return out;
}

/* -- filenames --
 * Drive has no concept of "artist", so on upload we infer the usual
 * "Artist - Title" convention from the filename. It is the single biggest
 * quality-of-life win available without building a metadata editor. */

/** Strip the extension from a filename, leaving dots inside the name alone. */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The human-readable stem of a filename.
 *
 * Unlike {@link stripExtension} this also rejects a bare dotfile: ".mp3" has
 * no stem at all (the dot is not introducing an extension), so it yields the
 * "Untitled" fallback rather than the nonsense title "mp3".
 */
function titleStem(name: string): string {
  const trimmed = name.trim();
  // A leading dot with exactly one dot means the whole name is an extension.
  const isBareExtension = trimmed.startsWith(".") && trimmed.indexOf(".", 1) === -1;
  const stem = isBareExtension ? "" : stripExtension(trimmed).replace(/^\.+/, "").trim();
  return stem || "Untitled";
}

/** Guess artist/title from a filename, e.g. "Boards of Canada - Roygbiv.mp3". */
export function parseFilename(name: string): { title: string; artist?: string } {
  const stem = titleStem(name);
  // Only the FIRST " - " separates; later ones belong to the title.
  const sep = stem.indexOf(" - ");
  if (sep <= 0) return { title: stem };
  const artist = stem.slice(0, sep).trim();
  const title = stem.slice(sep + 3).trim();
  if (!artist || !title) return { title: stem };
  return { title, artist };
}

/** Audio extensions we accept, mapped to the MIME type we serve them as. */
const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
  weba: "audio/webm",
};

/** The MIME type for a filename's extension, if it looks like audio. */
export function mimeTypeFor(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return AUDIO_TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** True when the filename has a known audio extension. */
export function isAudioName(name: string): boolean {
  return mimeTypeFor(name) !== null;
}

/** Replace characters Drive treats specially, and cap the length at 255. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#%{}]/g, "-") // reserved on Drive, Windows and Dropbox
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, ""); // leading dots hide the file in Drive's own UI
  const base = cleaned || "Untitled";
  return base.length > 255 ? base.slice(0, 255) : base;
}

/* -- Drive API plumbing -- */

/** The Drive REST base for metadata requests. */
export const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** The Drive REST base for uploads (different path, same API). */
export const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/** Google's OAuth 2.0 endpoints. */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Drive's own mime type for a folder. */
export const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Escape a value for use inside a Drive `q=` search expression.
 *
 * Drive's query language uses backslash escapes, so naively interpolating a
 * user's filename would let a crafted name change the meaning of the query.
 */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** The `q` expression listing every non-trashed child of our folder. */
export function folderChildrenQuery(folderId: string): string {
  return `'${escapeDriveQuery(folderId)}' in parents and trashed = false`;
}

/** The `q` expression that finds an existing folder by name in My Drive. */
export function folderByNameQuery(name: string): string {
  return (
    `mimeType = '${FOLDER_MIME}' and ` +
    `name = '${escapeDriveQuery(name)}' and ` +
    `trashed = false and 'root' in parents`
  );
}

/** Sort newest-first, so a fresh upload lands at the top of the list. */
export const DRIVE_ORDER_BY = "modifiedTime desc";

/** Fields requested when listing -- exactly what the UI renders, nothing more. */
export const DRIVE_FILE_FIELDS =
  "nextPageToken,files(id,name,mimeType,size,description,createdTime,modifiedTime,thumbnailLink)";

/**
 * Normalise a raw Drive file resource into a {@link DriveTrack}.
 *
 * Drive types every field as "string or missing", so this is the one place that
 * coerces them. Unparseable numbers become 0 rather than NaN, which would
 * otherwise render as the literal text "NaN" in the queue.
 */
export function toDriveTrack(raw: {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  description?: string;
  createdTime?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
}): DriveTrack {
  const id = raw.id ?? "";
  const name = sanitizeFilename(raw.name ?? "Untitled");
  const meta = decodeDescription(raw.description);
  const bytes = Number(raw.size);
  const duration = meta.duration ?? 0;
  // Both the title and the artist come from the same parse, so a file named
  // "Artist - Title" can never end up with the artist split off but the title
  // left as the whole stem.
  const fromName = parseFilename(name);
  return {
    fileId: id,
    // A description title wins; otherwise fall back to the filename.
    title: meta.title || fromName.title,
    artist: meta.artist || fromName.artist || "Unknown artist",
    album: DRIVE_FOLDER_NAME,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
    mimeType: raw.mimeType || mimeTypeFor(name) || "audio/mpeg",
    createdAt: raw.createdTime ?? "",
    modifiedAt: raw.modifiedTime ?? "",
    thumbnail: raw.thumbnailLink || undefined,
  };
}

/* -- errors --
 * Every Drive failure collapses to one of a handful of codes. The UI shows the
 * matching sentence, so it never has to interpret a raw Google error body. */

/** Coerce anything thrown by `fetch` or Drive into a stable, showable code. */
export function driveErrorCode(err: unknown): DriveErrorCode {
  if (typeof err === "object" && err !== null) {
    const status = Number((err as { status?: unknown }).status);
    // 403 is a deliberate rejection (CSRF), not a dead grant: it must not be
    // reported as "unauthorized", which would prompt a pointless reconnect.
    if (status === 403) return "forbidden";
    if (status === 401) return "unauthorized";
    if (status === 404) return "notFound";
    if (status === 429 || status >= 500) return "network";

    const code = String((err as { code?: unknown }).code ?? "");
    if (["ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"].includes(code)) {
      return "network";
    }
  }
  return "unknown";
}

/** The human-readable message for an error code. */
export function driveErrorMessage(code: DriveErrorCode): string {
  return DRIVE_ERRORS[code];
}

/**
 * An error carrying the HTTP status to reply with, and an optional explicit
 * {@link DriveErrorCode}.
 *
 * The explicit code exists because several distinct failures share a status:
 * 501 means both "not configured" and "no session secret", and 401 means both
 * "not connected" and "the grant was revoked". The UI needs to tell those apart
 * (reconnect vs. tell the operator), so the code is carried explicitly and
 * {@link driveErrorCode} is only the fallback.
 */
export class DriveHttpError extends Error {
  readonly status: number;
  readonly code?: DriveErrorCode;

  constructor(status: number, message: string, code?: DriveErrorCode) {
    super(message);
    this.name = "DriveHttpError";
    this.status = status;
    this.code = code;
  }
}

/* -- list helpers -- */

/**
 * Merge freshly fetched Drive tracks into a list, de-duplicating by file id.
 *
 * A manual refresh can race an optimistic local insert, and re-inserting the
 * same track would duplicate its row and confuse the queue's index bookkeeping.
 * Incoming metadata wins, and the server's newest-first order is preserved.
 */
export function mergeDriveTracks(
  existing: DriveTrack[],
  incoming: DriveTrack[],
): DriveTrack[] {
  if (incoming.length === 0) return existing;

  const seen = new Set<string>();
  const merged: DriveTrack[] = [];
  for (const t of incoming) {
    if (t.fileId && !seen.has(t.fileId)) {
      seen.add(t.fileId);
      merged.push(t);
    }
  }
  for (const t of existing) {
    if (!seen.has(t.fileId)) {
      seen.add(t.fileId);
      merged.push(t);
    }
  }
  return merged;
}

/** Sum the bytes and count the files in a Drive library listing. */
export function totalUsage(tracks: DriveTrack[]): { bytes: number; files: number } {
  return {
    bytes: tracks.reduce((sum, t) => sum + (t.bytes > 0 ? t.bytes : 0), 0),
    files: tracks.length,
  };
}

/** Case-insensitive search across title, artist and album. */
export function filterDriveTracks(
  tracks: DriveTrack[],
  query: string,
): DriveTrack[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q),
  );
}
