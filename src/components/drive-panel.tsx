"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DRIVE_FOLDER_NAME, filterDriveTracks, toQueueTrack } from "@/lib/drive";
import { paletteFor } from "@/lib/palette";
import type { LocalTrack } from "@/lib/local-track";
import { useDriveLibrary } from "@/hooks/use-drive-library";
import { formatBytes, formatDuration } from "@/lib/format";
import { CloseIcon, PlayIcon, PlusIcon, TrashIcon, WaveIcon } from "./icons";
import { useSwipeToDismiss } from "@/hooks/use-keyboard-shortcuts";

interface Props {
  onClose: () => void;
  /**
   * Hand a track to the player.
   *
   * Takes a `LocalTrack` (already a queue entry) rather than the raw Drive
   * record, so this panel does not decide how Drive tracks map into the queue
   * — `toQueueTrack` already did, and `music-player` needs the same shape.
   */
  onPlay: (t: LocalTrack) => void;
  /** A Drive track was deleted, so drop it from the queue. */
  onRemoved: (fileId: string) => void;
  currentId: string;
  /** Plays the closing animation before the parent unmounts us. */
  closing?: boolean;
}

/**
 * The Google Drive library.
 *
 * Deliberately a sibling of `library-panel.tsx` rather than a tab inside it:
 * the OPFS library keeps working with no server and no network, and Drive is
 * an optional, networked alternative. Keeping them separate means a failure in
 * one can never leave the other in a broken state.
 */
/** The accent gradient for a Drive row, matching its queue tile exactly. */
function gradientFor(fileId: string): string {
  const [from, to] = paletteFor(fileId);
  return `linear-gradient(135deg, ${from}, ${to})`;
}

export default function DrivePanel({
  onClose,
  onPlay,
  onRemoved,
  currentId,
  closing,
}: Props) {
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } =
    useSwipeToDismiss(onClose);
  const drive = useDriveLibrary();
  // Alias the two functions the mount effect uses, so its dependency list is
  // stable rather than the whole hook object (which is recreated every render).
  const reportError = drive.report;
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** Set when a drop or picker contained nothing playable. */
  const [noAudio, setNoAudio] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // The OAuth callback returns here with ?drive=connected|denied|error. Report
  // the outcome once, then scrub the query so a refresh does not repeat it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("drive");
    if (!outcome) return;
    const reason = params.get("reason");
    if (outcome === "error") {
      reportError(reason ?? "Google Drive sign-in didn’t complete.");
    }
    params.delete("drive");
    params.delete("reason");
    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${rest ? `?${rest}` : ""}`,
    );
  }, [reportError]);

  /** Only offer files the browser will actually recognise as audio. */
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const audio = Array.from(files).filter(
        (f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|weba)$/i.test(f.name),
      );
      if (audio.length === 0) {
        setNoAudio(true);
        return;
      }
      setNoAudio(false);
      void drive.upload(audio);
    },
    [drive],
  );

  const visible = filterDriveTracks(drive.tracks, query);
  const connected = drive.status?.connected === true;
  const configured = drive.status?.configured === true;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Google Drive library"
    >
      <div
        className={`anim-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm ${closing ? "closing" : ""}`}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        className={`anim-sheet safe-bottom relative flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl border border-white/10 bg-[#0b0b11] p-5 shadow-2xl sm:max-h-[80vh] sm:rounded-2xl ${closing ? "closing" : ""}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-xs font-medium tracking-[0.25em] text-zinc-400 uppercase">
            <WaveIcon width={14} height={14} className="text-zinc-500" />
            Drive
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-500 transition-colors hover:text-white"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {/* Not configured — explain what the operator has to do. */}
        {!configured ? (
          <div className="px-2 py-8 text-center">
            <p className="text-sm text-zinc-400">Google Drive isn’t set up on this server.</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-600">
              An operator has to add <code className="text-zinc-500">GOOGLE_CLIENT_ID</code>,{" "}
              <code className="text-zinc-500">GOOGLE_CLIENT_SECRET</code>,{" "}
              <code className="text-zinc-500">GOOGLE_REDIRECT_URI</code> and{" "}
              <code className="text-zinc-500">AETHER_SESSION_SECRET</code> to the
              environment. Everything else keeps working without them.
            </p>
          </div>
        ) : !connected ? (
          <div className="px-2 py-8 text-center">
            <p className="text-sm text-zinc-400">Save your library in Google Drive</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-zinc-600">
              AETHER keeps its music in a single{" "}
              <span className="text-zinc-500">{DRIVE_FOLDER_NAME}</span> folder in your
              Drive — your own account, your own files. AETHER can only see files it
              created.
            </p>
            <button
              type="button"
              onClick={() => void drive.connect()}
              className="mt-4 rounded-full border border-white/15 px-4 py-1.5 text-xs text-zinc-200 transition-colors hover:border-white/40 hover:text-white"
            >
              Connect Google Drive
            </button>
          </div>
        ) : (
          <>
            {/* connected header */}
            <div className="mb-3 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-600">
                {drive.status?.account?.email || "Connected"}
                {drive.usage.files > 0
                  ? ` · ${drive.usage.files} track${drive.usage.files === 1 ? "" : "s"} · ${formatBytes(drive.usage.bytes)}`
                  : null}
              </span>
              <button
                type="button"
                onClick={() => void drive.refresh()}
                aria-label="Refresh from Drive"
                disabled={drive.uploading}
                className="rounded-md px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:text-zinc-300 disabled:opacity-50"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void drive.disconnect()}
                className="rounded-md px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
              >
                Disconnect
              </button>
            </div>

            {/* upload — the write path */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
              }}
              className={`mb-3 rounded-xl border border-dashed p-3 transition-colors ${
                dragging ? "border-white/30 bg-white/[0.06]" : "border-white/10"
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={drive.uploading}
                  className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/40 hover:text-white disabled:opacity-50"
                >
                  <PlusIcon width={13} height={13} />
                  {drive.uploading
                    ? `Uploading ${drive.uploadProgress?.done ?? 0}/${drive.uploadProgress?.total ?? 0}`
                    : "Upload to Drive"}
                </button>
                <span className="text-[11px] text-zinc-600">or drop them here</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {noAudio && (
              <p role="alert" className="mb-2 text-xs text-amber-400/90">
                Those files don’t look like audio.
              </p>
            )}

            {drive.error && (
              <div role="alert" className="mb-2 flex items-start gap-2">
                <p className="flex-1 text-xs text-amber-400/90">{drive.error}</p>
                <button
                  type="button"
                  onClick={drive.clearError}
                  aria-label="Dismiss error"
                  className="text-zinc-600 transition-colors hover:text-zinc-300"
                >
                  <CloseIcon width={12} height={12} />
                </button>
              </div>
            )}

            {drive.loading ? (
              <ul className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-white/5" />
                    <span className="flex-1 space-y-1.5">
                      <span className="block h-3 w-2/5 animate-pulse rounded bg-white/5" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : visible.length === 0 ? (
              <div className="px-2 py-10 text-center">
                <p className="text-sm text-zinc-400">
                  {query.trim() ? "Nothing matches." : "No tracks in Drive yet."}
                </p>
                <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-600">
                  {query.trim()
                    ? "Try a different search."
                    : `Upload something above and it lands in ${DRIVE_FOLDER_NAME}, where you can see it in Drive itself.`}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Drive"
                    aria-label="Search Drive"
                    className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:outline-none"
                  />
                  <span className="shrink-0 text-[11px] text-zinc-600">
                    {visible.length}/{drive.tracks.length}
                  </span>
                </div>
                <ul
                  data-no-swipe
                  className="-mr-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 overscroll-contain"
                >
                  {visible.map((t) => {
                    const queueId = `drive:${t.fileId}`;
                    return (
                      <li key={t.fileId}>
                        <div className="group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-white/5 hover:bg-white/[0.03]">
                          <span
                            className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5"
                            style={{
                              background: t.thumbnail
                                ? undefined
                                : gradientFor(t.fileId),
                            }}
                          >
                            {t.thumbnail && (
                              // eslint-disable-next-line @next/next/no-img-element -- Drive-hosted artwork, unoptimized
                              <img src={t.thumbnail} alt="" width={40} height={40} loading="lazy" className="h-full w-full object-cover" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm ${queueId === currentId ? "text-white" : "text-zinc-200"}`}>
                              {t.title}
                            </span>
                            <span className="block truncate text-xs text-zinc-600">
                              {t.artist}
                            </span>
                          </span>
                          <span className="text-xs tabular-nums text-zinc-700">
                            {t.duration > 0 ? formatDuration(t.duration) : "—"}
                          </span>
                          {/* Deletion is permanent on Drive, so it takes two taps. */}
                          {confirmDelete === t.fileId ? (
                            <span className="flex items-center gap-1">
                              <button
                                type="button"
                                autoFocus
                                onClick={() => {
                                  setConfirmDelete(null);
                                  onRemoved(t.fileId);
                                  void drive.remove(t);
                                }}
                                className="rounded-full bg-red-500/90 px-2 py-1 text-[11px] text-white"
                              >
                                Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(null)}
                                className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-zinc-400"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Delete ${t.title} from Drive`}
                              onClick={() => setConfirmDelete(t.fileId)}
                              className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:text-red-400"
                            >
                              <TrashIcon width={15} height={15} />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Play ${t.title}`}
                            onClick={() => onPlay(toQueueTrack(t))}
                            className="rounded-full border border-white/15 p-2 text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
                          >
                            <PlayIcon width={14} height={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <p className="mt-3 text-center text-[10px] text-zinc-700">
              Stored in {DRIVE_FOLDER_NAME} in your Drive · streams through this server, so
              nothing is cached.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
