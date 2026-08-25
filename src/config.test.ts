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
  it("leaves the public-demo notice off unless the embed asks for it by exact value", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1" })).isPublicDemo).toBe(false);
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "false" })).isPublicDemo).toBe(false);
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "" })).isPublicDemo).toBe(false);
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "True" })).isPublicDemo).toBe(false);
  });

  it("turns the public-demo notice on for data-public-demo=\"true\"", () => {
    expect(readConfig(scriptWith({ "data-site": "shop_1", "data-public-demo": "true" })).isPublicDemo).toBe(true);
  });
});
