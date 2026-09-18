import type { WidgetConfig } from "./config.js";
import { logWidgetError } from "./errors.js";

/**
 * `25-143`: the widget's own reload-time read of `GET /api/v1/conversations/{conversationId}/unread-count`
 * - the visitor-authenticated, read-only endpoint `Ago.Chat.Api`'s own `UnreadCountEndpoints` adds as
 * this same item's server-side half. Same shape every other visitor REST call in this codebase already
 * uses (`recordContactDetail`, `consent.ts`) - the signed visitor token as a bearer header, `fetchImpl`
 * injectable so a test never needs a real network.
 *
 * `afterSequence` is `null` for a visitor this browser has never marked a read position for (the
 * backlog item's own contract: "omit it entirely for a visitor who has never had one") - the query
 * string carries no `afterSequence` parameter at all in that case, matching the server's own default
 * (`UnreadCountEndpoints.HandleGetUnreadCountAsync`'s `afterSequence ?? 0`, "every message ever sent").
 *
 * <b>Resolves to `0` rather than throwing, on any failure.</b> A non-2xx response, a malformed body, or
 * a network error all degrade to "nothing unread" instead of propagating - this is a reload-time
 * convenience that seeds a badge's starting number, not a write whose failure a visitor needs to hear
 * about. `bootstrapSession` (`ui/widget.ts`) awaits this call before the panel or the toggle's own
 * accessible label render; letting a failure here reject that promise would put the *entire* widget
 * bootstrap - color, position, locale, the `restarted` note - at the mercy of one best-effort read this
 * item added, which is a materially worse failure mode than a badge that simply stays at zero for this
 * page load. `logWidgetError` still records the failure to the console (`errors.ts`'s own "never let an
 * internal failure become invisible" posture) - swallowed for the visitor, not for whoever is
 * debugging.
 */
export async function getUnreadCount(
  config: WidgetConfig,
  token: string,
  conversationId: string,
  afterSequence: number | null,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const query = afterSequence !== null ? `?afterSequence=${encodeURIComponent(String(afterSequence))}` : "";

  try {
    const response = await fetchImpl(
      `${config.apiBaseUrl}/api/v1/conversations/${conversationId}/unread-count${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
      logWidgetError(new Error(`Unread count request failed: ${response.status}`));
      return 0;
    }

    const body = (await response.json()) as { count?: unknown };
    return typeof body.count === "number" && Number.isFinite(body.count) && body.count >= 0 ? body.count : 0;
  } catch (error) {
    logWidgetError(error);
    return 0;
  }
}
