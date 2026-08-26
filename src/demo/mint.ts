/**
 * `8-09`: calling `8-07`'s minting endpoint and turning every outcome it can produce into something a
 * person can read.
 *
 * The endpoint is `POST /api/v1/demo/credentials`, unauthenticated by design (`adr/0058`: any gate at
 * all defeats "a stranger obtains credentials with nobody intervening"). It takes no body.
 */

/** What the API returns on success - `MintedDemoTenantResponse` in `Ago.Chat.Api/Demo`. */
export interface MintedDemoTenant {
  username: string;
  password: string;
  siteName: string;
  sitePublicKey: string;
  visitorUrl: string;
  expiresAt: string;
}

/**
 * Every outcome this button has, as a closed set.
 *
 * `rateLimited` and `atCapacity` are **ordinary states, not errors** - `8-07` caps live demo tenants
 * in total and rate-limits per IP, and a stranger on a busy day reaches both. They are separated from
 * `failed` because the thing to tell a person differs: one is "wait a moment", the other is "wait for
 * somebody else's to expire", and neither is "something went wrong".
 */
export type MintOutcome =
  | { kind: "minted"; tenant: MintedDemoTenant }
  | { kind: "rateLimited"; retryAfterSeconds: number | null }
  | { kind: "atCapacity" }
  | { kind: "disabled" }
  | { kind: "failed"; detail: string };

/** RFC 7807, which every error response from this API takes (`api-design.md`). */
interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
}

/**
 * The error codes `DemoTenantErrors` produces. Matched on the problem's `title`/`detail` rather than
 * on the HTTP status alone, because the cap and the rate limit are both 4xx and the difference between
 * them is the whole point of telling them apart.
 */
const CAPACITY_MARKER = "demo.capacity_reached";
const DISABLED_MARKER = "demo.disabled";

export async function mintDemoTenant(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MintOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/demo/credentials`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
  } catch {
    // The network, not the API. Deliberately does not repeat the browser's own error text, which is
    // both unhelpful and varies per browser.
    return { kind: "failed", detail: "Could not reach the demo API. Check your connection and retry." };
  }

  if (response.ok) {
    try {
      return { kind: "minted", tenant: (await response.json()) as MintedDemoTenant };
    } catch {
      return { kind: "failed", detail: "The demo API answered with something unreadable." };
    }
  }

  // Read once; the body is needed by two of the branches below and a Response body can only be
  // consumed once.
  const problem = await readProblem(response);
  const marker = `${problem?.title ?? ""} ${problem?.detail ?? ""}`;

  if (response.status === 429) {
    return { kind: "rateLimited", retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")) };
  }

  if (marker.includes(CAPACITY_MARKER)) {
    return { kind: "atCapacity" };
  }

  if (marker.includes(DISABLED_MARKER)) {
    return { kind: "disabled" };
  }

  return {
    kind: "failed",
    detail: problem?.detail ?? problem?.title ?? `The demo API answered ${response.status}.`,
  };
}

async function readProblem(response: Response): Promise<ProblemDetails | null> {
  try {
    return (await response.json()) as ProblemDetails;
  } catch {
    return null;
  }
}

/** `Retry-After` is seconds here (`ConversationErrors.RateLimited` sets it from a TimeSpan). A date
 * form is legal in HTTP and this API never sends one, so an unparseable value becomes `null` and the
 * UI says "in a moment" rather than inventing a number. */
function parseRetryAfter(header: string | null): number | null {
  if (header === null) {
    return null;
  }

  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
