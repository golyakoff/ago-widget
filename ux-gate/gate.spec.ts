import { fileURLToPath } from "node:url";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { openWidget } from "./fixtures/openWidget.js";
import { measureHorizontalOverflow } from "./lib/overflow.js";
import { measureUndersizedInteractiveElements } from "./lib/minSize.js";
import { measureContrastViolations } from "./lib/contrast.js";

const MIN_INTERACTIVE_SIZE_PX = 24;
const SCREENSHOTS_DIR = fileURLToPath(new URL("./screenshots/", import.meta.url));

/**
 * `15-11`: two states rather than a list of routes. The widget has no routing - it has a launcher and
 * a panel, and every rendered pixel it owns is in one of those two states. Both are measured, because
 * the launcher is what a visitor sees on every page of a shop that never opens the chat, and the
 * panel is what they see when they do.
 */
const STATES = [
  { name: "widget-closed", open: false },
  { name: "widget-open", open: true },
];

for (const state of STATES) {
  test(state.name, async ({ page }) => {
    await openWidget(page, { open: state.open });

    const viewport = page.viewportSize();
    if (!viewport) {
      throw new Error("ux-gate: no viewport configured for this Playwright project.");
    }
    const suffix = `${viewport.width}x${viewport.height}`;

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, `${state.name}--${suffix}.png`),
      fullPage: false,
    });

    // **The overflow check measures the host page, and that is deliberate.** A widget's whole promise
    // is that it does not damage the page it is dropped onto, so "does the document scroll sideways
    // now" is the assertion that matters here - more than it does in a console, where the app *is*
    // the page. `demo/index.html`'s own hostile CSS makes this a real test rather than a formality.
    await test.step("no horizontal overflow", async () => {
      const overflow = await page.evaluate(measureHorizontalOverflow);
      expect(
        overflow.overflowPx,
        `document.documentElement.scrollWidth (${overflow.scrollWidth}px) exceeds window.innerWidth (${overflow.innerWidth}px) by ${overflow.overflowPx}px`,
      ).toBe(0);
    });

    await test.step("no undersized interactive element", async () => {
      const result = await page.evaluate(measureUndersizedInteractiveElements, MIN_INTERACTIVE_SIZE_PX);
      expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
    });

    await test.step("WCAG AA contrast", async () => {
      const result = await page.evaluate(measureContrastViolations);
      expect(result.violations, JSON.stringify(result.violations, null, 2)).toEqual([]);
    });
  });
}
