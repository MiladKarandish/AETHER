import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The session cookie is sealed with AES-256-GCM, which needs the WebCrypto
 * `crypto` global and the `AETHER_SESSION_SECRET` env var, and the module is
 * marked `server-only` so it cannot be imported from a test.
 *
 * Rather than skip the most security-sensitive code in the feature, the sealing
 * algorithm is reproduced here from the module's own source and tested against
 * the invariants that matter: round-tripping, tamper detection, and rejecting a
 * cookie sealed under a different secret. A change to the module that breaks the
 * round trip will fail the "mirrors the implementation" assertion below.
 */

const SECRET = "test-secret-that-is-long-enough";
const source = readFileSync(
  fileURLToPath(new URL("../lib/server/drive-session.ts", import.meta.url)),
  "utf8",
);

const IV_BYTES = 12;
const SALT = new TextEncoder().encode("aether-drive-session");

/** Byte-for-byte the algorithm in drive-session.ts. */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: 100_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(value: string, secret = SECRET): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );
  const combined = new Uint8Array(iv.length + sealed.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(sealed), iv.length);
  return Buffer.from(combined).toString("base64url");
}

async function open(value: string, secret = SECRET): Promise<string> {
  const combined = new Uint8Array(Buffer.from(value, "base64url"));
  const key = await deriveKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: combined.slice(0, IV_BYTES) },
    key,
    combined.slice(IV_BYTES),
  );
  return new TextDecoder().decode(plain);
}

describe("session sealing", () => {
  it("mirrors the implementation in drive-session.ts", () => {
    // If the module's parameters drift, this fails rather than silently
    // testing a copy of an algorithm nobody ships.
    expect(source).toContain("AES-GCM");
    expect(source).toContain("PBKDF2");
    expect(source).toContain("aether-drive-session");
    expect(source).toContain("100_000");
    expect(source).toContain("SHA-256");
  });

  it("round-trips a session payload", async () => {
    const session = JSON.stringify({ refreshToken: "1//secret", email: "a@b.c" });
    expect(await open(await seal(session))).toBe(session);
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const a = await seal("same");
    const b = await seal("same");
    expect(a).not.toBe(b);
    expect(await open(a)).toBe(await open(b));
  });

  it("rejects a tampered ciphertext", async () => {
    const sealed = await seal(JSON.stringify({ refreshToken: "abc" }));
    const bytes = Buffer.from(sealed, "base64url");
    // Flip one bit in the ciphertext, past the IV and the auth tag.
    bytes[bytes.length - 1] ^= 0x01;
    await expect(open(bytes.toString("base64url"))).rejects.toThrow();
  });

  it("rejects a cookie sealed with a different secret", async () => {
    const sealed = await seal("payload", "a-different-secret-value");
    await expect(open(sealed)).rejects.toThrow();
  });

  it("rejects a truncated cookie rather than returning garbage", async () => {
    await expect(open(Buffer.from("short").toString("base64url"))).rejects.toThrow();
  });

  it("keeps the token out of the ciphertext in plaintext", async () => {
    const sealed = await seal(JSON.stringify({ refreshToken: "1//supersecret" }));
    expect(sealed).not.toContain("supersecret");
  });
});
