import type { MusicProvider, StreamTrack } from "./types";
import { pickPalette } from "./types";

/**
 * Internet Archive — millions of freely-licensed recordings (live sets,
 * netlabels, Musopen classical…). No API key. CORS headers are inconsistent
 * across items, so each result is probed: items that answer with
 * access-control-allow-origin can feed the analyser; the rest fall back to
 * plain playback (idle visualizer).
 */

const PALETTES: [string, string, string][] = [
  ["#78716c", "#a8a29e", "#e7e5e4"],
  ["#b45309", "#d97706", "#fde68a"],
  ["#475569", "#64748b", "#cbd5e1"],
  ["#7c2d12", "#ea580c", "#fed7aa"],
];

interface IaDoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  downloads?: number;
  year?: string;
}

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : (v ?? "");

/**
 * The Archive's "audio" index is mostly NOT music: poetry readings,
 * audiobooks, old-time radio dramas, lectures, nature sounds… Anything
 * matching this pattern is dropped regardless of popularity.
 */
const JUNK_TITLE_RE =
  /(poetry|poems?\b|episode|episodes|old ?time ?radio|radio (drama|program|show)|audio ?book|librivox|chapter \d|lecture|sermon|\binterview|short works|multilingual|sound ?effects|nature sounds?|white noise|meditation|asmr|language (lesson|course)|news)/i;

const isMusic = (d: IaDoc) =>
  d.identifier &&
  !JUNK_TITLE_RE.test(first(d.title)) &&
  (d.downloads ?? 0) >= 5000; // un-heard uploads are junk or broken derivatives

const corsCache = new Map<string, boolean>();

/** Cheap probe of one derivative file's CORS headers. */
async function hasCors(identifier: string, file: string): Promise<boolean> {
  const key = `${identifier}/${file}`;
  const hit = corsCache.get(key);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    const res = await fetch(
      `https://archive.org/download/${identifier}/${encodeURIComponent(file)}`,
      { method: "HEAD" },
    );
    ok =
      res.ok &&
      (res.headers.get("access-control-allow-origin") ?? "").length > 0;
  } catch {
    ok = false;
  }
  corsCache.set(key, ok);
  return ok;
}

function mapTrack(d: IaDoc, corsSafe: boolean): StreamTrack {
  const file = `${d.identifier}_vbr.mp3`;
  return {
    id: `archive:${d.identifier}`,
    kind: "stream",
    provider: "archive",
    title: first(d.title) || d.identifier,
    artist: first(d.creator) || "Internet Archive",
    album: d.year ? `Internet Archive · ${d.year}` : "Internet Archive",
    duration: 0, // unknown until the audio element reports it
    artwork: `https://archive.org/services/img/${d.identifier}`,
    streamUrl: `https://archive.org/download/${d.identifier}/${encodeURIComponent(file)}`,
    license: "Public domain / open license — see item page",
    pageUrl: `https://archive.org/details/${d.identifier}`,
    corsSafe,
    palette: pickPalette(PALETTES, d.identifier),
  };
}

async function query(params: string, opts?: { simple?: boolean }): Promise<StreamTrack[]> {
  // Exclude the known spoken-word / non-music collections outright. The
  // Archive's search backend is flaky and sometimes rejects the negation
  // syntax — fall back to the plain query and let the code-level junk
  // filter handle pollution.
  const exclusions = opts?.simple
    ? ""
    : "-collection:(audio_poetry OR oldtimeradio OR librivoxaudio OR audio_booksother OR audio_news OR audio_tech) -subject:(spokenword) ";
  const q = encodeURIComponent(
    `AND mediatype:(audio) AND format:(MP3) ${exclusions}${params}`,
  );
  const url =
    `https://archive.org/advancedsearch.php?q=${q}` +
    `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=year&fl%5B%5D=downloads` +
    `&rows=20&output=json&sort%5B%5D=downloads+desc`;

  const res = await fetch(url);
  if (!res.ok && !opts?.simple) {
    // one retry without negations before giving up
    await new Promise((r) => setTimeout(r, 400));
    return query(params, { simple: true });
  }
  if (!res.ok) throw new Error(`archive ${res.status}`);
  const j = (await res.json()) as {
    response?: { docs?: IaDoc[] };
  };
  const docs = (j.response?.docs ?? []).filter(isMusic);
  // Probe CORS for at most a few items to keep discovery snappy.
  const withCors = await Promise.all(
    docs.slice(0, 12).map(async (d) => ({
      doc: d,
      cors: await hasCors(d.identifier, `${d.identifier}_vbr.mp3`),
    })),
  );
  return withCors
    .filter(({ doc }) => doc.identifier)
    .map(({ doc, cors }) => mapTrack(doc, cors));
}

export const archiveProvider: MusicProvider = {
  id: "archive",
  available: true,
  search: (q) => query(`AND (${q})`),
  trending: () =>
    query(
      'AND collection:(audio_music) AND subject:("ambient music" OR "electronic")',
    ),
};
