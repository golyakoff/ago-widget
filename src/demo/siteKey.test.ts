import { describe, expect, it } from "vitest";
import { resolveDemoSiteKey } from "./siteKey.js";

describe("resolveDemoSiteKey", () => {
  const FALLBACK = "demo_site";

  /**
   * The one that must never regress. Every link that exists today - the README's table,
   * `ago-landing`'s demo cards, anything already bookmarked - arrives with no query string, and all of
   * them must keep working exactly as they do now. `8-09`'s Scope calls this out explicitly, and it is
   * the difference between adding a capability and breaking the demo for everyone who had one.
   */
  it("falls back to the page's own key when there is no query string at all", () => {
    expect(resolveDemoSiteKey("", FALLBACK)).toBe(FALLBACK);
    expect(resolveDemoSiteKey("?", FALLBACK)).toBe(FALLBACK);
  });

  it("falls back when the query string carries other parameters but no site", () => {
    expect(resolveDemoSiteKey("?utm_source=cv&ref=github", FALLBACK)).toBe(FALLBACK);
  });

  it("uses the key from the link a minted tenant's visitorUrl carries", () => {
    // The exact shape 8-07's MintDemoTenantHandler produces: `demo_` plus a 32-character hex id.
    const minted = "demo_0199a1f2c4d34b7e8a1b2c3d4e5f6071";
    expect(resolveDemoSiteKey(`?site=${minted}`, FALLBACK)).toBe(minted);
  });

  it("accepts the seeded keys the 8-05 tenants use", () => {
    expect(resolveDemoSiteKey("?site=demo_site2", FALLBACK)).toBe("demo_site2");
    expect(resolveDemoSiteKey("?site=site_0199a1f2c4d34b7e8a1b2c3d4e5f6071", FALLBACK)).toBe(
      "site_0199a1f2c4d34b7e8a1b2c3d4e5f6071",
    );
  });

  it("reads the parameter with or without a leading question mark", () => {
    expect(resolveDemoSiteKey("site=demo_site2", FALLBACK)).toBe("demo_site2");
  });

  /**
   * A malformed key must not reach the widget. The value only ever lands in a `data-` attribute, never
   * in `innerHTML` and never in a URL this page builds - but a rejected value fails here, where the
   * cause is obvious, instead of several layers away in the API's own site lookup.
   */
  it.each([
    ["empty", ""],
    ["a space", "demo site"],
    ["a quote", 'demo"site'],
    ["an angle bracket", "<script>"],
    ["a slash", "demo/site"],
    ["too long", "d".repeat(65)],
  ])("rejects a key with %s and falls back", (_label, value) => {
    expect(resolveDemoSiteKey(`?site=${encodeURIComponent(value)}`, FALLBACK)).toBe(FALLBACK);
  });

  it("takes the first value when the parameter is repeated", () => {
    // URLSearchParams.get returns the first. Asserted rather than assumed, because "which one wins"
    // is exactly the kind of thing a crafted link would try to exploit if it were the last.
    expect(resolveDemoSiteKey("?site=demo_site2&site=demo_evil", FALLBACK)).toBe("demo_site2");
  });
});
