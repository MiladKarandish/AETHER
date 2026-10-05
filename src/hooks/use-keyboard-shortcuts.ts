"use client";

import { useEffect, useRef } from "react";

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