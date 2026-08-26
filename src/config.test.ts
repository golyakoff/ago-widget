import { describe, expect, it } from "vitest";
import { MissingSiteKeyError, readConfig } from "./config.js";

// `__AGO_DEFAULT_API_BASE_URL__` is an esbuild `define`, replaced at build time (build.mjs) and
// therefore genuinely absent under vitest, which does not run that build. Declaring it on
// `globalThis` is the smallest faithful stand-in: the bundled code reads a bare identifier, and a
// global of that name is exactly what a bare identifier resolves to.
(globalThis as unknown as Record<string, string>)["__AGO_DEFAULT_API_BASE_URL__"] = "https://built-in.example";

function scriptWith(attributes: Record<string, string>): HTMLScriptElement {
  const script = document.createElement("script");
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(name, value);
  }

  return script;
}

describe("readConfig", () => {
  it("rejects an embed with no data-site", () => {
    expect(() => readConfig(scriptWith({}))).toThrow(MissingSiteKeyError);
  });

  it("falls back to the built-in API origin and strips its trailing slashes", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1" })).apiBaseUrl).toBe("https://built-in.example");
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-api": "https://api.example//" })).apiBaseUrl).toBe(
      "https://api.example",
    );
  });

  // 8-06. The default matters more than the opt-in: a real shop's embed must never sprout a notice
  // telling its own customers the conversation is public.
  it("says nothing unless the embed asks for a notice by exact value", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1" })).demoNotice).toBe("none");
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "false" })).demoNotice).toBe("none");
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "" })).demoNotice).toBe("none");
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "True" })).demoNotice).toBe("none");
  });

  // 8-11. The two states this item exists to keep apart.
  it("reads the notice from data-demo-notice", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-demo-notice": "public" })).demoNotice).toBe("public");
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-demo-notice": "private" })).demoNotice).toBe("private");
  });

  /**
   * 8-11. A typo must not decide what a stranger is told about their own privacy. Falling back to
   * "public" would put a false warning on a private tenant; falling back to "private" would remove a
   * true one from a public page. Silence is the only default that cannot mislead somebody, and a
   * demo page that lost its notice is caught by the boot tests instead.
   */
  it("falls back to silence for a value it does not recognise, never to a guess", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-demo-notice": "Public" })).demoNotice).toBe("none");
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-demo-notice": "true" })).demoNotice).toBe("none");
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-demo-notice": "" })).demoNotice).toBe("none");
  });

  /**
   * 8-11. `data-public-demo="true"` was 8-06's attribute and this bundle is a public script tag on a
   * public URL, so somebody may have copied the demo page's markup. api-design.md's reasoning about
   * an embed that "cannot be forced to upgrade" applies to a script tag's attributes too.
   */
  it("still honours 8-06's data-public-demo as an alias for the public notice", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "true" })).demoNotice).toBe("public");
  });

  // The new attribute wins: an embed that carries both has been migrated, and the old one is what is
  // left over rather than what is meant.
  it("prefers data-demo-notice when both attributes are present", () => {
    expect(
      readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "true", "data-demo-notice": "private" }))
        .demoNotice,
    ).toBe("private");
  });
});
