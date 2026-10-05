"use client";

import type { LocalTrack } from "./local-track";
import { hashString, paletteFor } from "./palette";

/**
 * Offline library — audio files stored in the browser's OPFS
 * (persistent, quota-backed) with an IndexedDB metadata index.
 * Playback goes through blob: URLs, which are same-origin, so the
 * analyser (visualizer) works on library tracks unconditionally.
 */

const DB_NAME = "aether-library";
const STORE = "tracks";
const DB_VERSION = 2;

/** Metadata row persisted in IndexedDB (file bytes live in OPFS). */
export interface LibraryRecord {
  sourceId: string;
  title: string;
  artist: string;
  artwork: string;
  /** legacy fields from saved online tracks — kept so old rows stay readable */
  license: string;
  pageUrl: string;
  palette: [string, string, string];
  savedAt: number;
  bytes: number;
  /** real duration in seconds, learned after first playback */
  duration?: number;
}

/** Library track shaped for the player queue (LocalTrack-compatible). */
export type LibraryTrack = LocalTrack;

/** Every blob: URL this module has minted this session, per track id. */
const urlCache = new Map<string, string>();

/** Revoke all blob URLs (call on unmount so sessions don't leak them). */
export function revokeLibraryUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

/** Drop the cached URL for one track (after removal from the library). */
function revokeUrl(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}


let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * One connection, cached for the session. Opening/closing per operation
 * churns connections and is needlessly slow during bulk imports.
 * Resets itself on failure so a transient error can't wedge the library.
 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "sourceId" });
      }
      // Rows are stored whole, so newer optional fields (duration, mimeType)
      // need no migration — only the version bump matters.
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab requested a version change — release our handle
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("IndexedDB unavailable"));
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error("IndexedDB upgrade blocked by another open tab"));
    };
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let req: IDBRequest<T>;
    try {
      const tx = db.transaction(STORE, mode);
      req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    } catch (err) {
      // e.g. connection closed underneath us — drop the cache and retry once
      dbPromise = null;
      reject(err instanceof Error ? err : new Error("IndexedDB error"));
    }
  });
}

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("library", { create: true });
}

/* ——— capability detection ———
 * OPFS + IndexedDB are both unavailable in private-mode Safari and some
 * embedded webviews. Callers must degrade to an empty library rather than
 * throwing, or the panel spins on a skeleton forever. */

let capability: boolean | null = null;

/** True when offline storage is usable in this browser context. */
export function isLibrarySupported(): boolean {
  if (capability !== null) return capability;
  capability =
    typeof indexedDB !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function";
  return capability;
}

const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

/** Sanitized OPFS basename for a sourceId (no extension). */
const idToStem = (sourceId: string) => sourceId.replace(/[^a-z0-9_-]+/gi, "_");

/** OPFS filenames keep their real extension so the browser sniffs the MIME type. */
const idToFile = (sourceId: string, ext = "mp3") => `${idToStem(sourceId)}.${ext}`;

/** Known extension per sourceId (not stored in the row; rebuilt by repairLibrary). */
const extBySourceId = new Map<string, string>();

/** Mint (or reuse) a blob: URL for a stored file. One URL per file per session. */
async function urlFor(sourceId: string, ext: string): Promise<string> {
  const cached = urlCache.get(sourceId);
  if (cached) return cached;
  const dir = await getDir();
  const fh = await dir.getFileHandle(idToFile(sourceId, ext));
  const file = await fh.getFile();
  const url = URL.createObjectURL(file);
  urlCache.set(sourceId, url);
  return url;
}

const rowToTrack = (r: LibraryRecord, url: string): LibraryTrack => ({
  id: `library:${r.sourceId}`,
  kind: "local",
  title: r.title || "Untitled",
  artist: r.artist || "Unknown artist",
  album: "AETHER Library",
  duration: r.duration ?? 0,
  artwork: r.artwork ?? "",
  url,
  palette: r.palette ?? paletteFor(r.sourceId),
});

/** Mint (or reuse) a blob: URL for a stored file. One URL per file per session. */

/** All saved tracks, as player-queue-ready objects. Never throws. */
export async function listLibrary(): Promise<LibraryTrack[]> {
  if (!isLibrarySupported()) return [];
  try {
    const rows = await withStore<LibraryRecord[]>("readonly", (s) => s.getAll());
    const out: LibraryTrack[] = [];
    for (const r of rows) {
      try {
        const url = await urlFor(r.sourceId, extBySourceId.get(r.sourceId) ?? "mp3");
        out.push(rowToTrack(r, url));
      } catch {
        // metadata row with no file (interrupted import) — skip it so the
        // queue never advertises a track that cannot be played
      }
    }
    return out;
  } catch {
    // storage blocked/unavailable — degrade to an empty library
    return [];
  }
}

/** Write one local audio file into OPFS + IndexedDB. Returns the queue track. */
export async function importFile(
  file: File,
  meta: { title?: string; artist?: string } = {},
): Promise<LibraryTrack> {
  if (!isLibrarySupported()) {
    throw new Error("Offline storage is not available in this browser.");
  }
  const ext = extOf(file.name) || "mp3";
  // name+size+mtime makes re-importing the same file idempotent
  const sourceId = `local:${hashString(
    `${file.name}:${file.size}:${file.lastModified}`,
  ).toString(36)}`;

  const dir = await getDir();
  const fh = await dir.getFileHandle(idToFile(sourceId, ext), { create: true });
  const writable = await fh.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }
  extBySourceId.set(sourceId, ext);

  const palette = paletteFor(sourceId);
  const record: LibraryRecord = {
    sourceId,
    title: meta.title?.trim() || file.name.replace(/\.[^.]+$/, "") || "Untitled",
    artist: meta.artist?.trim() || "Unknown artist",
    artwork: "",
    license: "",
    pageUrl: "",
    palette,
    savedAt: Date.now(),
    bytes: file.size,
  };
  await withStore("readwrite", (s) => s.put(record));

  revokeUrl(sourceId); // the old File handle is stale now
  const url = await urlFor(sourceId, ext);
  return rowToTrack(record, url);
}

/**
 * importFile() that never throws — returns null on failure so callers can
 * import many files in a loop without try/catch at each step.
 */
export async function importFileSafe(file: File): Promise<LibraryTrack | null> {
  try {
    return await importFile(file);
  } catch {
    return null;
  }
}

/** Persist the real duration learned during playback, so the queue stops
 *  showing 0:00 for every library track forever. */
export async function saveDuration(sourceId: string, duration: number): Promise<void> {
  if (!isLibrarySupported() || !Number.isFinite(duration) || duration <= 0) return;
  try {
    const rows = await withStore<LibraryRecord[]>("readonly", (s) => s.getAll());
    const row = rows.find((r) => r.sourceId === sourceId);
    if (!row || row.duration === duration) return;
    await withStore("readwrite", (s) => s.put({ ...row, duration } satisfies LibraryRecord));
  } catch {
    /* duration persistence is best-effort — never break playback for it */
  }
}

/** Remove a track (file + metadata). */
export async function removeFromLibrary(sourceId: string): Promise<void> {
  const ext = extBySourceId.get(sourceId) ?? "mp3";
  revokeUrl(sourceId);
  extBySourceId.delete(sourceId);
  if (!isLibrarySupported()) return;
  try {
    const dir = await getDir();
    await dir.removeEntry(idToFile(sourceId, ext));
  } catch {
    /* file already gone */
  }
  await withStore("readwrite", (s) => s.delete(sourceId));
}

/**
 * Delete OPFS files with no matching metadata row (interrupted import).
 * Those orphans silently consume quota forever.
 */
export async function repairLibrary(): Promise<number> {
  if (!isLibrarySupported()) return 0;
  const rows = await withStore<LibraryRecord[]>("readonly", (s) => s.getAll());
  const known = new Set(rows.map((r) => idToStem(r.sourceId)));
  const dir = await getDir();
  let removed = 0;

  // `entries()` is async-iterable at runtime but missing from some TS lib
  // versions, so guard for it rather than casting the whole handle away.
  const iterable = dir as unknown as {
    entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    keys?: () => AsyncIterableIterator<string>;
  };
  const names: string[] = [];
  if (typeof iterable.entries === "function") {
    for await (const [name, handle] of iterable.entries()) {
      if (handle.kind === "file") names.push(name);
    }
  } else if (typeof iterable.keys === "function") {
    for await (const name of iterable.keys()) names.push(name);
  } else {
    return 0;
  }

  for (const name of names) {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    if (known.has(stem)) continue;
    try {
      await dir.removeEntry(name);
      removed++;
    } catch {
      /* entry vanished mid-iteration, or was a directory after all */
    }
  }
  return removed;
}

/** Quota usage for the "x of y used" readout. */
export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est) return null;
    return { used: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}
