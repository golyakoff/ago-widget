import type { VisitorSessionResponse } from "./protocol/types.js";
import type { WidgetConfig } from "./config.js";
import type { WidgetStorage, VisitorSession } from "./storage.js";
import { jitteredDelayMs } from "./protocol/backoff.js";

/** A site key that does not exist, or an origin this site never allowed - retrying cannot help
 * either one, so the widget gives up rather than looping forever against a permanent rejection. */
export class VisitorSessionRejectedError extends Error {}

const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * `POST /api/v1/visitor-sessions` (api-design.md, Widget-facing constraints): rate-limited per
 * site, `429` + `Retry-After` honoured with jittered backoff rather than hammered
 * (embeddable-widget skill's Connection behaviour). A stored session from a previous page load is
 * reused as-is - the token is valid for 30 days server-side, so minting a new visitor identity on
 * every page view would silently fragment one visitor into many.
 */
export async function getOrCreateVisitorSession(
  config: WidgetConfig,
  storage: WidgetStorage,
  fetchImpl: typeof fetch = fetch,
): Promise<VisitorSession> {
  const existing = storage.getVisitorSession();
  if (existing) {
    return existing;
  }

  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(`${config.apiBaseUrl}/api/v1/visitor-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicKey: config.siteKey }),
    });

    if (response.status === 201) {
      const body = (await response.json()) as VisitorSessionResponse;
      const session: VisitorSession = { token: body.token, visitorId: body.visitorId };
      storage.setVisitorSession(session);
      return session;
    }

    if (response.status === 429 && attempt <= MAX_RATE_LIMIT_RETRIES) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : jitteredDelayMs(attempt);
      await sleep(Number.isFinite(retryAfterMs) ? retryAfterMs : jitteredDelayMs(attempt));
      continue;
    }

    throw new VisitorSessionRejectedError(`Visitor session request rejected: ${response.status}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
