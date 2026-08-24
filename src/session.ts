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
 * every page view would silently fragment one visitor into many. `11-03`: this also means a
 * returning visitor's cached `widgetPrimaryColorHex`/`widgetPosition` are *not* refreshed on this
 * path either - `storage.ts`'s own `VisitorSession` doc comment states that limitation plainly.
 *
 * `11-03`: `ui/widget.ts` now calls this eagerly, right after mounting, rather than lazily on first
 * open - the skill's Bootstrap section ("the handshake returns the site's widget settings ... and
 * the visitor's history cursor") describes this call as part of bootstrap itself, not something
 * deferred until interaction. That is compatible with the skill's "nothing heavy before first
 * interaction" rule because the two are different weights: this is one small, already rate-limited
 * REST call that does not block rendering (fired without an `await` at the call site), never the
 * real-time connection itself - the actual heavy part (`connection.ts`'s SignalR handshake, joining
 * a conversation, loading history) stays exactly as lazy as `5-09` made it, gated on first open.
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
      const session: VisitorSession = {
        token: body.token,
        visitorId: body.visitorId,
        widgetPrimaryColorHex: body.widgetPrimaryColorHex,
        widgetPosition: body.widgetPosition,
      };
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
