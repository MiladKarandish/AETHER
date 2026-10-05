"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps an element mounted through its exit animation.
 *
 * Conditional rendering (`{open && <Modal/>}`) unmounts immediately, so the
 * component can never play a closing transition — the overlay just vanishes.
 * This returns `mounted` to keep rendering plus a `closing` flag used to switch
 * the animation class, and holds the mount until the animation ends (with a
 * timeout fallback, because `animationend` never fires when animations are
 * disabled or reduced).
 */
/** Lifecycle phases for a presence-tracked overlay. */
type Phase = "hidden" | "open" | "closing";

/**
 * Pure transition function for presence state.
 *
 * Modelling this as a single `phase` (rather than deriving "is closing?" from a
 * comparison against the previous `open`) is what makes it correct: a render-phase
 * state update invalidates any local variable it just changed, so
 * `wasOpen === true && open === false` can never be observed on the render that
 * needs it. Storing the phase explicitly avoids that entire class of bug.
 */
export function presencePhase(current: Phase, open: boolean): Phase {
  if (open) return "open";
  // Closing from an already-hidden element is a no-op.
  if (current === "hidden") return "hidden";
  return "closing";
}

export function usePresence(
  open: boolean,
  durationMs = 220,
): { mounted: boolean; closing: boolean } {
  const [phase, setPhase] = useState<Phase>(() => (open ? "open" : "hidden"));
  const [prevOpen, setPrevOpen] = useState(open);

  // Adjust state during render (React's documented "derive state from props"
  // pattern) so the phase changes in the same commit as the prop, with no
  // cascading render. `closing` is then read from the stored phase, so it is
  // stable across the re-render React performs for this update.
  if (open !== prevOpen) {
    setPrevOpen(open);
    setPhase((current) => presencePhase(current, open));
  }

  const closing = phase === "closing";

  useEffect(() => {
    if (!closing) return;
    // Respect prefers-reduced-motion: skip the wait, unmount at once.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => setPhase("hidden"),
      reduce ? 0 : durationMs,
    );
    return () => window.clearTimeout(timer);
  }, [closing, durationMs]);

  return { mounted: phase !== "hidden", closing };
}

/**
 * Drag-to-dismiss for bottom sheets.
 *
 * On touch devices the only way out of a drawer is hunting for a close button
 * or tapping the backdrop. This tracks a vertical drag and calls `onDismiss`
 * once it passes a distance/velocity threshold, while letting normal scrolls
 * inside the sheet pass through untouched.
 */
export function useSwipeToDismiss(onDismiss: () => void) {
  const startY = useRef<number | null>(null);
  const offset = useRef(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Set while a drag is in flight so the opening/closing CSS animation is
  // suppressed and the drag transform is the only thing driving `translateY`.
  const dragging = useRef(false);

  // Callbacks are returned individually (not as one object holding the ref) so
  // spreading them onto JSX doesn't trip the "no refs during render" rule.
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Ignore drags that begin on a scrollable list, so the queue can still be
    // scrolled by touch inside the sheet.
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-swipe]")) return;
    startY.current = e.touches[0].clientY;
    offset.current = 0;
    dragging.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    const sheet = sheetRef.current;
    // only drag downward — upward movement belongs to the list
    if (dy <= 0) {
      offset.current = 0;
      if (sheet) sheet.style.transform = "";
      return;
    }
    offset.current = dy;
    if (sheet) {
      // Suppress the entry animation while dragging, otherwise the keyframe's
      // transform would override (and fight) the drag offset.
      sheet.style.animation = "none";
      sheet.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const end = useCallback(() => {
    const sheet = sheetRef.current;
    const dy = offset.current;
    const wasDragging = dragging.current;
    startY.current = null;
    offset.current = 0;
    dragging.current = false;

    if (sheet) {
      // Restore the CSS animation so the closing keyframe can take over, then
      // let React add the `closing` class. Clearing the inline transform is
      // safe because the animation drives the position from here on.
      sheet.style.animation = "";
      sheet.style.transform = "";
    }
    if (wasDragging && dy > 110) onDismiss();
  }, [onDismiss]);

  return { sheetRef, onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end };
}

/** Locks body scroll while a modal/drawer is open, without layout shift. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    // compensate for the removed scrollbar so the page doesn't jump
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [active]);
}

/** Keys we never hijack, so typing/selecting in a control still works. */
const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE.has(target.tagName) || target.isContentEditable) return true;
  // range inputs (volume/seek) legitimately consume arrow keys
  return target.getAttribute("role") === "slider";
}

/**
 * Global keyboard shortcuts. One declarative map instead of a growing switch,
 * so adding a binding is a one-line change and can't fall through to another case.
 */
export function useKeyboardShortcuts(
  handlers: Record<string, (e: KeyboardEvent) => void>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const handler = handlers[e.key];
      if (!handler) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers, enabled]);
}

/**
 * Tracks a modal/drawer's open state and wires up Escape-to-close plus a
 * focus trap, so overlays behave like real dialogs.
 */
export function useDismissable(
  open: boolean,
  onClose: () => void,
): { panelRef: React.RefObject<HTMLElement | null> } {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      // keep focus inside the dialog while it is open
      const root = panelRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    // move focus into the dialog for screen-reader users
    const timer = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          'button, input, [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.clearTimeout(timer);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  return { panelRef };
}