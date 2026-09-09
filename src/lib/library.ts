"use client";

/**
 * Offline library — downloaded tracks are stored as files in the browser's
 * OPFS (persistent, quota-backed) with an IndexedDB metadata index.
 * Playback goes through blob: URLs, which are same-origin → the analyser
 * (visualizer) works on library tracks unconditionally.
 */

const DB_NAME = "aether-library";
const STORE = "tracks";
const DB_VERSION = 1;

/** Metadata row persisted in IndexedDB (file bytes live in OPFS). */
export interface LibraryRecord {
  /** `${sourceProvider}:${nativeId}` of the track it was downloaded from */
  sourceId: string;
  title: string;
  artist: string;
  artwork: string;
  license: string;
  pageUrl: string;
  palette: [string, string, string];
  savedAt: number;
  bytes: number;
}

/** Library track shaped for the player queue (StreamTrack-compatible). */
export interface LibraryTrack {
  id: string;
  kind: "stream";
  provider: "library";
  title: string;
  artist: string;
  album: string;
  duration: number;
  artwork: string;
  streamUrl: string;
  license: string;
  pageUrl: string;
  corsSafe: true;
  palette: [string, string, string];
}

export interface DownloadProgress {
  received: number;
  /** 0 = unknown size */
  total: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "sourceId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
    tx.oncomplete = () => db.close();
  });
}

const idToFile = (sourceId: string) =>
  `${sourceId.replace(/[^a-z0-9_-]+/gi, "_")}.mp3`;

async function getDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("library", { create: true });
}

/** All saved tracks, as player-queue-ready objects. */
export async function listLibrary(): Promise<LibraryTrack[]> {
  const rows = await withStore<LibraryRecord[]>("readonly", (s) => s.getAll());
  const dir = await getDir();
  const out: LibraryTrack[] = [];
  for (const r of rows) {
    try {
      const fh = await dir.getFileHandle(idToFile(r.sourceId));
      const file = await fh.getFile();
      // blob URLs die on reload — mint fresh ones per session
      out.push({
        id: `library:${r.sourceId}`,
        kind: "stream",
        provider: "library",
        title: r.title,
        artist: r.artist,
        album: "AETHER Library",
        duration: 0,
        artwork: r.artwork,
        streamUrl: URL.createObjectURL(file),
        license: r.license,
        pageUrl: r.pageUrl,
        corsSafe: true,
        palette: r.palette,
      });
    } catch {
      // metadata without a file (interrupted download) — skip
    }
  }
  return out;
}

export function isSaved(sourceId: string): Promise<boolean> {
  return withStore<IDBValidKey | undefined>("readonly", (s) =>
    s.getKey(sourceId),
  ).then((k) => k !== undefined);
}

/**
 * Download a track's audio into the OPFS library. `onProgress` reports
 * received/total bytes (total 0 when the server sends no length).
 */
export async function saveToLibrary(
  sourceId: string,
  meta: Omit<LibraryRecord, "sourceId" | "savedAt" | "bytes">,
  audioUrl: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  const res = await fetch(audioUrl);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({ received, total });
  }

  const blob = new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
  const dir = await getDir();
  const fh = await dir.getFileHandle(idToFile(sourceId), { create: true });
  const writable = await fh.createWritable();
  await writable.write(blob);
  await writable.close();

  const record: LibraryRecord = {
    ...meta,
    sourceId,
    savedAt: Date.now(),
    bytes: blob.size,
  };
  await withStore("readwrite", (s) => s.put(record));
}

/** Remove a track (file + metadata). */
export async function removeFromLibrary(sourceId: string): Promise<void> {
  try {
    const dir = await getDir();
    await dir.removeEntry(idToFile(sourceId));
  } catch {
    /* file already gone */
  }
  await withStore("readwrite", (s) => s.delete(sourceId));
}
