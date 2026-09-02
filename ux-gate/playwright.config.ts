import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const PORT = 4180;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * `15-11`, this repository's harness.
 *
 * Two things differ from the consoles' identical config, both because this is not a Vite app:
 *
 * - `webServer` runs `build.mjs` and then `ux-gate/server.mjs`, ten lines of `node:http`, rather than
 *   `vite preview`. See that file for why a dependency was not added for it.
 * - The gate loads `demo/index.html` from the repository root, so the widget is measured exactly as
 *   that page loads it - hostile host-page CSS, double `<script>` inclusion and all.
 */
export default defineConfig({
  testDir: ".",
  testMatch: ["**/*.spec.ts"],
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build && node ux-gate/server.mjs`,
    // Playwright runs `webServer` from the config file's own directory, not the repository root, so
    // without this `node ux-gate/server.mjs` resolves to `ux-gate/ux-gate/server.mjs`. Stated rather
    // than fixed by making the path relative, because every other path in this file - the build, the
    // served root, `demo/index.html` - is repository-relative too, and one of them being different
    // would be the next person's afternoon.
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    // The demo page, not the origin: this server has no index at the repository root, so a readiness
    // probe against `/` waits out its whole timeout on a 404 that will never become a 200.
    url: `${BASE_URL}/demo/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // `build.mjs` refuses to run without this, on purpose - CLAUDE.md's "do not invent endpoints",
    // and there is no hosted deployment for it to default to. The value here is the same localhost
    // placeholder `demo/index.html` already carries in its own `data-api`, so the built widget and
    // the page that loads it agree; every call to it is intercepted in `fixtures/openWidget.ts` and
    // nothing ever leaves the machine.
    env: { AGO_API_BASE_URL: "http://localhost:5009" },
  },
  projects: [
    { name: "mobile-375x812", use: { viewport: { width: 375, height: 812 } } },
    { name: "desktop-1280x800", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
