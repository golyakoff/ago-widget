import { describe, expect, it } from "vitest";
import { moduleBundleUrl } from "./moduleLoader.js";

/**
 * `20-07`: only `moduleBundleUrl`'s pure URL arithmetic is unit-tested here - `loadModule` itself is
 * a one-line wrapper around a runtime `import()` of that URL, which is exactly the browser-only
 * behaviour `ui/modules.test.ts` exercises indirectly through a mocked module loader (real dynamic
 * import of an arbitrary https:// URL is not something vitest's Node/jsdom environment does).
 */
describe("moduleBundleUrl", () => {
  it("resolves a sibling file next to the widget's own script, not the host page's own address", () => {
    expect(moduleBundleUrl("https://cdn.example/dist/widget.js", "widget-module-booking.js")).toBe(
      "https://cdn.example/dist/widget-module-booking.js",
    );
  });

  it("resolves against a path with query parameters on the widget's own script tag", () => {
    expect(moduleBundleUrl("https://cdn.example/widget.js?v=3", "widget-module-booking.js")).toBe(
      "https://cdn.example/widget-module-booking.js",
    );
  });
});
