"use client";

import { useEffect, useRef, useState } from "react";
import {
  PROVIDER_LABEL,
  PROVIDER_FILTERS,
  filterByProvider,
  searchAll,
  trendingAll,
  type ProviderId,
  type StreamTrack,
} from "@/lib/providers";
import { CloseIcon, PlayIcon, PlusIcon, SearchIcon } from "./icons";
import { formatTime } from "./queue-list";

interface Props {
  onClose: () => void;
  onPlay: (t: StreamTrack) => void;
  onAdd: (t: StreamTrack) => void;
  queuedIds: ReadonlySet<string>;
}

type Filter = ProviderId | "all";

export default function Discover({ onClose, onPlay, onAdd, queuedIds }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StreamTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // initial load: trending / curated picks
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load for the modal
    setLoading(true);
    trendingAll()
      .then((t) => {
        if (!alive) return;
        setResults(t);
        setError(t.length === 0 ? "No providers reachable right now." : null);
      })
      .catch(() => alive && setError("Could not reach any provider."))
      .finally(() => alive && setLoading(false));
    inputRef.current?.focus();
    return () => {
      alive = false;
    };
  }, []);

  // debounced search as the user types
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      searchAll(q)
        .then((t) => {
          if (!alive) return;
          setResults(t);
          setError(t.length === 0 ? `Nothing found for “${q}”.` : null);
        })
        .catch(() => alive && setError("Search failed — try again."))
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const availableFilters = PROVIDER_FILTERS.filter(
    (f) => f === "all" || results.some((t) => t.provider === f),
  );
  const shown = filterByProvider(results, filter);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl border border-white/10 bg-[#0b0b11] p-5 shadow-2xl sm:max-h-[80vh] sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xs font-medium tracking-[0.25em] text-zinc-400 uppercase">Discover</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-500 hover:text-white"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className="relative mb-3">
          <SearchIcon width={15} height={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-zinc-600" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search free music across providers…"
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pr-3 pl-9 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
          />
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {availableFilters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                filter === f
                  ? "border-white/30 bg-white/10 text-white"
                  : "border-white/10 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {f === "all" ? "All" : PROVIDER_LABEL[f]}
            </button>
          ))}
        </div>

        <ul className="-mr-1 min-h-[120px] flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {loading && <li className="px-1 py-6 text-center text-sm text-zinc-600">Searching…</li>}
          {!loading && error && <li className="px-1 py-6 text-center text-sm text-zinc-600">{error}</li>}
          {!loading &&
            shown.map((t) => (
              <li key={t.id}>
                <div className="group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-colors hover:border-white/5 hover:bg-white/[0.03]">
                  <span
                    className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5"
                    style={{
                      background: t.artwork
                        ? undefined
                        : `linear-gradient(135deg, ${t.palette[0]}, ${t.palette[1]})`,
                    }}
                  >
                    {t.artwork && (
                      // eslint-disable-next-line @next/next/no-img-element -- remote provider artwork, unoptimized
                      <img
                        src={t.artwork}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">{t.title}</span>
                    <span className="block truncate text-xs text-zinc-600">
                      {t.artist} · {PROVIDER_LABEL[t.provider]}
                      {t.duration > 0 ? ` · ${formatTime(t.duration)}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Queue ${t.title}`}
                    onClick={() => onAdd(t)}
                    disabled={queuedIds.has(t.id)}
                    className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-zinc-500"
                  >
                    <PlusIcon width={16} height={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Play ${t.title}`}
                    onClick={() => onPlay(t)}
                    className="rounded-full border border-white/15 p-2 text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
                  >
                    <PlayIcon width={14} height={14} />
                  </button>
                </div>
              </li>
            ))}
        </ul>

        <p className="mt-3 text-center text-[10px] text-zinc-700">
          Free &amp; open catalogs — Audius · Jamendo · Internet Archive · FMA
        </p>
      </div>
    </div>
  );
}
