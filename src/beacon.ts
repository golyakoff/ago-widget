import type { WidgetConfig } from "./config.js";
import { logWidgetError } from "./errors.js";

/**
 * `23-07`: the two events `POST /api/v1/widget-activity` accepts - `Ago.Chat.Domain.WidgetActivityEventKind`'s
 * own wire values, lower-case exactly as the server parses them.
 */
export type BeaconKind = "load" | "open";

/**
 * `23-07`: one beacon, fired and forgotten - `docs/backlog/23-07-*.md`'s own Scope: "the highest-volume
 * public endpoint in the product... it writes nothing synchronously." Nothing here ever awaits the
 * response or inspects its status: a `429`, a `403` (a refused origin - the server's own job to record,
 * never this widget's to notice or retry) or a dropped connection all mean exactly one thing from this
 * call's own point of view - the count did not land, and `decisions.md` §3 already accepts that as the
 * cost of an approximate dashboard rather than a database write on every visitor's page load.
 *
 * <b>No retry, deliberately - unlike `VisitorSessionManager`'s own mint/renew calls.</b> Those carry an
 * identity a visitor cannot get any other way, so `embeddable-widget`'s "honour `429`, back off rather
 * than hammering" rule is worth a retry loop's own bundle cost. A beacon carries nothing anyone is
 * waiting on - the tenant's own dashboard already tolerates losing "a few events" (this item's own
 * Scope, echoing `decisions.md` §3) - so the one line a retry loop would add here buys back a single
 * dashboard count at the cost of a second request against an endpoint whose own point is staying cheap.
 *
 * `guardAsync`'s own contract (`errors.ts`): any rejection - a network error, a non-2xx response
 * `fetchImpl` itself does not throw on but a caller-added `.then` might, `JSON.stringify` on a config
 * that somehow is not serialisable - is caught and logged, never allowed to reach an
 * `unhandledrejection` on the host page. This function's own body needs no `try`/`catch` of its own
 * for exactly that reason: nothing inside it is ever awaited by the caller.
 */
export function sendBeacon(config: WidgetConfig, fetchImpl: typeof fetch, kind: BeaconKind): void {
  fetchImpl(`${config.apiBaseUrl}/api/v1/widget-activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey: config.siteKey, kind }),
  }).catch(logWidgetError);
}
