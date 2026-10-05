import { describe, expect, it } from "vitest";
import {
  DriveHttpError,
  driveErrorCode,
  driveErrorMessage,
  DRIVE_ERRORS,
} from "@/lib/drive";

/**
 * The session cookie's crypto helpers live in a `server-only` module, which
 * cannot be imported here. Rather than duplicating the algorithm, these tests
 * exercise the pure error mapping that the routes and the client both rely on
 * to turn a Drive failure into something showable.
 */
describe("driveErrorCode", () => {
  it("maps an expired or revoked grant to the reconnect prompt", () => {
    expect(driveErrorCode(new DriveHttpError(401, ""))).toBe("unauthorized");
  });

  it("maps a 403 to a security rejection, not a reconnect prompt", () => {
    // 403 is how a blocked cross-site request is reported. Reporting it as
    // "unauthorized" would send the user to reconnect for no reason.
    expect(driveErrorCode(new DriveHttpError(403, ""))).toBe("forbidden");
  });

  it("maps a missing file to notFound", () => {
    expect(driveErrorCode(new DriveHttpError(404, ""))).toBe("notFound");
  });

  it("maps throttling and server faults to a retryable network error", () => {
    expect(driveErrorCode(new DriveHttpError(429, ""))).toBe("network");
    expect(driveErrorCode(new DriveHttpError(500, ""))).toBe("network");
    expect(driveErrorCode(new DriveHttpError(503, ""))).toBe("network");
  });

  it("maps transport-level DNS failures to a network error", () => {
    // A thrown fetch() TypeError has no `status`, only a `cause.code`.
    const dns = Object.assign(new Error("fetch failed"), {
      cause: { code: "ENOTFOUND" },
    });
    expect(driveErrorCode(dns)).toBe("unknown");
    const direct = Object.assign(new Error("x"), { code: "ECONNRESET" });
    expect(driveErrorCode(direct)).toBe("network");
  });

  it("falls back to unknown rather than throwing on junk input", () => {
    for (const junk of [null, undefined, "string", 42, {}, []]) {
      expect(driveErrorCode(junk)).toBe("unknown");
    }
  });
});

describe("driveErrorMessage", () => {
  it("has a sentence for every code", () => {
    for (const code of Object.keys(DRIVE_ERRORS)) {
      const message = driveErrorMessage(code as keyof typeof DRIVE_ERRORS);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe("DriveHttpError", () => {
  it("carries the status the route should reply with", () => {
    const err = new DriveHttpError(429, "slow down");
    expect(err.status).toBe(429);
    expect(err.message).toBe("slow down");
    expect(err).toBeInstanceOf(Error);
  });

  it("carries an explicit code so shared statuses stay distinguishable", () => {
    // Two unrelated failures both answer 401; the UI must be able to tell them
    // apart, so the code is never inferred from the status alone.
    const revoked = new DriveHttpError(401, "expired", "unauthorized");
    const missing = new DriveHttpError(401, "no session", "notConnected");
    expect(revoked.status).toBe(missing.status);
    expect(revoked.code).not.toBe(missing.code);
  });

  it("leaves the code undefined when none is given", () => {
    expect(new DriveHttpError(400, "bad").code).toBeUndefined();
  });
});
