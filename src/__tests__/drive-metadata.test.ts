import { describe, expect, it } from "vitest";
import {
  DRIVE_ID_PREFIX,
  decodeDescription,
  encodeDescription,
  escapeDriveQuery,
  fileIdOf,
  filterDriveTracks,
  folderByNameQuery,
  folderChildrenQuery,
  isAudioName,
  isDriveTrack,
  mergeDriveTracks,
  mimeTypeFor,
  parseFilename,
  sanitizeFilename,
  stripExtension,
  toDriveTrack,
  toQueueTrack,
  totalUsage,
  trackId,
  type DriveTrack,
} from "@/lib/drive";

const track = (over: Partial<DriveTrack> = {}): DriveTrack => ({
  fileId: "abc123",
  title: "Roygbiv",
  artist: "Boards of Canada",
  album: "AETHER Music",
  duration: 0,
  bytes: 1024,
  mimeType: "audio/mpeg",
  createdAt: "",
  modifiedAt: "",
  ...over,
});

describe("queue ids", () => {
  it("round-trips a file id through the queue id", () => {
    expect(fileIdOf(trackId("xyz"))).toBe("xyz");
  });

  it("does not claim ids from the OPFS library", () => {
    expect(fileIdOf("library:local:abc")).toBeNull();
    expect(isDriveTrack("library:local:abc")).toBe(false);
  });

  it("recognises its own ids", () => {
    expect(isDriveTrack(`${DRIVE_ID_PREFIX}file`)).toBe(true);
  });

  it("handles an empty file id without throwing", () => {
    expect(fileIdOf(DRIVE_ID_PREFIX)).toBe("");
  });
});

describe("toQueueTrack", () => {
  it("produces a local-kind entry the engine can play", () => {
    const q = toQueueTrack(track());
    expect(q.kind).toBe("local");
    expect(q.id).toBe(`drive:abc123`);
    // Same-origin URL: this is what keeps the analyser working.
    expect(q.url).toBe("/api/drive/audio/abc123");
  });

  it("fills in placeholders for sparse metadata", () => {
    const q = toQueueTrack(
      track({ title: "", artist: "", album: "", duration: -5 }),
    );
    expect(q.title).toBe("Untitled");
    expect(q.artist).toBe("Unknown artist");
    expect(q.album).toBe("AETHER Music");
    // A negative duration must not leak into the transport's seek clamp.
    expect(q.duration).toBe(0);
  });

  it("is stable, so a refresh does not change a track's colour", () => {
    expect(toQueueTrack(track()).palette).toEqual(toQueueTrack(track()).palette);
  });

  it("escapes ids in the audio URL", () => {
    expect(toQueueTrack(track({ fileId: "a/b" })).url).toBe("/api/drive/audio/a%2Fb");
  });
});

describe("description round-trip", () => {
  it("preserves every field it writes", () => {
    const encoded = encodeDescription({
      title: "Roygbiv",
      artist: "Boards of Canada",
      duration: 143,
    });
    expect(decodeDescription(encoded)).toEqual({
      title: "Roygbiv",
      artist: "Boards of Canada",
      duration: 143,
    });
  });

  it("survives a description with no duration", () => {
    const encoded = encodeDescription({ title: "Roygbiv", artist: "BOC" });
    expect(decodeDescription(encoded).duration).toBeUndefined();
    expect(decodeDescription(encoded).title).toBe("Roygbiv");
  });

  it("returns nothing for empty input instead of throwing", () => {
    expect(decodeDescription(undefined)).toEqual({});
    expect(decodeDescription(null)).toEqual({});
    expect(decodeDescription("")).toEqual({});
  });

  it("tolerates a hand-edited description", () => {
    expect(decodeDescription("just a title").title).toBe("just a title");
    expect(decodeDescription("Song (12s)").duration).toBe(12);
    // A stray separator must not produce an empty title.
    expect(decodeDescription(" -- ").title).toBeUndefined();
  });

  it("does not treat a hyphen in a name as an artist separator", () => {
    // The separator is an em dash, so hyphenated artists survive intact.
    expect(decodeDescription("Thesis -- Jay-Z").artist).toBe("Jay-Z");
  });
});

describe("parseFilename", () => {
  it("splits the conventional Artist - Title form", () => {
    expect(parseFilename("Boards of Canada - Roygbiv.mp3")).toEqual({
      title: "Roygbiv",
      artist: "Boards of Canada",
    });
  });

  it("treats a bare name as the title", () => {
    expect(parseFilename("Roygbiv.mp3")).toEqual({ title: "Roygbiv" });
  });

  it("only splits on the first separator", () => {
    expect(parseFilename("A - B - C.mp3")).toEqual({ title: "B - C", artist: "A" });
  });

  it("ignores a leading or trailing separator", () => {
    expect(parseFilename(" - Roygbiv.mp3").artist).toBeUndefined();
    expect(parseFilename("BOC - .mp3")).toEqual({ title: "BOC -" });
  });

  it("never returns an empty title", () => {
    expect(parseFilename("").title).toBe("Untitled");
    expect(parseFilename(".mp3").title).toBe("Untitled");
    expect(parseFilename("   ").title).toBe("Untitled");
  });
});

describe("mimeTypeFor / isAudioName", () => {
  it("maps known audio extensions", () => {
    expect(mimeTypeFor("a.mp3")).toBe("audio/mpeg");
    expect(mimeTypeFor("a.FLAC")).toBe("audio/flac");
    expect(mimeTypeFor("a.wav")).toBe("audio/wav");
  });

  it("rejects anything that is not audio", () => {
    expect(mimeTypeFor("cover.jpg")).toBeNull();
    expect(mimeTypeFor("notes.pdf")).toBeNull();
    expect(mimeTypeFor("noextension")).toBeNull();
    // A dotfile must not be read as an extension.
    expect(mimeTypeFor(".mp3")).toBeNull();
    expect(isAudioName("cover.jpg")).toBe(false);
    expect(isAudioName("song.mp3")).toBe(true);
  });
});

describe("sanitizeFilename", () => {
  it("replaces characters that are reserved elsewhere", () => {
    expect(sanitizeFilename("a/b:c*d?.mp3")).toBe("a-b-c-d-.mp3");
  });

  it("never returns an empty name", () => {
    expect(sanitizeFilename("")).toBe("Untitled");
    expect(sanitizeFilename("   ")).toBe("Untitled");
    expect(sanitizeFilename("///")).toBe("---");
  });

  it("caps the length at Drive's limit", () => {
    expect(sanitizeFilename("x".repeat(400))).toHaveLength(255);
  });

  it("keeps ordinary names intact", () => {
    expect(sanitizeFilename("Roygbiv.mp3")).toBe("Roygbiv.mp3");
  });
});

describe("stripExtension", () => {
  it("removes only the final extension", () => {
    expect(stripExtension("a.b.c.mp3")).toBe("a.b.c");
    expect(stripExtension("noext")).toBe("noext");
    expect(stripExtension(".mp3")).toBe(".mp3");
  });
});

describe("escapeDriveQuery", () => {
  it("neutralises quotes that would break out of the q expression", () => {
    expect(escapeDriveQuery("it's")).toBe("it\\'s");
    expect(escapeDriveQuery("back\\slash")).toBe("back\\\\slash");
  });

  it("keeps a crafted name inside its own clause", () => {
    const q = folderChildrenQuery("' or name != 'x");
    expect(q.startsWith("'\\' or name != \\'x'")).toBe(true);
    // Exactly two UNESCAPED quotes remain: the folder id's own delimiters. Any
    // extra unescaped quote would let the value break out of its clause.
    const unescaped = q.match(/(?<!\\)'/g) ?? [];
    expect(unescaped).toHaveLength(2);
  });

  it("finds the folder by name and scope", () => {
    const q = folderByNameQuery("AETHER Music");
    expect(q).toContain("'root' in parents");
    expect(q).toContain("trashed = false");
    expect(q).toContain("name = 'AETHER Music'");
  });
});

describe("toDriveTrack", () => {
  it("maps a raw Drive resource", () => {
    const t = toDriveTrack({
      id: "f1",
      name: "song.mp3",
      mimeType: "audio/mpeg",
      size: "2048",
      description: encodeDescription({ title: "Song", artist: "Artist" }),
    });
    expect(t.fileId).toBe("f1");
    expect(t.title).toBe("Song");
    expect(t.artist).toBe("Artist");
    expect(t.bytes).toBe(2048);
    expect(t.mimeType).toBe("audio/mpeg");
  });

  it("falls back to the filename for a file with no description", () => {
    const t = toDriveTrack({ id: "f1", name: "Boards of Canada - Roygbiv.mp3" });
    expect(t.title).toBe("Roygbiv");
    expect(t.artist).toBe("Boards of Canada");
  });

  it("never yields NaN for missing or junk numbers", () => {
    // NaN would render as the literal text "NaN" in the queue.
    const t = toDriveTrack({ id: "f1", name: "a.mp3", size: "not-a-number" });
    expect(Number.isNaN(t.bytes)).toBe(false);
    expect(t.bytes).toBe(0);
    expect(t.duration).toBe(0);
  });

  it("always reports a playable mime type", () => {
    expect(toDriveTrack({ id: "f", name: "x.bin" }).mimeType).toBe("audio/mpeg");
    expect(toDriveTrack({ id: "f", name: "x.ogg" }).mimeType).toBe("audio/ogg");
  });
});

describe("mergeDriveTracks", () => {
  it("puts refreshed tracks first without duplicating them", () => {
    const existing = [track({ fileId: "a" }), track({ fileId: "b" })];
    const incoming = [track({ fileId: "b", title: "New B" })];
    const merged = mergeDriveTracks(existing, incoming);
    expect(merged.map((t) => t.fileId)).toEqual(["b", "a"]);
    expect(merged[0].title).toBe("New B");
  });

  it("keeps an optimistic local track that the server has not seen yet", () => {
    const merged = mergeDriveTracks([track({ fileId: "new" })], [track({ fileId: "old" })]);
    expect(merged.map((t) => t.fileId)).toEqual(["old", "new"]);
  });

  it("drops entries with no file id", () => {
    expect(mergeDriveTracks([], [track({ fileId: "" })])).toEqual([]);
  });

  it("returns the same array when nothing changed", () => {
    const existing = [track()];
    expect(mergeDriveTracks(existing, [])).toBe(existing);
  });
});

describe("totalUsage / filterDriveTracks", () => {
  it("sums bytes and counts files", () => {
    expect(totalUsage([track({ bytes: 10 }), track({ fileId: "b", bytes: 5 })])).toEqual({
      bytes: 15,
      files: 2,
    });
    expect(totalUsage([])).toEqual({ bytes: 0, files: 0 });
  });

  it("searches title, artist and album, case-insensitively", () => {
    const list = [track(), track({ fileId: "2", title: "Other", artist: "Zed" })];
    expect(filterDriveTracks(list, "royg")).toHaveLength(1);
    expect(filterDriveTracks(list, "ZED")).toHaveLength(1);
    expect(filterDriveTracks(list, "aether")).toHaveLength(2);
    expect(filterDriveTracks(list, "  ")).toHaveLength(2);
    expect(filterDriveTracks(list, "nope")).toHaveLength(0);
  });
});
