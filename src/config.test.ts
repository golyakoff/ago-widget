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

/**
 * `#337`: `apiBaseUrl` resolves `data-api` -> the script's own origin -> the baked-in default
 * (`adr/0092`'s follow-up). The demo-shop case below is the one that matters most: it is the exact
 * regression that would take down both public demo pages if the ordering were ever silently
 * inverted, and it is written to fail if `data-api` stopped winning over inference.
 */
describe("readConfig apiBaseUrl resolution (#337)", () => {
  it("infers the API origin from the script's own src when data-api is absent", () => {
    const config = readConfig(
      scriptWith({ "data-site": "shop_1", src: "https://chat-api.reserve-me.ru/widget/ago-chat.js" }),
    );
    // Stripped to the origin - not the /widget/ago-chat.js path, and not /widget either.
    expect(config.apiBaseUrl).toBe("https://chat-api.reserve-me.ru");
  });

  /**
   * The regression this item exists to prevent, made concrete: a bundle loaded from a demo shop's
   * own origin, exactly as `public-demo`/`public-demo-2` serve it, but with the `data-api` attribute
   * `src/demo/boot.ts`'s `bootWidget` now always sets. If `data-api` ever stopped winning over
   * inference, this would assert the demo shop's own origin instead and fail.
   */
  it("prefers data-api over the inferred origin, even when the script was loaded from a demo shop", () => {
    const config = readConfig(
      scriptWith({
        "data-site": "shop_1",
        "data-api": "https://chat-api.reserve-me.ru",
        src: "https://demo-shop1.reserve-me.ru/ago-chat.js",
      }),
    );
    expect(config.apiBaseUrl).toBe("https://chat-api.reserve-me.ru");
    expect(config.apiBaseUrl).not.toBe("https://demo-shop1.reserve-me.ru");
  });

  it("falls back to the baked-in default for an inline script, which has no src to infer from", () => {
    // No `src` attribute at all - the DOM's own `.src` getter is "" in that case, not a URL.
    expect(readConfig(scriptWith({ "data-site": "shop_1" })).apiBaseUrl).toBe("https://built-in.example");
  });

  /**
   * `about:blank` and similar give `URL#origin` the literal string `"null"` (an opaque origin, per
   * the URL Standard) rather than throwing. Falling through to the baked default is correct;
   * returning the four characters `"null"` as though it were a configured API origin is not.
   */
  it("falls back to the baked-in default rather than the string \"null\" for an opaque origin", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1", src: "about:blank" })).apiBaseUrl).toBe(
      "https://built-in.example",
    );
  });
});

// `20-07`. Down from `20-06`'s two required attributes to one boolean - the default is still what
// matters most: a shop that bought chat and not booking must not get a module chip, and must not
// have the bundle fetch a lazy module bundle it has no use for.
describe("readConfig booking module", () => {
  it("offers no booking module unless the embed asks for it", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1" })).bookingModuleEnabled).toBe(false);
  });

  it("needs the exact value \"true\", not merely the attribute's presence", () => {
    // Mirrors `data-public-demo`'s own convention (`readDemoNotice`): a typo or a stray
    // `data-booking="false"` must not silently enable a module.
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-booking": "false" })).bookingModuleEnabled).toBe(
      false,
    );
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-booking": "" })).bookingModuleEnabled).toBe(false);
  });

  it("enables the booking module on data-booking=\"true\"", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-booking": "true" })).bookingModuleEnabled).toBe(
      true,
    );
  });
});

// `20-07`. `ui/moduleLoader.ts`'s only way to find a lazy module bundle's sibling file.
describe("readConfig scriptUrl", () => {
  it("reads the script tag's own absolute src, resolved by the DOM rather than read as a raw attribute", () => {
    const config = readConfig(
      scriptWith({ "data-site": "shop_1", src: "https://cdn.example/dist/ago-chat.js" }),
    );
    expect(config.scriptUrl).toBe("https://cdn.example/dist/ago-chat.js");
  });
});
