import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { presencePhase } from "@/hooks/use-keyboard-shortcuts";

type Phase = "hidden" | "open" | "closing";

/**
 * Faithful model of usePresence's lifecycle, driving the REAL presencePhase()
 * reducer so this exercises production logic rather than a reimplementation.
 *
 * Models React's behaviour that caused the original bug: a render-phase
 * setState triggers an immediate re-render, so any local variable mutated in
 * that render cannot be read afterwards in the same pass.
 */
function makePresence(initialOpen: boolean) {
  let phase: Phase = initialOpen ? "open" : "hidden";
  let prevOpen = initialOpen;
  let pendingTimer: (() => void) | null = null;

  const render = (open: boolean): { mounted: boolean; closing: boolean } => {
    const snapshot = () => ({
      mounted: phase !== "hidden",
      closing: phase === "closing",
    });
    if (open !== prevOpen) {
      prevOpen = open;
      phase = presencePhase(phase, open);
      // React re-renders immediately after a render-phase update; the returned
      // value comes from that second pass.
      return snapshot();
    }
    return snapshot();
  };

  const commit = () => {
    // Mirrors the effect lifecycle: when `closing` flips false the cleanup runs
    // and cancels the pending unmount, exactly as React would.
    if (phase === "closing") {
      pendingTimer = () => {
        phase = "hidden";
      };
    } else if (pendingTimer) {
      pendingTimer = null;
    }
  };

  const runTimers = () => {
    const queued = pendingTimer;
    pendingTimer = null;
    queued?.();
  };

  return {
    render,
    commit,
    runTimers,
    state: () => ({ phase, mounted: phase !== "hidden", closing: phase === "closing" }),
  };
}

describe("presencePhase", () => {
  it("maps open/close onto the right phase", () => {
    expect(presencePhase("hidden", true)).toBe("open");
    expect(presencePhase("open", true)).toBe("open");
    expect(presencePhase("closing", true)).toBe("open");
    expect(presencePhase("open", false)).toBe("closing");
    expect(presencePhase("closing", false)).toBe("closing");
  });

  it("treats closing an already-hidden element as a no-op", () => {
    // Otherwise a stray `open=false` would mount an invisible overlay.
    expect(presencePhase("hidden", false)).toBe("hidden");
  });

  it("is idempotent for repeated identical inputs", () => {
    for (const p of ["hidden", "open", "closing"] as Phase[]) {
      for (const open of [true, false]) {
        const once = presencePhase(p, open);
        expect(presencePhase(once, open)).toBe(once);
      }
    }
  });
});

describe("usePresence lifecycle", () => {
  it("mounts on open and unmounts after the close animation", () => {
    const p = makePresence(false);
    expect(p.render(false)).toEqual({ mounted: false, closing: false });

    expect(p.render(true)).toEqual({ mounted: true, closing: false });
    p.commit();

    // Closing must be observable so the exit animation can run.
    expect(p.render(false)).toEqual({ mounted: true, closing: true });
    p.commit();

    // ...and only then does it unmount.
    p.runTimers();
    expect(p.state()).toEqual({ phase: "hidden", mounted: false, closing: false });
  });

  it("reopens cleanly from the closing phase", () => {
    const p = makePresence(false);
    p.render(true);
    p.commit();
    p.render(false);
    p.commit();

    // Reopen before the timer fires: must cancel the pending unmount.
    expect(p.render(true)).toEqual({ mounted: true, closing: false });
    p.commit();
    p.runTimers();
    expect(p.state().mounted).toBe(true);
  });

  it("survives repeated open/close cycles", () => {
    const p = makePresence(false);
    for (let i = 0; i < 5; i++) {
      p.render(true);
      p.commit();
      expect(p.state().closing).toBe(false);
      p.render(false);
      p.commit();
      expect(p.state().closing).toBe(true);
      p.runTimers();
      expect(p.state().mounted, `stuck open on cycle ${i}`).toBe(false);
    }
  });

  it("never leaves an overlay mounted after close (regression)", () => {
    // This is the bug that shipped: `closing` was derived from a comparison the
    // render-phase update had already invalidated, so it never became true, the
    // effect never armed, and the modal could not be dismissed.
    const p = makePresence(false);
    p.render(true);
    p.commit();
    p.render(false);
    p.commit();
    p.runTimers();
    expect(p.state().mounted).toBe(false);
    expect(p.state().phase).toBe("hidden");
  });
});

describe("usePresence wiring", () => {
  const source = readFileSync(
    resolve(__dirname, "../hooks/use-keyboard-shortcuts.ts"),
    "utf8",
  );
  const hook = source.slice(source.indexOf("export function usePresence"));

  it("derives `closing` from the stored phase, not from a comparison", () => {
    // The original defect: `closing` was computed as
    // `wasOpen === true && open === false`. React's render-phase update mutated
    // `wasOpen` first, so that expression could never be true on the render
    // that needed it, the effect never armed, and overlays could not close.
    // The fix reads `closing` straight from the phase state. Guard that shape.
    expect(hook).toMatch(/const closing = phase === "closing"/);
    expect(hook).not.toMatch(/const closing = .*open === false/);
  });

  it("mounts the overlay whenever the open prop is true", () => {
    // If `mounted` were ever derived from a stale comparison, opening would
    // break too. It must key off the phase alone.
    expect(hook).toMatch(/return \{ mounted: phase !== "hidden", closing \}/);
  });

  it("schedules the unmount only while closing", () => {
    expect(hook).toMatch(/if \(!closing\) return;/);
    expect(hook).toMatch(/setPhase\("hidden"\)/);
  });
});