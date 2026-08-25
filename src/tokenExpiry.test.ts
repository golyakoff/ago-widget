import { describe, expect, it } from "vitest";
import { readTokenLifetime } from "./tokenExpiry.js";
import { fakeJwt } from "./testing/fakeJwt.js";

/**
 * `testing.md`'s "Pure unit" level: no DOM, no network, no clock. What matters about this function
 * is that it is honest about what it cannot read - every `null` below is a case where guessing would
 * put the whole widget into either a renewal loop or the silence `17-06` reported.
 */
describe("readTokenLifetime", () => {
  const issuedAtMs = Date.UTC(2026, 7, 25, 9, 0, 0);
  const expiresAtMs = Date.UTC(2026, 8, 1, 9, 0, 0);

  it("reads the window a token claims for itself", () => {
    expect(readTokenLifetime(fakeJwt({ issuedAtMs, expiresAtMs }))).toEqual({ issuedAtMs, expiresAtMs });
  });

  it("reports no issue time for a token carrying only exp, rather than inventing one", () => {
    expect(readTokenLifetime(fakeJwt({ expiresAtMs }))).toEqual({ issuedAtMs: null, expiresAtMs });
  });

  it("falls back to iat when the issuer wrote that instead of nbf", () => {
    const token = fakeJwt({ expiresAtMs, extra: { iat: Math.floor(issuedAtMs / 1000) } });
    expect(readTokenLifetime(token)).toEqual({ issuedAtMs, expiresAtMs });
  });

  it("survives a payload whose base64url needs padding restored", () => {
    // `sub` is sized so the payload's base64 length is not a multiple of four - the case an `atob`
    // that rejects unpadded input would throw on.
    const token = fakeJwt({ expiresAtMs, extra: { sub: "a" } });
    expect(readTokenLifetime(token)?.expiresAtMs).toBe(expiresAtMs);
  });

  it("reads nothing from a token it cannot parse, so the widget presents it and lets the server judge", () => {
    expect(readTokenLifetime("")).toBeNull();
    expect(readTokenLifetime("opaque-not-a-jwt")).toBeNull();
    expect(readTokenLifetime("header.@@@not-base64@@@.signature")).toBeNull();
    expect(readTokenLifetime(`header.${btoa("not json")}.signature`)).toBeNull();
  });

  it("reads nothing from a token with no usable exp", () => {
    expect(readTokenLifetime(`header.${btoa(JSON.stringify({ sub: "x" }))}.sig`)).toBeNull();
    expect(readTokenLifetime(`header.${btoa(JSON.stringify({ exp: "soon" }))}.sig`)).toBeNull();
  });
});
