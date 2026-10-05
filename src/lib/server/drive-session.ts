import "server-only";

import { cookies } from "next/headers";

/**
 * The Drive session: an encrypted, httpOnly cookie holding the refresh token.
 *
 * Storing the session in a cookie rather than a database keeps this app
 * completely stateless — nothing to provision, and it survives a redeploy. The
 * payload is encrypted (not just signed) because a refresh token is a bearer
 * credential for the user's Drive: if it leaked from a cookie jar it would be
 * usable until revoked.
 */

/** Cookie name. Versioned so a future format change invalidates old cookies. */
export const SESSION_COOKIE = "aether_drive_session";

/** OAuth `state` nonce cookie, read once by the callback route. */
export const STATE_COOKIE = "aether_drive_state";

/** How long a connection lasts. Google refresh tokens do not expire quickly. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** What the encrypted cookie carries. */
export interface DriveSession {
  /** The long-lived credential. Required: without it there is no session. */
  refreshToken: string;
  /**
   * The current short-lived access token, cached alongside the refresh token.
   *
   * Google access tokens last an hour and obtaining one costs a network round
   * trip. Keeping it in the same encrypted cookie means a burst of Range
   * requests during playback reuses one token instead of one per request.
   */
  accessToken?: string;
  /** When {@link accessToken} was issued, for the freshness check. */
  accessTokenIssuedAt?: number;
  /** Cached account email, so the status route need not call Google. */
  email?: string;
  name?: string;
}

/* -- encryption --
 * AES-256-GCM via WebCrypto, with a key derived from AETHER_SESSION_SECRET.
 * The secret is a separate env var from the OAuth client so the two can be
 * rotated independently. */

const ALGO = "AES-GCM";
const IV_BYTES = 12;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** True when a session-encryption secret is configured. */
export function hasSessionSecret(): boolean {
  const v = process.env.AETHER_SESSION_SECRET;
  return typeof v === "string" && v.trim().length >= 16;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  // A fixed salt is correct here: the secret is already high-entropy random
  // data, so there is no dictionary to attack, and a random salt would make
  // the key unstable across server restarts (i.e. across every request).
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode("aether-drive-session"), iterations: 100_000, hash: "SHA-256" },
    material,
    { name: ALGO, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a session into a URL-safe cookie value. */
export async function sealSession(session: DriveSession): Promise<string> {
  const secret = process.env.AETHER_SESSION_SECRET?.trim();
  if (!secret) throw new Error("AETHER_SESSION_SECRET is not set.");

  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(session));
  const sealed = await crypto.subtle.encrypt({ name: ALGO, iv }, key, plaintext);

  // iv || authTag || ciphertext — the tag is appended by WebCrypto.
  const combined = new Uint8Array(iv.length + sealed.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(sealed), iv.length);
  return base64url(combined);
}

/**
 * Decrypt a cookie value.
 *
 * Returns null for every failure mode — absent, tampered, wrong key, corrupt —
 * because a session we cannot read is simply "not connected", never a crash.
 */
export async function unsealSession(value: string | undefined): Promise<DriveSession | null> {
  const secret = process.env.AETHER_SESSION_SECRET?.trim();
  if (!secret || !value) return null;

  try {
    const combined = fromBase64url(value);
    if (combined.length <= IV_BYTES) return null;
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: ALGO, iv: combined.slice(0, IV_BYTES) },
      key,
      combined.slice(IV_BYTES),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as DriveSession;
    // A payload without a refresh token is useless; treat it as absent.
    return typeof parsed?.refreshToken === "string" && parsed.refreshToken
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/* -- cookie plumbing -- */

/** Read the Drive session from the request cookies, or null. */
export async function readSession(): Promise<DriveSession | null> {
  const store = await cookies();
  return unsealSession(store.get(SESSION_COOKIE)?.value);
}

/** Write the session cookie (and clear the state cookie) in a route handler. */
export async function writeSession(session: DriveSession): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await sealSession(session), {
    httpOnly: true,
    sameSite: "lax", // survives the top-level redirect back from Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  store.delete(STATE_COOKIE);
}

/** Forget the session. Safe to call when there is nothing to forget. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(STATE_COOKIE);
}
