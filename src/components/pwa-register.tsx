"use client";

import { useEffect } from "react";

/**
 * Registers the AETHER service worker (public/sw.js).
 *
 * Registration is production-only on purpose. In `next dev` the module graph is
 * rebuilt on every edit, so a cache-first worker would happily keep serving an
 * old document and fight HMR. Skipping it in development keeps the dev loop honest.
 *
 * The worker itself is careful about what it caches, but registration must never
 * be able to break the page: every failure path here is logged and swallowed.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch (error) {
        // Unsupported browser, insecure context, or a blocked script. Not fatal.
        console.warn("[aether] service worker registration failed:", error);
      }
    };

    if (document.readyState === "complete") {
      void register();
      return;
    }

    // Registering after load keeps the worker off the critical rendering path.
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}