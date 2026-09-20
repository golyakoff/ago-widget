import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// `build.mjs` defines __AGO_WIDGET_CSS__ from the same file, minified through esbuild's own CSS
// transform - tests get the raw, unminified text instead. Nothing here checks exact CSS bytes, so
// the difference is invisible to every test; reading the real file rather than a stand-in string
// keeps a future test that greps for a specific rule honest against the actual source.
const widgetCss = readFileSync(new URL("./src/ui/styles.css", import.meta.url), "utf8");

export default defineConfig({
  define: {
    __AGO_WIDGET_CSS__: JSON.stringify(widgetCss),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
