# AETHER

**A generative music engine that lives in a web page.**

There are no audio files in this repository. The nine built-in tracks are composed note by
note and synthesized live in the browser with the Web Audio API — oscillators, noise
buffers, a convolution reverb, and a seeded pseudo-random number generator. No streaming
service, no `<audio src>` pointing at a file on disk, just mathematics.

You can also bring your own music. It is kept offline in the browser's storage by default,
or optionally saved in a Google Drive folder in your own account — see
[Google Drive](#google-drive). Neither is required to play the generative catalogue.

Nine tracks ship with the engine, each defined by nothing more than a title, a tempo, a
root note, a mode, and an integer seed.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Press <kbd>Space</kbd> to start —
the browser requires a user gesture before it will let an `AudioContext` produce sound.

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the dev server (`next dev`) |
| `npm run build` | Production build (`next build`) |
| `npm run start` | Serve the production build (`next start`) |
| `npm run lint` | ESLint via `eslint-config-next` |
| `npm run verify` | Typecheck + lint + tests, the same gate CI runs |

Optionally, to save your own music in Google Drive, copy `.env.example` to `.env.local`
and fill in the OAuth values — see [Google Drive](#google-drive). The app works fully
without them.

## How it works

### Composition is a pure function of the seed

`src/lib/tracks.ts` holds the catalogue. A track is a handful of parameters — `bpm`,
`duration`, `seed`, `root`, and a `scale` drawn from `SCALES` (major, minor, dorian,
phrygian, lydian, mixolydian):

```ts
export interface Track {
  kind: "synth";
  id: string;
  title: string;
  album: string;
  bpm: number;
  duration: number;
  seed: number;
  root: number;          // semitone offset from C
  scale: number[];       // semitone steps of the mode within one octave
  palette: [string, string, string];
  blurb: string;
}
```

`compose(track)` walks the timeline bar by bar and returns a flat, time-sorted array of
`ScoreEvent`s (`{ t, d, f, i, v }` — time, duration, frequency, instrument, velocity). All
randomness comes from `mulberry32(track.seed)`, a small deterministic PRNG. It picks a
chord progression, then decides per bar whether to play four-voice pads, a bass line, an
arpeggiated pluck pattern, and drums, gated by an energy curve that fades in over the
first two bars, drops to a sparse break at the midpoint, and thins out for the last three.

**The same seed always produces the same score.** Nothing consults `Date.now()` or
`Math.random()` during composition. This is the property that makes the player behave like
a record player rather than a generator: seeking to 2:14 doesn't roll new dice, it moves
the playhead into a performance that already exists.

Because `compose()` is pure but non-trivial, `composeCached()` memoizes it in a 16-entry
`Map` keyed by the composition-relevant parameters, so re-selecting a track is free.

### Playback is a look-ahead scheduler

`src/lib/engine.ts` wraps the score in an `AudioEngine`. It does not fire a note when one
"arrives" — that would depend on `setInterval` being punctual, and it isn't. Instead it
schedules every voice on the audio clock ahead of time:

```ts
private tick() {
  const lookahead = this.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
  while (this.idx < this.events.length && this.events[this.idx].t < pos + lookahead) {
    const ev = this.events[this.idx++];
    const when = Math.max(now + 0.02, this.startedAt + (ev.t - this.offset));
    this.playEvent(ev, when);
  }
}
```

A 60 ms interval walks a cursor through the sorted event list and hands each event to the
Web Audio scheduler with an absolute start time, 350 ms ahead of the playhead. Timers being
late is then harmless: the audio is already committed to the hardware.

Two details worth knowing:

- **Hidden tabs.** Browsers throttle `setInterval` to roughly 1 Hz in background tabs,
  which would starve a 350 ms window. `engine.ts` listens for `visibilitychange` and
  widens the look-ahead to 2.5 s while the document is hidden, then tightens it again.
- **Seeking.** `seek(t)` fades out live voices, sets the offset, and binary-searches the
  sorted event list (`lowerBound`) for the first event at or after `t`. Resuming from a
  seek is the same code path as starting cold from zero.

### Signal path

```
oscillators / noise  ->  stem gain (pad pluck bass kick snare hat)
                     ->  bus  ->  master gain  ->  analyser  ->  destination
                          \->  wet  ->  convolution reverb  ->  master
```

Each instrument has its own `GainNode` (`setStemGain()`), so the six voices are
independently levelable. The reverb impulse response is generated at runtime — `makeIR()`
fills a stereo buffer with decaying noise — so there is no IR file to ship. Percussion
reuses a single shared noise buffer; the kick is a sine sweeping 150 Hz down to 43 Hz, the
snare is bandpassed noise plus a tonal body, the hats are highpassed noise.

## The offline library

The generative engine covers the queue by default, but you can drop your own files in
alongside it. `src/lib/library.ts` splits storage in two:

| Layer | Holds | API |
| --- | --- | --- |
| **OPFS** (`navigator.storage.getDirectory()`) | The audio bytes, under `library/` | `FileSystemWritableFileStream` |
| **IndexedDB** (`aether-library`, store `tracks`) | Metadata rows: title, artist, palette, byte size, `savedAt`, duration | `LibraryRecord` |

Splitting them this way keeps large blobs out of the structured store and lets the engine
list the library by reading metadata alone, without opening a single file.

Supporting behaviour in the module:

- `isLibrarySupported()` gates everything. Callers degrade to an empty library rather than
  throwing, so the panel never spins on a skeleton forever.
- `importFile(file, meta)` derives an idempotent `sourceId` from name, size, and mtime, so
  re-importing the same file is a no-op rather than a duplicate.
- Playback goes through `blob:` URLs minted per file per session and cached in a `Map`.
  `revokeLibraryUrls()` releases them all on unmount so sessions don't leak.
- `saveDuration()` persists the real duration learned from `loadedmetadata` — until the
  browser has read the file, every imported track would otherwise read as `0:00` forever.
- `repairLibrary()` sweeps OPFS files with no metadata row, which is what an interrupted
  import leaves behind; orphans silently consume quota forever.
- `storageUsage()` backs the quota readout via `navigator.storage.estimate()`.

A `blob:` URL is same-origin, so the element routes through `MediaElementAudioSourceNode`
into the same master → analyser chain as the synth. The visualizer therefore works on
imported files unconditionally, with no CORS caveat.

**Once imported, tracks play with no network.** They never touch a server again.

The panel (`library-panel.tsx`) exposes an **Add audio files** button plus drag-and-drop,
a search box, real durations once known, the quota readout, and a **Repair storage** action
that runs the orphan sweep on demand.

### Browser support for the library

The library depends on two storage APIs that don't have identical support matrices:

| Capability | Notes |
| --- | --- |
| IndexedDB | Universal in modern browsers; blocked or ephemeral in some private modes |
| OPFS (`navigator.storage.getDirectory`) | Chromium and Safari; absent in some embedded webviews |
| Private-mode Safari | `library.ts` documents both as unavailable here — the library degrades to empty |

The generative engine itself has no such dependency. `AudioContext` is broadly supported
(the engine falls back to `webkitAudioContext` for older Safari) and, since the seed is the
only input, playback is identical on every machine that can run the Web Audio API.

## Google Drive

The OPFS library above lives in one browser on one machine. Drive is the second option:
your music sits in an `AETHER Music` folder in your own Google account, so it follows you
between devices and survives clearing site data.

It is **entirely optional**. With no Drive configuration the app behaves exactly as before —
the generative engine, the local library, and the PWA are untouched.

### Setup

Copy `.env.example` to `.env.local` and fill in four values:

```bash
cp .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client id from the Google Cloud console |
| `GOOGLE_CLIENT_SECRET` | Its client secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/api/drive/callback` locally; the https equivalent once deployed |
| `AETHER_SESSION_SECRET` | 32+ random characters, encrypts the session cookie (`openssl rand -base64 32`) |
| `GOOGLE_DRIVE_FOLDER` | Optional; renames the folder inside Drive |

In the Google Cloud console: enable the **Google Drive API**, create an **OAuth client ID**
of type *Web application*, and register the redirect URI exactly as written above (the
path and port must match `GOOGLE_REDIRECT_URI`, or Google rejects the handshake).

### Design

```
browser ──▶ /api/drive/* ──▶ Google Drive API
   │            │
   │            └── OAuth 2.0 auth-code flow; refresh token sealed into an
   │                AES-256-GCM encrypted, httpOnly cookie
   │
   ├── upload: browser PUTs the bytes ──────────────────────▶ resumable session on Google
   └── playback: <audio src="/api/drive/audio/<id>"> ──▶ same-origin, Range-aware proxy
```

Four decisions shape the whole feature:

**Tokens never reach the browser.** The OAuth dance, the refresh token, and every Drive API
call happen server-side. The browser only ever calls same-origin routes that authenticate
with the encrypted cookie. `src/lib/server/*` is marked `server-only`, so importing it from
a component is a *build* error rather than a silent credential leak.

**The scope is the narrowest one that works.** `drive.file` grants access only to files this
app creates. AETHER can never read the rest of your Drive — not by accident, not if the
deploy is compromised. The broader `drive` scope would hand over every document you own.

**Uploads bypass this server.** `POST /api/drive/tracks` mints a Google *resumable* session
and returns its URL; the browser then PUTs the bytes straight to Google. A large album never
enters this process's memory, no request body limit applies, and a dropped connection
retries without re-sending everything.

**Playback is proxied, and that proxy is the point.** `/api/drive/audio/[fileId]` forwards
the client's `Range` header to Drive and passes the `206`/`Content-Range` straight through.
That is what makes seeking work, and staying same-origin is what keeps the analyser fed —
the same two properties `blob:` URLs give the OPFS library. For the same reason a Drive
track is just a `LocalTrack` with id `drive:<fileId>`: the engine, queue, mixer gating, and
error recovery need no changes at all.

### Where the metadata lives

Drive has no title/artist/duration fields for arbitrary files, so AETHER writes them to the
file's **description**:

```
Roygbiv — Boards of Canada (143s)
```

This keeps the library self-describing: a file dragged into any other Drive client still
shows its name and artist, and a rename in Drive can't desync a metadata index. Duration is
the exception — Drive has no such concept at all, so it's absent until the browser plays the
file once and writes back what it measured.

### Routes

| Route | Purpose |
| --- | --- |
| `GET /api/drive/status` | Is Drive configured? Is this browser connected? Never throws |
| `GET /api/drive/auth` | Mints a CSRF `state` nonce, returns Google's consent URL |
| `GET /api/drive/callback` | Exchanges the code, seals the session, redirects back |
| `POST /api/drive/disconnect` | Revokes the grant at Google and clears the cookie |
| `GET /api/drive/tracks` | The library listing, paginated |
| `POST /api/drive/tracks` | Begins a resumable upload, returns the session URL |
| `PATCH /api/drive/tracks/[id]` | Edit title/artist, or persist a learned duration |
| `DELETE /api/drive/tracks/[id]` | Delete the file from Drive |
| `GET /api/drive/audio/[id]` | Range-aware media stream — this is what plays |
| `HEAD /api/drive/audio/[id]` | Metadata probe; fetches size without the body |

### Failure behaviour

Every route funnels errors through one helper, so the panel sees a consistent
`{ error, code }` and never has to parse Google's error body. Codes are carried explicitly
rather than inferred from the HTTP status, because unrelated failures share statuses —
a `403` is a blocked cross-site request, not an expired grant, and reporting it as
"unauthorized" would send the user to reconnect for no reason.

Mutating routes additionally reject cross-site requests by comparing `Origin` to `Host`
(`SameSite=Lax` alone doesn't cover them), and the OAuth handshake uses a 256-bit `state`
nonce verified on the way back.

A revoked or unreadable session is cleared automatically, so the panel offers **Reconnect**
instead of retrying forever. Deleting from the queue never deletes from Drive — only the
panel's explicit, two-step delete does.


## Keyboard shortcuts

Bound in `src/hooks/use-keyboard-shortcuts.ts` and listed in the in-app panel toggled with
<kbd>?</kbd>. Bindings are ignored while focus is in a text field or slider.

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek 5 seconds |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Volume |
| <kbd>N</kbd> / <kbd>P</kbd> | Next / previous track |
| <kbd>M</kbd> | Mute |
| <kbd>S</kbd> | Shuffle |
| <kbd>R</kbd> | Repeat mode (off → all → one) |
| <kbd>L</kbd> | Like current track |
| <kbd>I</kbd> | Immersive mode |
| <kbd>Esc</kbd> | Exit immersive / close panels |
| <kbd>?</kbd> | Toggle the shortcut panel |

## Player features

- **Queue** mixing generative and library tracks in one list (`queue-list.tsx`).
- **Queue editing** — drag the handle to reorder (pointer-based, so it works on
  touch) and remove entries with the × on each row. Removing a library track also
  deletes it from the library.
- **Mixer** — six independently levelable instrument stems (pads, plucks, bass,
  kick, snare, hats), each with a mute toggle, backed by `engine.setStemGain()`.
  Levels persist. Generated tracks only; an imported file is already mixed.
- **Score view** — the generated score drawn as instrument lanes under the track
  (`score-view.tsx`), showing exactly which events produced the sound. Tapping it
  seeks. This is the machinery the project is built on, made visible.
- **Remix** — `remixTrack()` re-seeds the current track, keeping its title and
  palette but producing new music. Bound to <kbd>E</kbd>.
- **Shareable links** — because composition is deterministic, a track id plus its
  variation reproduces a piece exactly, so the URL alone is enough:
  `?t=tidal-memory#v3` plays the same audio on any machine. **Share** copies it,
  or opens the native share sheet where available.
- **Transport** with scrubbable seek bar, shuffle, three repeat modes, and likes
  (`transport.tsx`). Previous restarts the track if you're past 3 s in, otherwise it steps
  back — the standard behaviour. Switching tracks never interrupts playback: the engine hook
  records whether it was playing and auto-resumes the incoming track.
- **Shuffle** walks a stable Fisher–Yates permutation and remembers the last few tracks
  played, so it can't ping-pong A → B → A. Shuffle and repeat mode persist across reloads.
- **Visualizer** — a canvas radial spectrum with a rotating, bass-reactive ring
  (`visualizer.tsx`). It reads the engine's `AnalyserNode` directly, honours
  `prefers-reduced-motion`, and stops drawing while the tab is hidden.
- **Media Session API** integration, so lock-screen and headset controls report the current
  title and album.
- **Resilient local playback** — if an imported file won't load, the player skips it and
  stops after three consecutive failures with a visible notice rather than looping forever.
- **Persisted settings** — volume, mute, likes, shuffle, repeat mode, mixer levels, and last
  index in `localStorage`.

## Offline / PWA

AETHER is installable and works with no network. Generated tracks are pure
computation and imported tracks live in OPFS, so once the shell is cached the
whole player is offline-capable.

- `public/manifest.webmanifest` — installability metadata, icons, and shortcuts.
- `public/sw.js` — **network-first** for HTML so an online user always gets the
  current build (a cache-first HTML handler would pin users to a dead deploy),
  **cache-first** only for content-hashed `/_next/static/` assets, and no
  interception of RSC payloads, range requests, or `blob:` URLs. Two cache
  generations are retained so a tab open across a deploy doesn't 404 into a white
  screen.
- Registration is production-only (`src/components/pwa-register.tsx`) so the worker
  never fights HMR in development.

Bump `CACHE_VERSION` in `sw.js` when the shell changes materially.

## Mobile

The layout is built mobile-first and adapts at the `sm` (640px) and `lg` (1024px)
breakpoints. Phone-specific behaviour:

- **Safe areas** — `viewport-fit=cover` plus `--safe-*` CSS variables keep the fixed
  transport, drawers and header clear of the notch and the iOS home indicator.
- **Now-playing strip** — below `sm` the transport shows the current track and a like
  button, since the desktop side column is hidden at that width.
- **Touch targets** — `.tap-target` enlarges hit areas to at least 44px on coarse
  pointers without changing the visual size on desktop.
- **Swipe to dismiss** — both bottom sheets (queue and library) can be dragged down to
  close; drags starting inside a scrollable list still scroll normally.
- **Scroll locking** — the page behind an open drawer or modal is locked, with
  scrollbar-width compensation so nothing shifts.
- **Landscape** — short viewports get compact padding via a `max-height` media query.

## Motion

All transitions are defined in one place in `src/app/globals.css` so timing and
easing stay consistent. Shared tokens: `--dur-fast` (120ms), `--dur-base` (200ms),
`--dur-sheet` (260ms), plus `--ease-out` / `--ease-in-out`.

- **Overlays animate both ways.** Every modal and bottom sheet fades and scales
  or slides in *and out*. Conditional rendering unmounts instantly and can never
  play an exit, so `usePresence` keeps the element mounted through the closing
  animation. Sheets slide up from the bottom edge on mobile and scale in from
  `sm` up, where they're centered rather than bottom-anchored.
- **Swipe-to-dismiss composes with the CSS animation.** While a drag is in
  flight the keyframe animation is suppressed so the drag offset is the only
  thing driving `translateY`; on release the animation is restored and the closing
  keyframe takes over. Dragging less than the threshold snaps back.
- **Press feedback** — `.press` scales controls down slightly on `:active`, with a
  stronger, faster response on coarse pointers where there is no hover state.
- **Staggered lists** — `.anim-list` fades its children in sequence.
- **Reduced motion** — every animation above is disabled under
  `prefers-reduced-motion`, including the visualizer's canvas loop.

### Performance

Every animation is compositor-only (`opacity` / `transform`), so the browser runs
them without layout or paint work per frame. This matters here because the page
already runs two `requestAnimationFrame` canvas loops (the visualizer and the score
view).

Two things were deliberately removed rather than added:

- The track-change animation used to animate `filter: blur()`, which re-rasterises
  text every frame. It now uses only opacity and transform.
- No `will-change` on the sheets. These animations are one-shot and browsers
  already promote the element while the animation runs; leaving the hint on would
  pin a GPU layer for the sheet's whole lifetime.

`src/__tests__/motion.test.ts` enforces these invariants so they can't silently
regress. It is mutation-checked: adding a paint-triggering property to any
`@keyframes` block fails the suite.

### Why no animation library

The React Compiler is enabled (`reactCompiler: true`), and animation libraries are
prone to conflicting with its rules. More importantly, a library would drive most
transitions through `requestAnimationFrame` and inline style writes, which is
strictly more main-thread work per frame than compositor-driven CSS — on a page
already animating two canvases. Every animation needed here is opacity or
transform, which CSS does better and for free. The one genuinely hard problem,
exit animations, is handled by a 30-line `usePresence` hook.

## Project layout

```
src/
  app/
    layout.tsx            metadata, Geist fonts
    page.tsx              renders <MusicPlayer />
    api/drive/            OAuth, listing, upload, and media-stream routes
  components/
    music-player.tsx      player shell: composes the hooks and renders the layout
    transport.tsx         seek bar + playback controls
    queue-list.tsx        the queue
    visualizer.tsx        canvas radial spectrum
    library-panel.tsx     offline library browser (import, search, repair)
    drive-panel.tsx       Google Drive library (connect, upload, browse, delete)
    mixer-panel.tsx      per-instrument stem mixer
    score-view.tsx       canvas timeline of the generated score
    pwa-register.tsx     production-only service worker registration
    icons.tsx             inline SVG icon set
  hooks/
    use-player-queue.ts   queue, index, shuffle order, repeat, reordering, errors
    use-audio-engine.ts   AudioEngine lifecycle + transport state + stem mixer
    use-persistent-state.ts  localStorage-backed state with validation
    use-keyboard-shortcuts.ts  key bindings, dialog dismissal, swipe, scroll lock
    use-shareable-track.ts ?t= URL parsing and native sharing
    use-drive-library.ts  Drive connection state, uploads, listing
  lib/
    tracks.ts             TRACKS, SCALES, mulberry32, compose(), composeCached()
    engine.ts             AudioEngine — scheduler, synth voices, stems, reverb, analyser
    library.ts            OPFS + IndexedDB offline library
    local-track.ts        LocalTrack / PlayerTrack union and the isLocal() guard
    drive.ts              Drive types, metadata/filename parsing, query escaping
    drive-client.ts       browser-side client for the /api/drive routes
    format.ts             formatBytes / formatDuration / formatLength
    palette.ts            the deterministic accent palettes
    server/
      drive.ts            OAuth + Drive REST client (server-only)
      drive-session.ts    AES-256-GCM sealed session cookie (server-only)
      drive-api.ts        shared route plumbing: authorize, error mapping
  __tests__/              vitest unit tests for the pure logic
```

Player logic lives in `src/hooks/`, one concern per hook. `music-player.tsx` is the shell
that wires them together and renders the UI.

## Development

TypeScript in `strict` mode, with the React Compiler enabled (`reactCompiler: true` in
`next.config.ts`).

```bash
npm run dev              # dev server
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test             # vitest run
npm run verify           # typecheck + lint + test — run this before pushing
```

Unit tests cover the deterministic composition logic (`compose()`, `mulberry32`,
`composeCached()`), track identity (`remixTrack()`, `variationOf()`), and `formatTime()`.
Those modules are deliberately free of rendering and browser side effects, so they run in
plain Node with no DOM shim. CI runs `npm run verify` on every push and pull request.

When touching the player, keep the two invariants intact: switching tracks must not stop
playback, and `engine.destroy()` must run on unmount so the `AudioContext` is released.
