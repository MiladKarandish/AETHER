"use client";

import type { LocalTrack } from "./local-track";

/**
 * Offline library — local audio files stored in the browser's OPFS
 * (persistent, quota-backed) with an IndexedDB metadata index.
 * Playback goes through blob: URLs, which are same-origin → the analyser
 * (visualizer) works on library tracks unconditionally.
 */

const DB_NAME = "aether-library";
const STORE = "tracks";
const DB_VERSION = 1;

/**
 * Metadata row persisted in IndexedDB (file bytes live in OPFS).
 * `license` / `pageUrl` are legacy fields from saved online tracks —
 * kept so existing rows stay readable.
 */
export interface LibraryRecord {
  /** `${originProvider}:${nativeId}` of the track it was saved from */
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

/** Library track shaped for the player queue (LocalTrack-compatible). */
export type LibraryTrack = LocalTrack;

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
        kind: "local",
        title: r.title,
        artist: r.artist,
        album: "AETHER Library",
        duration: 0,
        artwork: r.artwork,
        url: URL.createObjectURL(file),
        palette: r.palette,
      });
    } catch {
      // metadata without a file (interrupted download) — skip
    }
  }
  return out;
}

/**
 * Remove a track (file + metadata).
 */
export async function removeFromLibrary(sourceId: string): Promise<void> {
  try {
    const dir = await getDir();
    await dir.removeEntry(idToFile(sourceId));
  } catch {
    /* file already gone */
  }
  await withStore("readwrite", (s) => s.delete(sourceId));
}
