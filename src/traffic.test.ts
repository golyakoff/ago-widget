import { afterEach, describe, expect, it } from "vitest";
import { captureTrafficSource } from "./traffic.js";

/**
 * `18-12`'s own Done-when: the widget actually reads `document.referrer`/`location.href` and turns
 * them into the four fields `VisitorHub.JoinWithTrafficSourceAsync` sends on - proven here as a pure
 * function of the two browser globals, not only through `connection.test.ts`'s own end-to-end
 * invocation-args assertions.
 *
 * **The empty-referrer case gets its own test, first, deliberately** - it is the common case (a direct
 * visit, a privacy-blocking browser, a referrer-stripping browser), not the exception this suite
 * happens to also cover.
 */
describe("captureTrafficSource", () => {
  const originalReferrer = document.referrer;

  afterEach(() => {
    Object.defineProperty(document, "referrer", { value: originalReferrer, configurable: true });
    window.history.pushState({}, "", "/");
  });

  it("captures nothing at all for a direct visit with no UTM tag - the common case", () => {
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
    window.history.pushState({}, "", "/");

    const source = captureTrafficSource();

    expect(source).toEqual({
      referrerHost: undefined,
      utmSource: undefined,
      utmMedium: undefined,
      utmCampaign: undefined,
    });
  });

  it("captures the referring page's host when document.referrer is set", () => {
    Object.defineProperty(document, "referrer", { value: "https://shop.example/some/page?x=1", configurable: true });
    window.history.pushState({}, "", "/");

    const source = captureTrafficSource();

    expect(source.referrerHost).toBe("shop.example");
    expect(source.utmSource).toBeUndefined();
  });

  it("captures all three UTM parameters from the landing page's own URL", () => {
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
    window.history.pushState({}, "", "/?utm_source=newsletter&utm_medium=email&utm_campaign=summer_sale");

    const source = captureTrafficSource();

    expect(source).toEqual({
      referrerHost: undefined,
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "summer_sale",
    });
  });

  it("captures a referrer and a campaign together - a real, unremarkable combination", () => {
    Object.defineProperty(document, "referrer", { value: "https://shop.example/", configurable: true });
    window.history.pushState({}, "", "/?utm_campaign=summer_sale");

    const source = captureTrafficSource();

    expect(source.referrerHost).toBe("shop.example");
    expect(source.utmCampaign).toBe("summer_sale");
  });

  it("degrades to no referrer, never throws, when document.referrer is not a valid URL", () => {
    Object.defineProperty(document, "referrer", { value: "not a url at all", configurable: true });
    window.history.pushState({}, "", "/");

    expect(() => captureTrafficSource()).not.toThrow();
    expect(captureTrafficSource().referrerHost).toBeUndefined();
  });

  it("ignores an empty UTM parameter value the same way it ignores an absent one", () => {
    Object.defineProperty(document, "referrer", { value: "", configurable: true });
    window.history.pushState({}, "", "/?utm_source=&utm_campaign=summer_sale");

    const source = captureTrafficSource();

    expect(source.utmSource).toBeUndefined();
    expect(source.utmCampaign).toBe("summer_sale");
  });
});
