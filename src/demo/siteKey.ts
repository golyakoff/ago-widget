/**
 * `8-09`: which tenant a public demo page should boot its widget against.
 *
 * **This lives in the demo page's own code, deliberately, and must never move into the widget.**
 * `adr/0058` states the rule and it is the sentence in this whole item most likely to be violated by
 * accident: a widget that read `?site=` from the URL of the page hosting it would let *any* page it is
 * embedded on choose which tenant it talks to. That is not a convenience, it is a tenant-isolation
 * hole — a shop's own page could be made to open a conversation against somebody else's tenant by a
 * crafted link. The page decides; the widget is told, through the same `data-site` attribute it has
 * always read.
 *
 * Nothing here imports from the widget, and `src/index.ts` does not import this. The two ship as
 * separate bundles (`build.mjs`) so the boundary is a build artifact rather than a promise.
 */

/**
 * The shape a site key may take. `8-07` mints `demo_<32 hex>`; `1-05` seeds `demo_site` and
 * `demo_site2`; `10-02` registers `site_<32 hex>`.
 *
 * Validated rather than trusted even though the value only ever reaches a `data-` attribute (never
 * `innerHTML`, never a URL this page builds). Two reasons that survive that: a malformed key produces
 * a confusing widget-side failure several layers from its cause, and a rule that is enforced here
 * cannot be forgotten by the next thing that consumes it.
 */
const SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Resolves the key from a query string, falling back to the page's own baked-in tenant.
 *
 * **The fallback is not optional.** Every link that exists today — the README table, `ago-landing`'s
 * demo cards, anything a reviewer has already bookmarked — arrives with no query string at all, and
 * every one of them must keep working exactly as it does now. A version of this that required the
 * parameter would break the demo for everyone in order to serve the person who just pressed a button.
 *
 * @param search the page's `location.search`, with or without its leading `?`
 * @param fallback the page's own baked-in key, used when the parameter is absent or malformed
 */
export function resolveDemoSiteKey(search: string, fallback: string): string {
  // No try/catch: `URLSearchParams` accepts any string and never throws, so a guard here would be
  // unreachable code claiming a guarantee it does not provide. Written with one, then removed after a
  // mutation that deleted the catch changed nothing - which is the only way to find out.
  const candidate = new URLSearchParams(search).get("site");

  if (candidate === null || !SITE_KEY_PATTERN.test(candidate)) {
    return fallback;
  }

  return candidate;
}
