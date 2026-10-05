"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  mergeDriveTracks,
  totalUsage,
  type DriveStatus,
  type DriveTrack,
} from "@/lib/drive";
import {
  deleteTrack,
  disconnect,
  editTrack,
  getStatus,
  listTracks,
  saveDuration,
  startConnect,
  uploadTrack,
  DriveClientError,
} from "@/lib/drive-client";

/**
 * Drive connection state and library operations.
 *
 * Owns everything the Drive panel needs so the component stays presentational:
 * the connection status, the track list, uploads in flight, and the error
 * message to display. Extracted here so the panel is render-only and this logic
 * is reviewable on its own.
 */

/** What the hook exposes. */
export interface DriveLibrary {
  status: DriveStatus | null;
  tracks: DriveTrack[];
  /** Total bytes and file count for the folder. */
  usage: { bytes: number; files: number };
  /** True during the initial status/listing load. */
  loading: boolean;
  /** True while any upload is running. */
  uploading: boolean;
  /** How many files the current upload batch contains. */
  uploadProgress: { done: number; total: number } | null;
  /** User-facing error, or null. */
  error: string | null;
  /** Send the browser to Google's consent screen. */
  connect: () => Promise<void>;
  /** Forget this connection. */
  disconnect: () => Promise<void>;
  /** Re-fetch the folder listing. */
  refresh: () => Promise<void>;
  /** Upload one or more local audio files. */
  upload: (files: File[]) => Promise<void>;
  /** Delete a track from Drive (permanent). */
  remove: (track: DriveTrack) => Promise<void>;
  /** Rename/re-attribute a track. */
  edit: (fileId: string, patch: { title?: string; artist?: string }) => Promise<void>;
  /** Persist a duration learned during playback. */
  persistDuration: (fileId: string, duration: number) => void;
  /** Dismiss the current error. */
  clearError: () => void;
  /** Show a message that originated outside this hook (e.g. the OAuth redirect). */
  report: (message: string) => void;
}

export function useDriveLibrary(): DriveLibrary {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [tracks, setTracks] = useState<DriveTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Guards against setting state after unmount during a slow request. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Turn any thrown value into the message to show. */
  const messageFor = useCallback((err: unknown): string => {
    if (err instanceof DriveClientError) return err.message;
    if (err instanceof Error && err.message) return err.message;
    return "Something went wrong talking to Google Drive.";
  }, []);

  /** Load the listing for a connected session. */
  const refresh = useCallback(async () => {
    try {
      const found = await listTracks();
      if (!alive.current) return;
      setTracks((prev) => mergeDriveTracks(prev, found));
    } catch (err) {
      if (!alive.current) return;
      // An expired session is not a listing bug; re-read the status so the
      // panel switches to the "reconnect" state instead of looping errors.
      if (err instanceof DriveClientError && err.code === "unauthorized") {
        setStatus((prev) => (prev ? { ...prev, connected: false } : prev));
        setError(err.message);
        return;
      }
      setError(messageFor(err));
    }
  }, [messageFor]);

  // Initial load: status first, then the listing only if connected.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getStatus();
        if (cancelled || !alive.current) return;
        setStatus(s);
        if (s.connected) {
          try {
            const found = await listTracks();
            if (!cancelled && alive.current) setTracks(found);
          } catch (err) {
            if (!cancelled && alive.current) setError(messageFor(err));
          }
        }
      } finally {
        if (!cancelled && alive.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageFor]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const url = await startConnect();
      // A full navigation: Google redirects back to /api/drive/callback, which
      // bounces home with ?drive=connected and the panel picks it up on mount.
      window.location.assign(url);
    } catch (err) {
      setError(messageFor(err));
    }
  }, [messageFor]);

  const disconnectDrive = useCallback(async () => {
    setError(null);
    try {
      await disconnect();
      // Drop the whole status object rather than patching one field: whether
      // Drive is configured at all is a server fact that does not change when
      // a user disconnects, and re-reading it is not worth another request.
      setStatus({ configured: true, connected: false });
      setTracks([]);
    } catch (err) {
      setError(messageFor(err));
    }
  }, [messageFor]);

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setUploading(true);
      setUploadProgress({ done: 0, total: files.length });

      const added: DriveTrack[] = [];
      // Sequential on purpose: parallel resumable uploads would each need their
      // own session and this keeps progress honest and Drive-friendly.
      for (const [index, file] of files.entries()) {
        try {
          const track = await uploadTrack(file);
          added.push(track);
        } catch (err) {
          if (alive.current) setError(`${file.name}: ${messageFor(err)}`);
        }
        if (alive.current) {
          setUploadProgress({ done: index + 1, total: files.length });
        }
      }

      if (alive.current) {
        setTracks((prev) => mergeDriveTracks(prev, added));
        setUploading(false);
        setUploadProgress(null);
        // Re-read the folder so Drive's own size fields are authoritative.
        void refresh();
      }
    },
    [messageFor, refresh],
  );

  const remove = useCallback(
    async (track: DriveTrack) => {
      setError(null);
      // Drop the row immediately; the request is the slow part and Drive
      // deletes are reliable, so a failed call is surfaced without restoring.
      setTracks((prev) => prev.filter((t) => t.fileId !== track.fileId));
      try {
        await deleteTrack(track.fileId);
      } catch (err) {
        if (alive.current) {
          setTracks((prev) => mergeDriveTracks(prev, [track]));
          setError(messageFor(err));
        }
      }
    },
    [messageFor],
  );

  const edit = useCallback(
    async (fileId: string, patch: { title?: string; artist?: string }) => {
      setError(null);
      try {
        await editTrack(fileId, patch);
        await refresh();
      } catch (err) {
        setError(messageFor(err));
      }
    },
    [messageFor, refresh],
  );

  const persistDuration = useCallback((fileId: string, duration: number) => {
    // Optimistic: the queue already knows the duration, and the panel's row
    // should show it immediately rather than after a refetch.
    setTracks((prev) =>
      prev.map((t) => (t.fileId === fileId ? { ...t, duration } : t)),
    );
    void saveDuration(fileId, duration);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Show a message from outside the hook.
   *
   * The OAuth callback is a full-page redirect, so the failure reason arrives
   * in the URL rather than in a rejected promise — this is how the panel
   * surfaces it once the app remounts.
   */
  const report = useCallback((message: string) => setError(message), []);

  return {
    status,
    tracks,
    usage: totalUsage(tracks),
    loading,
    uploading,
    uploadProgress,
    error,
    connect,
    disconnect: disconnectDrive,
    refresh,
    upload,
    remove,
    edit,
    persistDuration,
    clearError,
    report,
  };
}
