/**
 * Builds a **synthetic** JWT for the tests in this repository.
 *
 * Nothing here is a real token and nothing here has ever been near one: the payload is assembled
 * from the arguments, the signature segment is the literal text below, and no signing key is
 * involved in any direction. That is deliberate and it is a rule rather than a convenience - a
 * captured credential must never be written into a repository, a fixture or a commit message, and
 * this file exists so no test is ever tempted to paste one "just to have a realistic shape".
 *
 * It does not need to be verifiable, because the only code that reads it is `tokenExpiry.ts`, which
 * verifies nothing by design (see its own header) - it decodes the payload to decide *when to ask
 * the server for a new token*, and the server is what actually judges the token afterwards.
 */

const NOT_A_SIGNATURE = "this-is-not-a-signature";

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface FakeJwtClaims {
  /** Epoch **milliseconds**, converted to the seconds a JWT actually carries. */
  issuedAtMs?: number;
  expiresAtMs: number;
  /** Anything else to put in the payload - a test asserting on the unreadable path uses this. */
  extra?: Record<string, unknown>;
}

export function fakeJwt(claims: FakeJwtClaims): string {
  const payload: Record<string, unknown> = {
    sub: "00000000-0000-0000-0000-0000000000ff",
    exp: Math.floor(claims.expiresAtMs / 1000),
    ...claims.extra,
  };
  if (claims.issuedAtMs !== undefined) {
    payload["nbf"] = Math.floor(claims.issuedAtMs / 1000);
  }

  return [base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })), base64Url(JSON.stringify(payload)), NOT_A_SIGNATURE].join(".");
}
