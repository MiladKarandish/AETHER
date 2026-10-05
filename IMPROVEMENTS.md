# AETHER — Improvements & Feature Suggestions

> Written after a full read of the source (`src/lib/`, `src/components/`, `src/app/`).
> Items are grouped by theme, ordered roughly by impact within each group.
> "Fix" = something in the current code that is buggy or fragile;
> "Improve" = polish on an existing feature; "Feature" = new capability.

---

## 1. Fixes & robustness (found while reading the source)

### 1.1 Fix — Switching tracks stops playback
In `src/components/music-player.tsx`, the load effect (`[engine, index]`) calls
`setPlaying(false)` unconditionally, and `engine.load()`/`loadLocal()` halt the
current sound. So pressing **Next while playing** silences the player until you
press play again. Every music player keeps playing across track switches.
Capture "was playing" before the index change (a `wasPlayingRef` updated in the
rAF loop works) and auto-resume after the new track loads.

### 1.2 Fix — Blob URL leak in the offline library
`listLibrary()` (`src/lib/library.ts`) mints `URL.createObjectURL(file)` for
every track, and it is called on mount **and every time the LibraryPanel
opens** — a fresh URL each time, never revoked. The panel's copy then gets
appended to the queue by `playNow`, so the queue holds URLs too. Over a long
session this accumulates blobs until the tab is closed.
- Keep a `Map<sourceId, string>` URL cache inside `library.ts` so one URL per
  file exists per session.
- Revoke in `removeFromLibrary()`.
- Revoke everything on `pagehide` / when the player unmounts.

### 1.3 Fix — Unhandled rejection when OPFS / IndexedDB is unavailable
`listLibrary()` throws if `navigator.storage.getDirectory` or IndexedDB is
missing (private mode, older Safari), and both call sites
(`music-player.tsx` mount effect, `library-panel.tsx`) use a bare `.then()`
with no `.catch()`. Add feature detection + `.catch(() => [])`, and show an
honest "offline storage unavailable" state in the panel instead of an eternal
skeleton.

### 1.4 Fix — Broken-track skip loop
`onAudioError` in `music-player.tsx` jumps to `pickNextIndex(1)` on any local
file failure. If several library files are broken (or all of them are), this
cycles forever, reloading + erroring on every tick. Count consecutive errors
(`engine.play()` also fires `onAudioError`) and stop the carousel after N
failures — pause and surface a message instead.

### 1.5 Fix — Local-track durations are never persisted
`liveDuration` (`music-player.tsx`) only remembers the duration of the track
that is *currently* loaded. Every other library track shows `0:00` in the
queue forever, on every visit. When `onDurationChanged` fires, write the
duration back to the IndexedDB row (add a `duration` field to
`LibraryRecord`, bump `DB_VERSION`) and have `listLibrary()` populate it.
The queue becomes truthful with zero extra runtime work.

### 1.6 Fix — Orphaned OPFS files
`listLibrary()` skips rows whose file is missing, but the reverse — a file
whose metadata row is missing (interrupted save) — is never cleaned up and
silently eats quota. Add a one-time reconciliation pass on startup (or a
"Repair library" action in the panel): list OPFS entries, delete any whose
`sourceId` has no IndexedDB row.

### 1.7 Fix — Seek into an unloaded local file clamps to 0
`engine.seek()` in `local` mode computes `max = this.duration || el?.duration
|| 0`. If metadata hasn't loaded yet (`duration === 0`), any seek clamps to 0.
Prefer `el.duration` before `this.duration`, or defer the seek until
`loadedmetadata` fires.

### 1.8 Fix — Synth audio gaps when the tab is backgrounded
The scheduler runs on `setInterval` (60 ms) with `LOOKAHEAD = 0.35`
(`src/lib/engine.ts`). Background tabs throttle timers to ≥1 s, so after a few
seconds hidden, every note is scheduled late and audio stutters or drops out.
Options, cheapest first:
- Widen the look-ahead when `document.visibilityState === "hidden"` (e.g. 2 s)
  and restore on visible.
- Or drive the scheduler from a `Worker` timer / `AudioWorklet` clock, which
  is immune to throttling.

### 1.9 Fix — Shuffle is memoryless, and shuffle/repeat aren't persisted
`pickNextIndex` picks uniformly at random, only avoiding the current track —
so "shuffle" can bounce A → B → A forever, and reshuffles on every skip.
Maintain a shuffled order (Fisher–Yates over the queue) plus a short
recently-played set, regenerated when the queue or the toggle changes. Also
persist `shuffle` and `repeat` to `localStorage` like volume/muted/liked
already are — they reset on every reload today.

### 1.10 Fix — `AudioEngine` is never destroyed
`music-player.tsx` creates the engine in `useState` and never calls
`engine.destroy()` on unmount. Harmless today (the player lives for the page
lifetime) but add the cleanup effect — it gives `destroy()` a reason to exist
and protects against future route-level remounts.

---

## 2. Code health

### 2.1 Split `music-player.tsx` (613 lines, every concern in one component)
It currently owns: queue state, engine wiring, persistence, keyboard map,
media session, panels, layout. Natural seams, all mechanical, no behavior
change:
- `usePlayerQueue()` — queue / index / next / prev / shuffle / repeat
- `useAudioEngine(track)` — load / play / pause / position / analyser wiring
- `usePersistentState(key, initial)` — the copy-pasted `localStorage` blocks
- `useKeyboardShortcuts(map)` — the switch statement
- `useMediaSession(...)` — already almost a standalone effect

### 2.2 Memoize `compose()`
`compose(track)` runs on every track selection and re-derives hundreds of
events from the seed. A module-level `Map<id, ScoreEvent[]>` cache makes
re-selecting a track instant and allocation-free. (Determinism by design makes
this perfectly safe — same seed, same output.)

### 2.3 One database connection at a time
`withStore()` opens and closes IndexedDB per operation. Fine at this scale,
but cache the `openDb()` promise (with close-on-error recovery) so repeated
writes during a future import flow don't churn connections.

### 2.4 Rewrite `README.md`
It's still the default create-next-app text. The project deserves a short doc:
what the generative engine is, how determinism/seeking works, the OPFS
library, keyboard shortcuts, and a screenshot of the visualizer.

---

## 3. Audio engine upgrades

### 3.1 Feature — Stem mixer (per-instrument volume)
Today every voice hardcodes `this.bus` at unity (`playPad`, `playBass`,
`playKick`… in `engine.ts`). Create six child gains — `pad`, `pluck`, `bass`,
`kick`, `snare`, `hat` — route each voice into its own stem, stems into
`bus`, and expose `engine.setStemGain(instrument, v)`. The UI payoff is a
small mixer drawer (six vertical sliders in a popover). For a generative
engine, "turn the drums down, pads up" is a killer feature and the plumbing
is ~30 lines.

### 3.2 Feature — Render to file (export your track)
Because the score is fully deterministic, the same `compose()` output can be
rendered offline: build an `OfflineAudioContext`, replay the six
`playX(t, …)` voice functions into it, encode to WAV, download. "Export
Solar Drift as .wav" turns a demo player into a *tool*. The voice code needs
refactoring to accept a `BaseAudioContext` + destination instead of reading
`this.ctx`/`this.bus` — that's the only real work; everything else exists.

### 3.3 Improve — Seed the reverb IR
`makeIR()` uses `Math.random()`, so the reverb tail differs per session. Feed
it `mulberry32(track.seed)` (export it from `tracks.ts`) so each track gets a
stable, characterful room — and vary `seconds`/`decay` per mood while you're
there ("Submerged" gets a long dark tail, "Restless" a short bright one).

### 3.4 Improve — Groove: swing + humanization
The score is perfectly quantized. Add a per-track `swing` value in `Track`
(offset every off-8th by `swing * spb * 0.1`) in `compose()`. Cheap change,
immediately audible "analog" feel.

### 3.5 Improve — Sidechain pump
Insert a pre-master "duck" gain that the kick triggers: at each kick event,
`duck.gain.setTargetAtTime(0.55, t, 0.01)` then release
`setTargetAtTime(1, t + 0.12, 0.25)`. That classic breathing between kick and
pads is the single most recognizable sound in this genre, and it's ~10 lines.

### 3.6 Improve — Stereo width
Voices are mono into the bus. Give `playPad`/`playPluck` per-oscillator
`StereoPannerNode` (the ±7/+6 detuned pad pair is begging for L/R spread).
Subtle, but the difference between "demo" and "record" mixes.

### 3.7 Feature — Crossfade between tracks
The engine already owns the master gain, so crossfade is: on track switch
while playing, fade current voices over ~1.5 s (the existing
`stopAllVoices(fade)` already fades click-free!) while the next track starts
at full gain into a second bus. Two bus gains and a switch — not a second
engine.

---

## 4. Generative flagship features

These lean into what makes AETHER unique — the music is code, so the player
can do things no file-based player can.

### 4.1 Feature — Remix (nudge the seed)
A small dice button next to the track title: `engine.load({ ...track, seed:
track.seed + 1 })`. The composition stays in the same key/mood/palette but
the performance changes — infinite variations of "Solar Drift". One line of
logic, profound feel. Show the seed in the header ("variation №7") and let
users go back/forward through variations with ←/→ buttons.

### 4.2 Feature — Track editor / "compose your own"
`Track` is just data: `bpm`, `root`, `scale`, `seed`, `palette`, `mood`,
`blurb`. A create-panel (modal or `/new` route) with:
- BPM slider (60–130), key picker, scale picker (all 6 modes in `SCALES`
  already), seed field + randomize, palette picker, title/blurb.
- **Live preview** — reload the engine as controls change (with a debounce).
- Save: synthesized tracks can persist to localStorage as user tracks and
  enter the queue with a "yours" badge. Combined with 3.2, users can export
  their own composition.

### 4.3 Feature — Infinite mode
Generative music should never have to end. When enabled, instead of
`finished = true` at the end of the score, `compose()` regenerates the *next
section* (bars `N..2N` with a new random seed offset) and the scheduler
appends events seamlessly — `lowerBound`/`idx` already work on a flat
event list, so this is an append + duration-extension. A "∞ Live" badge in
the UI. The break/energy curve already gives natural ebb and flow.

### 4.4 Feature — Generated cover art
Synth tracks have no artwork, only palettes. Render one deterministically
from the seed: a small canvas (concentric rings / scanlines seeded by
`mulberry32`, colored by `palette`) → `toDataURL` → use for the queue tile,
the immersive view, and MediaSession artwork. One-time per track, cached.

### 4.5 Improve — Mood-reactive mastering
`Track.mood` is display-only today. Map it to engine parameters: reverb
length (3.3), filter cutoff travel on pads, hat brightness, overall
compression. "Nocturnal" should *sound* nocturnal without changing a note.

---

## 5. Library & online sources

`providers.txt` contains Audius and Jamendo credentials, and `LibraryRecord`
still carries legacy `license`/`pageUrl` fields "from saved online tracks" —
so an online-catalog → save-offline flow was clearly planned. The current
library, however, has **no way to add anything to it** (only list/play/remove
exist). That's the biggest missing piece:

### 5.1 Feature — Import local files (complete the write path)
- `<input type="file" multiple accept="audio/*">` + drag-and-drop onto the
  LibraryPanel.
- Write bytes to OPFS, metadata row to IndexedDB (`sourceId` can be a hash
  of name+size+lastModified for idempotency).
- Parse ID3/Vorbis tags client-side (title/artist/album/embedded artwork;
  artwork → data URL into the `artwork` field) so imports don't all show
  "AETHER Library". A small dependency (e.g. `music-metadata-browser`) or a
  minimal ID3v2 parser — the format needed for basic frames is tiny.
- Show progress for multi-file imports; show total size via
  `navigator.storage.estimate()` (users love knowing what's using quota).

### 5.2 Feature — Explore tab (Audius / Jamendo)
A third panel next to Queue/Library: search Jamendo's catalog (CC-licensed,
API key already provisioned) or Audius trending, stream via `<audio>` with
CORS-safe URLs, and a **"Save offline"** button that downloads the file into
OPFS through the exact flow of 5.1. This turns AETHER into a real listening
app, and the offline story ("saved tracks play with zero network") is a
genuine differentiator. Design note: keep streaming online tracks *outside*
the OPFS path until saved, so licensing stays clean; store `license`/
`pageUrl` (the fields are already in the schema) and show attribution.

### 5.3 Improve — Library panel ergonomics
- Search/filter box (trivial now, essential once imports exist).
- Sort: title / artist / recently saved.
- Play-all / shuffle-library buttons.
- Restore `duration` (1.5) so rows show real lengths.

### 5.4 Improve — Likes that do something
`liked` is persisted but purely decorative. Add a "Liked" pseudo-queue
(filter of the current queue) reachable from the header, and/or a
"play liked shuffle" action.

### 5.5 Improve — Play counts & recently played
Record `{id, playedAt}` on `onEnded` (localStorage is fine). Powers
"Recently played" sorting, and later a simple "again" mood-based autoplay.

---

## 6. UX & visual polish

### 6.1 Improve — Sleep timer & fade-out
Generative ambient is made for falling asleep to. A simple menu: 15/30/45/60
min → at T-minus-60s, ramp `master.gain` to 0 (setTargetAtTime), pause, reset
gain. Trivial with the existing `applyGain` plumbing.

### 6.2 Improve — ARIA on the seek bar
`role="slider"` in `transport.tsx` has `aria-valuemin/max/now` but no
`aria-valuetext` ("2:31 of 3:16") and no `aria-orientation`. Also
`onPointerUp` seeks to the last move position but keyboard focus isn't
restored to the handle — small a11y wins.

### 6.3 Feature — Shareable track state
Synth tracks are pure data, so the full player state serializes to a URL:
`?t=solar-drift&v=3&pos=0` (track, variation, position). Pasting the link
resumes the exact moment and variation. Free deep-linking because there are
no files — share "listen to this" links for a player that has no server.

### 6.4 Improve — Immersive mode fullscreen API
`immersive` currently just hides chrome. Also request
`document.documentElement.requestFullscreen()` (with Esc exiting both) and
add a subtle parallax: translate the visualizer slightly with mouse position
for depth.

### 6.5 Improve — Reduced-motion support
The visualizer, shockwave, and equalizer animations ignore
`prefers-reduced-motion` (globals.css has no such media query). Gate the
canvas animation intensity and disable `.pulse-ring`/`.eq` animations under
it — accessibility and battery.

### 6.6 Improve — Sleep-friendly "dim" theme
A single CSS variable set (`--background`, `--foreground` exists in
`globals.css` already) toggled by a moon button: pure-black background, zinc-400
text, no grain. For night listening, and it exercises the theming that's
already stubbed.

### 6.7 Feature — Mini floating player on scroll
On mobile the transport is fixed; on desktop the header scrolls away. When
the queue panel grows past the viewport, condense the transport to a compact
pill (artwork dot + title + play/pause) that follows scroll. Optional, but
nice-to-have.

---

## 7. Platform & persistence

### 7.1 Feature — PWA / offline shell
`next.config.ts` + a manifest + service worker (or Serwist):
- The app shell caches, so the player opens with zero network — the synth
  tracks play anyway since they're generated!
- Library tracks already live in OPFS, so **the entire app works offline**.
  That's a rare, genuinely true "100% offline music player" story worth
  advertising in the README.
- Add `display: "standalone"`, theme color from the current palette.

### 7.2 Feature — Export/import library
One JSON (metadata) + OPFS files → zip, or simply:
"Export library" downloads metadata JSON + copies files out; "Import"
re-reads them. Protects users against clearing browser data, enables
migration between browsers/devices.

### 7.3 Fix — `providers.txt` contains live API secrets
`providers.txt` has Audius/Jamendo API keys, secrets, and a bearer token in
the repo root (likely tracked by git). Rotate these credentials, and move
them out of the repo — into environment variables (`.env.local`, gitignored)
or a server route that injects them. Client-side keys in a public repo get
scraped within hours. Check `git log` — if committed, rotation is mandatory
even after removal.

### 7.4 Improve — Track "score view" (nerd delight)
You already compute the full score; visualize it! A toggle that draws the
event timeline (pads/plucks/drums as colored lanes over the seek bar) —
players like this (e.g. piano-roll visualizers) get shared *because* they
expose the machinery. The data structure (`ScoreEvent[]`) is already there.

### 7.5 Improve — Tests for the pure logic
`compose()` is deterministic — perfect unit-test target: same seed → same
events; monotonic sort; energy envelope at intro/break/outro bars; scale
degrees stay in mode. Also test `mulberry32` distribution and
`formatTime` edge cases. No test runner in `package.json` yet — add vitest,
no config needed for pure functions.

---

## Priority snapshot

| Priority | Items | Why |
| --- | --- | --- |
| Now | 1.1, 1.2, 1.4, 1.5, 7.3 | Correctness bugs + a security issue |
| Next | 3.1, 3.2, 4.1, 5.1, 1.9 | Highest delight-per-line-of-code |
| Later | 4.2, 4.3, 5.2, 7.1 | Big swings, each a release-worthy feature |
| Polish | 6.x, 2.x | Do alongside related work |

> The two ideas I'd bet on: **seed remixing (4.1)** and **offline-first PWA +
> library (7.1 + 5.1)** — they compound the project's two genuine
> differentiators (the music is generated, and it all works without a
> network) instead of adding features a normal player already has.



