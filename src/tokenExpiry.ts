/**
 * Reads `nbf`/`iat`/`exp` out of a visitor JWT so `session.ts` can decide *when to ask the server
 * for a new one*. That is the whole job, and the boundary matters:
 *
 * **This verifies nothing, and it is never an authorization decision.** The signature is
 * not checked, the claims are not trusted, and nothing in this widget behaves differently because
 * of what it reads here beyond the moment it chooses to call the renewal endpoint. The server
 * re-validates the token on every single presentation (the negotiate, every attachment call), so a
 * token whose payload lies about `exp` buys an attacker nothing: too-early and the widget makes one
 * extra, rate-limited renewal call; too-late and the connect fails exactly as it does today, which
 * `session.ts` already has a path for.
 *
 * ## Why read `exp` rather than store an expiry alongside the token (`17-07`'s own question)
 *
 * `storage.ts`'s `VisitorSession` already carries fields beyond the token, so storing an
 * `expiresAt` next to it was the alternative. Rejected for two reasons, the second decisive:
 *
 * - The token is the thing the server will judge. An expiry stored beside it is a second copy of
 *   the same fact that can drift from it - a session written by an older build, a lifetime the
 *   server changed since, a hand-edited storage entry. Reading the token means there is one answer.
 * - **It would need a server response-shape change, and would break every already-stored session.**
 *   A returning visitor holding a token minted before this change has no stored expiry field and
 *   never will, so a stored-expiry design has to treat "no expiry recorded" as either "renew now"
 *   (a renewal storm on the day it ships) or "assume valid" (exactly the silence `17-06` reported).
 *   Reading `exp` works on the tokens that already exist, which is the population that matters on
 *   the day this ships.
 */

/** `nbf`/`iat`/`exp` in epoch milliseconds. `issuedAtMs` is `null` for a token carrying neither. */
export interface TokenLifetime {
  issuedAtMs: number | null;
  expiresAtMs: number;
}

interface JwtClaims {
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
}

/**
 * Returns the lifetime a JWT claims for itself, or `null` for anything this cannot read - a
 * malformed token, an opaque one, a payload that is not JSON, a payload with no numeric `exp`.
 * `null` is not an error: `session.ts` treats "I cannot tell when this expires" as "use it and let
 * the server decide", which is precisely the behaviour the widget had before this existed.
 */
export function readTokenLifetime(token: string): TokenLifetime | null {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    return null;
  }

  let claims: JwtClaims;
  try {
    // `atob` alone, no `TextDecoder`: the only claims read here are numeric, so the byte-level
    // fidelity of any string claim in the same payload is irrelevant, and this is the smaller of
    // the two in a bundle with a 45 KB ceiling.
    claims = JSON.parse(atob(base64UrlToBase64(payload))) as JwtClaims;
  } catch {
    return null;
  }

  const expiresAtSeconds = numeric(claims.exp);
  if (expiresAtSeconds === null) {
    return null;
  }

  // `nbf` first: `JwtTokenService.IssueVisitorToken` sets `notBefore` explicitly, and `iat` is the
  // fallback for any issuer that only writes that one.
  const issuedAtSeconds = numeric(claims.nbf) ?? numeric(claims.iat);
  return {
    issuedAtMs: issuedAtSeconds === null ? null : issuedAtSeconds * 1000,
    expiresAtMs: expiresAtSeconds * 1000,
  };
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  // `atob` rejects an unpadded string in some engines and accepts it in others - pad rather than
  // depend on which.
  return base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
